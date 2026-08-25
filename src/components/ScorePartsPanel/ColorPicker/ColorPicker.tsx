import {
  COLOR_PICKER_FIELDSET_CLASS,
  getSwatchStyles,
} from '#/components/ScorePartsPanel/ColorPicker/ColorPicker.styles';
import {
  ANNOTATION_COLOR_ORDER,
  ANNOTATION_COLORS,
  type AnnotationColor,
} from '#/lib/pdf/annotations';

type ColorPickerProps = {
  value: AnnotationColor;
  onPick: (color: AnnotationColor) => void;
};

export function ColorPicker({ value, onPick }: ColorPickerProps) {
  return (
    <fieldset className={COLOR_PICKER_FIELDSET_CLASS}>
      <legend className="sr-only">Note colour</legend>

      {ANNOTATION_COLOR_ORDER.map((color) => {
        const { label, css } = ANNOTATION_COLORS[color];
        const selected = color === value;

        return (
          <label key={color} title={label} className="cursor-pointer">
            <input
              type="radio"
              name="annotation-color"
              value={color}
              checked={selected}
              onChange={() => onPick(color)}
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
  );
}
