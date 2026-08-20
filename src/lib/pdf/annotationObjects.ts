/**
 * Performance marks as real PDF annotations, so they survive a reopen.
 *
 * Each mark is a `/Stamp` whose appearance stream draws what `stampAnnotation`
 * draws, and whose dictionary carries the `ScoreAnnotation` fields in a private
 * `PdfEditor*` namespace. The ink therefore lives in the annotation rather than
 * the page, so removing it recovers the unstamped original — which is what lets
 * a file be opened, stripped back to pristine bytes, and saved over repeatedly
 * without marks compounding.
 */

import {
  degrees,
  drawEllipse,
  drawText,
  PDFDict,
  type PDFDocument,
  type PDFFont,
  PDFHexString,
  PDFName,
  type PDFNumber,
  type PDFObject,
  type PDFOperator,
  type PDFPage,
  type PDFRef,
  type PDFString,
} from 'pdf-lib';
import { type DrawSink, stampAnnotation } from '#/lib/pdf/annotationStamp';
import type { AnnotationKind, ScoreAnnotation } from '#/lib/pdf/annotations';
import { DEFAULT_SIZE } from '#/lib/pdf/annotations';

/**
 * The private keys a mark rides in.
 *
 * The prefix is what makes our marks identifiable: a source score may
 * legitimately carry links, outline targets or form fields, and both reading and
 * stripping filter strictly on it so that someone else's annotations are never
 * claimed or deleted.
 */
const KIND = PDFName.of('PdfEditorKind');
const TEXT = PDFName.of('PdfEditorText');
const ID = PDFName.of('PdfEditorId');
const SIZE = PDFName.of('PdfEditorSize');
const X = PDFName.of('PdfEditorX');
const Y = PDFName.of('PdfEditorY');

const ANNOTS = PDFName.of('Annots');
const AP = PDFName.of('AP');
const N = PDFName.of('N');

const FONT_KEY = 'PdfEditorFont';

/** Print flag: the mark is part of the music, not a viewer-only sticky note. */
const PRINT_FLAG = 4;

const KINDS: readonly AnnotationKind[] = Object.keys(
  DEFAULT_SIZE,
) as AnnotationKind[];

/**
 * Vertical room the glyphs are given in the appearance box, as a fraction of
 * point size. Deliberately generous on both sides: a box that is too small
 * clips the mark, while one that is too large costs nothing at all.
 */
const GLYPH_ASCENT = 1;
const GLYPH_DESCENT = 0.35;

type Box = { left: number; bottom: number; right: number; top: number };

/**
 * A built appearance and the box it draws inside.
 *
 * The box is in *mark-local* space — anchored at the origin rather than at the
 * mark's position on the page — which is what makes two marks with the same
 * kind, text and size share one XObject. The position is applied once, by the
 * annotation's `/Rect`.
 */
type Appearance = { ref: PDFRef; box: Box };

/**
 * Form XObjects already built, keyed by what determines their geometry.
 *
 * A well-marked score carries hundreds of "3"s at one size. They are one drawing
 * repeated, and the file should say so once.
 */
export type AppearanceCache = Map<string, Appearance>;

export function appearanceCache(): AppearanceCache {
  return new Map();
}

function appearanceKey(annotation: ScoreAnnotation): string {
  return `${annotation.kind}:${annotation.size}:${annotation.text}`;
}

/**
 * A draw sink that accumulates pdf-lib operators instead of pushing them into a
 * page, and tracks what they reach so the form can be given a bounding box.
 *
 * Everything is drawn against the origin — see `Appearance`.
 */
