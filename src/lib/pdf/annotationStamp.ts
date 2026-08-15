/**
 * Drawing annotations onto an output page.
 *
 * Saving the whole document and extracting a part both end up stamping the same
 * marks, and they must look identical either way — a string number that is
 * circled in the full score and bare in the extracted part is a different
 * instruction. So the geometry lives here once, and both callers hand it a
 * placement in their own output space.
 */

import { type PDFFont, type PDFPage, rgb } from 'pdf-lib';
import type { ScoreAnnotation } from '#/lib/pdf/annotations';

/** Ink for every mark: clearly the performer's, not the engraver's. */
export const ANNOTATION_COLOR = rgb(0.1, 0.2, 0.75);

/**
 * Helvetica's cap height as a fraction of point size.
 *
 * The circled digits are the only place this matters, and it is worth the
 * constant: `heightAtSize` reports the font's full line height, ascender and
 * descender included, so centring a digit against it would sink it visibly
 * below the middle of its circle.
 */
const CAP_HEIGHT = 0.717;

/** How far the circle stands off the digit, as a fraction of point size. */
const CIRCLE_PADDING = 0.24;

type Placement = {
  /** Text's left edge, in the output page's user space. */
  x: number;
  /** Text's baseline, in the output page's user space. */
  y: number;
  /** Point size, already scaled to the output. */
  size: number;
};

/**
 * Stamps one annotation, if it has anything to say. Silently skips blank text
 * so callers do not each have to check.
 */
export function stampAnnotation(
  page: PDFPage,
  annotation: ScoreAnnotation,
  placement: Placement,
  font: PDFFont,
): void {
  const text = annotation.text.trim();
  if (!text) return;

  const { x, y, size } = placement;
  page.drawText(text, { x, y, size, font, color: ANNOTATION_COLOR });

  if (annotation.kind !== 'string') return;

  // The circle is centred on the digit rather than on the anchor: a "1" and a
  // "12" are different widths, and a circle drawn to a fixed box would sit off
  // to one side of the narrower one.
  const width = font.widthOfTextAtSize(text, size);
  const capHeight = size * CAP_HEIGHT;

  page.drawCircle({
    x: x + width / 2,
    y: y + capHeight / 2,
    size: Math.max(width, capHeight) / 2 + size * CIRCLE_PADDING,
    // No `color`, so pdf-lib leaves the circle unfilled and the music engraved
    // underneath it still shows through.
    borderColor: ANNOTATION_COLOR,
    borderWidth: Math.max(0.4, size * 0.07),
  });
}
