import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  analyzePage,
  finishAnalysis,
  resolveParts,
  type ScoreDocument,
} from '#/lib/pdf/analysis/analysis.score';
import type { PageStaves } from '#/lib/pdf/staffDetection';
import { buildScoreFixture } from '#tests/unit/lib/testScoreFixture';

// `analyzeScore` goes through `loadPdfjs`, which needs a DOM; this opens the
// document the way the other pdf.js tests do.
async function openFixture(bytes: Uint8Array): Promise<ScoreDocument> {
  const doc = await pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
  }).promise;

  return {
    numPages: doc.numPages,
    getPage: (sourceIndex) => doc.getPage(sourceIndex + 1),
    ops: pdfjs.OPS,
    destroy: () => doc.destroy(),
  };
}

describe('finishAnalysis', () => {
  let doc: ScoreDocument;

  beforeAll(async () => {
    const { bytes } = await buildScoreFixture({ pageCount: 4 });
    doc = await openFixture(bytes);
  });

  afterAll(() => doc.destroy());

  it('does not depend on the order pages were detected in', async () => {
    const inOrder: PageStaves[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      inOrder.push(await analyzePage(doc, i));
    }

    const reversed: PageStaves[] = [];
    for (let i = doc.numPages - 1; i >= 0; i--) {
      reversed[i] = await analyzePage(doc, i);
    }

    const expected = await finishAnalysis(doc, inOrder);
    expect(expected.parts).toHaveLength(4);
    expect(await finishAnalysis(doc, reversed)).toEqual(expected);
  });

  it('resolves the same parts from the first page alone', async () => {
    const all: PageStaves[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      all.push(await analyzePage(doc, i));
    }

    const { parts } = await finishAnalysis(doc, all);
    expect(await resolveParts(doc, all.slice(0, 1))).toEqual(parts);
  });

  it('has no parts to resolve before any staves are in', async () => {
    expect(await resolveParts(doc, [])).toBeNull();
    const blank = { ...(await analyzePage(doc, 0)), systems: [] };
    expect(await resolveParts(doc, [blank])).toBeNull();
  });

  it('refuses pages that are missing or out of source order', async () => {
    const first = await analyzePage(doc, 0);
    const second = await analyzePage(doc, 1);

    await expect(finishAnalysis(doc, [first])).rejects.toThrow(/Page 1/);
    await expect(
      finishAnalysis(doc, [second, first, first, first]),
    ).rejects.toThrow(/Page 0/);
  });
});
