import { FONT_SIZE_SELECT_CLASS } from '#/components/PDFEditor/FontSizeSelect/FontSizeSelect.styles';
import { fontSizeOptions } from '#/components/PDFEditor/FontSizeSelect/FontSizeSelect.utils';

type FontSizeSelectProps = {
  value: number | null;
  onChange: (size: number) => void;
  disabled?: boolean;
};

export function FontSizeSelect({
  value,
  onChange,
  disabled = false,
}: FontSizeSelectProps) {
  return (
    <select
      data-testid="FontSizeSelect"
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      className={FONT_SIZE_SELECT_CLASS}
    >
      <option value="" disabled hidden>
        Size
      </option>
      {fontSizeOptions(value).map((size) => (
        <option key={size} value={size}>
          {size}
        </option>
      ))}
    </select>
  );
}
