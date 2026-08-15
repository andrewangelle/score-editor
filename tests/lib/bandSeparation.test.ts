/**
 * Bands cut from different systems must not overlap.
 *
 * `contentTop`/`contentBottom` are grown by chaining outwards from a staff
 * through whatever ink is near it, which is what keeps a dynamic or a ledger
 * line with the music it belongs to. But the chain has no idea where one system
 * ends and the next begins: give it stepping stones across the gap and it will
 * walk from a staff straight into the system below.
 *
 * A column of performance marks is exactly such a staircase — which is how this
 * surfaced. Marks written under a staff, baked into the file on save and read
 * back when it was reopened, joined every system on the page to its neighbour;
 * each band then claimed the whole gap and the regions drawn on screen sat on
 * top of one another.
 *
 * A single-staff score is where it bites, because there the staff above and
 * below are always different music and the within-system sharing rule never
 * applies.
 */

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createAnnotation, type ScoreAnnotation } from '#/lib/pdf/annotations';
import { buildEditedPdf } from '#/lib/pdf/document';
import { type Region, regionsFromParts, staffBounds } from '#/lib/pdf/regions';
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

/** Pairs of regions on one page that cover any of the same page. */
function overlappingPairs(regions: readonly Region[]): string[] {
  const clashes: string[] = [];
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i];
      const b = regions[j];
      if (a.pageIndex !== b.pageIndex) continue;
      if (a.rect.bottom < b.rect.top && b.rect.bottom < a.rect.top) {
        clashes.push(
          `${i}[${a.rect.bottom}..${a.rect.top}] over ${j}[${b.rect.bottom}..${b.rect.top}]`,
        );
      }
    }
  }
  return clashes;
}

/** A one-guitar score: five systems down the page, one staff each. */
const SINGLE_STAFF = {
  pageCount: 1,
  systemsPerPage: 5,
  partNames: ['Gtr 2'],
  lineSpacing: 6,
  systemGap: 70,
};

/** The staircase: marks stepping down from the staff towards the next system. */
function marksUnder(staffBottom: number, steps: number): ScoreAnnotation[] {
  return Array.from({ length: steps }, (_, i) =>
    createAnnotation(
      0,
      150,
      staffBottom - (i + 1) * 8,
      i % 2 === 0 ? 'fingering' : 'string',
      i % 2 === 0 ? '1 3 2 4' : '3',
    ),
  );
}

describe('bands of adjacent systems', () => {
  let plain: PageStaves[];
  let annotated: PageStaves[];

  beforeAll(async () => {
    const { bytes } = await buildScoreFixture(SINGLE_STAFF);
    plain = await analyse(bytes);

    const first = plain[0].systems[0].staves[0];
    const saved = await buildEditedPdf(
      bytes,
      [{ id: 'p0', sourceIndex: 0, rotation: 0 }],
      [
        ...marksUnder(first.bottom, 8),
        createAnnotation(0, 250, first.top + 8, 'position', '7'),
      ],
    );
    annotated = await analyse(saved);
  });

  it('reads the same five systems either way', () => {
    // The marks must not change what the page *is*, only how far each staff's
    // content reaches — otherwise this test would be measuring the wrong thing.
    expect(plain[0].systems).toHaveLength(5);
    expect(annotated[0].systems).toHaveLength(5);
  });

  it('lets the marks bridge the gap between systems', () => {
    // Not the bug — this is the chaining doing its job, and the guard for the
    // rest of this file: without it the fix below would be untested.
    const [first, second] = annotated[0].systems.map(
      (system) => system.staves[0],
    );

    expect(first.contentBottom).toBeLessThanOrEqual(second.top);
    expect(second.contentTop).toBeGreaterThanOrEqual(first.bottom);
  });

  it('still cuts bands that do not overlap', () => {
    const regions = regionsFromParts(annotated, [0], ['Gtr 2']);

    expect(overlappingPairs(regions)).toEqual([]);
  });

  it('meets its neighbour halfway rather than swallowing it', () => {
    const [first, second] = annotated[0].systems.map(
      (system) => system.staves[0],
    );
    const halfway = (first.bottom + second.top) / 2;
    const regions = regionsFromParts(annotated, [0], ['Gtr 2']);

    expect(regions[0].rect.bottom).toBeCloseTo(halfway);
    expect(regions[1].rect.top).toBeCloseTo(halfway);
  });

  it('keeps the marks it grew to hold', () => {
    // Capping at the halfway line must not cost the band the very marks that
    // pushed it there: they sit above the line and have to come along.
    const [plainBand] = regionsFromParts(plain, [0], ['Gtr 2']);
    const [grownBand] = regionsFromParts(annotated, [0], ['Gtr 2']);

    expect(grownBand.rect.bottom).toBeLessThan(plainBand.rect.bottom);
  });

  it('leaves an unmarked page to its own headroom and legroom', () => {
    // Where nothing bridges the gap the halfway line is never reached, so the
    // cap changes nothing: the band is still the staff plus its own height at
    // each end. A fix that squared every band to the midpoint would fail here.
    const [band] = regionsFromParts(plain, [0], ['Gtr 2']);
    const staff = plain[0].systems[0].staves[0];
    const height = staff.top - staff.bottom;

    expect(band.rect.bottom).toBeCloseTo(staff.bottom - height);
    expect(overlappingPairs(regionsFromParts(plain, [0], ['Gtr 2']))).toEqual(
      [],
    );
  });
});

describe('staves within one system', () => {
  /** Two staves close together, as one system's staves are. */
  const system = {
    left: 0,
    right: 600,
    top: 700,
    bottom: 600,
    staves: [
      {
        top: 700,
        bottom: 676,
        left: 0,
        right: 600,
        lineSpacing: 6,
        lineCount: 5,
        contentTop: 716,
        contentBottom: 640,
      },
      {
        top: 640,
        bottom: 616,
        left: 0,
        right: 600,
        lineSpacing: 6,
        lineCount: 5,
        contentTop: 676,
        contentBottom: 600,
      },
    ],
  };

  it('still shares the gap between them', () => {
    // Deliberate, and unchanged by the cross-system rule: a slur or fingering
    // hanging between two staves of one system belongs to both bands, because
    // whichever staff detection assigned it to, it must not be sliced in half.
    const upper = staffBounds(system, 0, [system]);
    const lower = staffBounds(system, 1, [system]);

    expect(upper.bottom).toBeLessThan(lower.top);
  });
});
