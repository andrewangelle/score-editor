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
