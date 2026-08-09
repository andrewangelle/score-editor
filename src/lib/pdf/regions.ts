/**
 * Regions: the rectangles that extraction actually operates on.
 *
 * Staff detection is only one way to produce these. A region is a plain
 * rectangle on a source page, so the same extraction path serves "give me the
 * guitar staves" and "give me this box I drew on a spreadsheet". Detection
 * proposes; the user disposes.
 *
 * All coordinates are PDF user space (origin bottom-left, y upward, points).
 */

import type { Rect, System } from '#/lib/pdf/staffDetection';
import { staffHeight } from '#/lib/pdf/staffDetection';

export type Region = {
  id: string;
  pageIndex: number;
  rect: Rect;
  label: string;
  /**
   * Regions sharing this key are kept together on one output page. Derived
   * regions use their source system, so simultaneous music is never split.
   */
  groupKey: string;
  /** Which part ordinals this came from, when derived from detection. */
  ordinals?: number[];
};

export type LayoutOptions = {
  /** Extra space kept above the top staff of a band, in staff-heights. */
  headroom: number;
  /** Extra space kept below the bottom staff of a band, in staff-heights. */
  legroom: number;
  /** Page margin of the produced document, in points. */
  margin: number;
  /** Vertical space between regions in the output, in points. */
  bandGap: number;
  /**
   * Keep the full page width rather than trimming to the system. Scores put
   * instrument names and rehearsal marks outside the staff, so this is the safe
   * default: nothing else competes for horizontal space on a system.
   */
  fullWidth: boolean;
};

export const DEFAULT_LAYOUT: LayoutOptions = {
  headroom: 1,
  legroom: 1,
  margin: 36,
  bandGap: 18,
  fullWidth: true,
};

/** Smallest region worth keeping, in points; guards against stray click-drags. */
export const MIN_REGION_SIZE = 6;

/**
 * How far a band stops short of the next staff's outermost line, in points.
 * Enough that the neighbour's line never shows up as a stray rule along the
 * edge of an extracted part.
 */
const NEIGHBOUR_CLEARANCE = 1;

export type Edge = 'top' | 'bottom' | 'left' | 'right';

/**
 * Vertical extent to give each staff.
 *
 * Two things have to hold at once. The band must reach far enough to keep
 * everything that belongs to the staff — ledger lines and notes stacked well
 * above it, dynamics well below — which is what detection recorded in
 * `contentTop`/`contentBottom`. And it must still claim at least half the space
 * to each neighbour, so a slur or fingering sitting in the gap, which detection
 * may have assigned to the staff on the other side, is not sliced in two.
 *
 * So the band is the larger of the two, stopped just short of the neighbouring
 * staff's own lines. The outermost staves have no neighbour to share with and
 * fall back to a multiple of their own height.
 */
export function staffBounds(
  system: System,
  index: number,
  options: LayoutOptions = DEFAULT_LAYOUT,
): { top: number; bottom: number } {
  const staff = system.staves[index];
  // Nominal height, so a one-line percussion staff still gets real padding.
  const height = staffHeight(staff);
  const above = system.staves[index - 1];
  const below = system.staves[index + 1];

  return {
    top: above
      ? Math.min(
          Math.max(staff.contentTop, (staff.top + above.bottom) / 2),
          above.bottom - NEIGHBOUR_CLEARANCE,
        )
      : Math.max(staff.contentTop, staff.top + height * options.headroom),
    bottom: below
      ? Math.max(
          Math.min(staff.contentBottom, (staff.bottom + below.top) / 2),
          below.top + NEIGHBOUR_CLEARANCE,
        )
      : Math.min(staff.contentBottom, staff.bottom - height * options.legroom),
  };
}

/** Builds a rectangle from two arbitrary corners, in either drag direction. */
export function rectFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Rect {
  return {
    left: Math.min(a.x, b.x),
    right: Math.max(a.x, b.x),
    bottom: Math.min(a.y, b.y),
    top: Math.max(a.y, b.y),
  };
}

