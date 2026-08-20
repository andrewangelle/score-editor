/**
 * Measure numbers and tempo marks: the text that tells a player where they are.
 *
 * A score engraves these once per system, in the strip above its top staff.
 * Cutting one instrument out is a horizontal slice that stops well below that
 * strip, so every part but the topmost comes out unnumbered — and an unnumbered
 * part cannot be rehearsed from.
 *
 * Nothing here matches placement against a template, because engravers vary all
 * of it: every bar or the first of each system, above the top staff or below the
 * bottom one, bare or boxed. Both are read from evidence that survives any house
 * style instead:
 *
 *  - a **measure number** is a bare number printed in the same place relative to
 *    a staff throughout the document, whose values only ever increase — which is
 *    precisely what tuplet digits, fingerings and time signatures are not.
 *  - a **tempo mark** is text in a text font (not the notation font) sitting in
 *    the free strip above a system, space notation itself does not use.
 *
 * Page numbers pass the first test too, so they are told apart by the one thing
 * that makes them page numbers: their value is the page they are printed on.
 */

import type {
  PageStaves,
  PageTextItem,
  Rect,
  Staff,
  System,
} from '#/lib/pdf/staffDetection';
import { staffHeight } from '#/lib/pdf/staffDetection';

export type MarkingKind = 'measure' | 'tempo';

export type Marking = {
  id: string;
  kind: MarkingKind;
  text: string;
  pageIndex: number;
  systemIndex: number;
  rect: Rect;
};

export type MarkingOptions = {
  /** How far beyond a staff's outermost line a marking may sit, in staff heights. */
  reach: number;
  /** How far outside the system's horizontal span a marking may sit. */
  sideReach: number;
  padding: number;
};

export const DEFAULT_MARKINGS: MarkingOptions = {
  reach: 2.5,
  sideReach: 1.5,
  padding: 1.5,
};

/**
 * A marking-shaped piece of text, before the document as a whole has had its say
 * about whether it is one. `offset`, `rightGap` and `size` are in staff heights.
 */
export type Candidate = {
  pageIndex: number;
  systemIndex: number;
  staffIndex: number;
  side: 'above' | 'below';
  text: string;
  rect: Rect;
  /** Distance from the staff's outermost line. */
  offset: number;
  /** How far short of the system's right edge it stops. */
  rightGap: number;
  size: number;
  value: number | null;
};

/** A bare number, with or without the brackets some engravers box them in. */
const BARE_NUMBER = /^[([{]?\s*(\d{1,4})\s*[)\]}]?$/;

