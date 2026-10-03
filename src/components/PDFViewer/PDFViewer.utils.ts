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
  if (pinned < 0 || range.includes(pinned)) {
    return range;
  }
  return [...range, pinned].sort((a, b) => a - b);
}

/**
 * The mounted pages in the order analysis should reach them: the visible range,
 * then the overscan nearest it (below before above), then the pinned page.
 * `items` is the virtualizer's mounted set, which comes back in index order and
 * so would put the overscan above the viewport first.
 */
export function analysisPriority(
  range: { startIndex: number; endIndex: number },
  items: readonly number[],
  pinnedIndex: number,
) {
  const mounted = new Set(items);
  const order: number[] = [];
  for (let index = range.startIndex; index <= range.endIndex; index++) {
    order.push(index);
  }

  for (let distance = 1; ; distance++) {
    const below = range.endIndex + distance;
    const above = range.startIndex - distance;
    const hasBelow = mounted.has(below);
    const hasAbove = mounted.has(above);
    if (!hasBelow && !hasAbove) {
      break;
    }
    if (hasBelow) {
      order.push(below);
    }
    if (hasAbove) {
      order.push(above);
    }
  }

  if (pinnedIndex >= 0 && !order.includes(pinnedIndex)) {
    order.push(pinnedIndex);
  }
  return order;
}

/** Duplicated pages share a source page, and so share its analysis. */
export function toSourceIndices(
  indices: readonly number[],
  pages: readonly { sourceIndex: number }[],
) {
  const sources: number[] = [];
  for (const index of indices) {
    const source = pages[index]?.sourceIndex;
    if (source !== undefined && !sources.includes(source)) {
      sources.push(source);
    }
  }
  return sources;
}

export function sameIndices(a: readonly number[], b: readonly number[]) {
  return a.length === b.length && a.every((index, i) => index === b[i]);
}
