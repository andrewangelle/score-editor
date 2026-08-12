/**
 * Turns regions into a new PDF containing only those rectangles.
 *
 * `pdf-lib`'s `embedPage` clips to a rectangle, so a region is lifted as vector
 * content — the output stays crisp and selectable, unlike a render-and-crop
 * approach. Nothing in here knows about music: regions may come from staff
 * detection or from the user dragging boxes on the page.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { annotationsWithin, type ScoreAnnotation } from '#/lib/pdf/annotations';
import {
  DEFAULT_LAYOUT,
  type LayoutOptions,
  type Region,
  regionsFromParts,
  staffBounds,
} from '#/lib/pdf/regions';
import type { PageStaves } from '#/lib/pdf/staffDetection';

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

  for (const group of groups) {
    const groupHeight =
      group.reduce((sum, r) => sum + (r.rect.top - r.rect.bottom), 0) +
      options.bandGap * (group.length - 1);

    // Start a new page unless the whole group fits, or nothing has been placed
    // yet — a group taller than one page has to overflow somewhere.
    if (cursor - groupHeight < usableBottom && current.length > 0) {
      pages.push(current);
      current = [];
      cursor = usableTop;
    }

    for (const region of group) {
      const height = region.rect.top - region.rect.bottom;
      current.push({ region, x: options.margin, y: cursor - height });
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

  // Embed every region up front: embedPage is async and one call per region
  // keeps each clip independent.
  const sourcePages = source.getPages();
  const flat = laidOut.flat();
  const embedded = await output.embedPages(
    flat.map((placed) => sourcePages[placed.region.pageIndex]),
    flat.map((placed) => placed.region.rect),
  );
  const embeddedByRegion = new Map(
    flat.map((placed, i) => [placed, embedded[i]]),
  );

  const printableWidth = pageWidth - layout.margin * 2;

  for (const pageRegions of laidOut) {
    const outPage = output.addPage([pageWidth, pageHeight]);

    for (const placed of pageRegions) {
      const embed = embeddedByRegion.get(placed);
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

      // Notes are baked at the same scale so they stay glued to their notehead.
      const inRegion = annotationsWithin(
        annotations,
        placed.region.pageIndex,
        placed.region.rect,
      );
      for (const annotation of inRegion) {
        if (!annotation.text.trim()) continue;
        outPage.drawText(annotation.text, {
          x: placed.x + (annotation.x - placed.region.rect.left) * scale,
          y:
            placed.y +
            (embed.height - height) +
            (annotation.y - placed.region.rect.bottom) * scale,
          size: annotation.size * scale,
          font,
          color: rgb(0.1, 0.2, 0.75),
        });
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
