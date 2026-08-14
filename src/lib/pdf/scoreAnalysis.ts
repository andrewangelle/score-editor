/**
 * Runs staff detection across a whole document and turns it into a part list.
 *
 * A part is identified by its *position* within a system, not by its name:
 * engravers print instrument names only on the first system and abbreviate or
 * omit them thereafter, but staff order is fixed for the whole score. Names are
 * read off the first system purely so the UI has something human to show.
 */

import { detectMarkings, type Marking } from '#/lib/pdf/markings';
import type { Part } from '#/lib/pdf/partExtraction';
import { loadPdfjs } from '#/lib/pdf/pdfjsClient';
import {
  detectPageStaves,
  guessPartNames,
  type PageStaves,
} from '#/lib/pdf/staffDetection';

/**
 * A page's staves plus the markings that belong to them. Markings can only be
 * settled with the whole document in view — see `markings.ts` — so they are
 * attached here rather than by the per-page staff finder.
 */
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

export async function analyzeScore(bytes: Uint8Array): Promise<ScoreAnalysis> {
  const pdfjs = await loadPdfjs();
  // pdf.js detaches the buffer it is given, so it never sees the pristine copy.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;

  try {
    const detected: PageStaves[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      detected.push(await detectPageStaves(page, i, pdfjs.OPS));
    }

    const markings = detectMarkings(
      detected,
      detected.map((page) => page.text ?? []),
    );

    // `ink` and `text` run to thousands of entries per page and have done their
    // job by now. This analysis is held in the store, so it must not carry them
    // any further.
    const pages: ScorePage[] = detected.map(
      ({ ink: _ink, text: _text, ...page }, i) => ({
        ...page,
        markings: markings[i] ?? [],
      }),
    );

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
          await doc.getPage(labelPage.pageIndex + 1),
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
  } finally {
    await doc.destroy();
  }
}
