import { type PointerEvent, useRef, useState } from 'react';
import { Region } from '#/components/RegionLayer/Region';
import {
  getSurfaceStyles,
  PREVIEW_CLASS,
} from '#/components/RegionLayer/RegionLayer.styles';
import { rectToScreen, toPdfPoint } from '#/lib/pdf/pageCoordinates';
import {
  clampRect,
  type Edge,
  isUsableRect,
  moveRegion,
  type Region as RegionData,
  rectFromPoints,
  resizeRegion,
} from '#/lib/pdf/regions';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import {
  regionAdded,
  regionChanged,
  regionSelected,
} from '#/store/regions.slice';
import { selectOverlay, selectRegions } from '#/store/selectors';
import { selectIsEditingRegions } from '#/store/tool.slice';

type Point = { x: number; y: number };

type Drag =
  | { kind: 'new'; start: Point; current: Point }
  | { kind: 'move'; origin: RegionData; start: Point; region: RegionData }
  | { kind: 'edge'; origin: RegionData; edge: Edge; region: RegionData };

export type RegionGesture = { kind: 'move' } | { kind: 'edge'; edge: Edge };

type RegionLayerProps = {
  renderedWidth: number;
};

export function RegionLayer({ renderedWidth }: RegionLayerProps) {
  const dispatch = useAppDispatch();
  const overlay = useAppSelector((state) =>
    selectOverlay(state, renderedWidth),
  );
  const regions = useAppSelector(selectRegions);
  const interactive = useAppSelector(selectIsEditingRegions);
  const surface = useRef<HTMLDivElement>(null);
  const surfaceBox = useRef<DOMRect | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  if (!overlay) {
    return null;
  }

  const { pageIndex, pageWidth, pageHeight, scale } = overlay;

  const pageRegions = regions.filter(
    (region) => region.pageIndex === pageIndex,
  );

  const preview =
    drag?.kind === 'new'
      ? clampRect(
          rectFromPoints(drag.start, drag.current),
          pageWidth,
          pageHeight,
        )
      : null;

  function toPdf(clientX: number, clientY: number) {
    const box = surfaceBox.current ?? surface.current?.getBoundingClientRect();

    if (!box || !overlay) {
      return null;
    }

    return toPdfPoint(
      clientX - box.left,
      clientY - box.top,
      overlay.pageHeight,
      overlay.scale,
    );
  }

  function captureGesture(event: React.PointerEvent) {
    surfaceBox.current = surface.current?.getBoundingClientRect() ?? null;
    surface.current?.setPointerCapture(event.pointerId);
  }

  function clearDrag() {
    surfaceBox.current = null;
    setDrag(null);
  }

  function getRegion(region: RegionData): RegionData {
    return drag && drag.kind !== 'new' && drag.region.id === region.id
      ? drag.region
      : region;
  }

  function dragRegion(event: React.PointerEvent) {
    if (!drag) {
      return;
    }

    const point = toPdf(event.clientX, event.clientY);

    if (!point) {
      return;
    }

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

  function updateRegionChange() {
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
    clearDrag();
  }

  function startRegionDrag(
    event: PointerEvent<HTMLButtonElement>,
    region: RegionData,
    gesture: RegionGesture,
  ) {
    captureGesture(event);

    if (gesture.kind === 'edge') {
      setDrag({ kind: 'edge', origin: region, edge: gesture.edge, region });
      return;
    }

    const point = toPdf(event.clientX, event.clientY);

    if (!point) {
      return;
    }

    setDrag({ kind: 'move', origin: region, start: point, region });
  }

  function captureSelectedRegion(event: PointerEvent<HTMLDivElement>) {
    if (!interactive || event.target !== event.currentTarget) {
      return;
    }

    captureGesture(event);

    const point = toPdf(event.clientX, event.clientY);

    if (!point) {
      return;
    }

    dispatch(regionSelected(null));
    setDrag({ kind: 'new', start: point, current: point });
  }

  return (
    <div
      data-testid="RegionLayer"
      ref={surface}
      className={getSurfaceStyles(interactive, Boolean(drag))}
      onPointerDown={captureSelectedRegion}
      onPointerMove={dragRegion}
      onPointerUp={updateRegionChange}
      onPointerCancel={clearDrag}
    >
      {pageRegions.map((stored) => (
        <Region
          key={stored.id}
          region={getRegion(stored)}
          renderedWidth={renderedWidth}
          onDragStart={startRegionDrag}
        />
      ))}

      {preview && (
        <div
          data-testid="RegionPreview"
          aria-hidden
          className={PREVIEW_CLASS}
          style={rectToScreen(preview, pageHeight, scale)}
        />
      )}
    </div>
  );
}
