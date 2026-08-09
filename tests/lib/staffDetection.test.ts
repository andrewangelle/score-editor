import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFNumber,
} from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createAnnotation } from '#/lib/pdf/annotations';
import { extractParts, layoutBands, planBands } from '#/lib/pdf/partExtraction';
import {
  detectPageStaves,
  guessPartNames,
  type PageStaves,
} from '#/lib/pdf/staffDetection';
import {
  buildScoreFixture,
  FIXTURE_DEFAULTS,
  PAGE_HEIGHT,
} from '#tests/lib/testScoreFixture';

/** Bounding boxes of the form XObjects `embedPage` produced, in band space. */
function embeddedFormBoxes(doc: PDFDocument) {
  const boxes: { left: number; bottom: number; right: number; top: number }[] =
    [];

  for (const page of doc.getPages()) {
    const resources = page.node.Resources();
    const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xobjects) continue;

    for (const key of xobjects.keys()) {
      // A form XObject is a stream; its BBox lives on the stream's dictionary.
      const entry = xobjects.lookup(key);
      const form =
        entry instanceof PDFDict
          ? entry
          : ((entry as { dict?: PDFDict })?.dict ?? null);
      const bbox = form?.lookupMaybe(PDFName.of('BBox'), PDFArray);
      if (!bbox) continue;
      const n = (i: number) => (bbox.lookup(i) as PDFNumber).asNumber();
      boxes.push({ left: n(0), bottom: n(1), right: n(2), top: n(3) });
    }
  }

  return boxes;
}

function countEmbeddedForms(doc: PDFDocument): number {
  return embeddedFormBoxes(doc).length;
}

async function analyse(bytes: Uint8Array): Promise<PageStaves[]> {
  const doc = await pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
  }).promise;

  const pages: PageStaves[] = [];
  for (let i = 0; i < doc.numPages; i++) {
    pages.push(await detectPageStaves(await doc.getPage(i + 1), i, pdfjs.OPS));
  }
  return pages;
}

describe('staff detection', () => {
  let bytes: Uint8Array;
  let pages: PageStaves[];

  beforeAll(async () => {
    bytes = (await buildScoreFixture()).bytes;
    pages = await analyse(bytes);
  });

  it('finds every system on every page', () => {
    expect(pages).toHaveLength(FIXTURE_DEFAULTS.pageCount);
    for (const page of pages) {
      expect(page.systems).toHaveLength(FIXTURE_DEFAULTS.systemsPerPage);
    }
  });

  it('finds one staff per part in each system', () => {
    for (const page of pages) {
      for (const system of page.systems) {
        expect(system.staves).toHaveLength(FIXTURE_DEFAULTS.partNames.length);
      }
    }
  });

  it('rejects barlines, beams and ledger lines', () => {
    // Any of those leaking through would inflate the staff count above.
    const total = pages.flatMap((p) => p.systems).flatMap((s) => s.staves);
    expect(total).toHaveLength(
      FIXTURE_DEFAULTS.pageCount *
        FIXTURE_DEFAULTS.systemsPerPage *
        FIXTURE_DEFAULTS.partNames.length,
    );
  });

  it('recovers the engraving scale', () => {
    for (const system of pages[0].systems) {
      for (const staff of system.staves) {
        expect(staff.lineSpacing).toBeCloseTo(FIXTURE_DEFAULTS.lineSpacing, 1);
        expect(staff.top - staff.bottom).toBeCloseTo(
          FIXTURE_DEFAULTS.lineSpacing * 4,
          1,
        );
      }
    }
  });

  it('orders staves top to bottom within a system', () => {
    for (const system of pages[0].systems) {
      const tops = system.staves.map((s) => s.top);
      expect([...tops].sort((a, b) => b - a)).toEqual(tops);
    }
  });

  it('orders systems top to bottom on a page', () => {
    const tops = pages[0].systems.map((s) => s.top);
    expect([...tops].sort((a, b) => b - a)).toEqual(tops);
  });

  it('reads instrument names off the first system', async () => {
    const doc = await pdfjs.getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
    }).promise;
    const names = await guessPartNames(
      await doc.getPage(1),
      pages[0].systems[0],
    );
    expect(names).toEqual(FIXTURE_DEFAULTS.partNames);
  });

  it('survives a tighter engraving where systems nearly touch', async () => {
    const tight = await buildScoreFixture({
      lineSpacing: 4,
      staffGap: 16,
      systemGap: 34,
      systemsPerPage: 2,
      pageCount: 1,
    });
    const detected = await analyse(tight.bytes);
    expect(detected[0].systems).toHaveLength(2);
    for (const system of detected[0].systems) {
      expect(system.staves).toHaveLength(4);
    }
  });

  it('handles a single system per page, where there is no gap to split on', async () => {
    const single = await buildScoreFixture({
      systemsPerPage: 1,
      pageCount: 1,
    });
    const detected = await analyse(single.bytes);
    expect(detected[0].systems).toHaveLength(1);
    expect(detected[0].systems[0].staves).toHaveLength(4);
  });
});

