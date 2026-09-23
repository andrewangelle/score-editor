import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  type Marking,
  type MarkingKind,
  numericValue,
} from '#/lib/pdf/markings/markings';
import type { ScoreAnalysis, ScorePage } from '#/lib/pdf/scoreAnalysis';

export type MarkingsRow = {
  measure: number | null;
  measureMarking: Marking | null;
  eventMarkings: Marking[];
};

/** What a markings export maps: the time signatures, or the tempo marks. */
export type MarkingsExportKind = Extract<
  MarkingKind,
  'time-signature' | 'tempo'
>;

export type MarkingsExportResult = {
  rows: MarkingsRow[];
  measuresInferred: boolean;
};

/** A bar's place in the document: which system, and which bar across it. */
type BarPosition = { system: number; bar: number };

type Anchor = BarPosition & { value: number; marking: Marking };

/**
 * Places every event in a bar by counting the barlines to its left, then numbers
 * that bar by counting bars from the nearest printed measure number. A printed
 * number always wins over the count, so a miscounted system only misnumbers the
 * events between it and the next printed number. Events ahead of the first
 * printed number count backwards from it; a score with none at all counts from 1.
 */
export function collectMarkingsRows(
  analysis: ScoreAnalysis,
  kind: MarkingsExportKind,
): MarkingsExportResult {
  const allMarkings = analysis.pages.flatMap((page) => page.markings);

  const eventMarkings = allMarkings.filter((marking) => marking.kind === kind);

  if (eventMarkings.length === 0) {
    return { rows: [], measuresInferred: false };
  }

  // Every system in reading order, and where each page's systems start in it.
  const systems = analysis.pages.flatMap((page) => page.systems);
  const pageOffsets = new Map<number, number>();
  let offset = 0;

  for (const page of analysis.pages) {
    pageOffsets.set(page.pageIndex, offset);
    offset += page.systems.length;
  }

  function systemOf(marking: Marking) {
    return (pageOffsets.get(marking.pageIndex) ?? 0) + marking.systemIndex;
  }

  // Without barlines a system is read as a single bar, which leaves the printed
  // numbers to do all the work.
  function barlinesOf(index: number) {
    return systems[index]?.barlines ?? [];
  }

  function barCount(index: number) {
    return Math.max(barlinesOf(index).length, 1);
  }

  function barAt(system: number, x: number): number {
    return barlinesOf(system).filter((barline) => barline < x).length;
  }

  /** Bars from one position to a later one. */
  function barsBetween(from: BarPosition, to: BarPosition): number {
    if (from.system === to.system) return to.bar - from.bar;
    let bars = barCount(from.system) - from.bar;
    for (let index = from.system + 1; index < to.system; index++) {
      bars += barCount(index);
    }
    return bars + to.bar;
  }

  function compare(a: BarPosition, b: BarPosition) {
    return a.system - b.system || a.bar - b.bar;
  }

  const printed: Anchor[] = [];
  for (const marking of allMarkings) {
    if (marking.kind !== 'measure') {
      continue;
    }

    const value = numericValue(marking.text);
    if (value === null) {
      continue;
    }

    const system = systemOf(marking);
    const spacing = systems[system]?.staves[0]?.lineSpacing ?? 0;

    // Engravers centre a number over the bar's opening barline as often as they
    // start it there, so the bar it names is judged from its middle with a
    // staff space of give.
    const middle = (marking.rect.left + marking.rect.right) / 2;

    printed.push({
      system,
      bar: barAt(system, middle + spacing),
      value,
      marking,
    });
  }
  printed.sort(
    (a, b) => compare(a, b) || a.marking.rect.left - b.marking.rect.left,
  );

  const start = { system: 0, bar: 0 };
  const anchors = corroboratedMeasureNumbers(
    printed,
    (anchor) => anchor.value - barsBetween(start, anchor),
  );

  const measuresInferred = anchors.length === 0;

  function measureOf(event: Marking): {
    measure: number;
    marking: Marking | null;
  } {
    const system = systemOf(event);
    const position = { system, bar: barAt(system, event.rect.left) };

    // Several numbers in one bar only happen when barlines went unread; the one
    // nearest the event's left is then the closest guess.
    const sameBar = anchors.filter((anchor) => compare(anchor, position) === 0);
    if (sameBar.length > 0) {
      const anchor =
        lastWhere(
          sameBar,
          (candidate) => candidate.marking.rect.left <= event.rect.left,
        ) ?? sameBar[0];
      return { measure: anchor.value, marking: anchor.marking };
    }

    const before = lastWhere(
      anchors,
      (anchor) => compare(anchor, position) < 0,
    );
    if (before) {
      return {
        measure: before.value + barsBetween(before, position),
        marking: null,
      };
    }

    const after = anchors[0];
    if (after) {
      return {
        measure: Math.max(after.value - barsBetween(position, after), 0),
        marking: null,
      };
    }

    return {
      measure: 1 + barsBetween(start, position),
      marking: null,
    };
  }

  const filteredEvents = filterCourtesyTimeSigs(eventMarkings, analysis.pages);

  // Group events by measure.
  const rowMap = new Map<
    number,
    { measure: number; measureMarking: Marking | null; events: Marking[] }
  >();

  for (const event of filteredEvents) {
    const { measure, marking } = measureOf(event);

    const existing = rowMap.get(measure);
    if (existing) {
      existing.events.push(event);
      existing.measureMarking ??= marking;
    } else {
      rowMap.set(measure, {
        measure,
        measureMarking: marking,
        events: [event],
      });
    }
  }

  // Sort rows by measure number ascending.
  const sorted = [...rowMap.values()].sort((a, b) => a.measure - b.measure);

  const rows: MarkingsRow[] = sorted.map((entry) => ({
    measure: entry.measure,
    measureMarking: entry.measureMarking,
    eventMarkings: entry.events,
  }));

  return { rows, measuresInferred };
}

