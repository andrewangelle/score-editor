import { type PointerEvent, useRef, useState } from 'react';
import { Annotations } from '#/components/ScoreOverlay/Annotations';
import { getSurfaceStyles } from '#/components/ScoreOverlay/ScoreOverlay.styles';
import { StaffHints } from '#/components/ScoreOverlay/StaffHints';
import { useScorePointerRef } from '#/hooks/useScorePointer';
import { DEFAULT_SIZE } from '#/lib/pdf/annotations/annotations';
import { toPdfPoint } from '#/lib/pdf/pageCoordinates';
import {
  annotationMoved,
  annotationPlaced,
  annotationSelected,
  selectAnnotations,
  selectSelectedAnnotationId,
} from '#/store/annotations.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { selectAnnotationCarrying, selectOverlay } from '#/store/selectors';
import {
  selectAnnotationColor,
  selectAnnotationFontSize,
  selectIsEditingRegions,
  selectPlacing,
} from '#/store/tool.slice';
import { AnnotationCursorPreview } from './AnnotationCursorPreview';

export type Drag = { id: string; x: number; y: number };

export type Cursor = { clientX: number; clientY: number };

const DRAG_THRESHOLD = 3;

export type DragDimensions = {
  id: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
};

type ScoreOverlayProps = {
  pageWidth: number;
};

export function ScoreOverlay({ pageWidth }: ScoreOverlayProps) {
  const dispatch = useAppDispatch();
  const annotations = useAppSelector(selectAnnotations);
  const placing = useAppSelector(selectPlacing);
  const color = useAppSelector(selectAnnotationColor);
  const fontSize = useAppSelector(selectAnnotationFontSize);
  const selectedId = useAppSelector(selectSelectedAnnotationId);
  const interactive = !useAppSelector(selectIsEditingRegions);
  const surface = useRef<HTMLDivElement>(null);
  const surfaceBox = useRef<DOMRect | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const pendingDrag = useRef<DragDimensions | null>(null);
  const pointerRef = useScorePointerRef();
  const overlay = useAppSelector((state) => selectOverlay(state, pageWidth));
  const carrying = useAppSelector(selectAnnotationCarrying);

  function toPdf(clientX: number, clientY: number) {
    const box = surfaceBox.current ?? surface.current?.getBoundingClientRect();
    if (!box || !overlay) return null;
    return toPdfPoint(
      clientX - box.left,
      clientY - box.top,
      overlay.pageHeight,
      overlay.scale,
    );
  }

  function dragAnnotation(event: PointerEvent<HTMLDivElement>) {
    // Update shared pointer tracking for paste position
    const point = toPdf(event.clientX, event.clientY);
    if (point && overlay) {
      pointerRef.current = {
        pageIndex: overlay.pageIndex,
        x: point.x,
        y: point.y,
      };
    }

    // Promote pending drag if threshold exceeded
    if (pendingDrag.current && !drag) {
      const dx = event.clientX - pendingDrag.current.startX;
      const dy = event.clientY - pendingDrag.current.startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        setDrag({
          id: pendingDrag.current.id,
          x: pendingDrag.current.x,
          y: pendingDrag.current.y,
        });
        pendingDrag.current = null;
      }
      return;
    }

    if (drag) {
      if (point) setDrag({ id: drag.id, x: point.x, y: point.y });
      return;
    }

    if (carrying) {
      setCursor({ clientX: event.clientX, clientY: event.clientY });
    }
  }

  function placeAnnotation(event: PointerEvent<HTMLElement>) {
    // A pending drag that never exceeded the threshold is a tap → select.
    if (pendingDrag.current) {
      const tappedId = pendingDrag.current.id;
      pendingDrag.current = null;
      // A tap never promotes to a drag, so endDrag() never runs to clear this
      // If left stale, it would poison every later toPdf() call with
      // the bounding rect captured at tap time.
      surfaceBox.current = null;
      dispatch(annotationSelected(selectedId === tappedId ? null : tappedId));
      return;
    }

    if (drag) {
      endDrag();
      return;
    }
    if (event.target !== event.currentTarget) return;

    if (!placing) {
      // A tap on bare page surface, with no tool active, clears selection.
      if (selectedId) dispatch(annotationSelected(null));
      return;
    }

    const point = toPdf(event.clientX, event.clientY);

    if (!point || !overlay) {
      return;
    }

    // Deselect when placing new annotations
    if (selectedId) {
      dispatch(annotationSelected(null));
    }

    const placed = dispatch(
      annotationPlaced({
        pageIndex: overlay.pageIndex,
        x: point.x,
        y: point.y,
        kind: placing,
        color,
        text: carrying?.text,
        size: fontSize ?? DEFAULT_SIZE[placing],
      }),
    );

    if (carrying) {
      return;
    }

    setEditing(placed.payload.id);
    setDraft('');
  }

  function startAnnotationPointer(annotation: Drag) {
    return (event: PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      surfaceBox.current = surface.current?.getBoundingClientRect() ?? null;
      pendingDrag.current = {
        id: annotation.id,
        startX: event.clientX,
        startY: event.clientY,
        x: annotation.x,
        y: annotation.y,
      };
    };
  }

  function endDrag() {
    surfaceBox.current = null;

    if (!drag) {
      return;
    }

    const original = annotations.find(
      (annotation) => annotation.id === drag.id,
    );

    if (original && (original.x !== drag.x || original.y !== drag.y)) {
      dispatch(annotationMoved(drag));
    }

    setDrag(null);
  }

  function clearPointer(_: PointerEvent<HTMLDivElement>) {
    pointerRef.current = null;
    setCursor(null);
  }

  function cancelPointerEvent(_: PointerEvent<HTMLDivElement>) {
    surfaceBox.current = null;
    pendingDrag.current = null;
    setDrag(null);
    setCursor(null);
  }

  if (!overlay) {
    return null;
  }

  return (
    <div
      data-testid="ScoreOverlay"
      ref={surface}
      className={getSurfaceStyles(interactive, Boolean(placing))}
      onPointerMove={dragAnnotation}
      onPointerLeave={clearPointer}
      onPointerUp={placeAnnotation}
      onPointerCancel={cancelPointerEvent}
    >
      <StaffHints pageWidth={pageWidth} />

      <Annotations
        pageWidth={pageWidth}
        drag={drag}
        draft={draft}
        setDraft={setDraft}
        editing={editing}
        setEditing={setEditing}
        onAnnotationPointerDown={startAnnotationPointer}
      />

      <AnnotationCursorPreview cursor={cursor} pageWidth={pageWidth} />
    </div>
  );
}
