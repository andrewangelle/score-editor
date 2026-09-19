import { useRef, useState } from 'react';
import {
  ANNOTATION_ANCHOR_CLASS,
  cursorMarkInk,
  DRAFT_INPUT_CLASS,
  getAnnotationStyles,
  getCursorMarkStyles,
  getSurfaceStyles,
  STAFF_HINT_CLASS,
  STAFF_LABEL_CLASS,
} from '#/components/ScoreOverlay/ScoreOverlay.styles';
import type { ScorePointerRef } from '#/hooks/useScorePointer';
import {
  ANNOTATION_COLORS,
  type AnnotationKind,
  DEFAULT_COLOR,
  DEFAULT_SIZE,
  normalizeAnnotationText,
} from '#/lib/pdf/annotations/annotations';
import { toPdfPoint, toScreenPoint } from '#/lib/pdf/pageCoordinates';
import { type Part, staffBounds } from '#/lib/pdf/partExtraction';
import type { System } from '#/lib/pdf/staffDetection';
import {
  annotationMoved,
  annotationPlaced,
  annotationRemoved,
  annotationRetitled,
  annotationSelected,
  selectAnnotations,
  selectSelectedAnnotationId,
} from '#/store/annotations.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import {
  selectAnnotationColor,
  selectAnnotationFontSize,
  selectAnnotationValue,
  selectIsEditingRegions,
  selectPlacing,
} from '#/store/tool.slice';

type ScoreOverlayProps = {
  pageIndex: number;
  pageHeight: number;
  scale: number;
  systems: readonly System[];
  parts: readonly Part[];
  pointerRef: ScorePointerRef;
};

type Drag = { id: string; x: number; y: number };

type Cursor = { clientX: number; clientY: number };

const PLACEHOLDER: Record<AnnotationKind, string> = {
  fingering: 'e.g. 1 3 2 4',
  string: 'String, e.g. 3',
  position: 'Position, e.g. V or 5',
  note: 'Performance note',
};

const DRAG_THRESHOLD = 3;

