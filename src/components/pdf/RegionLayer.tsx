import { useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '#/hooks';
import { rectToScreen, toPdfPoint } from '#/lib/pdf/pageCoordinates';
import {
  clampRect,
  type Edge,
  isUsableRect,
  moveRegion,
  type Region,
  rectFromPoints,
  resizeRegion,
} from '#/lib/pdf/regions';
import {
  regionAdded,
  regionChanged,
  regionRemoved,
  regionSelected,
  selectSelectedRegionId,
} from '#/store/regions.slice';
import { selectRegions } from '#/store/selectors';
import { selectIsEditingRegions } from '#/store/tool.slice';

/**
 * Draws and edits the rectangles that extraction will cut.
 *
 * Detection seeds these, but nothing here assumes they came from staves — drag
 * on empty space to add one, drag an edge to adjust, drag the body to move. This
 * is what makes the tool usable on a score it misread, and on documents that
 * have no staves at all.
 *
 * A drag in progress is local: the rectangle under the pointer is this
 * component's business until the pointer comes up, and only the result is
 * dispatched. The store hears about a move once, not sixty times a second.
 */

const EDGES: Edge[] = ['top', 'bottom', 'left', 'right'];
const HANDLE = 9;

type Point = { x: number; y: number };

type Drag =
  | { kind: 'new'; start: Point; current: Point }
  | { kind: 'move'; origin: Region; start: Point; region: Region }
  | { kind: 'edge'; origin: Region; edge: Edge; region: Region };

type RegionLayerProps = {
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  scale: number;
};

export function RegionLayer({
  pageIndex,
  pageWidth,
  pageHeight,
  scale,
}: RegionLayerProps) {
  const dispatch = useAppDispatch();
  const regions = useAppSelector(selectRegions);
  const selectedId = useAppSelector(selectSelectedRegionId);
  /** The region tool is what makes this layer take clicks at all. */
  const interactive = useAppSelector(selectIsEditingRegions);

  const surface = useRef<HTMLDivElement>(null);
  /** The surface's screen box, pinned for the length of a gesture. */
  const surfaceBox = useRef<DOMRect | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const toPdf = (clientX: number, clientY: number) => {
    const box = surfaceBox.current ?? surface.current?.getBoundingClientRect();
    if (!box) return null;
    return toPdfPoint(clientX - box.left, clientY - box.top, pageHeight, scale);
  };

  /**
   * Opens a gesture: pins the surface's geometry, and routes the rest of the
   * pointer stream here wherever it goes.
   *
   * Measuring forces a synchronous layout, and what sits under this surface is a
   * PDF canvas plus pdf.js's text layer — one absolutely positioned span per
   * text run, thousands of them on an engraved page. Measuring per pointermove
   * reflows all of it every frame, which is what makes a drag crawl. The surface
   * cannot move while a gesture is in flight, so once at the start is enough.
   *
   * The capture is what keeps that gesture alive past the page edge: the
   * geometry clamps for exactly that case, so dragging a rectangle *to* the edge
   * is ordinary, and without capture the release out there is never heard.
   */
  function captureGesture(event: React.PointerEvent) {
    surfaceBox.current = surface.current?.getBoundingClientRect() ?? null;
    surface.current?.setPointerCapture(event.pointerId);
  }

  function endGesture() {
    surfaceBox.current = null;
    setDrag(null);
  }

  const pageRegions = regions.filter(
    (region) => region.pageIndex === pageIndex,
  );

  /** The live version of a region while it is being dragged. */
  function shown(region: Region): Region {
    return drag && drag.kind !== 'new' && drag.region.id === region.id
      ? drag.region
      : region;
  }

  function handleMove(event: React.PointerEvent) {
    if (!drag) return;
    const point = toPdf(event.clientX, event.clientY);
    if (!point) return;

    if (drag.kind === 'new') {
      setDrag({ ...drag, current: point });
      return;
    }
    if (drag.kind === 'move') {
      setDrag({
        ...drag,
        region: moveRegion(
          drag.origin,
          point.x - drag.start.x,
          point.y - drag.start.y,
          pageWidth,
          pageHeight,
        ),
      });
      return;
    }
    const value =
      drag.edge === 'top' || drag.edge === 'bottom' ? point.y : point.x;
    setDrag({
      ...drag,
      region: resizeRegion(
        drag.origin,
        drag.edge,
        value,
        pageWidth,
        pageHeight,
      ),
    });
  }

  function handleUp() {
    if (drag?.kind === 'new') {
      const rect = clampRect(
        rectFromPoints(drag.start, drag.current),
        pageWidth,
        pageHeight,
      );
      // A click without a drag should not leave an invisible sliver behind.
      if (isUsableRect(rect)) {
        dispatch(regionAdded({ visible: regions, pageIndex, rect }));
      }
    } else if (drag && drag.region !== drag.origin) {
      dispatch(regionChanged({ visible: regions, region: drag.region }));
    }
    endGesture();
  }

  const preview =
    drag?.kind === 'new'
      ? clampRect(
          rectFromPoints(drag.start, drag.current),
          pageWidth,
          pageHeight,
        )
      : null;

  return (
    <div
      ref={surface}
      className={`absolute inset-0 ${interactive ? '' : 'pointer-events-none'} ${
        interactive && !drag ? 'cursor-crosshair' : ''
      }`}
      onPointerDown={(event) => {
        if (!interactive || event.target !== event.currentTarget) return;
        captureGesture(event);
        const point = toPdf(event.clientX, event.clientY);
        if (!point) return;
        dispatch(regionSelected(null));
        setDrag({ kind: 'new', start: point, current: point });
      }}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={endGesture}
    >
      {pageRegions.map((stored) => {
        const region = shown(stored);
        const box = rectToScreen(region.rect, pageHeight, scale);
        const isSelected = region.id === selectedId;

        return (
          <div
            key={region.id}
            className={`absolute border-2 ${
              isSelected
                ? 'border-blue-600 bg-blue-500/10'
                : 'border-blue-400/70 bg-blue-400/5'
            }`}
            style={box}
          >
            <button
              type="button"
              aria-label={`Select region ${region.label}`}
              disabled={!interactive}
              onPointerDown={(event) => {
                if (!interactive) return;
                event.stopPropagation();
                captureGesture(event);
                const point = toPdf(event.clientX, event.clientY);
                if (!point) return;
                dispatch(regionSelected(region.id));
                setDrag({
                  kind: 'move',
                  origin: region,
                  start: point,
                  region,
                });
              }}
              className="absolute inset-0 size-full cursor-move disabled:cursor-default"
            />

            <span className="pointer-events-none absolute top-0.5 left-1 rounded bg-white/75 px-1 font-medium text-[10px] text-blue-800">
              {region.label}
            </span>

            {isSelected && interactive ? (
              <button
                type="button"
                aria-label={`Remove region ${region.label}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() =>
                  dispatch(regionRemoved({ visible: regions, id: region.id }))
                }
                className="-top-3 -right-3 absolute size-6 rounded-full border border-slate-300 bg-white text-slate-600 text-xs shadow hover:bg-red-50 hover:text-red-700"
              >
                ✕
              </button>
            ) : null}

            {interactive
              ? EDGES.map((edge) => (
                  <button
                    key={edge}
                    type="button"
                    aria-label={`Drag ${edge} edge of ${region.label}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      captureGesture(event);
                      dispatch(regionSelected(region.id));
                      setDrag({
                        kind: 'edge',
                        origin: region,
                        edge,
                        region,
                      });
                    }}
                    className={`absolute ${
                      edge === 'top' || edge === 'bottom'
                        ? 'left-0 h-2 w-full cursor-ns-resize'
                        : 'top-0 h-full w-2 cursor-ew-resize'
                    }`}
                    style={{
                      top: edge === 'top' ? -HANDLE / 2 : undefined,
                      bottom: edge === 'bottom' ? -HANDLE / 2 : undefined,
                      left: edge === 'left' ? -HANDLE / 2 : undefined,
                      right: edge === 'right' ? -HANDLE / 2 : undefined,
                    }}
                  />
                ))
              : null}
          </div>
        );
      })}

      {preview ? (
        <div
          aria-hidden
          className="pointer-events-none absolute border-2 border-blue-600 border-dashed bg-blue-500/10"
          style={rectToScreen(preview, pageHeight, scale)}
        />
      ) : null}
    </div>
  );
}
