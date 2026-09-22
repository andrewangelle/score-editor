/**
 * Which vertical rules close a bar. Measure numbers for tempo marks and time
 * signatures are counted off these, so a stem taken for a barline shifts every
 * event after it by a bar.
 */

import { describe, expect, it } from 'vitest';
import {
  findBarlines,
  type Staff,
  type System,
  type VerticalRule,
} from '#/lib/pdf/staffDetection';

const SPACING = 4;
const LEFT = 100;
const RIGHT = 700;

function staffAt(bottom: number, lineCount = 5): Staff {
  const top = bottom + SPACING * (lineCount - 1);
  return {
    top,
    bottom,
    left: LEFT,
    right: RIGHT,
    lineSpacing: SPACING,
    lineCount,
    contentTop: top,
    contentBottom: bottom,
  };
}

function systemOf(...staves: Staff[]): System {
  return {
    staves,
    left: LEFT,
    right: RIGHT,
    top: Math.max(...staves.map((staff) => staff.top)),
    bottom: Math.min(...staves.map((staff) => staff.bottom)),
  };
}

const rule = (x: number, bottom: number, top: number): VerticalRule => ({
  x,
  bottom,
  top,
});

/** One rule per staff at `x`, stopping at each staff's outer lines. */
const perStaff = (x: number, staves: Staff[]) =>
  staves.map((staff) => rule(x, staff.bottom, staff.top));

describe('findBarlines', () => {
  const upper = staffAt(200);
  const lower = staffAt(150);
  const system = systemOf(upper, lower);

  it('reads a rule running through every staff as a barline', () => {
    const verticals = [300, 500, RIGHT].map((x) =>
      rule(x, lower.bottom, upper.top),
    );

    expect(findBarlines(system, verticals)).toEqual([300, 500, RIGHT]);
  });

  it('reads a rule per staff, lined up, as a barline', () => {
    const verticals = [300, RIGHT].flatMap((x) => perStaff(x, [upper, lower]));

    expect(findBarlines(system, verticals)).toEqual([300, RIGHT]);
  });

  it('leaves out the opening barline, even set in behind a bracket', () => {
    const verticals = [LEFT + SPACING * 2, 400, RIGHT].map((x) =>
      rule(x, lower.bottom, upper.top),
    );

    expect(findBarlines(system, verticals)).toEqual([400, RIGHT]);
  });

  it('reads a double barline as one', () => {
    const verticals = [398, 400, RIGHT].map((x) =>
      rule(x, lower.bottom, upper.top),
    );

    expect(findBarlines(system, verticals)).toEqual([399, RIGHT]);
  });

  it('ignores a stem that crosses one staff only', () => {
    const verticals = [
      ...perStaff(RIGHT, [upper, lower]),
      rule(350, upper.bottom - SPACING * 3, upper.top),
    ];

    expect(findBarlines(system, verticals)).toEqual([RIGHT]);
  });

  it('ignores stems that line up across staves but overshoot them', () => {
    // Two guitars playing the same chords: stems at one x, each longer than
    // its staff is tall, and neither reaching the other staff.
    const verticals = [
      ...perStaff(RIGHT, [upper, lower]),
      rule(350, upper.bottom - SPACING * 3, upper.top + SPACING * 2),
      rule(350, lower.bottom - SPACING * 3, lower.top + SPACING * 2),
    ];

    expect(findBarlines(system, verticals)).toEqual([RIGHT]);
  });

  it('keeps a system barline that runs past a hidden staff', () => {
    const verticals = [400, RIGHT].map((x) =>
      rule(x, lower.bottom, upper.top + SPACING * 4),
    );

    expect(findBarlines(system, verticals)).toEqual([400, RIGHT]);
  });

  it('keeps the barline of a one-line staff, which runs past its line', () => {
    const drums = staffAt(250, 1);
    const verticals = [400, RIGHT].flatMap((x) => [
      rule(x, drums.bottom - SPACING, drums.top + SPACING),
      ...perStaff(x, [upper, lower]),
    ]);

    expect(findBarlines(systemOf(drums, upper, lower), verticals)).toEqual([
      400,
      RIGHT,
    ]);
  });

  it('finds none when nothing crosses the staves', () => {
    expect(findBarlines(system, [])).toEqual([]);
  });
});
