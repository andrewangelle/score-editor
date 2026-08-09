/**
 * The one conversion between PDF user space and screen space.
 *
 * PDF measures in points from the bottom-left with y increasing upward; CSS
 * measures in pixels from the top-left with y increasing downward. Getting this
 * wrong puts every annotation on the wrong side of the page, so it lives here as
 * a pair of pure, mutually inverse functions rather than inline in a component.
 */

export type Point = { x: number; y: number };

/** Screen offset within the rendered page -> PDF user space. */
export function toPdfPoint(
  offsetX: number,
  offsetY: number,
  pageHeight: number,
  scale: number,
): Point {
  return {
    x: offsetX / scale,
    y: pageHeight - offsetY / scale,
  };
}

/** PDF user space -> screen offset within the rendered page. */
export function toScreenPoint(
  point: Point,
  pageHeight: number,
  scale: number,
): Point {
  return {
    x: point.x * scale,
    y: (pageHeight - point.y) * scale,
  };
}

export type ScreenBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * A PDF rectangle as CSS box geometry. The vertical flip means the rectangle's
 * *top* edge supplies the CSS `top`, which is the easiest thing to get backwards.
 */
export function rectToScreen(
  rect: { left: number; bottom: number; right: number; top: number },
  pageHeight: number,
  scale: number,
): ScreenBox {
  return {
    left: rect.left * scale,
    top: (pageHeight - rect.top) * scale,
    width: (rect.right - rect.left) * scale,
    height: (rect.top - rect.bottom) * scale,
  };
}
