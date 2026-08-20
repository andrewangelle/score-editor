/**
 * A draw sink that records instead of drawing.
 *
 * pdf-lib deflates the content streams it builds, so the operators are not
 * readable back out of a saved document; the calls are the observable behaviour
 * of stamping. Shared, because two suites need to compare against it — what the
 * flattened path draws, and what the appearance-stream path draws — and the
 * whole point of `DrawSink` is that those two answers are the same.
 */

import type { DrawSink } from '#/lib/pdf/annotationStamp';

export type Circle = { x: number; y: number; size: number };
export type Text = { text: string; x: number; y: number; size: number };

export function recorder() {
  const circles: Circle[] = [];
  const texts: Text[] = [];

  const page: DrawSink = {
    drawText: (
      text: string,
      { x, y, size }: { x: number; y: number; size: number },
    ) => texts.push({ text, x, y, size }),
    drawCircle: ({ x, y, size }: Circle) => circles.push({ x, y, size }),
  };

  return { page, circles, texts };
}
