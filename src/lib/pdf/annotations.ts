/**
 * Everything the performer writes on the score: fingerings, string numbers,
 * left-hand positions and performance notes.
 *
 * An annotation is anchored to a point in the *original* document's user space,
 * never to the extracted output. That is the whole trick: you can mark up the
 * full score, then extract the guitar parts, then extract them again with a
 * different selection, and every note stays welded to the music it describes.
 * Extraction only has to ask "which annotations fall inside this band?".
 */

/**
 * What a mark on the page says.
 *
 * The three terse kinds are the guitarist's shorthand: which finger stops the
 * note, which string it is stopped on, and where the left hand sits on the
 * neck. They are separate kinds rather than one "short text" because each is
 * engraved differently — a string number is circled, a position is a roman
 * numeral — and because they are read at a glance in a fixed order of
 * prominence, which is what `DEFAULT_SIZE` encodes.
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

/**
 * Fingerings are terse and sit tight to the notes; prose notes run larger.
 *
 * Within the shorthand the sizes are a hierarchy, not a preference. A fingering
 * belongs to one notehead, so it is the smallest; a string number qualifies
 * that note and is circled, so it needs a touch more room; a position governs a
 * whole passage, so it reads largest of the three.
 */
export const DEFAULT_SIZE: Record<AnnotationKind, number> = {
  fingering: 8,
  string: 9.5,
  position: 11,
  note: 10,
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
 * Puts committed text into the form its kind is engraved in.
 *
 * Positions are conventionally roman, but they are *thought* in arabic — a
 * player reads "seventh position" and types 7 — so a number is converted rather
 * than rejected. A string identifier is drawn inside a circle, which only has
 * room for the number itself.
 *
 * Returning empty is meaningful: the overlay reads it as "nothing was said
 * here" and drops the annotation rather than leaving a blank circle behind.
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

  // Two digits so a 12-string or a lute tablature course still fits; more than
  // that is not a string number and would burst the circle.
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

/**
 * Annotations whose anchor lies inside `rect`. Used both to decide what to bake
 * into an extracted band and to render the overlay for a single page.
 */
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
