/**
 * How real engraved PDFs are actually drawn, and what that costs a detector
 * that does not account for it.
 *
 * Notation software batches many lines into one path operation. A detector that
 * reads only the bounding box pdf.js reports per path sees a whole staff as one
 * tall blob and finds nothing — on a real 8-instrument score that produced a
 * single unusable region. These tests pin the behaviour that fixes it.
 */

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { staffBounds } from '#/lib/pdf/regions';
import {
  detectPageStaves,
  type PageStaves,
  subpathBoxes,
} from '#/lib/pdf/staffDetection';
import { buildScoreFixture } from '#tests/lib/testScoreFixture';

/** The widest a path can be and still not be a plausible staff line. */
const STAFF_LINE_WIDTH = 400;
const RULE_THICKNESS = 2.5;

async function analyse(bytes: Uint8Array): Promise<PageStaves[]> {
  const doc = await pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
  }).promise;

  const pages: PageStaves[] = [];
  for (let i = 0; i < doc.numPages; i++) {
    pages.push(await detectPageStaves(await doc.getPage(i + 1), i, pdfjs.OPS));
  }
  await doc.destroy();
  return pages;
}

/** Every constructPath's aggregate bounding box on page 1. */
async function pathBoxes(
  bytes: Uint8Array,
): Promise<{ width: number; height: number }[]> {
  const doc = await pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
  }).promise;
  const ops = await (await doc.getPage(1)).getOperatorList();

  const boxes: { width: number; height: number }[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] !== pdfjs.OPS.constructPath) continue;
    const box = ops.argsArray[i]?.[2] as ArrayLike<number> | undefined;
    if (!box || box.length < 4) continue;
    boxes.push({ width: box[2] - box[0], height: box[3] - box[1] });
  }
  await doc.destroy();
  return boxes;
}

describe('decoding a path into its subpaths', () => {
  it('splits a run of moveTo/lineTo pairs into one box each', () => {
    // Two horizontal lines, the way a two-line staff would be emitted.
    const boxes = subpathBoxes([
      0, 10, 100, 1, 200, 100, 0, 10, 90, 1, 200, 90,
    ]);

    expect(boxes).toEqual([
      { left: 10, right: 200, bottom: 100, top: 100 },
      { left: 10, right: 200, bottom: 90, top: 90 },
    ]);
  });

  it('folds curve control points into the box', () => {
    // A curve bulging above its endpoints must not be measured as flat.
    const boxes = subpathBoxes([0, 0, 0, 2, 10, 50, 20, 50, 30, 0]);

    expect(boxes).toEqual([{ left: 0, right: 30, bottom: 0, top: 50 }]);
  });

  it('treats closePath as part of the subpath it ends', () => {
    const boxes = subpathBoxes([0, 0, 0, 1, 10, 0, 1, 10, 5, 3]);

    expect(boxes).toEqual([{ left: 0, right: 10, bottom: 0, top: 5 }]);
  });

  it('gives up on an encoding it does not recognise', () => {
    // Callers fall back to the aggregate box rather than trusting a guess.
    expect(subpathBoxes([9, 1, 2])).toBeNull();
    expect(subpathBoxes([0, 1])).toBeNull();
  });
});

describe('a score engraved the way real software engraves it', () => {
  let bytes: Uint8Array;
  let pages: PageStaves[];
  const partNames = [
    'A.Sax',
    'T.Sax',
    'Voice',
    'Gtr 1',
    'Gtr 2',
    'Bass',
    'Tuba',
    'Drums',
  ];

  beforeAll(async () => {
    ({ bytes } = await buildScoreFixture({
      partNames,
      pageCount: 1,
      systemsPerPage: 1,
    }));
    pages = await analyse(bytes);
  });

  it('emits no path whose own bounding box looks like a staff line', async () => {
    // The premise of the other tests in this block: reading the aggregate box
    // finds nothing here, because each staff is one path of five subpaths.
    const boxes = await pathBoxes(bytes);
    const ruleShaped = boxes.filter(
      (box) => box.width >= STAFF_LINE_WIDTH && box.height <= RULE_THICKNESS,
    );

    expect(boxes.length).toBeGreaterThan(0);
    expect(ruleShaped).toEqual([]);
  });

  it('still finds every staff', () => {
    const system = pages[0].systems[0];
    expect(pages[0].systems).toHaveLength(1);
    expect(system.staves).toHaveLength(partNames.length);
    expect(system.staves.map((staff) => staff.lineCount)).toEqual(
      partNames.map(() => 5),
    );
  });

  it('keeps all eight staves in one system rather than one system each', () => {
    // The failure the user hit: eight instruments collapsing to a single
    // one-staff part list, because every staff became its own system.
    expect(pages[0].systems).toHaveLength(1);
    expect(pages[0].systems[0].staves).toHaveLength(8);
  });
});

describe('a producer that draws one path per line', () => {
  it('is detected just as well', async () => {
    const { bytes } = await buildScoreFixture({
      batchedPaths: false,
      pageCount: 1,
      systemsPerPage: 1,
      partNames: ['Gtr 1', 'Gtr 2', 'Bass'],
    });
    const pages = await analyse(bytes);

    expect(pages[0].systems).toHaveLength(1);
    expect(pages[0].systems[0].staves).toHaveLength(3);
  });
});

describe('telling a system apart from a page of single-staff systems', () => {
  it('does not join staves that no barline connects', async () => {
    // A lead sheet: four one-staff systems down the page. The spacing here is
    // indistinguishable from an orchestral system's, so only the absence of a
    // connecting barline separates them.
    const { bytes } = await buildScoreFixture({
      pageCount: 1,
      systemsPerPage: 4,
      partNames: ['Voice'],
    });
    const pages = await analyse(bytes);

    expect(pages[0].systems).toHaveLength(4);
    for (const system of pages[0].systems) {
      expect(system.staves).toHaveLength(1);
    }
  });
});

describe('bands that keep what belongs to their staff', () => {
  it('grows past the halfway line to keep a high chord on its ledger lines', async () => {
    const lineSpacing = 6;
    const staffGap = 30;
    const { bytes } = await buildScoreFixture({
      pageCount: 1,
      systemsPerPage: 1,
      partNames: ['Voice', 'Gtr 1', 'Bass'],
      lineSpacing,
      staffGap,
      // Reaches well above the midpoint between this staff and the one above.
      highNotes: { ordinal: 1, reach: 22 },
    });

    const pages = await analyse(bytes);
    const system = pages[0].systems[0];
    const staff = system.staves[1];
    const above = system.staves[0];
    const band = staffBounds(system, 1);
    const midpoint = (staff.top + above.bottom) / 2;

    // The chord's topmost ledger line is inside the band...
    expect(staff.contentTop).toBeGreaterThan(staff.top + 18);
    expect(band.top).toBeGreaterThan(midpoint);
    // ...and the staff above keeps its own lines to itself.
    expect(band.top).toBeLessThan(above.bottom);
  });

  it('leaves a staff with nothing above it at its own height', async () => {
    const { bytes } = await buildScoreFixture({
      pageCount: 1,
      systemsPerPage: 1,
      partNames: ['Voice', 'Gtr 1'],
    });
    const pages = await analyse(bytes);
    const system = pages[0].systems[0];

    for (let i = 0; i < system.staves.length; i++) {
      const band = staffBounds(system, i);
      expect(band.top).toBeGreaterThan(system.staves[i].top);
      expect(band.bottom).toBeLessThan(system.staves[i].bottom);
    }
  });
});
