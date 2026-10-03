import {
  defaultRangeExtractor,
  type Range,
  useVirtualizer,
  type Virtualizer,
} from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { PAGE_GAP } from '#/components/PDFViewer/PDFViewer.constants';
import { PAGE_LIST_CLASS } from '#/components/PDFViewer/PDFViewer.styles';
import {
  renderedHeight,
  withPinned,
} from '#/components/PDFViewer/PDFViewer.utils';
import { ViewerPage } from '#/components/PDFViewer/ViewerPage';
import type { PageSize } from '#/hooks/usePageSizes';
import {
  pageSelected,
  selectPages,
  selectSelectedPageId,
  selectSelectionSource,
} from '#/store/document.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { selectActivePageId } from '#/store/tool.slice';

type PageListProps = {
  stage: HTMLDivElement;
  /** Indexed by source index. */
  sizes: PageSize[];
  pageWidth: number;
};

export function PageList({ stage, sizes, pageWidth }: PageListProps) {
  // The virtualizer is one mutable instance for the component's lifetime, so
  // the compiler would memoize everything read from it and never update.
  'use no memo';
  const dispatch = useAppDispatch();
  const pages = useAppSelector(selectPages);
  const selectedPageId = useAppSelector(selectSelectedPageId);
  const selectionSource = useAppSelector(selectSelectionSource);
  const activePageId = useAppSelector(selectActivePageId);
  const selectedIndex = pages.findIndex((page) => page.id === selectedPageId);
  const pinnedIndex = pages.findIndex((page) => page.id === activePageId);
  // Where a scroll asked for by the selection landed. Scroll events at that
  // offset are its own echo, not the reader moving, so they must not re-select.
  const landedAt = useRef<number | null>(null);
  const syncFrame = useRef<number | null>(null);
  // Read a frame after the scroll, by which time this render's values may be stale.
  const latest = useRef({ pages, selectedPageId });

  const getItemKey = useCallback((index: number) => pages[index].id, [pages]);

  const estimateSize = useCallback(
    (index: number) =>
      renderedHeight(sizes[pages[index].sourceIndex], pageWidth),
    [pages, sizes, pageWidth],
  );

  const rangeExtractor = useCallback(
    (range: Range) => withPinned(defaultRangeExtractor(range), pinnedIndex),
    [pinnedIndex],
  );

  function selectPageInView(instance: Virtualizer<HTMLDivElement, Element>) {
    syncFrame.current = null;
    const offset = instance.scrollOffset ?? 0;

    if (landedAt.current !== null) {
      if (Math.abs(offset - landedAt.current) < 1) return;
      landedAt.current = null;
    }

    const { pages, selectedPageId } = latest.current;
    const centre = offset + stage.clientHeight / 2;
    const page = pages[instance.getVirtualItemForOffset(centre)?.index ?? -1];
    if (page && page.id !== selectedPageId) {
      dispatch(pageSelected(page.id, { source: 'scroll' }));
    }
  }

  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => stage,
    estimateSize,
    getItemKey,
    rangeExtractor,
    gap: PAGE_GAP,
    paddingStart: PAGE_GAP,
    paddingEnd: PAGE_GAP,
    scrollPaddingStart: PAGE_GAP,
    overscan: 2,
    onChange(instance) {
      syncFrame.current ??= requestAnimationFrame(() =>
        selectPageInView(instance),
      );
    },
  });

  useEffect(() => {
    latest.current = { pages, selectedPageId };
  });

  useEffect(
    () => () => {
      if (syncFrame.current === null) {
        return;
      }

      cancelAnimationFrame(syncFrame.current);
      syncFrame.current = null;
    },
    [],
  );

  useLayoutEffect(() => {
    if (virtualizer || pageWidth || pages || sizes) {
      virtualizer.measure();
    }
  }, [virtualizer, pageWidth, pages, sizes]);

  useLayoutEffect(() => {
    if (selectionSource === 'scroll' || selectedIndex === -1) {
      return;
    }

    const target = virtualizer.getOffsetForIndex(selectedIndex, 'start');
    if (!target) {
      return;
    }

    landedAt.current = target[0];

    if (selectedPageId) {
      virtualizer.scrollToIndex(selectedIndex, { align: 'start' });
    }
  }, [virtualizer, selectedPageId, selectedIndex, selectionSource]);

  return (
    <div
      data-testid="PageList"
      className={PAGE_LIST_CLASS}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => (
        <ViewerPage
          key={item.key}
          index={item.index}
          page={pages[item.index]}
          top={item.start}
          pageWidth={pageWidth}
          height={item.size}
        />
      ))}
    </div>
  );
}
