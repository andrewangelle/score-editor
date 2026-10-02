import type { PageSize } from '#/hooks/usePageSizes';

/** A page's height when rendered `pageWidth` pixels wide. */
export function renderedHeight(size: PageSize, pageWidth: number) {
  return (pageWidth * size.height) / size.width;
}

/**
 * Adds a pinned index to the virtualizer's range. The range must stay sorted
 * ascending, and the pinned index may already be in it.
 */
export function withPinned(range: number[], pinned: number) {
  if (pinned < 0 || range.includes(pinned)) return range;
  return [...range, pinned].sort((a, b) => a - b);
}
