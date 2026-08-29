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

const CAP_HEIGHT = 0.717;
const CIRCLE_PADDING = 0.24;

type Placement = {
  x: number;
  y: number;
  size: number;
};

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
  const width = font.widthOfTextAtSize(text, size);
  const capHeight = size * CAP_HEIGHT;

  page.drawCircle({
    x: x + width / 2,
    y: y + capHeight / 2,
    size: Math.max(width, capHeight) / 2 + size * CIRCLE_PADDING,
    borderColor: ink,
    borderWidth: Math.max(0.4, size * 0.07),
  });
}
