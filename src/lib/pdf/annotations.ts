/**
 * Performance notes and fingerings.
 *
 * An annotation is anchored to a point in the *original* document's user space,
 * never to the extracted output. That is the whole trick: you can mark up the
 * full score, then extract the guitar parts, then extract them again with a
 * different selection, and every note stays welded to the music it describes.
 * Extraction only has to ask "which annotations fall inside this band?".
 */

export type AnnotationKind = 'fingering' | 'note';

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

/** Fingerings are terse and sit tight to the notes; prose notes run larger. */
export const DEFAULT_SIZE: Record<AnnotationKind, number> = {
  fingering: 8,
  note: 10,
};

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
    text,
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
