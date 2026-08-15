/**
 * Turns regions into a new PDF containing only those rectangles.
 *
 * `pdf-lib`'s `embedPage` clips to a rectangle, so a region is lifted as vector
 * content — the output stays crisp and selectable, unlike a render-and-crop
 * approach. Nothing in here knows about music: regions may come from staff
 * detection or from the user dragging boxes on the page.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib';
import { stampAnnotation } from '#/lib/pdf/annotationStamp';
import { annotationsWithin, type ScoreAnnotation } from '#/lib/pdf/annotations';
import {
  DEFAULT_LAYOUT,
  type LayoutOptions,
  markingRows,
  markingStackHeight,
  type Region,
  regionsFromParts,
  staffBounds,
} from '#/lib/pdf/regions';
import type { PageStaves, Rect } from '#/lib/pdf/staffDetection';

export { DEFAULT_LAYOUT, type LayoutOptions, staffBounds };

export type Part = {
  id: string;
  /** Position within each system. This, not the name, identifies the part. */
  ordinal: number;
  name: string;
};

/** Kept as an alias: a band is just a region derived from staff detection. */
export type Band = Region;

export function planBands(
  pages: readonly PageStaves[],
  selectedOrdinals: readonly number[],
  options: LayoutOptions = DEFAULT_LAYOUT,
): Region[] {
  return regionsFromParts(pages, selectedOrdinals, [], options);
}

type PlacedRegion = { region: Region; x: number; y: number };

/**
 * Flows regions down output pages. Regions sharing a group key are placed
 * together: for derived bands that means one source system, and splitting a
 * system across a page break would separate music meant to be read at once.
 */
export function layoutBands(
  regions: readonly Region[],
  pageHeight: number,
  options: LayoutOptions = DEFAULT_LAYOUT,
): PlacedRegion[][] {
  const usableTop = pageHeight - options.margin;
  const usableBottom = options.margin;

  // Grouped by key rather than by adjacency: a hand-edited region sorts to
  // wherever its new geometry puts it, which for a run-length scan would split
  // its system into several groups and lay them out as if they were unrelated.
  // Groups keep first-appearance order, so document order still drives the flow.
  const groups: Region[][] = [];
  const byKey = new Map<string, Region[]>();
  for (const region of regions) {
    const group = byKey.get(region.groupKey);
    if (group) {
      group.push(region);
    } else {
      const started = [region];
      byKey.set(region.groupKey, started);
      groups.push(started);
    }
  }

  const pages: PlacedRegion[][] = [];
  let current: PlacedRegion[] = [];
  let cursor = usableTop;

  /** What a region occupies: its own rectangle plus anything stamped above it. */
  const occupied = (region: Region): number =>
    region.rect.top - region.rect.bottom + markingStackHeight(region, options);

  for (const group of groups) {
    const groupHeight =
      group.reduce((sum, region) => sum + occupied(region), 0) +
      options.bandGap * (group.length - 1);

    // Start a new page unless the whole group fits, or nothing has been placed
    // yet — a group taller than one page has to overflow somewhere.
    if (cursor - groupHeight < usableBottom && current.length > 0) {
      pages.push(current);
      current = [];
      cursor = usableTop;
    }

    for (const region of group) {
      // The markings sit above the band, so the band itself starts that much
      // further down; `y` is where its own rectangle is drawn.
      const height = occupied(region);
      current.push({
        region,
        x: options.margin,
        y: cursor - height,
      });
      cursor -= height + options.bandGap;
    }
    cursor -= options.bandGap;
  }

  if (current.length > 0) pages.push(current);
  return pages;
}

export type ExtractOptions = {
  layout?: LayoutOptions;
  annotations?: readonly ScoreAnnotation[];
  /** Output page size; defaults to the first source page's size. */
  pageSize?: { width: number; height: number };
};

/**
 * Produces the output PDF. Regions are scaled to fit the printable width when
 * the source is wider, which keeps a full-width region from running under the
 * margin.
 */
