/**
 * Runs staff detection across a whole document and turns it into a part list.
 * A part is identified by its *position* within a system
 */

import { detectMarkings } from '#/lib/pdf/markings/markings';
import type { Marking } from '#/lib/pdf/markings/markings.types';
import type { Part } from '#/lib/pdf/partExtraction';
import { loadPdfjs } from '#/lib/pdf/pdfjsClient';
import {
  detectPageStaves,
  guessPartNames,
  type PageStaves,
  type PdfOps,
  type StaffSourcePage,
} from '#/lib/pdf/staffDetection';

export type ScorePage = PageStaves & { markings: Marking[] };

export type ScoreAnalysis = {
  pages: ScorePage[];
  parts: Part[];
  /** Systems whose staff count disagrees with the part list, for warning the user. */
  irregularSystems: {
    pageIndex: number;
    systemIndex: number;
    staves: number;
  }[];
};

export const COULD_NOT_ANALYZE =
  'This document could not be analysed as a score.';

export class ScoreAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoreAnalysisError';
  }
}

function ordinalName(index: number, guessed: string | null): string {
  const clean = guessed?.replace(/[^\p{L}\p{N}\s.#'-]/gu, '').trim();
  return clean && clean.length <= 40 ? clean : `Staff ${index + 1}`;
}

/**
 * PDFs with nested form XObjects (e.g. an extraction of an extraction) cause
 * pdf.js to expand every layer, producing hundreds of thousands of operators
 * per page. Processing that many operators synchronously in `collectGeometry`
 * freezes the main thread, so we bail before it starts.
 */
const MAX_PAGE_OPERATORS = 200_000;

/**
 * An open pdf.js document, narrowed to what analysis reads. Pages are addressed
 * by source index.
 */
export type ScoreDocument = {
  numPages: number;
  getPage(sourceIndex: number): Promise<StaffSourcePage>;
  ops: PdfOps;
  destroy(): Promise<void>;
};

export async function openScoreDocument(
  bytes: Uint8Array,
): Promise<ScoreDocument> {
  const pdfjs = await loadPdfjs();
  // The slice is load-bearing: the caller's buffer is read again by extract and
  // save, and the pdf.js worker detaches whatever it is handed.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;

  return {
    numPages: doc.numPages,
    getPage: (sourceIndex) => doc.getPage(sourceIndex + 1),
    ops: pdfjs.OPS,
    destroy: () => doc.destroy(),
  };
}

/** Detection for one page, still carrying the `ink` and `text` markings need. */
export async function analyzePage(
  doc: ScoreDocument,
  sourceIndex: number,
): Promise<PageStaves> {
  const page = await doc.getPage(sourceIndex);
  const operators = await page.getOperatorList();

  if (operators.fnArray.length > MAX_PAGE_OPERATORS) {
    throw new ScoreAnalysisError(
      'This file contains too many drawing layers for staff detection. ' +
        'If it is an extracted part, open the original score to detect and re-extract parts.',
    );
  }

  return detectPageStaves(page, sourceIndex, doc.ops, undefined, operators);
}

/**
 * `ink`, `frames` and `text` run to thousands of entries per page. The store
 * holds what this returns, so it must not carry them.
 */
export function toStoredPage(
  { ink: _ink, frames: _frames, text: _text, ...page }: PageStaves,
  markings: Marking[] = [],
): ScorePage {
  return { ...page, markings };
}

/** The document-wide pass. `detected` must hold every page, in source order. */
export async function finishAnalysis(
  doc: ScoreDocument,
  detected: readonly PageStaves[],
): Promise<ScoreAnalysis> {
  // Markings resolve in reading order, and callers may detect pages in any order.
  for (let i = 0; i < doc.numPages; i++) {
    if (detected[i]?.pageIndex !== i) {
      throw new Error(`Page ${i} is missing or out of source order.`);
    }
  }

  const markings = detectMarkings(
    detected,
    detected.map((page) => page.text ?? []),
  );

  const pages = detected.map((page, i) => toStoredPage(page, markings[i]));

  const firstSystem = pages
    .flatMap((page) => page.systems)
    .find((system) => system.staves.length > 0);

  if (!firstSystem) {
    throw new ScoreAnalysisError(
      'No staves were found. This tool reads engraved scores; scanned or photographed music has no vector staff lines to detect.',
    );
  }

  const labelPage = pages.find((page) => page.systems.includes(firstSystem));
  const guessed = labelPage
    ? await guessPartNames(
        await doc.getPage(labelPage.pageIndex),
        firstSystem,
        labelPage.clips,
      )
    : firstSystem.staves.map(() => null);

  const parts: Part[] = firstSystem.staves.map((_, ordinal) => ({
    id: `part-${ordinal}`,
    ordinal,
    name: ordinalName(ordinal, guessed[ordinal] ?? null),
  }));

  const irregularSystems = pages.flatMap((page) =>
    page.systems
      .map((system, systemIndex) => ({
        pageIndex: page.pageIndex,
        systemIndex,
        staves: system.staves.length,
      }))
      .filter((entry) => entry.staves !== parts.length),
  );

  return { pages, parts, irregularSystems };
}

export async function analyzeScore(bytes: Uint8Array): Promise<ScoreAnalysis> {
  const doc = await openScoreDocument(bytes);

  try {
    const detected: PageStaves[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      detected.push(await analyzePage(doc, i));
    }
    return await finishAnalysis(doc, detected);
  } finally {
    await doc.destroy();
  }
}

export function getAnalyseScoreError(cause: unknown) {
  if (cause instanceof Error) {
    return cause.message;
  }
  return COULD_NOT_ANALYZE;
}
