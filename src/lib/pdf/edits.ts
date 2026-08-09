import { normalizeAngle, type PageEdit } from '#/lib/pdf/document';

/** Rotates a single page by `delta` degrees, keeping the angle normalized. */
export function rotatePage(
  pages: readonly PageEdit[],
  id: string,
  delta: number,
): PageEdit[] {
  return pages.map((page) =>
    page.id === id
      ? { ...page, rotation: normalizeAngle(page.rotation + delta) }
      : page,
  );
}

/** Rotates every page, used by the toolbar when no single page is the target. */
export function rotateAllPages(
  pages: readonly PageEdit[],
  delta: number,
): PageEdit[] {
  return pages.map((page) => ({
    ...page,
    rotation: normalizeAngle(page.rotation + delta),
  }));
}

export function removePage(pages: readonly PageEdit[], id: string): PageEdit[] {
  return pages.filter((page) => page.id !== id);
}

/**
 * Swaps a page with its neighbour. Returns the original list unchanged when the
 * page is already at the edge, so callers can skip pushing a no-op onto undo.
 */
export function movePage(
  pages: readonly PageEdit[],
  id: string,
  direction: -1 | 1,
): PageEdit[] {
  const from = pages.findIndex((page) => page.id === id);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= pages.length) return pages as PageEdit[];

  const next = [...pages];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** True when the page list still matches the document as uploaded. */
export function isUnchanged(
  pages: readonly PageEdit[],
  original: readonly PageEdit[],
): boolean {
  if (pages.length !== original.length) return false;
  return pages.every(
    (page, index) =>
      page.id === original[index].id &&
      page.rotation === original[index].rotation,
  );
}
