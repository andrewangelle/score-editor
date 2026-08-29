/**
 * Everything the performer writes on the score: fingerings, string numbers,
 * left-hand positions and performance notes.
 */
export type AnnotationKind = 'fingering' | 'string' | 'position' | 'note';

export type AnnotationColor = 'blue' | 'black' | 'red' | 'green' | 'purple';

export const ANNOTATION_COLORS: Record<
  AnnotationColor,
  { label: string; css: string; rgb: readonly [number, number, number] }
> = {
  black: { label: 'Black', css: '#14141a', rgb: [0.08, 0.08, 0.1] },
  blue: { label: 'Blue', css: '#1a33bf', rgb: [0.1, 0.2, 0.75] },
  red: { label: 'Red', css: '#b31a1a', rgb: [0.7, 0.1, 0.1] },
  green: { label: 'Green', css: '#0d7333', rgb: [0.05, 0.45, 0.2] },
  purple: { label: 'Purple', css: '#7326b3', rgb: [0.45, 0.15, 0.7] },
};

/** The ink a mark gets when nothing else is chosen. */
export const DEFAULT_COLOR: AnnotationColor = 'black';

export const ANNOTATION_COLOR_ORDER = Object.keys(
  ANNOTATION_COLORS,
) as AnnotationColor[];

export function isAnnotationColor(value: unknown): value is AnnotationColor {
  return typeof value === 'string' && value in ANNOTATION_COLORS;
}

export type ScoreAnnotation = {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  text: string;
  size: number;
  kind: AnnotationKind;
  color: AnnotationColor;
};

export const DEFAULT_SIZE: Record<AnnotationKind, number> = {
  fingering: 6,
  string: 7,
  position: 8.5,
  note: 7.5,
};

export const ANNOTATION_VALUE_CHOICES: Partial<
  Record<AnnotationKind, readonly string[]>
> = {
  fingering: ['0', '1', '2', '3', '4'],
  string: ['1', '2', '3', '4', '5', '6', '7', '8'],
};

export function annotationValueChoices(
  kind: AnnotationKind,
): readonly string[] {
  return ANNOTATION_VALUE_CHOICES[kind] ?? [];
}

export function hasAnnotationValueMenu(kind: AnnotationKind): boolean {
  return annotationValueChoices(kind).length > 0;
}

/** Highest position a left hand reaches; past this the numeral is unreadable. */
const MAX_POSITION = 20;

const ROMAN_UNITS = [
  '',
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
];
const ROMAN_TENS = ['', 'X', 'XX'];

export function toRomanNumeral(value: number): string | null {
  if (!Number.isInteger(value) || value < 1 || value > MAX_POSITION)
    return null;
  return ROMAN_TENS[Math.floor(value / 10)] + ROMAN_UNITS[value % 10];
}

export function normalizeAnnotationText(
  kind: AnnotationKind,
  text: string,
): string {
  const trimmed = text.trim();

  if (kind === 'position') {
    const arabic = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
    return arabic === null
      ? trimmed.toUpperCase()
      : (toRomanNumeral(arabic) ?? '');
  }

  if (kind === 'string') return trimmed.replace(/\D/g, '').slice(0, 2);

  return trimmed;
}

export function createAnnotation(
  pageIndex: number,
  x: number,
  y: number,
  kind: AnnotationKind,
  text = '',
  color: AnnotationColor = DEFAULT_COLOR,
): ScoreAnnotation {
  return {
    id: `note-${crypto.randomUUID()}`,
    pageIndex,
    x,
    y,
    text: normalizeAnnotationText(kind, text),
    size: DEFAULT_SIZE[kind],
    kind,
    color,
  };
}

export function removeAnnotation(
  annotations: readonly ScoreAnnotation[],
  id: string,
): ScoreAnnotation[] {
  return annotations.filter((annotation) => annotation.id !== id);
}

export function annotationsWithin(
  annotations: readonly ScoreAnnotation[],
  pageIndex: number,
  rect: { left: number; bottom: number; right: number; top: number },
): ScoreAnnotation[] {
  return annotations.filter(
    (annotation) =>
      annotation.pageIndex === pageIndex &&
      annotation.x >= rect.left &&
      annotation.x <= rect.right &&
      annotation.y >= rect.bottom &&
      annotation.y <= rect.top,
  );
}
