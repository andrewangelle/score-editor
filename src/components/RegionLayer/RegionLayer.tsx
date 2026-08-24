import { useRef, useState } from 'react';
import {
  getEdgeHandleStyles,
  getRegionStyles,
  getSurfaceStyles,
  MOVE_HANDLE_CLASS,
  PREVIEW_CLASS,
  REGION_LABEL_CLASS,
  REMOVE_BUTTON_CLASS,
} from '#/components/RegionLayer/RegionLayer.styles';
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
import { useAppDispatch, useAppSelector } from '#/store/hooks';
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
 * Draws and edits the rectangles for extraction.
 *
 * A drag in progress is local and only its result is dispatched,
 * so the store  hears about a move once.
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
  const interactive = useAppSelector(selectIsEditingRegions);
  const surface = useRef<HTMLDivElement>(null);
  const surfaceBox = useRef<DOMRect | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const toPdf = (clientX: number, clientY: number) => {
    const box = surfaceBox.current ?? surface.current?.getBoundingClientRect();
    if (!box) return null;
    return toPdfPoint(clientX - box.left, clientY - box.top, pageHeight, scale);
  };

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
      className={getSurfaceStyles(interactive, Boolean(drag))}
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
            className={getRegionStyles(isSelected)}
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
              className={MOVE_HANDLE_CLASS}
            />

            <span className={REGION_LABEL_CLASS}>{region.label}</span>

            {isSelected && interactive ? (
              <button
                type="button"
                aria-label={`Remove region ${region.label}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() =>
                  dispatch(regionRemoved({ visible: regions, id: region.id }))
                }
                className={REMOVE_BUTTON_CLASS}
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
                    className={getEdgeHandleStyles(edge)}
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
          className={PREVIEW_CLASS}
          style={rectToScreen(preview, pageHeight, scale)}
        />
      ) : null}
    </div>
  );
}