/** Keeps a rectangle inside the page and the right way up. */
export function clampRect(
  rect: Rect,
  pageWidth: number,
  pageHeight: number,
): Rect {
  const left = Math.max(0, Math.min(rect.left, rect.right));
  const right = Math.min(pageWidth, Math.max(rect.left, rect.right));
  const bottom = Math.max(0, Math.min(rect.bottom, rect.top));
  const top = Math.min(pageHeight, Math.max(rect.bottom, rect.top));
  return { left, right, bottom, top };
}

export function isUsableRect(rect: Rect): boolean {
  return (
    rect.right - rect.left >= MIN_REGION_SIZE &&
    rect.top - rect.bottom >= MIN_REGION_SIZE
  );
}

export function createRegion(
  pageIndex: number,
  rect: Rect,
  label = 'Region',
): Region {
  const id = `region-${crypto.randomUUID()}`;
  return { id, pageIndex, rect, label, groupKey: id };
}

export function moveRegion(
  region: Region,
  dx: number,
  dy: number,
  pageWidth: number,
  pageHeight: number,
): Region {
  const width = region.rect.right - region.rect.left;
  const height = region.rect.top - region.rect.bottom;
  // Clamp the offset rather than the result, so dragging into an edge slides
  // along it instead of squashing the region.
  const left = Math.max(0, Math.min(pageWidth - width, region.rect.left + dx));
  const bottom = Math.max(
    0,
    Math.min(pageHeight - height, region.rect.bottom + dy),
  );

  return {
    ...region,
    rect: { left, right: left + width, bottom, top: bottom + height },
  };
}

export function resizeRegion(
  region: Region,
  edge: Edge,
  value: number,
  pageWidth: number,
  pageHeight: number,
): Region {
  const rect = { ...region.rect, [edge]: value };
  return { ...region, rect: clampRect(rect, pageWidth, pageHeight) };
}

export function updateRegion(
  regions: readonly Region[],
  id: string,
  next: Region,
): Region[] {
  return regions.map((region) => (region.id === id ? next : region));
}

export function removeRegion(regions: readonly Region[], id: string): Region[] {
  return regions.filter((region) => region.id !== id);
}

/** Splits a sorted ordinal list into runs of consecutive values. */
function contiguousRuns(ordinals: number[]): number[][] {
  const runs: number[][] = [];
  for (const ordinal of [...ordinals].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && ordinal === last[last.length - 1] + 1) last.push(ordinal);
    else runs.push([ordinal]);
  }
  return runs;
}

export type DerivedSource = {
  pageIndex: number;
  width: number;
  height: number;
  systems: System[];
};

/**
 * Derives regions from detected staves and a part selection.
 *
 * Adjacent selected staves become a single region so the barlines and bracket
 * joining them survive; separating them would slice those in half. Systems whose
 * staff count differs from the selection still contribute whatever ordinals they
 * do have, so an occasional condensed system degrades rather than failing.
 */
export function regionsFromParts(
  pages: readonly DerivedSource[],
  selectedOrdinals: readonly number[],
  names: readonly string[] = [],
  options: LayoutOptions = DEFAULT_LAYOUT,
): Region[] {
  const regions: Region[] = [];

  for (const page of pages) {
    page.systems.forEach((system, systemIndex) => {
      const present = selectedOrdinals.filter(
        (ordinal) => ordinal < system.staves.length,
      );
      if (present.length === 0) return;

      for (const run of contiguousRuns([...present])) {
        const top = staffBounds(system, run[0], options).top;
        const bottom = staffBounds(system, run[run.length - 1], options).bottom;

        regions.push({
          id: `band-${page.pageIndex}-${systemIndex}-${run[0]}`,
          pageIndex: page.pageIndex,
          groupKey: `${page.pageIndex}:${systemIndex}`,
          ordinals: run,
          label: run.map((o) => names[o] ?? `Staff ${o + 1}`).join(' + '),
          rect: {
            left: options.fullWidth ? 0 : system.left,
            right: options.fullWidth ? page.width : system.right,
            top: Math.min(top, page.height),
            bottom: Math.max(bottom, 0),
          },
        });
      }
    });
  }

  return regions;
}

/** Document order: page, then down the page. */
export function sortRegions(regions: readonly Region[]): Region[] {
  return [...regions].sort(
    (a, b) => a.pageIndex - b.pageIndex || b.rect.top - a.rect.top,
  );
}