export type MarkingsExportOptions = {
  pageSize?: { width: number; height: number };
  margin?: number;
  rowGap?: number;
};

export async function extractMarkings(
  sourceBytes: Uint8Array,
  analysis: ScoreAnalysis,
  kind: MarkingsExportKind,
  options?: MarkingsExportOptions,
): Promise<Uint8Array> {
  const { rows, measuresInferred } = collectMarkingsRows(analysis, kind);

  const pageWidth = options?.pageSize?.width ?? 612;
  const pageHeight = options?.pageSize?.height ?? 792;
  const margin = options?.margin ?? 36;
  const rowGap = options?.rowGap ?? 12;

  const source = await PDFDocument.load(sourceBytes, {
    updateMetadata: false,
  });
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.Helvetica);

  const sourcePages = source.getPages();
  const printableWidth = pageWidth - margin * 2;

  // Collect all unique clips needed.
  const clipKey = (
    pageIndex: number,
    rect: { left: number; bottom: number; right: number; top: number },
  ) => `${pageIndex}:${rect.left}:${rect.bottom}:${rect.right}:${rect.top}`;

  const clips = new Map<
    string,
    {
      pageIndex: number;
      rect: { left: number; bottom: number; right: number; top: number };
    }
  >();

  for (const row of rows) {
    if (row.measureMarking) {
      clips.set(
        clipKey(row.measureMarking.pageIndex, row.measureMarking.rect),
        {
          pageIndex: row.measureMarking.pageIndex,
          rect: row.measureMarking.rect,
        },
      );
    }

    for (const event of row.eventMarkings) {
      clips.set(clipKey(event.pageIndex, event.rect), {
        pageIndex: event.pageIndex,
        rect: event.rect,
      });
    }
  }

  const wanted = [...clips.entries()];
  const embeddedPages =
    wanted.length > 0
      ? await output.embedPages(
          wanted.map(([, clip]) => sourcePages[clip.pageIndex]),
          wanted.map(([, clip]) => clip.rect),
        )
      : [];
  const embedded = new Map(
    wanted.map(([key], i) => [key, embeddedPages[i]] as const),
  );

  // Layout rows onto output pages.
  let outPage = output.addPage([pageWidth, pageHeight]);
  let cursor = pageHeight - margin;
  const labelFontSize = 10;
  const clipGap = 6;

  if (measuresInferred) {
    const headerSize = 8;
    const header =
      '(No bar numbers were detected — measure numbers were counted from barlines)';

    outPage.drawText(header, {
      x: margin,
      y: cursor - headerSize,
      size: headerSize,
      font,
    });

    cursor -= headerSize + rowGap;
  }

  for (const row of rows) {
    // Compute row height: max of all clip heights and the label.
    let rowHeight = labelFontSize;
    if (row.measureMarking) {
      const embed = embedded.get(
        clipKey(row.measureMarking.pageIndex, row.measureMarking.rect),
      );
      if (embed) {
        const scale = Math.min(1, printableWidth / embed.width);
        rowHeight = Math.max(rowHeight, embed.height * scale);
      }
    }

    for (const event of row.eventMarkings) {
      const embed = embedded.get(clipKey(event.pageIndex, event.rect));
      if (embed) {
        const scale = Math.min(1, printableWidth / embed.width);
        rowHeight = Math.max(rowHeight, embed.height * scale);
      }
    }

    // Page break if needed.
    if (cursor - rowHeight < margin) {
      outPage = output.addPage([pageWidth, pageHeight]);
      cursor = pageHeight - margin;
    }

    let x = margin;

    // Draw measure number.
    if (row.measureMarking) {
      const embed = embedded.get(
        clipKey(row.measureMarking.pageIndex, row.measureMarking.rect),
      );

      if (embed) {
        const scale = Math.min(1, printableWidth / embed.width);
        outPage.drawPage(embed, {
          x,
          y: cursor - embed.height * scale,
          width: embed.width * scale,
          height: embed.height * scale,
        });
        x += embed.width * scale + clipGap;
      }
    } else if (row.measure !== null) {
      outPage.drawText(String(row.measure), {
        x,
        y: cursor - labelFontSize,
        size: labelFontSize,
        font,
      });

      x += font.widthOfTextAtSize(String(row.measure), labelFontSize) + clipGap;
    }

    // Draw event marking clips.
    for (const event of row.eventMarkings) {
      const embed = embedded.get(clipKey(event.pageIndex, event.rect));

      if (!embed) {
        continue;
      }

      const scale = Math.min(1, (pageWidth - margin - x) / embed.width, 1);
      const clampedScale = Math.max(scale, 0.1);

      outPage.drawPage(embed, {
        x,
        y: cursor - embed.height * clampedScale,
        width: embed.width * clampedScale,
        height: embed.height * clampedScale,
      });

      x += embed.width * clampedScale + clipGap;
    }

    cursor -= rowHeight + rowGap;
  }

  output.setTitle(source.getTitle() ?? '');
  output.setCreator('PDF Editor');
  output.setModificationDate(new Date());
  return output.save();
}

