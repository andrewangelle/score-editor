import { useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '#/hooks';
import {
  type AnnotationKind,
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
import { selectIsEditingRegions, selectPlacing } from '#/store/tool.slice';

/**
 * The interactive layer on top of a rendered page. It owns the single conversion
 * between PDF user space and CSS pixels; everything else in the score feature
 * works purely in PDF space, so this is the only place that handles the flip.
 *
 * Typing and dragging stay local until they finish — the store hears the text on
 * blur and the position on pointer-up — so writing a note is not a stream of
 * dispatches.
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
  /** Notes go read-only while the region tool has the page. */
  const interactive = !useAppSelector(selectIsEditingRegions);

  const surface = useRef<HTMLDivElement>(null);
  /**
   * The surface's screen box, pinned while a note is dragged. Measuring reflows
   * the page under it, so doing it per pointermove costs a layout every frame —
   * and nothing moves mid-drag.
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

  function commitDraft(id: string, kind: AnnotationKind) {
    // Leaving a note blank removes it. Judged after normalizing, so a string
    // number typed as letters — which has no engravable form — counts as blank
    // rather than becoming an empty circle.
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
      className={`absolute inset-0 ${interactive ? '' : 'pointer-events-none'} ${
        placing ? 'cursor-crosshair' : ''
      }`}
      // A bare div is right here: a coordinate surface, not a control, and every
      // actual affordance inside it is a real button.
      onPointerMove={(event) => {
        if (!drag) return;
        const point = toPdf(event.clientX, event.clientY);
        if (point) setDrag({ id: drag.id, x: point.x, y: point.y });
      }}
      // Placement waits for the release, and that is load-bearing. This surface
      // is not focusable, so the browser's handling of the *press* moves focus
      // to the body, blurring the editor opened here the moment it mounts — and
      // a blank note that loses focus deletes itself. By pointer-up that focus
      // move has already happened and nothing afterwards takes focus back.
      onPointerUp={(event) => {
        // A note being dragged also releases here; that is not a placement.
        if (drag) {
          endDrag();
          return;
        }
        if (!placing || event.target !== event.currentTarget) return;
        const point = toPdf(event.clientX, event.clientY);
        if (!point) return;
        // Opens straight into its editor, which needs the id just minted.
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
      onPointerCancel={() => {
        surfaceBox.current = null;
        setDrag(null);
      }}
    >
      {systems.map((system) =>
        system.staves.map((staff, ordinal) => {
          // The page's systems, so the hint agrees with the region drawn over
          // it: both stop halfway between one system and the next.
          const bounds = staffBounds(system, ordinal, systems);
          const part = parts[ordinal];

          return (
            // Position is the stable identity: no two staves on a page share a
            // top edge, and it survives re-detection.
            <div
              key={`${staff.top}-${staff.left}`}
              aria-hidden
              // A quiet hint of what detection found; RegionLayer draws the
              // extraction rectangles themselves on top of this.
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
        const anchor = drag?.id === annotation.id ? drag : annotation;
        const screen = toScreenPoint(anchor, pageHeight, scale);
        const fontSize = Math.max(7, annotation.size * scale);
        const circled = annotation.kind === 'string';

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
                onBlur={() => commitDraft(annotation.id, annotation.kind)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === 'Escape') {
                    event.currentTarget.blur();
                  }
                }}
                className="w-32 rounded border border-blue-400 bg-white px-1 py-0.5 text-xs shadow"
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
                // Circled here as it will be when baked, so the page on screen
                // reads as the page that comes out.
                className={`cursor-move whitespace-nowrap bg-white/80 font-medium text-blue-700 leading-none hover:bg-blue-50 ${
                  circled
                    ? 'flex items-center justify-center rounded-full border border-blue-700'
                    : 'rounded px-1'
                }`}
                style={
                  circled
                    ? {
                        fontSize,
                        // Round enough to hold two digits without turning into
                        // an oval on one.
                        width: fontSize * 1.8,
                        height: fontSize * 1.8,
                      }
                    : { fontSize }
                }
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
