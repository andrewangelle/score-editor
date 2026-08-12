import { useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '#/hooks';
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
import { selectIsEditingRegions, selectPlacing } from '#/store/tool.slice';

/**
 * The interactive layer sitting on top of a rendered page.
 *
 * It owns the single conversion between PDF user space (origin bottom-left, y
 * upward, points) and CSS pixels (origin top-left, y downward). Every other part
 * of the score feature works purely in PDF space, so this is the only place that
 * has to think about the flip.
 *
 * Typing and dragging are local until they are finished: the store hears the
 * text when the field is left and the position when the pointer comes up, so a
 * note being written is not a stream of dispatches.
 */

type ScoreOverlayProps = {
  pageIndex: number;
  /** Source page size in PDF points. */
  pageHeight: number;
  /** Rendered pixels per PDF point. */
  scale: number;
  systems: readonly System[];
  parts: readonly Part[];
};

type Drag = { id: string; x: number; y: number };

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
  /** Notes go read-only while the region tool has the page. */
  const interactive = !useAppSelector(selectIsEditingRegions);

  const surface = useRef<HTMLDivElement>(null);
  /**
   * The surface's screen box, pinned while a note is being dragged. Measuring it
   * reflows the page under it — canvas plus pdf.js's text layer — so doing it
   * per pointermove costs a full layout every frame. Nothing moves mid-drag.
   */
  const surfaceBox = useRef<DOMRect | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);

  const toPdf = (clientX: number, clientY: number) => {
    const box = surfaceBox.current ?? surface.current?.getBoundingClientRect();
    if (!box) return null;
    return toPdfPoint(clientX - box.left, clientY - box.top, pageHeight, scale);
  };

  const pageAnnotations = annotations.filter(
    (annotation) => annotation.pageIndex === pageIndex,
  );

  function commitDraft(id: string) {
    // A note nobody typed into is not a note; leaving it blank removes it.
    if (draft.trim()) {
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
      className={`absolute inset-0 ${interactive ? '' : 'pointer-events-none'} ${
        placing ? 'cursor-crosshair' : ''
      }`}
      // A bare div is the right element here: it is a coordinate surface, not a
      // control, and every actual affordance inside it is a real button.
      onPointerDown={(event) => {
        if (!placing || event.target !== event.currentTarget) return;
        const point = toPdf(event.clientX, event.clientY);
        if (!point) return;
        // A freshly placed note is useless empty, so it opens straight into its
        // editor — which needs the id the action just minted.
        const placed = dispatch(
          annotationPlaced({
            pageIndex,
            x: point.x,
            y: point.y,
            kind: placing,
          }),
        );
        setEditing(placed.payload.id);
        setDraft('');
      }}
      onPointerMove={(event) => {
        if (!drag) return;
        const point = toPdf(event.clientX, event.clientY);
        if (point) setDrag({ id: drag.id, x: point.x, y: point.y });
      }}
      onPointerUp={endDrag}
      onPointerCancel={() => {
        surfaceBox.current = null;
        setDrag(null);
      }}
    >
      {systems.map((system) =>
        system.staves.map((staff, ordinal) => {
          const bounds = staffBounds(system, ordinal);
          const part = parts[ordinal];

          return (
            // Position is the stable identity here: no two staves on a page
            // share a top edge, and it survives re-detection.
            <div
              key={`${staff.top}-${staff.left}`}
              aria-hidden
              // A quiet hint of what detection found. The extraction rectangles
              // themselves are drawn by RegionLayer on top of this.
              className="pointer-events-none absolute border-slate-400/40 border-l-2 bg-slate-900/4"
              style={{
                left: 0,
                top: (pageHeight - bounds.top) * scale,
                width: '100%',
                height: (bounds.top - bounds.bottom) * scale,
              }}
            >
              {part ? (
                <span className="absolute bottom-0.5 left-1 font-medium text-[10px] text-slate-500">
                  {part.name}
                </span>
              ) : null}
            </div>
          );
        }),
      )}

      {pageAnnotations.map((annotation) => {
        // While this note is being dragged its position is local, so the
        // rendered anchor follows the pointer rather than the store.
        const anchor = drag?.id === annotation.id ? drag : annotation;
        const screen = toScreenPoint(anchor, pageHeight, scale);

        return (
          <div
            key={annotation.id}
            className="absolute"
            style={{
              left: screen.x,
              top: screen.y,
              // The anchor is the text baseline, so the box hangs above it.
              transform: 'translateY(-100%)',
            }}
          >
            {editing === annotation.id ? (
              <input
                // biome-ignore lint/a11y/noAutofocus: a freshly placed note is useless without focus
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => commitDraft(annotation.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === 'Escape') {
                    event.currentTarget.blur();
                  }
                }}
                className="w-32 rounded border border-blue-400 bg-white px-1 py-0.5 text-xs shadow"
                placeholder={
                  annotation.kind === 'fingering'
                    ? 'e.g. 1 3 2 4'
                    : 'Performance note'
                }
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
                className="cursor-move whitespace-nowrap rounded bg-white/80 px-1 font-medium text-blue-700 leading-none hover:bg-blue-50"
                style={{ fontSize: Math.max(9, annotation.size * scale) }}
              >
                {annotation.text || '…'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
