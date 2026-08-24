import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  initialPagingState,
  type PagingState,
  stepPaging,
  type TurnDirection,
  unlock,
  wheelPixels,
} from '#/lib/edgeScrollPaging';

type EdgeScrollPagingOptions = {
  container: HTMLElement | null;
  pageKey: string | null;
  onTurn: (direction: TurnDirection) => boolean;
};

function alignTo(container: HTMLElement, edge: 'top' | 'bottom') {
  container.scrollTop =
    edge === 'top' ? 0 : container.scrollHeight - container.clientHeight;
}

export function useEdgeScrollPaging({
  container,
  pageKey,
  onTurn,
}: EdgeScrollPagingOptions) {
  const paging = useRef<PagingState>(initialPagingState);
  const arrivingAt = useRef<'top' | 'bottom' | null>(null);

  useEffect(() => {
    if (!container) return;

    function handleWheel(event: WheelEvent) {
      if (!container) return;

      const step = stepPaging(paging.current, {
        deltaY: wheelPixels(
          event.deltaY,
          event.deltaMode,
          container.clientHeight,
        ),
        at: event.timeStamp,
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
      });
      paging.current = step.state;

      if (step.rearmed) arrivingAt.current = null;
      if (!step.turn) return;

      if (!onTurn(step.turn)) {
        paging.current = unlock(step.state);
        return;
      }

      event.preventDefault();
      arrivingAt.current = step.turn === 1 ? 'top' : 'bottom';
      alignTo(container, arrivingAt.current);
    }

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [container, onTurn]);

  useLayoutEffect(() => {
    const edge = arrivingAt.current;
    if (!container || !pageKey || !edge) return;

    alignTo(container, edge);
    if (edge === 'top') return;

    const observer = new ResizeObserver(() => {
      if (arrivingAt.current === 'bottom') alignTo(container, 'bottom');
    });
    for (const child of container.children) observer.observe(child);

    return () => observer.disconnect();
  }, [container, pageKey]);
}