function numericValue(text: string): number | null {
  const match = BARE_NUMBER.exec(text);
  return match ? Number(match[1]) : null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function mergeRun(items: readonly PageTextItem[]): PageTextItem {
  const rect = {
    left: Math.min(...items.map((item) => item.rect.left)),
    right: Math.max(...items.map((item) => item.rect.right)),
    bottom: Math.min(...items.map((item) => item.rect.bottom)),
    top: Math.max(...items.map((item) => item.rect.top)),
  };

  let str = '';
  items.forEach((item, index) => {
    const previous = items[index - 1];
    const height = item.rect.top - item.rect.bottom;
    // Engravers set "= 120" as its own item with no space of its own, so gaps
    // wide enough to read as word breaks are written back in.
    const spaced =
      previous && item.rect.left - previous.rect.right > height * 0.15;
    str += (spaced ? ' ' : '') + item.str;
  });

  // The run's font is the one that sets most of it: a metronome mark opens with
  // a notation-font note glyph and continues "= 120" in a text font, so reading
  // the first item's font would file the whole mark as notation and discard it.
  const dominant = [...items].sort(
    (a, b) =>
      b.rect.right - b.rect.left - (a.rect.right - a.rect.left) ||
      a.rect.left - b.rect.left,
  )[0];

  return {
    str: str.replace(/\s+/g, ' ').trim(),
    rect,
    fontName: dominant.fontName,
  };
}

/**
 * Joins text items that sit on one baseline into runs. A tempo mark reaches the
 * text layer in pieces — the metronome's note, "= 120", the caption before it —
 * which read separately are cryptic fragments and read as a run are one marking
 * with one rectangle, which is what has to be lifted.
 */
export function textRuns(items: readonly PageTextItem[]): PageTextItem[] {
  const usable = items.filter((item) => item.str.trim().length > 0);
  if (usable.length === 0) return [];

  // Baselines rather than boxes: superscripts and a mid-line notation glyph
  // rarely share a box height, but they do share where they sit.
  const sorted = [...usable].sort(
    (a, b) => b.rect.bottom - a.rect.bottom || a.rect.left - b.rect.left,
  );

  const lines: PageTextItem[][] = [];
  for (const item of sorted) {
    const line = lines.at(-1);
    const height = item.rect.top - item.rect.bottom;
    const tolerance = Math.max(height * 0.35, 0.5);
    if (line && Math.abs(line[0].rect.bottom - item.rect.bottom) <= tolerance) {
      line.push(item);
      continue;
    }
    lines.push([item]);
  }

  const runs: PageTextItem[] = [];
  for (const line of lines) {
    const ordered = [...line].sort((a, b) => a.rect.left - b.rect.left);
    const groups: PageTextItem[][] = [];

    for (const item of ordered) {
      const group = groups.at(-1);
      const previous = group?.[group.length - 1];
      // Roughly a character's width of space: wider than that and the engraver
      // meant two separate things, not two words of one.
      const allowance = previous
        ? (previous.rect.top - previous.rect.bottom) * 0.9
        : 0;

      if (
        group &&
        previous &&
        item.rect.left - previous.rect.right <= allowance
      )
        group.push(item);
      else groups.push([item]);
    }

    for (const group of groups) runs.push(mergeRun(group));
  }

  return runs;
}

/**
 * Which of the page's fonts are notation fonts.
 *
 * Noteheads, clefs and rests reach the text layer exactly as words do, so "text
 * above the staff" would otherwise collect every high note on the page. They are
 * told apart by where they land: a font whose glyphs mostly fall between staff
 * lines is the notation font. Reading this from usage rather than a list of font
 * names is what keeps it working on the next score.
 */
export function notationFonts(
  items: readonly PageTextItem[],
  systems: readonly System[],
): Set<string> {
  const staves = systems.flatMap((system) => system.staves);
  const tally = new Map<string, { on: number; total: number }>();

  for (const item of items) {
    const count = tally.get(item.fontName) ?? { on: 0, total: 0 };
    count.total += 1;
    if (
      staves.some(
        (staff) =>
          item.rect.bottom <= staff.top &&
          item.rect.top >= staff.bottom &&
          item.rect.right >= staff.left &&
          item.rect.left <= staff.right,
      )
    ) {
      count.on += 1;
    }
    tally.set(item.fontName, count);
  }

  const notation = new Set<string>();
  for (const [font, count] of tally) {
    // Too small a sample to judge, and a font that rare cannot be carrying the
    // page's notation anyway.
    if (count.total >= 4 && count.on / count.total >= 0.5) notation.add(font);
  }
  return notation;
}

/**
 * Measures a run against the staff it sits by, in that staff's own heights: a
 * pocket score and a conductor's score of the same piece differ threefold, so
 * every placement judgement downstream is made in staff heights, never points.
 */
function against(
  run: PageTextItem,
  system: System,
  staffIndex: number,
  side: 'above' | 'below',
  page: { pageIndex: number; systemIndex: number },
): Candidate {
  const staff = system.staves[staffIndex];
  const height = staffHeight(staff);
  const distance =
    side === 'above'
      ? run.rect.bottom - staff.top
      : staff.bottom - run.rect.top;

  return {
    pageIndex: page.pageIndex,
    systemIndex: page.systemIndex,
    staffIndex,
    side,
    text: run.str,
    rect: run.rect,
    offset: distance / height,
    rightGap: (system.right - run.rect.right) / height,
    size: (run.rect.top - run.rect.bottom) / height,
    value: numericValue(run.str),
  };
}

/**
 * Grows a marking's rectangle to take in whatever is drawn around it. Engravers
 * box measure numbers and draw a metronome's note as paths as often as glyphs;
 * lifting only the text's own box cuts the enclosure in half and leaves a stray
 * rule floating above the number, which reads as damage.
 *
 * Only ink close to the marking's own size counts, so the staff lines, barlines
 * and page background crossing the rectangle cannot swallow it.
 */
function enclosure(rect: Rect, ink: readonly Rect[], limit: number): Rect {
  const width = rect.right - rect.left;
  const height = rect.top - rect.bottom;
  const grown = { ...rect };

  for (const box of ink) {
    const touches =
      box.left <= rect.right &&
      box.right >= rect.left &&
      box.bottom <= rect.top &&
      box.top >= rect.bottom;
    if (!touches) continue;
    if (box.right - box.left > width + limit * 2) continue;
    if (box.top - box.bottom > height + limit * 2) continue;

    grown.left = Math.max(Math.min(grown.left, box.left), rect.left - limit);
    grown.right = Math.min(
      Math.max(grown.right, box.right),
      rect.right + limit,
    );
    grown.bottom = Math.max(
      Math.min(grown.bottom, box.bottom),
      rect.bottom - limit,
    );
    grown.top = Math.min(Math.max(grown.top, box.top), rect.top + limit);
  }

  return grown;
}

/**
 * The strip of free space on one side of a staff, bounded by whatever is next in
 * that direction, so a marking is never read off someone else's music.
 */
function strip(
  staff: Staff,
  side: 'above' | 'below',
  neighbour: number,
  options: MarkingOptions,
): { near: number; far: number } {
  const height = staffHeight(staff);
  return side === 'above'
    ? {
        near: staff.top,
        far: Math.min(staff.top + height * options.reach, neighbour),
      }
    : {
        near: staff.bottom,
        far: Math.max(staff.bottom - height * options.reach, neighbour),
      };
}

/**
 * Everything on one page that could be a marking. Whether it is one takes the
 * whole document to say, and is settled in `resolveMarkings`.
 */
export function pageCandidates(
  page: PageStaves,
  items: readonly PageTextItem[],
  options: MarkingOptions = DEFAULT_MARKINGS,
): Candidate[] {
  if (page.systems.length === 0) return [];

  const runs = textRuns(items);
  const notation = notationFonts(items, page.systems);
  const candidates: Candidate[] = [];

  // Systems in reading order, so each one knows what is directly above it.
  const ordered = [...page.systems].sort((a, b) => b.top - a.top);

  ordered.forEach((system, systemIndex) => {
    const previous = ordered[systemIndex - 1];
    const next = ordered[systemIndex + 1];
    const height = staffHeight(system.staves[0]);
    const sideRoom = height * options.sideReach;
    const withinSystem = (rect: Rect) =>
      rect.right >= system.left - sideRoom &&
      rect.left <= system.right + sideRoom;

    system.staves.forEach((staff, staffIndex) => {
      const above = system.staves[staffIndex - 1];
      const below = system.staves[staffIndex + 1];

      const sides: { side: 'above' | 'below'; neighbour: number }[] = [
        {
          side: 'above',
          neighbour: above
            ? above.bottom
            : (previous?.bottom ?? Number.POSITIVE_INFINITY),
        },
        // Only the last staff of a system has open space below it; between
        // staves the strip above the lower one already covers the gap.
        ...(below
          ? []
          : [
              {
                side: 'below' as const,
                neighbour: next?.top ?? Number.NEGATIVE_INFINITY,
              },
            ]),
      ];

      for (const { side, neighbour } of sides) {
        const { near, far } = strip(staff, side, neighbour, options);
        for (const run of runs) {
          if (!withinSystem(run.rect)) continue;
          const inside =
            side === 'above'
              ? run.rect.bottom >= near && run.rect.bottom <= far
              : run.rect.top <= near && run.rect.top >= far;
          if (!inside) continue;

          // Notation glyphs already travel with the staff, and stamping a stray
          // notehead onto another part would be noise. Digits are exempt: bar
          // numbers are often set in the notation font, which carries numerals.
          const value = numericValue(run.str);
          if (value === null && notation.has(run.fontName)) continue;

          candidates.push(
            against(run, system, staffIndex, side, {
              pageIndex: page.pageIndex,
              systemIndex,
            }),
          );
        }
      }
    });
  });

  return candidates;
}

/** Document order: page, then system, then across the system. */
function inReadingOrder(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort(
    (a, b) =>
      a.pageIndex - b.pageIndex ||
      a.systemIndex - b.systemIndex ||
      a.rect.left - b.rect.left,
  );
}

/**
 * Groups numeric candidates by where they sit relative to their staff. A house
 * style holds one offset and size for the whole score, so a group built this way
 * is one *role* — all the bar numbers, or all the page numbers, or all the
 * fingerings — and judging the role per group rather than per number lets a
 * single wrongly-placed digit be outvoted by its neighbours.
 */
function byPlacement(candidates: readonly Candidate[]): Candidate[][] {
  const sorted = [...candidates].sort(
    (a, b) => a.offset - b.offset || a.size - b.size,
  );
  const groups: Candidate[][] = [];

  for (const candidate of sorted) {
    const group = groups.at(-1);
    // Measured against the group's first member, not its last, so a group can
    // never creep: page numbers sit a little further out than bar numbers, and a
    // chain of near-misses would otherwise merge the two roles into one.
    const anchor = group?.[0];
    if (
      anchor &&
      anchor.side === candidate.side &&
      Math.abs(anchor.offset - candidate.offset) <= 0.3 &&
      Math.abs(anchor.size - candidate.size) <= 0.4
    ) {
      group.push(candidate);
      continue;
    }
    groups.push([candidate]);
  }

  return groups;
}

/**
 * A page number's value is fixed by where it is printed rather than by the
 * music, making it the one number identifiable outright. Most of a group must
 * agree before it is thrown out, so a score whose bar numbers briefly coincide
 * with its page numbers does not lose them.
 */
function arePageNumbers(group: readonly Candidate[]): boolean {
  const matching = group.filter(
    (candidate) => candidate.value === candidate.pageIndex + 1,
  ).length;
  return group.length >= 2 && matching / group.length >= 0.6;
}

/** The longest run through these whose numbers never go backwards. */
function longestNonDecreasing(ordered: readonly Candidate[]): Candidate[] {
  const length: number[] = [];
  const previous: number[] = [];
  let end = -1;

  for (let i = 0; i < ordered.length; i++) {
    length[i] = 1;
    previous[i] = -1;
    for (let j = 0; j < i; j++) {
      const climbs = (ordered[j].value ?? 0) <= (ordered[i].value ?? 0);
      if (climbs && length[j] + 1 > length[i]) {
        length[i] = length[j] + 1;
        previous[i] = j;
      }
    }
    if (end === -1 || length[i] > length[end]) end = i;
  }

  const chain: Candidate[] = [];
  for (let i = end; i >= 0; i = previous[i]) chain.push(ordered[i]);
  return chain.reverse();
}

/** How much of a group has to agree before it is read as a numbering. */
const AGREEMENT = 0.8;

/**
 * The measure numbers in one placement group, if that is what it holds.
 *
 * Music only goes forwards, so its numbering only goes up, and a group is judged
 * by the longest run through it that does. Tuplet digits and fingerings recur at
 * whatever value the music calls for, so their longest run is flat.
 *
 * Requiring the *whole* group to climb is too brittle: one tuplet printed at bar
 * number height would discard every bar number in the score. So most of the
 * group has to agree, and the run that agrees is also the answer.
 */
function measureNumbersIn(group: readonly Candidate[]): Candidate[] {
  if (group.length === 0 || arePageNumbers(group)) return [];

  const chain = longestNonDecreasing(inReadingOrder(group));
  const values = chain.map((candidate) => candidate.value ?? 0);

  if (
    chain.length >= 2 &&
    chain.length / group.length >= AGREEMENT &&
    values[values.length - 1] > values[0] &&
    // A numbering counts through many values; tuplets that happen to end higher
    // than they started still only ever say two or three things.
    new Set(values).size >= Math.min(3, chain.length)
  ) {
    return chain;
  }

  // A score hanging both in the top margin puts them within a line of each
  // other, and mixed together neither reads as a numbering. Page numbers can be
  // named outright, so they are the ones to stand down.
  const withoutPages = group.filter(
    (candidate) => candidate.value !== candidate.pageIndex + 1,
  );
  return withoutPages.length < group.length
    ? measureNumbersIn(withoutPages)
    : [];
}

/**
 * Strips the page's own furniture out of the tempo-mark candidates. Two things
 * share that strip without being tempo marks: a title, set far larger than any
 * marking, and a running header or credit line, which repeats verbatim page
 * after page where a tempo mark says something new each time.
 */
function withoutFurniture(candidates: readonly Candidate[]): Candidate[] {
  if (candidates.length === 0) return [];

  const typical = median(candidates.map((candidate) => candidate.size));

  // Keyed on the words *and* where they fall: a running header is pinned to one
  // spot page after page, while a tempo returns at whatever bar it applies to.
  const place = (candidate: Candidate) =>
    `${candidate.text}@${Math.round(candidate.rect.left / 4)}`;
  const repeats = new Map<string, Set<number>>();
  for (const candidate of candidates) {
    const pages = repeats.get(place(candidate)) ?? new Set<number>();
    pages.add(candidate.pageIndex);
    repeats.set(place(candidate), pages);
  }

  return candidates.filter((candidate) => {
    if (typical > 0 && candidate.size > typical * 1.75) return false;
    if ((repeats.get(place(candidate))?.size ?? 0) >= 3) return false;

    // A composer credit sits flush with the end of the system, where a marking —
    // which belongs to a bar, and so to a point along it — never is.
    const words = candidate.text.split(/\s+/).length;
    const flushRight = Math.abs(candidate.rightGap) <= 0.35;
    return !(flushRight && words >= 2 && !/[\d=]/.test(candidate.text));
  });
}

/**
 * Decides, with the whole document in view, which candidates are markings.
 * Returns one list per page, indexed as `pages` was given.
 */
export function resolveMarkings(
  candidates: readonly Candidate[],
  pageCount: number,
): Marking[][] {
  const kind = new Map<Candidate, MarkingKind>();

  const numbers = candidates.filter((candidate) => candidate.value !== null);
  for (const group of byPlacement(numbers)) {
    for (const candidate of measureNumbersIn(group)) {
      kind.set(candidate, 'measure');
    }
  }

  // Tempo marks come off the system header only: text above an inner staff is
  // that player's own instruction ("pizz."), and stamping it onto everyone
  // else's part would be a lie about who plays what.
  const prose = candidates.filter(
    (candidate) =>
      candidate.value === null &&
      candidate.side === 'above' &&
      candidate.staffIndex === 0 &&
      // A tuplet's "3:2" is digits and a colon; a marking carries words, or the
      // "=" of a metronome mark.
      /[=\p{L}]/u.test(candidate.text),
  );
  for (const candidate of withoutFurniture(prose)) {
    kind.set(candidate, 'tempo');
  }

  const pages: Marking[][] = Array.from({ length: pageCount }, () => []);
  for (const candidate of inReadingOrder([...kind.keys()])) {
    const page = pages[candidate.pageIndex];
    if (!page) continue;
    page.push({
      id: `marking-${candidate.pageIndex}-${candidate.systemIndex}-${page.length}`,
      kind: kind.get(candidate) ?? 'tempo',
      text: candidate.text,
      pageIndex: candidate.pageIndex,
      systemIndex: candidate.systemIndex,
      rect: candidate.rect,
    });
  }
  return pages;
}

/**
 * Reads the markings of a whole document. `text` is indexed alongside `pages`; a
 * page with no text layer contributes an empty list rather than failing the read.
 */
export function detectMarkings(
  pages: readonly PageStaves[],
  text: readonly (readonly PageTextItem[])[],
  options: MarkingOptions = DEFAULT_MARKINGS,
): Marking[][] {
  const candidates = pages.flatMap((page, index) =>
    pageCandidates(page, text[index] ?? [], options),
  );

  // Measurement is done on the text's own box, above; what gets *lifted* is
  // widened here, after acceptance, so presentation never moves the goalposts
  // for classification.
  return resolveMarkings(candidates, pages.length).map((markings, index) => {
    const page = pages[index];
    const ink = page?.ink ?? [];

    return markings.map((marking) => {
      const staff = page?.systems[marking.systemIndex]?.staves[0];
      const padded = {
        left: marking.rect.left - options.padding,
        right: marking.rect.right + options.padding,
        bottom: marking.rect.bottom - options.padding,
        top: marking.rect.top + options.padding,
      };
      const room = staff ? staffHeight(staff) * 0.5 : options.padding;
      return { ...marking, rect: enclosure(padded, ink, room) };
    });
  });
}

export function markingWithin(marking: Marking, rect: Rect): boolean {
  return (
    marking.rect.left >= rect.left &&
    marking.rect.right <= rect.right &&
    marking.rect.bottom >= rect.bottom &&
    marking.rect.top <= rect.top
  );
}

/**
 * Scores that number every instrumental group repeat one number down the system,
 * once per group: same words, same column, different heights. A part cut from
 * that system wants it once.
 */
export function markingKey(marking: Marking): string {
  return `${marking.kind}:${marking.text}:${Math.round(marking.rect.left)}`;
}

export function dedupeMarkings(markings: readonly Marking[]): Marking[] {
  const seen = new Set<string>();
  return markings.filter((marking) => {
    const key = markingKey(marking);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
