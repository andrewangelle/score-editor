/**
 * Regions: the rectangles that extraction actually operates on.
 *
 * A region is a plain rectangle on a source page, so the same extraction path
 * serves "give me the guitar staves" and "give me this box I drew".
 */

import {
  dedupeMarkings,
  type Marking,
  markingKey,
  markingWithin,
} from '#/lib/pdf/markings';
import type { Rect, Staff, System } from '#/lib/pdf/staffDetection';
import { staffHeight } from '#/lib/pdf/staffDetection';

export type Region = {
  id: string;
  pageIndex: number;
  rect: Rect;
  label: string;
  groupKey: string;
  ordinals?: number[];
  markings?: Marking[];
};

export type LayoutOptions = {
  headroom: number;
  legroom: number;
  margin: number;
  bandGap: number;
  fullWidth: boolean;
  keepMarkings: boolean;
  markingGap: number;
};

export const DEFAULT_LAYOUT: LayoutOptions = {
  headroom: 1,
  legroom: 1,
  margin: 36,
  bandGap: 18,
  fullWidth: true,
  keepMarkings: true,
  markingGap: 4,
};

export const MIN_REGION_SIZE = 6;
const NEIGHBOUR_CLEARANCE = 1;

export type Edge = 'top' | 'bottom' | 'left' | 'right';

function midpoint(near: number, far: number): number {
  return (near + far) / 2;
}

function staffAbove(staff: Staff, page: readonly System[]): Staff | null {
  let found: Staff | null = null;
  for (const system of page) {
    for (const other of system.staves) {
      if (other.bottom > staff.top && (!found || other.bottom < found.bottom)) {
        found = other;
      }
    }
  }
  return found;
}

function staffBelow(staff: Staff, page: readonly System[]): Staff | null {
  let found: Staff | null = null;
  for (const system of page) {
    for (const other of system.staves) {
      if (other.top < staff.bottom && (!found || other.top > found.top)) {
        found = other;
      }
    }
  }
  return found;
}

export function staffBounds(
  system: System,
  index: number,
  page: readonly System[] = [system],
  options: LayoutOptions = DEFAULT_LAYOUT,
): { top: number; bottom: number } {
  const staff = system.staves[index];
  const height = staffHeight(staff);
  const above = system.staves[index - 1];
  const below = system.staves[index + 1];

  const overhead = above ? null : staffAbove(staff, page);
  const underfoot = below ? null : staffBelow(staff, page);

  return {
    top: above
      ? Math.min(
          Math.max(staff.contentTop, midpoint(staff.top, above.bottom)),
          above.bottom - NEIGHBOUR_CLEARANCE,
        )
      : Math.min(
          Math.max(staff.contentTop, staff.top + height * options.headroom),
          overhead
            ? midpoint(staff.top, overhead.bottom)
            : Number.POSITIVE_INFINITY,
        ),
    bottom: below
      ? Math.max(
          Math.min(staff.contentBottom, midpoint(staff.bottom, below.top)),
          below.top + NEIGHBOUR_CLEARANCE,
        )
      : Math.max(
          Math.min(
            staff.contentBottom,
            staff.bottom - height * options.legroom,
          ),
          underfoot
            ? midpoint(staff.bottom, underfoot.top)
            : Number.NEGATIVE_INFINITY,
        ),
  };
}

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
  markings?: readonly Marking[];
};

export type MarkingRow = {
  markings: Marking[];
  bottom: number;
  height: number;
};

function extent(markings: readonly Marking[]): { bottom: number; top: number } {
  return {
    bottom: Math.min(...markings.map((marking) => marking.rect.bottom)),
    top: Math.max(...markings.map((marking) => marking.rect.top)),
  };
}

/**
 * Groups a region's markings into the lines they were engraved on.
 */
export function markingRows(region: Region): MarkingRow[] {
  const markings = [...(region.markings ?? [])].sort(
    (a, b) => a.rect.bottom - b.rect.bottom,
  );
  if (markings.length === 0) return [];

  const rows: Marking[][] = [];
  for (const marking of markings) {
    const row = rows.at(-1);
    if (row) {
      const held = extent(row);
      const shared =
        Math.min(held.top, marking.rect.top) -
        Math.max(held.bottom, marking.rect.bottom);
      const shorter = Math.min(
        held.top - held.bottom,
        marking.rect.top - marking.rect.bottom,
      );
      if (shared > shorter * 0.5) {
        row.push(marking);
        continue;
      }
    }
    rows.push([marking]);
  }

  return rows.map((row) => {
    const { bottom, top } = extent(row);
    return { markings: row, bottom, height: top - bottom };
  });
}

/** How much taller a region is once its markings are stamped above it. */
export function markingStackHeight(
  region: Region,
  options: LayoutOptions = DEFAULT_LAYOUT,
): number {
  if (!options.keepMarkings) return 0;
  return markingRows(region).reduce(
    (total, row) => total + row.height + options.markingGap,
    0,
  );
}

export function markingsFor(
  rect: Rect,
  systemIndex: number,
  markings: readonly Marking[] = [],
): Marking[] {
  const system = markings.filter(
    (marking) => marking.systemIndex === systemIndex,
  );
  const held = new Set(
    system.filter((marking) => markingWithin(marking, rect)).map(markingKey),
  );

  return dedupeMarkings(
    system.filter((marking) => !held.has(markingKey(marking))),
  );
}

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
        const top = staffBounds(system, run[0], page.systems, options).top;
        const bottom = staffBounds(
          system,
          run[run.length - 1],
          page.systems,
          options,
        ).bottom;
        const rect = {
          left: options.fullWidth ? 0 : system.left,
          right: options.fullWidth ? page.width : system.right,
          top: Math.min(top, page.height),
          bottom: Math.max(bottom, 0),
        };

        regions.push({
          id: `band-${page.pageIndex}-${systemIndex}-${run[0]}`,
          pageIndex: page.pageIndex,
          groupKey: `${page.pageIndex}:${systemIndex}`,
          ordinals: run,
          label: run.map((o) => names[o] ?? `Staff ${o + 1}`).join(' + '),
          rect,
          markings: markingsFor(rect, systemIndex, page.markings),
        });
      }
    });
  }

  return regions;
}

export function sortRegions(regions: readonly Region[]): Region[] {
  return [...regions].sort(
    (a, b) => a.pageIndex - b.pageIndex || b.rect.top - a.rect.top,
  );
}
