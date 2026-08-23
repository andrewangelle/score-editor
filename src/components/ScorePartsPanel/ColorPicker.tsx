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
    <fieldset className="mt-3 flex items-center gap-2">
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
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={`block size-5 rounded-full transition-shadow peer-focus-visible:ring-2 peer-focus-visible:ring-slate-900 peer-focus-visible:ring-offset-2 ${
                selected
                  ? 'ring-2 ring-slate-900 ring-offset-2'
                  : 'ring-1 ring-slate-300 hover:ring-slate-400'
              }`}
              style={{ backgroundColor: css }}
            />
            <span className="sr-only">{label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
