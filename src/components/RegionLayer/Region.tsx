import type { PointerEvent } from 'react';
import { usePageContext } from '#/components/PDFViewer/PageContext';
import type { RegionGesture } from '#/components/RegionLayer/RegionLayer';
import { EDGES, HANDLE } from '#/components/RegionLayer/RegionLayer.constants';
import {
  getEdgeHandleStyles,
  getRegionStyles,
  MOVE_HANDLE_CLASS,
  REGION_LABEL_CLASS,
  REMOVE_BUTTON_CLASS,
} from '#/components/RegionLayer/RegionLayer.styles';
import { rectToScreen } from '#/lib/pdf/pageCoordinates';
import type { Region as RegionData } from '#/lib/pdf/regions';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import {
  regionRemoved,
  regionSelected,
  selectSelectedRegionId,
} from '#/store/regions.slice';
import { selectOverlay, selectRegions } from '#/store/selectors';
import { selectIsEditingRegions } from '#/store/tool.slice';

type RegionProps = {
  region: RegionData;
  onDragStart: (
    event: PointerEvent<HTMLButtonElement>,
    region: RegionData,
    gesture: RegionGesture,
  ) => void;
};

export function Region({ region, onDragStart }: RegionProps) {
  const dispatch = useAppDispatch();
  const { sourceIndex, pageWidth } = usePageContext();
  const overlay = useAppSelector((state) =>
    selectOverlay(state, sourceIndex, pageWidth),
  );
  const regions = useAppSelector(selectRegions);
  const selectedId = useAppSelector(selectSelectedRegionId);
  const interactive = useAppSelector(selectIsEditingRegions);

  if (!overlay) {
    return null;
  }

  const box = rectToScreen(region.rect, overlay.pageHeight, overlay.scale);
  const isSelected = region.id === selectedId;

  function startDrag(
    event: PointerEvent<HTMLButtonElement>,
    gesture: RegionGesture,
  ) {
    if (!interactive) {
      return;
    }
    event.stopPropagation();
    dispatch(regionSelected(region.id));
    onDragStart(event, region, gesture);
  }

  return (
    <div
      data-testid="Region"
      className={getRegionStyles(isSelected)}
      style={box}
    >
      <button
        type="button"
        aria-label={`Select region ${region.label}`}
        disabled={!interactive}
        onPointerDown={(event) => startDrag(event, { kind: 'move' })}
        className={MOVE_HANDLE_CLASS}
      />

      <span className={REGION_LABEL_CLASS}>{region.label}</span>

      {isSelected && interactive && (
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
      )}

      {interactive &&
        EDGES.map((edge) => (
          <button
            key={edge}
            type="button"
            aria-label={`Drag ${edge} edge of ${region.label}`}
            onPointerDown={(event) => startDrag(event, { kind: 'edge', edge })}
            className={getEdgeHandleStyles(edge)}
            style={{
              top: edge === 'top' ? -HANDLE / 2 : undefined,
              bottom: edge === 'bottom' ? -HANDLE / 2 : undefined,
              left: edge === 'left' ? -HANDLE / 2 : undefined,
              right: edge === 'right' ? -HANDLE / 2 : undefined,
            }}
          />
        ))}
    </div>
  );
}
