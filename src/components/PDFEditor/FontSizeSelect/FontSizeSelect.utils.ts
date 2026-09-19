// Not `as const`: that would narrow this to a literal tuple and break the
// `includes` check below against a plain `number` (DEFAULT_SIZE and PDF-read
// values are not restricted to this list).
export const FONT_SIZES: readonly number[] = [
  5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13,
  13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5, 20, 20.5,
  21, 21.5, 22, 22.5, 23, 23.5, 24,
];

/** Adds `value` as an extra option when it falls outside the fixed list, so the select never renders blank. */
export function fontSizeOptions(value: number | null): readonly number[] {
  return value !== null && !FONT_SIZES.includes(value)
    ? [...FONT_SIZES, value].sort((a, b) => a - b)
    : FONT_SIZES;
}
