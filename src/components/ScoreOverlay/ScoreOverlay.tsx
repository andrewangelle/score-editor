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
import {
  ANNOTATION_COLORS,
  type AnnotationKind,
  DEFAULT_COLOR,
  normalizeAnnotationText,
} from '#/lib/pdf/annotations';
import { toPdfPoint, toScreenPoint } from '#/lib/pdf/pageCoordinates';
import { type Part, staffBounds } from '#/lib/pdf/partExtraction';
import type { System } from '#/lib/pdf/staffDetection';
import {
  annotationMoved,
  annotationPlaced,
  annotationRemoved,
  annotationRetitled,
  selectAnnotations,
} from '#/store/annotations.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import {
  selectAnnotationColor,
  selectAnnotationValue,
  selectIsEditingRegions,
  selectPlacing,
} from '#/store/tool.slice';

/**
 * The interactive layer on top of a rendered page. It owns the single conversion
 * between PDF user space and CSS pixels; everything else in the score feature
 * works purely in PDF space.
 *
 * Typing and dragging stay local until they finish — the store hears the text on
 * blur and the position on pointer-up.
 */

type ScoreOverlayProps = {
  pageIndex: number;
  pageHeight: number;
  scale: number;
  systems: readonly System[];
  parts: readonly Part[];
};

type Drag = { id: string; x: number; y: number };

type Cursor = { clientX: number; clientY: number };

const PLACEHOLDER: Record<AnnotationKind, string> = {
  fingering: 'e.g. 1 3 2 4',
  string: 'String, e.g. 3',
  position: 'Position, e.g. V or 5',
  note: 'Performance note',
};

export function ScoreOverlay({
  pageIndex,
  pageHeight,
  scale,
  systems,
  parts,
}: ScoreOverlayProps) {
  const dispatch = useAppDispatch();
  const annotations = useAppSelector(selectAnnotations);
  const placing = useAppSelector(selectPlacing);
  const color = useAppSelector(selectAnnotationColor);
  const value = useAppSelector(selectAnnotationValue);
  const interactive = !useAppSelector(selectIsEditingRegions);
  const surface = useRef<HTMLDivElement>(null);
  const surfaceBox = useRef<DOMRect | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const carrying = placing && value ? { kind: placing, text: value } : null;

  const toPdf = (clientX: number, clientY: number) => {
    const box = surfaceBox.current ?? surface.current?.getBoundingClientRect();
    if (!box) return null;
    return toPdfPoint(clientX - box.left, clientY - box.top, pageHeight, scale);
  };

  const pageAnnotations = annotations.filter(
    (annotation) => annotation.pageIndex === pageIndex,
  );

  function commitDraft(id: string, kind: AnnotationKind) {
    // Leaving a note blank removes it. Judged after normalizing.
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
        if (drag) {
          const point = toPdf(event.clientX, event.clientY);
          if (point) setDrag({ id: drag.id, x: point.x, y: point.y });
          return;
        }
        if (carrying) {
          setCursor({ clientX: event.clientX, clientY: event.clientY });
        }
      }}
      onPointerLeave={() => setCursor(null)}
      onPointerUp={(event) => {
        // A note being dragged also releases here; that is not a placement.
        if (drag) {
          endDrag();
          return;
        }
        if (!placing || event.target !== event.currentTarget) return;
        const point = toPdf(event.clientX, event.clientY);
        if (!point) return;
        const placed = dispatch(
          annotationPlaced({
            pageIndex,
            x: point.x,
            y: point.y,
            kind: placing,
            color,
            text: carrying?.text,
          }),
        );
        // A value off the menu arrives finished, and the tool stays loaded with
        // it — the next click puts down another. Only a blank one opens an
        // editor, which needs the id just minted.
        if (carrying) return;
        setEditing(placed.payload.id);
        setDraft('');
      }}
      onPointerCancel={() => {
        surfaceBox.current = null;
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
              {part ? (
                <span className={STAFF_LABEL_CLASS}>{part.name}</span>
              ) : null}
            </div>
          );
        }),
      )}

      {pageAnnotations.map((annotation) => {
        const anchor = drag?.id === annotation.id ? drag : annotation;
        const screen = toScreenPoint(anchor, pageHeight, scale);
        const fontSize = Math.max(7, annotation.size * scale);
        const circled = annotation.kind === 'string';
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
                  setDrag({
                    id: annotation.id,
                    x: annotation.x,
                    y: annotation.y,
                  });
                }}
                onDoubleClick={() => {
                  setEditing(annotation.id);
                  setDraft(annotation.text);
                }}
                title="Double-click to edit, drag to move"
                className={getAnnotationStyles(circled)}
                style={
                  circled
                    ? {
                        fontSize,
                        color: ink,
                        borderColor: ink,
                        width: fontSize * 1.8,
                        height: fontSize * 1.8,
                      }
                    : { fontSize, color: ink }
                }
              >
                {annotation.text || '…'}
              </button>
            )}
          </div>
        );
      })}

      {carrying && cursor ? (
        <div
          aria-hidden
          className={getCursorMarkStyles(carrying.kind === 'string')}
          style={{
            left: cursor.clientX,
            top: cursor.clientY,
            ...cursorMarkInk(carrying.kind, color, scale),
          }}
        >
          {carrying.text}
        </div>
      ) : null}
    </div>
  );
}