describe('band planning', () => {
  let pages: PageStaves[];

  beforeAll(async () => {
    pages = await analyse((await buildScoreFixture()).bytes);
  });

  it('merges adjacent parts into one band so barlines survive', () => {
    const bands = planBands(pages, [2, 3]);
    expect(bands).toHaveLength(
      FIXTURE_DEFAULTS.pageCount * FIXTURE_DEFAULTS.systemsPerPage,
    );
    for (const band of bands) expect(band.ordinals).toEqual([2, 3]);
  });

  it('emits separate bands for non-adjacent parts', () => {
    const bands = planBands(pages, [0, 3]);
    expect(bands).toHaveLength(
      FIXTURE_DEFAULTS.pageCount * FIXTURE_DEFAULTS.systemsPerPage * 2,
    );
    expect(bands.map((b) => b.ordinals)).toContainEqual([0]);
    expect(bands.map((b) => b.ordinals)).toContainEqual([3]);
  });

  it('keeps bands inside the page and clear of neighbouring staves', () => {
    const bands = planBands(pages, [1]);
    for (const band of bands) {
      expect(band.rect.bottom).toBeGreaterThanOrEqual(0);
      expect(band.rect.top).toBeLessThanOrEqual(PAGE_HEIGHT);
      expect(band.rect.top).toBeGreaterThan(band.rect.bottom);
    }

    // The band around Bass must not reach the Drums staff above it.
    const system = pages[0].systems[0];
    const drumsBottom = system.staves[0].bottom;
    expect(bands[0].rect.top).toBeLessThan(drumsBottom);
  });

  it('never splits one system across two output pages', () => {
    const bands = planBands(pages, [0, 2]);
    const laid = layoutBands(bands, PAGE_HEIGHT);

    const seen = new Map<string, number>();
    laid.forEach((page, index) => {
      for (const placed of page) {
        const key = placed.region.groupKey;
        const previous = seen.get(key);
        expect(previous === undefined || previous === index).toBe(true);
        seen.set(key, index);
      }
    });
  });

  it('lays bands out top-down without overlapping', () => {
    const laid = layoutBands(planBands(pages, [2, 3]), PAGE_HEIGHT);
    for (const page of laid) {
      for (let i = 0; i < page.length - 1; i++) {
        const height = page[i].region.rect.top - page[i].region.rect.bottom;
        expect(page[i].y).toBeGreaterThanOrEqual(
          page[i + 1].y +
            (page[i + 1].region.rect.top - page[i + 1].region.rect.bottom),
        );
        expect(height).toBeGreaterThan(0);
      }
    }
  });
});