function appearanceSink(font: PDFFont) {
  const operators: PDFOperator[] = [];
  let box: Box | null = null;

  function reach(next: Box) {
    box = box
      ? {
          left: Math.min(box.left, next.left),
          bottom: Math.min(box.bottom, next.bottom),
          right: Math.max(box.right, next.right),
          top: Math.max(box.top, next.top),
        }
      : next;
  }

  const sink: DrawSink = {
    drawText(text, options) {
      operators.push(
        ...drawText(font.encodeText(text), {
          color: options.color,
          font: PDFName.of(FONT_KEY),
          size: options.size,
          rotate: degrees(0),
          xSkew: degrees(0),
          ySkew: degrees(0),
          x: options.x,
          y: options.y,
        }),
      );
      reach({
        left: options.x,
        right: options.x + font.widthOfTextAtSize(text, options.size),
        bottom: options.y - options.size * GLYPH_DESCENT,
        top: options.y + options.size * GLYPH_ASCENT,
      });
    },

    drawCircle(options) {
      operators.push(
        ...drawEllipse({
          x: options.x,
          y: options.y,
          xScale: options.size,
          yScale: options.size,
          rotate: degrees(0),
          // Unfilled, so the engraving underneath still shows through.
          color: undefined,
          borderColor: options.borderColor,
          borderWidth: options.borderWidth,
        }),
      );
      // The stroke straddles the path, so half of it lies outside the radius.
      const outer = options.size + options.borderWidth / 2;
      reach({
        left: options.x - outer,
        right: options.x + outer,
        bottom: options.y - outer,
        top: options.y + outer,
      });
    },
  };

  return { sink, operators, box: () => box };
}

/**
 * The Form XObject for one mark, built once per distinct kind/text/size.
 *
 * Null when the mark draws nothing — a note whose editor was open but empty when
 * the file was saved. It is not written out, exactly as it is not stamped.
 */
function annotationAppearance(
  doc: PDFDocument,
  annotation: ScoreAnnotation,
  font: PDFFont,
  cache: AppearanceCache,
): Appearance | null {
  const key = appearanceKey(annotation);
  const built = cache.get(key);
  if (built) return built;

  const { sink, operators, box } = appearanceSink(font);
  stampAnnotation(
    sink,
    annotation,
    { x: 0, y: 0, size: annotation.size },
    font,
  );

  const bounds = box();
  if (!bounds) return null;

  const stream = doc.context.flateStream(
    operators.map((operator) => operator.toString()).join('\n'),
    {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: [bounds.left, bounds.bottom, bounds.right, bounds.top],
      Resources: { Font: { [FONT_KEY]: font.ref } },
    },
  );

  const appearance = { ref: doc.context.register(stream), box: bounds };
  cache.set(key, appearance);
  return appearance;
}

/**
 * Writes the marks belonging to one page as annotation objects on it.
 *
 * `cache` is a parameter rather than a local so that one document's worth of
 * pages share their appearance streams; a per-page cache would emit the same
 * fingering once per page it appears on.
 */
export function writeAnnotationObjects(
  doc: PDFDocument,
  page: PDFPage,
  annotations: readonly ScoreAnnotation[],
  font: PDFFont,
  cache: AppearanceCache = appearanceCache(),
): void {
  for (const annotation of annotations) {
    const appearance = annotationAppearance(doc, annotation, font, cache);
    if (!appearance) continue;

    const { ref, box } = appearance;
    // The appearance is drawn against the origin and the box measured there, so
    // placing the box at the anchor is the whole of the positioning. Box and
    // rect being the same size means a viewer's appearance transform is a pure
    // translation, and the mark lands exactly where it was flattened.
    const dict = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Stamp',
      Rect: [
        annotation.x + box.left,
        annotation.y + box.bottom,
        annotation.x + box.right,
        annotation.y + box.top,
      ],
      F: PRINT_FLAG,
      AP: { N: ref },
      // What a reader that knows nothing of this app reports the mark as.
      Contents: PDFHexString.fromText(annotation.text),
    });

    dict.set(KIND, PDFName.of(annotation.kind));
    dict.set(ID, PDFHexString.fromText(annotation.id));
    dict.set(TEXT, PDFHexString.fromText(annotation.text));
    dict.set(SIZE, doc.context.obj(annotation.size));
    dict.set(X, doc.context.obj(annotation.x));
    dict.set(Y, doc.context.obj(annotation.y));

    page.node.addAnnot(doc.context.register(dict));
  }
}