export async function extractRegions(
  sourceBytes: Uint8Array,
  regions: readonly Region[],
  fallbackSize: { width: number; height: number },
  options: ExtractOptions = {},
): Promise<Uint8Array> {
  const layout = options.layout ?? DEFAULT_LAYOUT;
  const annotations = options.annotations ?? [];

  if (regions.length === 0) {
    throw new Error(
      'Nothing to extract. Select at least one part, or draw a region on the page.',
    );
  }

  const source = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.Helvetica);

  const pageWidth = options.pageSize?.width ?? fallbackSize.width;
  const pageHeight = options.pageSize?.height ?? fallbackSize.height;
  const laidOut = layoutBands(regions, pageHeight, layout);

  // Embed every rectangle up front, once each. `embedPage` copies the source
  // page's content stream into the form it makes, and one marking is stamped
  // onto every band of its system — embedding it per band would multiply the
  // output's size by the number of parts.
  const sourcePages = source.getPages();
  const flat = laidOut.flat();
  const clipKey = (pageIndex: number, rect: Rect) =>
    `${pageIndex}:${rect.left}:${rect.bottom}:${rect.right}:${rect.top}`;

  const clips = new Map<string, { pageIndex: number; rect: Rect }>();
  const stampsOf = (region: Region) =>
    layout.keepMarkings
      ? markingRows(region).flatMap((row) => row.markings)
      : [];

  for (const placed of flat) {
    const { pageIndex, rect } = placed.region;
    clips.set(clipKey(pageIndex, rect), { pageIndex, rect });
    for (const marking of stampsOf(placed.region)) {
      clips.set(clipKey(pageIndex, marking.rect), {
        pageIndex,
        rect: marking.rect,
      });
    }
  }

  const wanted = [...clips.entries()];
  const embeddedPages = await output.embedPages(
    wanted.map(([, clip]) => sourcePages[clip.pageIndex]),
    wanted.map(([, clip]) => clip.rect),
  );
  const embedded = new Map(
    wanted.map(([key], i) => [key, embeddedPages[i]] as const),
  );

  const printableWidth = pageWidth - layout.margin * 2;

  for (const pageRegions of laidOut) {
    const outPage = output.addPage([pageWidth, pageHeight]);

    for (const placed of pageRegions) {
      const embed = embedded.get(
        clipKey(placed.region.pageIndex, placed.region.rect),
      );
      if (!embed) continue;

      const scale = Math.min(1, printableWidth / embed.width);
      const width = embed.width * scale;
      const height = embed.height * scale;

      outPage.drawPage(embed, {
        x: placed.x,
        y: placed.y + (embed.height - height),
        width,
        height,
      });

      // Markings are stacked back above the band, nearest line first, each at
      // the horizontal position it held in the score — a measure number hung in
      // the left margin stays in the left margin. They are lifted as vector
      // clips rather than re-typeset, so a metronome mark keeps its note glyph
      // and a boxed rehearsal letter keeps its box.
      let stack = placed.y + embed.height + layout.markingGap;
      const rows = layout.keepMarkings ? markingRows(placed.region) : [];
      for (const row of rows) {
        for (const marking of row.markings) {
          const stamp = embedded.get(
            clipKey(placed.region.pageIndex, marking.rect),
          );
          if (!stamp) continue;

          const stampWidth = stamp.width * scale;
          const offset = (marking.rect.left - placed.region.rect.left) * scale;
          outPage.drawPage(stamp, {
            // A marking engraved outside the band's own width — or one whose
            // band was scaled down — would otherwise run off the page.
            x: Math.min(
              Math.max(layout.margin, placed.x + offset),
              pageWidth - layout.margin - stampWidth,
            ),
            // Within a row, each marking keeps the height it was set at, so a
            // metronome mark still sits below the caption it belongs under.
            y: stack + (marking.rect.bottom - row.bottom) * scale,
            width: stampWidth,
            height: stamp.height * scale,
          });
        }
        stack += row.height * scale + layout.markingGap;
      }

      // Notes are baked at the same scale so they stay glued to their notehead.
      const inRegion = annotationsWithin(
        annotations,
        placed.region.pageIndex,
        placed.region.rect,
      );
      for (const annotation of inRegion) {
        stampAnnotation(
          outPage,
          annotation,
          {
            x: placed.x + (annotation.x - placed.region.rect.left) * scale,
            y:
              placed.y +
              (embed.height - height) +
              (annotation.y - placed.region.rect.bottom) * scale,
            size: annotation.size * scale,
          },
          font,
        );
      }
    }
  }

  output.setTitle(source.getTitle() ?? '');
  output.setCreator('PDF Editor');
  output.setModificationDate(new Date());
  return output.save();
}

/** Convenience wrapper for the detected-staves path. */
export async function extractParts(
  sourceBytes: Uint8Array,
  pages: readonly PageStaves[],
  selectedOrdinals: readonly number[],
  options: ExtractOptions = {},
): Promise<Uint8Array> {
  const layout = options.layout ?? DEFAULT_LAYOUT;
  const regions = regionsFromParts(pages, selectedOrdinals, [], layout);
  if (regions.length === 0) {
    throw new Error(
      'No staves matched that selection. Check the detected parts before extracting.',
    );
  }
  return extractRegions(sourceBytes, regions, pages[0], options);
}

/** `score.pdf` + ["Gtr 1","Gtr 2"] -> `score-Gtr 1+Gtr 2.pdf` */
export function partFileName(
  name: string,
  parts: readonly Part[],
  fallback = 'parts',
): string {
  const base = name.replace(/\.pdf$/i, '') || 'score';
  const suffix =
    parts.length > 0 ? parts.map((part) => part.name).join('+') : fallback;
  return `${base}-${suffix}.pdf`.replace(/[/\\]/g, '-');
}
