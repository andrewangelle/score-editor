/**
 * Extraction must not be music-specific. These tests drive it with hand-defined
 * rectangles on a document that has no staves at all — the same path the UI uses
 * once you drag a region yourself.
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFNumber,
  rgb,
  StandardFonts,
} from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createAnnotation } from '#/lib/pdf/annotations';
import { extractRegions } from '#/lib/pdf/partExtraction';
import { createRegion, type Region } from '#/lib/pdf/regions';

const PAGE = { width: 612, height: 792 };

/** A plain two-page report: headings, paragraphs and a boxed table. */
async function buildReport(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let p = 0; p < 2; p++) {
    const page = doc.addPage([PAGE.width, PAGE.height]);
    page.drawText(`Quarterly Report — page ${p + 1}`, {
      x: 60,
      y: 720,
      size: 16,
      font,
    });
    for (let line = 0; line < 12; line++) {
      page.drawText(`Body line ${line + 1} on page ${p + 1}`, {
        x: 60,
        y: 660 - line * 18,
        size: 10,
        font,
      });
    }
    page.drawRectangle({
      x: 60,
      y: 300,
      width: 480,
      height: 120,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    page.drawText('TABLE-MARKER', { x: 70, y: 350, size: 12, font });
  }

  return doc.save();
}

function formBoxes(doc: PDFDocument) {
  const boxes: { width: number; height: number }[] = [];
  for (const page of doc.getPages()) {
    const xobjects = page.node
      .Resources()
      ?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xobjects) continue;

    for (const key of xobjects.keys()) {
      const entry = xobjects.lookup(key);
      const dict =
        entry instanceof PDFDict
          ? entry
          : ((entry as { dict?: PDFDict })?.dict ?? null);
      const bbox = dict?.lookupMaybe(PDFName.of('BBox'), PDFArray);
      if (!bbox) continue;
      const n = (i: number) => (bbox.lookup(i) as PDFNumber).asNumber();
      boxes.push({ width: n(2) - n(0), height: n(3) - n(1) });
    }
  }
  return boxes;
}

describe('extraction on a document with no staves', () => {
  let bytes: Uint8Array;

  beforeAll(async () => {
    bytes = await buildReport();
  });

  it('cuts hand-defined rectangles from any PDF', async () => {
    const regions: Region[] = [
      createRegion(0, { left: 50, right: 560, bottom: 690, top: 740 }, 'Title'),
      createRegion(1, { left: 50, right: 560, bottom: 290, top: 430 }, 'Table'),
    ];

    const out = await extractRegions(bytes, regions, PAGE);
    const boxes = formBoxes(await PDFDocument.load(out));

    expect(boxes).toHaveLength(2);
    expect(
      boxes.map((b) => Math.round(b.height)).sort((a, b) => a - b),
    ).toEqual([50, 140]);
  });

  it('pulls a region from the second page as readily as the first', async () => {
    const region = createRegion(
      1,
      { left: 50, right: 560, bottom: 290, top: 430 },
      'Table',
    );
    const out = await extractRegions(bytes, [region], PAGE);

    const doc = await pdfjs.getDocument({
      data: out.slice(),
      isEvalSupported: false,
    }).promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const text = content.items
      .map((item) => (item as { str?: string }).str ?? '')
      .join(' ');

    expect(text).toContain('TABLE-MARKER');
  });

  it('keeps regions in the order given', async () => {
    const regions: Region[] = [
      createRegion(0, { left: 50, right: 560, bottom: 600, top: 640 }, 'A'),
      createRegion(0, { left: 50, right: 560, bottom: 500, top: 590 }, 'B'),
      createRegion(0, { left: 50, right: 560, bottom: 400, top: 490 }, 'C'),
    ];
    const out = await extractRegions(bytes, regions, PAGE);
    const boxes = formBoxes(await PDFDocument.load(out));
    expect(boxes.map((b) => Math.round(b.height))).toEqual([40, 90, 90]);
  });

  it('carries annotations that fall inside a hand-drawn region', async () => {
    const region = createRegion(
      0,
      { left: 50, right: 560, bottom: 290, top: 430 },
      'Table',
    );
    const inside = createAnnotation(0, 200, 400, 'note', 'REVIEW-THIS');
    const outside = createAnnotation(0, 200, 700, 'note', 'NOT-IN-REGION');

    const out = await extractRegions(bytes, [region], PAGE, {
      annotations: [inside, outside],
    });
    const doc = await pdfjs.getDocument({
      data: out.slice(),
      isEvalSupported: false,
    }).promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const text = content.items
      .map((item) => (item as { str?: string }).str ?? '')
      .join(' ');

    expect(text).toContain('REVIEW-THIS');
    expect(text).not.toContain('NOT-IN-REGION');
  });

  it('refuses an empty region list', async () => {
    await expect(extractRegions(bytes, [], PAGE)).rejects.toThrow(
      /Nothing to extract/,
    );
  });
});
