import {
  COLOR_PICKER_FIELDSET_CLASS,
  getSwatchStyles,
} from '#/components/EditScorePanel/ColorPicker/ColorPicker.styles';
import { SELECT_COLOR } from '#/components/EditScorePanel/EditScorePanel.constants';
import { SUBSECTION_CLASS } from '#/components/EditScorePanel/EditScorePanel.styles';
import {
  ANNOTATION_COLOR_ORDER,
  ANNOTATION_COLORS,
  type AnnotationColor,
} from '#/lib/pdf/annotations/annotations';
import {
  annotationRecolored,
  selectSelectedAnnotationId,
} from '#/store/annotations.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { selectSelectedAnnotationColor } from '#/store/selectors';
import {
  annotationColorPicked,
  selectAnnotationColor,
} from '#/store/tool.slice';

export function ColorPicker() {
  const dispatch = useAppDispatch();
  const toolColor = useAppSelector(selectAnnotationColor);
  const selectedAnnotationId = useAppSelector(selectSelectedAnnotationId);
  const selectedAnnotationColor = useAppSelector(selectSelectedAnnotationColor);
  const annotationColor = selectedAnnotationColor ?? toolColor;

  function pickColor(color: AnnotationColor) {
    dispatch(annotationColorPicked(color));
    if (selectedAnnotationId) {
      dispatch(annotationRecolored({ id: selectedAnnotationId, color }));
    }
  }

  return (
    <div data-testid="ColorPicker">
      <p className={SUBSECTION_CLASS}>{SELECT_COLOR}</p>

      <fieldset className={COLOR_PICKER_FIELDSET_CLASS}>
        <legend className="sr-only">Note color</legend>

        {ANNOTATION_COLOR_ORDER.map((color) => {
          const { label, css } = ANNOTATION_COLORS[color];
          const selected = color === annotationColor;

          return (
            <label key={color} title={label} className="cursor-pointer">
              <input
                type="radio"
                name="annotation-color"
                value={color}
                checked={selected}
                onChange={() => pickColor(color)}
                className="peer sr-only cursor-pointer"
              />
              <span
                aria-hidden
                className={getSwatchStyles(selected)}
                style={{ backgroundColor: css }}
              />
              <span className="sr-only">{label}</span>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
