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
  analysisPriority,
  renderedHeight,
  sameIndices,
  toSourceIndices,
  withPinned,
} from '#/components/PDFViewer/PDFViewer.utils';
import { ViewerPage } from '#/components/PDFViewer/ViewerPage';
import type { PageSize } from '#/hooks/usePageSizes';
import {
  pageSelected,
  selectDocumentId,
  selectPages,
  selectSelectedPageId,
  selectSelectionSource,
} from '#/store/document.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { analysisPrioritised, selectAnalysis } from '#/store/score.slice';
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
  const documentId = useAppSelector(selectDocumentId);
  const analysisDone = useAppSelector(selectAnalysis) !== null;
  const selectedIndex = pages.findIndex((page) => page.id === selectedPageId);
  const pinnedIndex = pages.findIndex((page) => page.id === activePageId);
  // Where a scroll asked for by the selection landed. Scroll events at that
  // offset are its own echo, not the reader moving, so they must not re-select.
  const landedAt = useRef<number | null>(null);
  const syncFrame = useRef<number | null>(null);
  // Read a frame after the scroll, by which time this render's values may be stale.
  const latest = useRef({
    pages,
    selectedPageId,
    selectedIndex,
    pinnedIndex,
    analysisDone,
    documentId,
  });
  // Tagged with its document: the store's priority resets on open, but this
  // list stays mounted across documents, so an identical first list for the
  // next one must not read as already sent.
  const sentPriority = useRef<{
    documentId: string | null;
    priority: number[];
  } | null>(null);

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
      if (Math.abs(offset - landedAt.current) < 1) {
        return;
      }
      landedAt.current = null;
    }

    const { pages, selectedPageId } = latest.current;
    const centre = offset + stage.clientHeight / 2;
    const page = pages[instance.getVirtualItemForOffset(centre)?.index ?? -1];
    if (page && page.id !== selectedPageId) {
      dispatch(pageSelected(page.id, { source: 'scroll' }));
    }
  }

  /** Sends analysis the mounted pages, the ones whose overlays are waiting. */
  function prioritiseMounted(instance: Virtualizer<HTMLDivElement, Element>) {
    const { pages, selectedIndex, pinnedIndex, analysisDone, documentId } =
      latest.current;
    if (analysisDone) {
      return;
    }

    const range = instance.range ?? {
      startIndex: Math.max(selectedIndex, 0),
      endIndex: Math.max(selectedIndex, 0),
    };
    const items = instance.getVirtualItems().map((item) => item.index);
    const priority = toSourceIndices(
      analysisPriority(range, items, pinnedIndex),
      pages,
    );

    const sent = sentPriority.current;
    if (
      sent?.documentId === documentId &&
      sameIndices(sent.priority, priority)
    ) {
      return;
    }
    sentPriority.current = { documentId, priority };
    dispatch(analysisPrioritised(priority));
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
      syncFrame.current ??= requestAnimationFrame(() => {
        selectPageInView(instance);
        prioritiseMounted(instance);
      });
    },
  });

  useEffect(() => {
    latest.current = {
      pages,
      selectedPageId,
      selectedIndex,
      pinnedIndex,
      analysisDone,
      documentId,
    };
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