/** How many neighbouring bars either side may vouch for a printed number. */
const CORROBORATION_REACH = 3;

/**
 * The printed numbers the barline count agrees with. A number is read off the
 * margin between systems, so it can land on the wrong one, and stray digits pass
 * for numbers; either would misnumber every event up to the next number. A real
 * number and its neighbours differ by exactly the bars counted between them —
 * their `offset` agrees — where a misplaced one is out by a whole system.
 *
 * Only a number for a *different* bar vouches, since the copies an engraver
 * repeats over each group of staves agree with each other whether right or
 * wrong. With nothing to corroborate against, every number is kept.
 */
function corroboratedMeasureNumbers(
  anchors: readonly Anchor[],
  offset: (anchor: Anchor) => number,
): Anchor[] {
  const bars: Anchor[][] = [];
  for (const anchor of anchors) {
    const bar = bars.at(-1);
    const first = bar?.[0];
    if (
      bar &&
      first &&
      first.system === anchor.system &&
      first.bar === anchor.bar &&
      first.value === anchor.value
    ) {
      bar.push(anchor);
    } else {
      bars.push([anchor]);
    }
  }

  const kept = bars.filter((bar, index) => {
    const own = offset(bar[0]);
    const near = [
      ...bars.slice(Math.max(index - CORROBORATION_REACH, 0), index),
      ...bars.slice(index + 1, index + 1 + CORROBORATION_REACH),
    ];
    return near.some(
      (other) => other[0].value !== bar[0].value && offset(other[0]) === own,
    );
  });

  return kept.length > 0 ? kept.flat() : [...anchors];
}

function lastWhere<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) return items[i];
  }
  return undefined;
}

/**
 * Removes courtesy (cautionary) time signatures that engravers place at the
 * very end of a system to warn the player of an upcoming change. The "real"
 * time signature at the start of the next system is kept; the courtesy
 * duplicate is dropped so the export doesn't show the same change twice.
 */
function filterCourtesyTimeSigs(
  events: Marking[],
  pages: readonly ScorePage[],
): Marking[] {
  const timeSigs = events.filter((e) => e.kind === 'time-signature');
  if (timeSigs.length === 0) return events;

  const courtesy = new Set<Marking>();

  for (const ts of timeSigs) {
    const system = pages[ts.pageIndex]?.systems[ts.systemIndex];
    if (!system) continue;

    const systemWidth = system.right - system.left;
    if (systemWidth <= 0) continue;

    const posInSystem = (ts.rect.left - system.left) / systemWidth;
    if (posInSystem < 0.8) continue;

    // Identify the next system in reading order.
    const page = pages[ts.pageIndex];
    let nextPageIdx = ts.pageIndex;
    let nextSysIdx = ts.systemIndex + 1;
    if (nextSysIdx >= page.systems.length) {
      nextPageIdx++;
      nextSysIdx = 0;
    }

    const hasMatch = timeSigs.some(
      (other) =>
        other !== ts &&
        other.pageIndex === nextPageIdx &&
        other.systemIndex === nextSysIdx &&
        other.text === ts.text,
    );

    if (hasMatch) {
      courtesy.add(ts);
    }
  }

  return courtesy.size > 0 ? events.filter((e) => !courtesy.has(e)) : events;
}

const EXPORT_SUFFIX: Record<MarkingsExportKind, string> = {
  'time-signature': 'time-signature-map',
  tempo: 'tempo-map',
};

export function markingsExportFileName(
  name: string,
  kind: MarkingsExportKind,
): string {
  const base = name.replace(/\.pdf$/i, '') || 'score';
  return `${base}-${EXPORT_SUFFIX[kind]}.pdf`;
}