function ourAnnotations(
  doc: PDFDocument,
  page: PDFPage,
): { entry: PDFObject; dict: PDFDict }[] {
  const annots = page.node.Annots();
  if (!annots) return [];

  const found: { entry: PDFObject; dict: PDFDict }[] = [];
  for (const entry of annots.asArray()) {
    // A malformed or unresolvable entry is someone else's problem, not ours.
    const dict = doc.context.lookupMaybe(entry, PDFDict);
    if (dict?.has(ID)) found.push({ entry, dict });
  }
  return found;
}

function readNumber(dict: PDFDict, key: PDFName): number | null {
  const value = dict.get(key) as PDFNumber | undefined;
  const number = value?.asNumber?.();
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function readText(dict: PDFDict, key: PDFName): string | null {
  const value = dict.get(key) as PDFString | PDFHexString | undefined;
  return typeof value?.decodeText === 'function' ? value.decodeText() : null;
}

/**
 * A file can be edited by anything, so nothing here is assumed: a mark missing
 * its anchor or carrying a kind this version does not know is dropped rather
 * than restored as a broken object.
 */
function toAnnotation(
  dict: PDFDict,
  pageIndex: number,
): ScoreAnnotation | null {
  const id = readText(dict, ID);
  const text = readText(dict, TEXT);
  const kind = (dict.get(KIND) as PDFName | undefined)?.decodeText?.();
  const size = readNumber(dict, SIZE);
  const x = readNumber(dict, X);
  const y = readNumber(dict, Y);

  if (!id || text === null || size === null || x === null || y === null) {
    return null;
  }
  if (!KINDS.includes(kind as AnnotationKind)) return null;

  return { id, pageIndex, x, y, text, size, kind: kind as AnnotationKind };
}

/**
 * Every mark this app wrote into the document, grouped by page in page order.
 *
 * `pageIndex` comes from where the annotation sits *now*, not from anything
 * stored: pages may have been reordered or deleted before the file was saved,
 * and the mark's page is whichever one it was written onto.
 */
export function readAnnotationObjects(doc: PDFDocument): ScoreAnnotation[] {
  const restored: ScoreAnnotation[] = [];

  doc.getPages().forEach((page, pageIndex) => {
    for (const { dict } of ourAnnotations(doc, page)) {
      const annotation = toAnnotation(dict, pageIndex);
      if (annotation) restored.push(annotation);
    }
  });

  return restored;
}

/**
 * Takes our marks back out, leaving every other annotation where it is.
 *
 * The bytes an opened document works from are these, with the marks lifted into
 * the store instead. That also settles a rendering problem: pdf.js paints
 * annotations onto its canvas whether or not the HTML annotation layer is
 * switched off, so the overlay would otherwise draw every mark twice.
 *
 * Returns whether anything was removed, so an untouched document can be spared
 * a pointless re-serialization.
 */
export function stripAnnotationObjects(doc: PDFDocument): boolean {
  let stripped = false;

  for (const page of doc.getPages()) {
    const ours = ourAnnotations(doc, page);
    if (ours.length === 0) continue;

    const annots = page.node.Annots();
    if (!annots) continue;

    const drop = new Set(ours.map(({ entry }) => entry));
    page.node.set(
      ANNOTS,
      doc.context.obj(annots.asArray().filter((entry) => !drop.has(entry))),
    );

    // The appearance streams are ours alone, and nothing else can be pointing
    // at them. Left behind they would accumulate over an open/save cycle.
    for (const { dict } of ours) {
      const ref = doc.context.lookupMaybe(dict.get(AP), PDFDict)?.get(N);
      if (ref) doc.context.delete(ref as PDFRef);
    }

    stripped = true;
  }

  return stripped;
}