describe('part extraction', () => {
  let bytes: Uint8Array;
  let pages: PageStaves[];

  beforeAll(async () => {
    bytes = (await buildScoreFixture()).bytes;
    pages = await analyse(bytes);
  });

  it('produces a valid PDF with one clipped form per band', async () => {
    const out = await extractParts(bytes, pages, [2, 3]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBeGreaterThan(0);
    expect(countEmbeddedForms(doc)).toBe(
      FIXTURE_DEFAULTS.pageCount * FIXTURE_DEFAULTS.systemsPerPage,
    );
  });

  it('clips each form to exactly the planned band', async () => {
    const bands = planBands(pages, [2, 3]);
    const out = await extractParts(bytes, pages, [2, 3]);
    const boxes = embeddedFormBoxes(await PDFDocument.load(out));

    const expected = bands
      .map(
        (b) =>
          `${(b.rect.right - b.rect.left).toFixed(1)}x${(b.rect.top - b.rect.bottom).toFixed(1)}`,
      )
      .sort();
    const actual = boxes
      .map(
        (b) =>
          `${(b.right - b.left).toFixed(1)}x${(b.top - b.bottom).toFixed(1)}`,
      )
      .sort();
    expect(actual).toEqual(expected);
  });

  it('clips a band tall enough for its two staves but not the third', async () => {
    const out = await extractParts(bytes, pages, [2, 3]);
    const boxes = embeddedFormBoxes(await PDFDocument.load(out));
    const system = pages[0].systems[0];
    const twoStaves = system.staves[2].top - system.staves[3].bottom;
    const threeStaves = system.staves[1].top - system.staves[3].bottom;

    for (const box of boxes) {
      const height = box.top - box.bottom;
      expect(height).toBeGreaterThan(twoStaves);
      expect(height).toBeLessThan(threeStaves);
    }
  });

  /**
   * Clipping in PDF hides content, it does not delete it: the unselected parts
   * are still in the byte stream behind each form's bounding box. This is true
   * of every non-rasterising crop, Acrobat's included. Pinned as a test so the
   * behaviour is a known property rather than a later surprise.
   */
  it('hides rather than deletes the unselected parts', async () => {
    const out = await extractParts(bytes, pages, [2, 3]);
    const doc = await pdfjs.getDocument({
      data: out.slice(),
      isEvalSupported: false,
    }).promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const text = content.items
      .map((item) => (item as { str?: string }).str ?? '')
      .join('');

    expect(text).toContain('Gtr 1');
    expect(text).toContain('Drums');
  });

  it('keeps the content vectorial rather than rasterising it', async () => {
    const out = await extractParts(bytes, pages, [2, 3]);
    const doc = await pdfjs.getDocument({
      data: out.slice(),
      isEvalSupported: false,
    }).promise;
    const list = await (await doc.getPage(1)).getOperatorList();
    expect(list.fnArray).toContain(pdfjs.OPS.constructPath);
    expect(list.fnArray).not.toContain(pdfjs.OPS.paintImageXObject);
  });

  it('refuses an empty selection rather than writing a blank file', async () => {
    await expect(extractParts(bytes, pages, [])).rejects.toThrow(/No staves/);
  });

  it('carries annotations that fall inside an extracted band', async () => {
    const staff = pages[0].systems[0].staves[2];
    const inside = createAnnotation(
      0,
      200,
      staff.top - 4,
      'fingering',
      'FINGERING-MARK',
    );
    const outside = createAnnotation(
      0,
      200,
      pages[0].systems[0].staves[0].top - 4,
      'note',
      'DRUMS-ONLY-MARK',
    );

    const out = await extractParts(bytes, pages, [2, 3], {
      annotations: [inside, outside],
    });
    const doc = await pdfjs.getDocument({
      data: out.slice(),
      isEvalSupported: false,
    }).promise;

    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      text += content.items
        .map((item) => (item as { str?: string }).str ?? '')
        .join('');
    }

    expect(text).toContain('FINGERING-MARK');
    // The drums annotation belongs to a band that was not extracted.
    expect(text).not.toContain('DRUMS-ONLY-MARK');
  });
});
