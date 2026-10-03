import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  analyzePage,
  finishAnalysis,
  type ScoreDocument,
} from '#/lib/pdf/scoreAnalysis';
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

  it('refuses pages that are missing or out of source order', async () => {
    const first = await analyzePage(doc, 0);
    const second = await analyzePage(doc, 1);

    await expect(finishAnalysis(doc, [first])).rejects.toThrow(/Page 1/);
    await expect(
      finishAnalysis(doc, [second, first, first, first]),
    ).rejects.toThrow(/Page 0/);
  });
});
