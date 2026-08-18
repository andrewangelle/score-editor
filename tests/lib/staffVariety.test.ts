/**
 * Guards the parts of detection that must not assume anything about the score:
 * how many instruments it has, and how many lines each of their staves uses.
 */

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractParts, planBands, staffBounds } from '#/lib/pdf/partExtraction';
import { detectPageStaves, type PageStaves } from '#/lib/pdf/staffDetection';
import { buildScoreFixture } from '#tests/lib/testScoreFixture';

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

describe('any number of instruments', () => {
  const ensembles: [string, string[]][] = [
    ['solo', ['Vln']],
    ['duo', ['Fl', 'Pno']],
    ['band', ['Tpt', 'Sax', 'Tbn', 'Gtr', 'Pno', 'Bass', 'Dr']],
    ['large ensemble', Array.from({ length: 12 }, (_, i) => `Inst ${i + 1}`)],
  ];

  it.each(ensembles)('detects a %s', async (_label, partNames) => {
    const { bytes } = await buildScoreFixture({
      partNames,
      pageCount: 1,
      systemsPerPage: partNames.length > 6 ? 1 : 2,
      lineSpacing: 5,
      staffGap: 20,
      systemGap: 60,
    });

    const pages = await analyse(bytes);
    expect(pages[0].systems.length).toBeGreaterThan(0);
    for (const system of pages[0].systems) {
      expect(system.staves).toHaveLength(partNames.length);
    }
  });

  it.each(ensembles)('extracts a subset of a %s', async (_label, partNames) => {
    const { bytes } = await buildScoreFixture({
      partNames,
      pageCount: 1,
      systemsPerPage: partNames.length > 6 ? 1 : 2,
      lineSpacing: 5,
      staffGap: 20,
      systemGap: 60,
    });

    const pages = await analyse(bytes);
    // Non-contiguous where there is room for it, to exercise multi-band systems.
    const pick = partNames.length > 2 ? [0, 2] : [0];
    expect(planBands(pages, pick).length).toBeGreaterThan(0);
    const out = await extractParts(bytes, pages, pick);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('staves that are not five lines', () => {
  // Standard notation, guitar TAB, one-line percussion, standard notation.
  const partNames = ['Gtr (notation)', 'Gtr (TAB)', 'Perc', 'Bass'];
  const lineCounts = [5, 6, 1, 5];
  let pages: PageStaves[];
  let bytes: Uint8Array;

  beforeAll(async () => {
    const fixture = await buildScoreFixture({
      partNames,
      lineCounts,
      pageCount: 1,
      systemsPerPage: 2,
      lineSpacing: 6,
      staffGap: 34,
      systemGap: 80,
    });
    bytes = fixture.bytes;
    pages = await analyse(bytes);
  });

  it('finds all four staves despite the differing line counts', () => {
    for (const system of pages[0].systems) {
      expect(system.staves).toHaveLength(partNames.length);
    }
  });

  it('reports the true line count of each staff', () => {
    for (const system of pages[0].systems) {
      expect(system.staves.map((staff) => staff.lineCount)).toEqual(lineCounts);
    }
  });

  it('keeps every line of the six-line TAB staff inside its band', () => {
    const system = pages[0].systems[0];
    const tab = system.staves[1];
    const bounds = staffBounds(system, 1);

    expect(tab.lineCount).toBe(6);
    // The band must fully contain the staff, top line to bottom line.
    expect(bounds.top).toBeGreaterThan(tab.top);
    expect(bounds.bottom).toBeLessThan(tab.bottom);
  });

  it('gives the one-line percussion staff a usable band rather than none', () => {
    const system = pages[0].systems[0];
    const perc = system.staves[2];
    const bounds = staffBounds(system, 2);

    expect(perc.lineCount).toBe(1);
    expect(perc.top).toBe(perc.bottom);
    // A zero-height staff would otherwise produce a zero-height band.
    expect(bounds.top - bounds.bottom).toBeGreaterThan(10);
  });

  it('extracts the TAB staff on its own', async () => {
    const out = await extractParts(bytes, pages, [1]);
    expect(out.length).toBeGreaterThan(0);
  });
});

/**
 * A real score is full of long horizontals that are not staff lines, and every
 * one of them read as a staff — or as a line of one — shifts the ordinals of
 * everything below it. Since a part is identified by its ordinal within the
 * system, that is not a cosmetic error: extracting "guitars 1 and 2" from an
 * affected system silently cuts the tenor sax, or the vocals, instead.
 *
 * Drawn from a 239-page orchestral score where 57 systems were misread this way.
 */
describe('decoys that a real engraving draws against its staves', () => {
  const partNames = ['Gtr 1', 'Gtr 2', 'Perc', 'Bass'];
  const lineCounts = [5, 6, 1, 5];
  let pages: PageStaves[];
  let bytes: Uint8Array;

  beforeAll(async () => {
    const fixture = await buildScoreFixture({
      partNames,
      lineCounts,
      pageCount: 1,
      systemsPerPage: 2,
      lineSpacing: 6,
      staffGap: 44,
      systemGap: 90,
      staffLineDecoys: true,
    });
    bytes = fixture.bytes;
    pages = await analyse(bytes);
  });

  it('finds exactly one staff per part, inventing none', () => {
    expect(pages[0].systems).toHaveLength(2);
    for (const system of pages[0].systems) {
      expect(system.staves).toHaveLength(partNames.length);
    }
  });

  it('keeps the one-line percussion staff while rejecting the stray lines', () => {
    // Both are a single long rule. Only one of them runs the full system.
    expect(pages[0].systems).toHaveLength(2);
    for (const system of pages[0].systems) {
      expect(system.staves.map((staff) => staff.lineCount)).toEqual(lineCounts);
    }
  });

  it('holds each staff line at its engraved height despite the beams', () => {
    // Beams sit a fraction of a line-space off the middle line. Averaged into
    // it, they drag it far enough that the staff stops looking evenly spaced
    // and is discarded whole — which is how a part vanishes from a page.
    const staves = pages[0].systems.flatMap((system) => system.staves);
    expect(staves).toHaveLength(2 * partNames.length);

    for (const staff of staves) {
      if (staff.lineCount < 2) continue;
      expect(staff.lineSpacing).toBeCloseTo(6, 1);
    }
  });

  it('cuts the bands the ordinals name, not their neighbours', async () => {
    const bands = planBands(pages, [0, 1]);
    expect(bands).toHaveLength(pages[0].systems.length);

    for (const band of bands) {
      const system = pages[0].systems.find(
        (candidate) => `0:${pages[0].systems.indexOf(candidate)}` === band.groupKey,
      );
      if (!system) throw new Error('band without a system');

      // Inside the two guitars, clear of the percussion staff below them.
      expect(band.rect.top).toBeLessThan(system.staves[0].top + 40);
      expect(band.rect.bottom).toBeGreaterThan(system.staves[2].top);
    }

    expect((await extractParts(bytes, pages, [0, 1])).length).toBeGreaterThan(0);
  });
});

describe('rules that are not staff lines', () => {
  it('rejects a row of ledger lines that together span the system', async () => {
    // The fixture draws four short ledger lines at a common height above every
    // staff. They span nearly the full width between them, so anything judging
    // a rule by its span rather than its coverage counts them as a staff line
    // and shifts the detected staff upward by one line.
    const { bytes } = await buildScoreFixture({
      pageCount: 1,
      systemsPerPage: 1,
    });
    const pages = await analyse(bytes);

    for (const staff of pages[0].systems[0].staves) {
      expect(staff.lineCount).toBe(5);
    }
  });
});
