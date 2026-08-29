/**
 * The one conversion between PDF user space and screen space.
 */

export type Point = { x: number; y: number };

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
