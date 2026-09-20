import { APPLY_FONT_SIZE } from '#/components/EditScorePanel/EditScorePanel.constants';
import { APPLY_FONT_SIZE_BUTTON_CLASS } from '#/components/EditScorePanel/EditScorePanel.styles';
import { FONT_SIZE_INPUT_CLASS } from '#/components/EditScorePanel/UpdateFontSize/UpdateFontSize.styles';
import {
  annotationResized,
  selectSelectedAnnotationId,
} from '#/store/annotations.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import {
  selectAnnotationFontSizeValue,
  selectSelectedAnnotationSize,
} from '#/store/selectors';
import {
  annotationFontSizePicked,
  selectAnnotationFontSize,
  selectPlacing,
} from '#/store/tool.slice';

export function UpdateFontSize() {
  const dispatch = useAppDispatch();
  const fontSize = useAppSelector(selectAnnotationFontSize);
  const selectedAnnotationId = useAppSelector(selectSelectedAnnotationId);
  const selectedAnnotationSize = useAppSelector(selectSelectedAnnotationSize);
  const placing = useAppSelector(selectPlacing);
  const displayValue = useAppSelector(selectAnnotationFontSizeValue);

  function updateFontSize() {
    if (selectedAnnotationId && fontSize !== null) {
      dispatch(annotationResized({ id: selectedAnnotationId, size: fontSize }));
    }
  }

  return (
    <div data-testid="UpdateFontSize" className="mt-3 flex items-center gap-2">
      <input
        type="number"
        data-testid="FontSizeInput"
        min={0.5}
        max={24}
        step={0.5}
        value={displayValue}
        disabled={placing === null && !selectedAnnotationId}
        onChange={(event) =>
          dispatch(annotationFontSizePicked(Number(event.target.value)))
        }
        className={FONT_SIZE_INPUT_CLASS}
      />

      <button
        type="button"
        data-testid="ApplyFontSize"
        className={APPLY_FONT_SIZE_BUTTON_CLASS}
        disabled={!selectedAnnotationId || fontSize === selectedAnnotationSize}
        onClick={updateFontSize}
      >
        {APPLY_FONT_SIZE}
      </button>
    </div>
  );
}
