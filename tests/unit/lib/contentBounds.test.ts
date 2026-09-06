/**
 * What a band's edge is allowed to reach, and where it is allowed to stop.
 *
 * These are the three ways a part came out with its bottom sliced off, each
 * seen on a real score: a beam group hanging off the end of a stem, a dynamic
 * whose descenders the text layer never reported, and a tuplet number the band
 * edge ran straight through. All three are engraved *below* the staff, which is
 * where a drum part keeps most of what it has to say.
 */

import { describe, expect, it } from 'vitest';
import { attachContentBounds, type Staff } from '#/lib/pdf/staffDetection';

const SPACING = 4;

/** A five-line staff of the usual proportions, at `bottom`. */
function staffAt(bottom: number): Staff {
  const top = bottom + SPACING * 4;
  return {
    top,
    bottom,
    left: 100,
    right: 700,
    lineSpacing: SPACING,
    lineCount: 5,
    contentTop: top,
    contentBottom: bottom,
  };
}

type Box = { left: number; bottom: number; right: number; top: number };

const box = (left: number, bottom: number, right: number, top: number): Box => ({
  left,
  bottom,
  right,
  top,
});

describe('content bounds', () => {
  it('follows a stem to the beam group hanging off it', () => {
    const staff = staffAt(200);
    // A stem crossing the staff and descending well below it, with a beam far
    // enough under the staff's own lines to be out of one chain step's reach.
    const stem = box(300, 184, 301, 210);
    const beam = box(295, 180, 340, 183);

    const [grown] = attachContentBounds([staff], [stem, beam]);

    expect(grown.contentBottom).toBe(180);
  });

  it('does not cross to ink the stem does not stand over', () => {
    const staff = staffAt(200);
    const stem = box(300, 184, 301, 210);
    // Same height as the beam above, but nowhere near the stem horizontally.
    const elsewhere = box(600, 180, 640, 183);

    const [grown] = attachContentBounds([staff], [stem, elsewhere]);

    expect(grown.contentBottom).toBe(184);
  });

  // A beam broken either side of the space a tuplet number is set in. Both
  // halves are within one step of the staff's lines, so the band's edge settles
  // at their underside, 190.
  const brokenBeam = [box(295, 190, 308, 193), box(318, 190, 340, 193)];

  it('stops past a glyph it would otherwise bisect', () => {
    const staff = staffAt(200);
    // In the break, so it overlaps neither half and no chain reaches it — but
    // the beams put the edge through it.
    const digit = box(310, 185, 316, 192);

    const [grown] = attachContentBounds([staff], [...brokenBeam, digit]);

    expect(grown.contentBottom).toBe(185);
  });

  it('leaves an edge where deeper ink merely crosses it', () => {
    const staff = staffAt(200);
    // Crosses the same edge in the same place, but reaches far past it — the
    // staff next door's stem, not a glyph of this one's.
    const intruder = box(310, 150, 316, 192);

    const [grown] = attachContentBounds([staff], [...brokenBeam, intruder]);

    expect(grown.contentBottom).toBe(190);
  });
});
