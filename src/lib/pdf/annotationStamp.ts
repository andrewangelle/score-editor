/**
 * Drawing annotations onto an output page.
 *
 * Saving the whole document and extracting a part stamp the same marks, and a
 * string number circled in the full score but bare in the extracted part is a
 * different instruction. So the geometry lives here once and both callers hand
 * it a placement in their own output space.
 */

import { type Color, type PDFFont, rgb } from 'pdf-lib';
import {
  ANNOTATION_COLORS,
  type AnnotationColor,
  DEFAULT_COLOR,
  type ScoreAnnotation,
} from '#/lib/pdf/annotations';

export function annotationInk(color: AnnotationColor): Color {
  const [r, g, b] = (
    ANNOTATION_COLORS[color] ?? ANNOTATION_COLORS[DEFAULT_COLOR]
  ).rgb;
  return rgb(r, g, b);
}

/**
 * Helvetica's cap height as a fraction of point size. Worth the constant because
 * `heightAtSize` reports full line height, ascender and descender included, so
 * centring a digit against it sinks it visibly below the middle of its circle.
 */
const CAP_HEIGHT = 0.717;

/** How far the circle stands off the digit, as a fraction of point size. */
const CIRCLE_PADDING = 0.24;

/** Placement in the output page's user space. */
type Placement = {
  x: number;
  y: number;
  size: number;
};

/**
 * What stamping needs from the thing it draws onto: either a page's content
 * stream (flattened, the way a printed part carries it) or an annotation's
 * appearance stream (readable back as an editable object).
 *
 * `PDFPage` satisfies this structurally, as does the recording sink in
 * `annotationObjects.ts`, so neither path can drift from the other.
 */
export type DrawSink = {
  drawText(
    text: string,
    options: {
      x: number;
      y: number;
      size: number;
      font: PDFFont;
      color: Color;
    },
  ): void;
  drawCircle(options: {
    x: number;
    y: number;
    size: number;
    borderColor: Color;
    borderWidth: number;
  }): void;
};

/** Silently skips blank text, so callers do not each have to check. */
export function stampAnnotation(
  page: DrawSink,
  annotation: ScoreAnnotation,
  placement: Placement,
  font: PDFFont,
): void {
  const text = annotation.text.trim();
  if (!text) return;

  const { x, y, size } = placement;
  const ink = annotationInk(annotation.color);
  page.drawText(text, { x, y, size, font, color: ink });

  if (annotation.kind !== 'string') return;

  // Centred on the digit rather than the anchor: "1" and "12" are different
  // widths, and a circle drawn to a fixed box sits off to one side of the
  // narrower one.
  const width = font.widthOfTextAtSize(text, size);
  const capHeight = size * CAP_HEIGHT;

  page.drawCircle({
    x: x + width / 2,
    y: y + capHeight / 2,
    size: Math.max(width, capHeight) / 2 + size * CIRCLE_PADDING,
    // No `color`, so pdf-lib leaves the circle unfilled and the music engraved
    // underneath it still shows through.
    borderColor: ink,
    borderWidth: Math.max(0.4, size * 0.07),
  });
}