export function ScoreOverlay({
  pageIndex,
  pageHeight,
  scale,
  systems,
  parts,
  pointerRef,
}: ScoreOverlayProps) {
  const dispatch = useAppDispatch();
  const annotations = useAppSelector(selectAnnotations);
  const placing = useAppSelector(selectPlacing);
  const color = useAppSelector(selectAnnotationColor);
  const value = useAppSelector(selectAnnotationValue);
  const fontSize = useAppSelector(selectAnnotationFontSize);
  const selectedId = useAppSelector(selectSelectedAnnotationId);
  const interactive = !useAppSelector(selectIsEditingRegions);
  const surface = useRef<HTMLDivElement>(null);
  const surfaceBox = useRef<DOMRect | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const pendingDrag = useRef<{
    id: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);

  const carrying = placing && value ? { kind: placing, text: value } : null;

  const pageAnnotations = annotations.filter(
    (annotation) => annotation.pageIndex === pageIndex,
  );

  function toPdf(clientX: number, clientY: number) {
    const box = surfaceBox.current ?? surface.current?.getBoundingClientRect();
    if (!box) return null;
    return toPdfPoint(clientX - box.left, clientY - box.top, pageHeight, scale);
  }

  function commitDraft(id: string, kind: AnnotationKind) {
    if (normalizeAnnotationText(kind, draft)) {
      dispatch(annotationRetitled({ id, text: draft }));
    } else {
      dispatch(annotationRemoved(id));
    }
    setEditing(null);
  }

  function endDrag() {
    surfaceBox.current = null;
    if (!drag) return;
    const original = annotations.find(
      (annotation) => annotation.id === drag.id,
    );
    if (original && (original.x !== drag.x || original.y !== drag.y)) {
      dispatch(annotationMoved(drag));
    }
    setDrag(null);
  }

  return (
    <div
      ref={surface}
      className={getSurfaceStyles(interactive, Boolean(placing))}
      onPointerMove={(event) => {
        // Update shared pointer tracking for paste position
        const point = toPdf(event.clientX, event.clientY);
        if (point) {
          pointerRef.current = { pageIndex, x: point.x, y: point.y };
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
      }}
      onPointerLeave={() => {
        pointerRef.current = null;
        setCursor(null);
      }}
      onPointerUp={(event) => {
        // A pending drag that never exceeded the threshold is a tap → select.
        if (pendingDrag.current) {
          const tappedId = pendingDrag.current.id;
          pendingDrag.current = null;
          // A tap never promotes to a drag, so endDrag() never runs to clear
          // this — left stale, it would poison every later toPdf() call with
          // the bounding rect captured at tap time.
          surfaceBox.current = null;
          dispatch(
            annotationSelected(selectedId === tappedId ? null : tappedId),
          );
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
        if (!point) return;

        // Deselect when placing new annotations
        if (selectedId) dispatch(annotationSelected(null));

        const placed = dispatch(
          annotationPlaced({
            pageIndex,
            x: point.x,
            y: point.y,
            kind: placing,
            color,
            text: carrying?.text,
            size: fontSize ?? DEFAULT_SIZE[placing],
          }),
        );
        if (carrying) return;
        setEditing(placed.payload.id);
        setDraft('');
      }}
      onPointerCancel={() => {
        surfaceBox.current = null;
        pendingDrag.current = null;
        setDrag(null);
        setCursor(null);
      }}
    >
      {systems.map((system) =>
        system.staves.map((staff, ordinal) => {
          const bounds = staffBounds(system, ordinal, systems);
          const part = parts[ordinal];

          return (
            <div
              key={`${staff.top}-${staff.left}`}
              aria-hidden
              className={STAFF_HINT_CLASS}
              style={{
                left: 0,
                top: (pageHeight - bounds.top) * scale,
                width: '100%',
                height: (bounds.top - bounds.bottom) * scale,
              }}
            >
              {part && <span className={STAFF_LABEL_CLASS}>{part.name}</span>}
            </div>
          );
        }),
      )}

      {pageAnnotations.map((annotation) => {
        const anchor = drag?.id === annotation.id ? drag : annotation;
        const screen = toScreenPoint(anchor, pageHeight, scale);
        const markFontSize = Math.max(3, annotation.size * scale);
        const circled = annotation.kind === 'string';
        const isSelected = annotation.id === selectedId;
        const ink = (
          ANNOTATION_COLORS[annotation.color] ??
          ANNOTATION_COLORS[DEFAULT_COLOR]
        ).css;

        return (
          <div
            key={annotation.id}
            className={ANNOTATION_ANCHOR_CLASS}
            style={{ left: screen.x, top: screen.y }}
          >
            {editing === annotation.id ? (
              <input
                // biome-ignore lint/a11y/noAutofocus: a freshly placed note is useless without focus
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => commitDraft(annotation.id, annotation.kind)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === 'Escape') {
                    event.currentTarget.blur();
                  }
                }}
                className={DRAFT_INPUT_CLASS}
                placeholder={PLACEHOLDER[annotation.kind]}
              />
            ) : (
              <button
                type="button"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  surfaceBox.current =
                    surface.current?.getBoundingClientRect() ?? null;
                  pendingDrag.current = {
                    id: annotation.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    x: annotation.x,
                    y: annotation.y,
                  };
                }}
                onDoubleClick={() => {
                  setEditing(annotation.id);
                  setDraft(annotation.text);
                }}
                title={
                  isSelected
                    ? 'Cmd/Ctrl+C to copy · Double-click to edit'
                    : 'Tap to select · Double-click to edit · Drag to move'
                }
                className={getAnnotationStyles(circled, isSelected)}
                style={
                  circled
                    ? {
                        fontSize: markFontSize,
                        color: ink,
                        borderColor: ink,
                        width: markFontSize * 1.8,
                        height: markFontSize * 1.8,
                      }
                    : { fontSize: markFontSize, color: ink }
                }
              >
                {annotation.text || '…'}
              </button>
            )}
          </div>
        );
      })}

      {carrying && cursor && (
        <div
          aria-hidden
          className={getCursorMarkStyles(carrying.kind === 'string')}
          style={{
            left: cursor.clientX,
            top: cursor.clientY,
            ...cursorMarkInk(
              carrying.kind,
              color,
              scale,
              fontSize ?? DEFAULT_SIZE[carrying.kind],
            ),
          }}
        >
          {carrying.text}
        </div>
      )}
    </div>
  );
}
