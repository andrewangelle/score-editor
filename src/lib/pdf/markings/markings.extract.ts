import { PDFDocument, StandardFonts } from 'pdf-lib';
import { type Marking, numericValue } from '#/lib/pdf/markings/markings';
import type { ScoreAnalysis } from '#/lib/pdf/scoreAnalysis';

export type MarkingsRow = {
  measure: number | null;
  measureMarking: Marking | null;
  eventMarkings: Marking[];
};

export type MarkingsExportResult = {
  rows: MarkingsRow[];
  measuresInferred: boolean;
};

type SystemKey = `${number}:${number}`;

function systemKey(pageIndex: number, systemIndex: number): SystemKey {
  return `${pageIndex}:${systemIndex}`;
}

export function collectMarkingsRows(
  analysis: ScoreAnalysis,
): MarkingsExportResult {
  const allMarkings = analysis.pages.flatMap((page) => page.markings);

  const measureMarkings = allMarkings.filter(
    (marking) => marking.kind === 'measure',
  );

  const eventMarkings = allMarkings.filter(
    (marking) => marking.kind === 'tempo' || marking.kind === 'time-signature',
  );

  if (eventMarkings.length === 0) {
    return { rows: [], measuresInferred: false };
  }

  const measuresInferred = measureMarkings.length === 0;

  // Build an ordered list of measure entries keyed by (pageIndex, systemIndex).
  type MeasureEntry = {
    key: SystemKey;
    value: number;
    marking: Marking | null;
    left: number;
  };

  const measures: MeasureEntry[] = [];

  if (measuresInferred) {
    let systemOrdinal = 0;
    for (const page of analysis.pages) {
      for (let si = 0; si < page.systems.length; si++) {
        systemOrdinal++;
        measures.push({
          key: systemKey(page.pageIndex, si),
          value: systemOrdinal,
          marking: null,
          left: Number.NEGATIVE_INFINITY,
        });
      }
    }
  } else {
    const sorted = [...measureMarkings].sort(
      (a, b) =>
        a.pageIndex - b.pageIndex ||
        a.systemIndex - b.systemIndex ||
        a.rect.left - b.rect.left,
    );

    for (const marking of sorted) {
      const value = numericValue(marking.text);

      if (value === null) {
        continue;
      }

      measures.push({
        key: systemKey(marking.pageIndex, marking.systemIndex),
        value,
        marking,
        left: marking.rect.left,
      });
    }
  }

  // For each event marking, find the nearest measure number to its left on the
  // same system, or fall back to the last measure from the previous system.
  function findMeasure(event: Marking): MeasureEntry | null {
    const evKey = systemKey(event.pageIndex, event.systemIndex);

    // Measures on the same system, at or to the left of the event.
    const sameSystem = measures.filter(
      (m) => m.key === evKey && m.left <= event.rect.left,
    );
    if (sameSystem.length > 0) {
      return sameSystem[sameSystem.length - 1];
    }

    // Same system but event is before any measure number — use first of system.
    const anyOnSystem = measures.filter((m) => m.key === evKey);
    if (anyOnSystem.length > 0) {
      return anyOnSystem[0];
    }

    // Look back through all previous systems.
    const eventGlobal = globalSystemIndex(event.pageIndex, event.systemIndex);
    let best: MeasureEntry | null = null;
    for (const m of measures) {
      const mGlobal = globalSystemIndex(
        Number(m.key.split(':')[0]),
        Number(m.key.split(':')[1]),
      );
      if (mGlobal < eventGlobal) {
        best = m;
      }
    }
    return best;
  }

  // Build global system ordinal for ordering.
  const systemOffsets = new Map<number, number>();
  let offset = 0;
  for (const page of analysis.pages) {
    systemOffsets.set(page.pageIndex, offset);
    offset += page.systems.length;
  }

  function globalSystemIndex(pageIndex: number, systemIndex: number): number {
    return (systemOffsets.get(pageIndex) ?? 0) + systemIndex;
  }

  // Group events by measure.
  const rowMap = new Map<
    number,
    { measure: number; measureMarking: Marking | null; events: Marking[] }
  >();

  for (const event of eventMarkings) {
    const entry = findMeasure(event);
    if (!entry) continue;

    const existing = rowMap.get(entry.value);
    if (existing) {
      existing.events.push(event);
    } else {
      rowMap.set(entry.value, {
        measure: entry.value,
        measureMarking: entry.marking,
        events: [event],
      });
    }
  }

  // Sort rows by measure number ascending.
  const sorted = [...rowMap.values()].sort((a, b) => a.measure - b.measure);

  const rows: MarkingsRow[] = sorted.map((entry) => {
    // Time signatures before tempo marks within each row.
    const events = [...entry.events].sort((a, b) => {
      const kindOrder = (k: string) => (k === 'time-signature' ? 0 : 1);
      return kindOrder(a.kind) - kindOrder(b.kind);
    });

    return {
      measure: entry.measure,
      measureMarking: entry.measureMarking,
      eventMarkings: events,
    };
  });

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
  options?: MarkingsExportOptions,
): Promise<Uint8Array> {
  const { rows, measuresInferred } = collectMarkingsRows(analysis);

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
      '(Measure numbers are approximate — no bar numbers were detected)';
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
      if (!embed) continue;

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

export function markingsExportFileName(name: string): string {
  const base = name.replace(/\.pdf$/i, '') || 'score';
  return `${base}-markings.pdf`;
}
