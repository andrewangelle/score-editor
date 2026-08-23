/**
 * Everything the performer writes on the score: fingerings, string numbers,
 * left-hand positions and performance notes.
 *
 * An annotation is anchored in the *original* document's user space, never in
 * the extracted output. That is the whole trick: mark up the full score, extract
 * the guitar parts, extract them again differently, and every note stays welded
 * to the music it describes — extraction only asks which fall inside a band.
 */
export type AnnotationKind = 'fingering' | 'string' | 'position' | 'note';

export type ScoreAnnotation = {
  id: string;
  /** Page of the uploaded document this note is anchored to. */
  pageIndex: number;
  /** Anchor in source-page user space; the text's left edge and baseline. */
  x: number;
  y: number;
  text: string;
  size: number;
  kind: AnnotationKind;
};

export const DEFAULT_SIZE: Record<AnnotationKind, number> = {
  fingering: 6,
  string: 7,
  position: 8.5,
  note: 7.5,
};

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

/** `5` -> `V`. Only the range a left hand can actually reach is supported. */
export function toRomanNumeral(value: number): string | null {
  if (!Number.isInteger(value) || value < 1 || value > MAX_POSITION)
    return null;
  return ROMAN_TENS[Math.floor(value / 10)] + ROMAN_UNITS[value % 10];
}

/**
 * Puts committed text into the form its kind is engraved in. Returning empty is
 * meaningful: the overlay drops the annotation rather than leaving a blank
 * circle behind.
 */
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

  // Two digits so a 12-string or a lute course still fits; more than that is
  // not a string number and would burst the circle.
  if (kind === 'string') return trimmed.replace(/\D/g, '').slice(0, 2);

  return trimmed;
}

export function createAnnotation(
  pageIndex: number,
  x: number,
  y: number,
  kind: AnnotationKind,
  text = '',
): ScoreAnnotation {
  return {
    id: `note-${crypto.randomUUID()}`,
    pageIndex,
    x,
    y,
    text: normalizeAnnotationText(kind, text),
    size: DEFAULT_SIZE[kind],
    kind,
  };
}

export function removeAnnotation(
  annotations: readonly ScoreAnnotation[],
  id: string,
): ScoreAnnotation[] {
  return annotations.filter((annotation) => annotation.id !== id);
}

/** Annotations whose anchor lies inside `rect`. */
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
