import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';
import {
  appearanceCache,
  readAnnotationObjects,
  stripAnnotationObjects,
  writeAnnotationObjects,
} from '#/lib/pdf/annotationObjects';
import { stampAnnotation } from '#/lib/pdf/annotationStamp';
import type { ScoreAnnotation } from '#/lib/pdf/annotations';
import {
  type EditorState,
  readEditorState,
  writeEditorState,
} from '#/lib/pdf/editorState';

/**
 * Everything is parsed in-memory in the browser, so this is a guard against
 * locking up the tab rather than a server-side resource limit.
 */
export const MAX_PDF_BYTES = 100 * 1024 * 1024;

/** A PDF header may be preceded by junk bytes; the spec-tolerant scan window. */
const HEADER_SCAN_BYTES = 1024;

/**
 * One page of the document being edited. `sourceIndex` always points back into
 * the uploaded bytes, which are never mutated, so reordering and deleting are
 * just list operations and the document is only rebuilt on save.
 */
export type PageEdit = {
  /** Stable identity for React keys and selection, unrelated to position. */
  id: string;
  sourceIndex: number;
  /** Absolute rotation in degrees, normalized to 0 | 90 | 180 | 270. */
  rotation: number;
};

export type LoadedPdf = {
  name: string;
  /**
   * Pristine bytes of the upload. Never handed to pdf.js, which detaches
   * buffers. "Pristine" means without this app's own marks: they are lifted out
   * into `annotations` rather than left in the page, which is what lets a file
   * be saved over repeatedly without marks compounding, and keeps pdf.js from
   * painting a mark the overlay is about to draw itself.
   */
  bytes: Uint8Array;
  pages: PageEdit[];
  /** Marks recovered from a file this app saved. Empty for any other PDF. */
  annotations: ScoreAnnotation[];
  state: EditorState | null;
};

/** Thrown for problems worth showing the user verbatim. */
export class PdfLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfLoadError';
  }
}

export function normalizeAngle(angle: number): number {
  const snapped = Math.round(angle / 90) * 90;
  return ((snapped % 360) + 360) % 360;
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1
    ? `${mb.toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Reads a user-selected file, verifies it really is a PDF, derives the initial
 * page list, and recovers any work this app saved into it — all in one pass,
 * because parsing a 239-page score is the expensive part of opening one.
 *
 * Throws `PdfLoadError` with a message meant for the UI.
 */
export async function readPdfFile(file: File): Promise<LoadedPdf> {
  if (file.size === 0) {
    throw new PdfLoadError(`"${file.name}" is empty.`);
  }

  if (file.size > MAX_PDF_BYTES) {
    throw new PdfLoadError(
      `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_PDF_BYTES)}.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = new TextDecoder('latin1').decode(
    bytes.subarray(0, HEADER_SCAN_BYTES),
  );
  if (!header.includes('%PDF-')) {
    throw new PdfLoadError(`"${file.name}" does not look like a PDF file.`);
  }

  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/encrypt/i.test(detail)) {
      throw new PdfLoadError(
        `"${file.name}" is password protected and cannot be opened.`,
      );
    }
    throw new PdfLoadError(`"${file.name}" could not be read: ${detail}`);
  }

  const pages = source.getPages().map((page, sourceIndex) => ({
    id: `page-${sourceIndex}-${crypto.randomUUID()}`,
    sourceIndex,
    rotation: normalizeAngle(page.getRotation().angle),
  }));

  if (pages.length === 0) {
    throw new PdfLoadError(`"${file.name}" contains no pages.`);
  }

  const annotations = readAnnotationObjects(source);
  const state = readEditorState(source);
  // Re-serializing is only worth it when there was something to take out: most
  // documents opened here were never saved from here, and rewriting 100 MB to
  // remove nothing is a real cost for no change.
  const stripped = stripAnnotationObjects(source);

  return {
    name: file.name,
    bytes: stripped ? await source.save() : bytes,
    pages,
    annotations,
    state,
  };
}

export type SaveOptions = {
  /**
   * `objects` writes each mark as a PDF annotation carrying its own fields, so
   * reopening gets it back as something retypable and draggable. `flattened`
   * draws it into the page content, which is what a part handed to a player
   * wants: ink no viewer can decide not to print.
   */
  marks?: 'objects' | 'flattened';
  /** Written only alongside `objects`; flattened output has no session. */
  state?: EditorState | null;
};

/**
 * Rebuilds the document from the original bytes, applying the page order and
 * rotations. Pure pdf-lib, so this is safe to call from a server function too.
 */
export async function buildEditedPdf(
  source: Uint8Array,
  pages: readonly PageEdit[],
  annotations: readonly ScoreAnnotation[] = [],
  options: SaveOptions = {},
): Promise<Uint8Array> {
  if (pages.length === 0) {
    throw new PdfLoadError('A PDF must have at least one page.');
  }

  const asObjects = options.marks === 'objects';

  const original = await PDFDocument.load(source, { updateMetadata: false });
  const output = await PDFDocument.create();

  const copied = await output.copyPages(
    original,
    pages.map((page) => page.sourceIndex),
  );

  const font = annotations.length
    ? await output.embedFont(StandardFonts.Helvetica)
    : null;
  // Shared across pages so the same fingering, at the same size, is one drawing
  // in the file however many staves it appears on.
  const appearances = appearanceCache();

  copied.forEach((page, index) => {
    // `pages` and `copied` are index-aligned by construction above.
    page.setRotation(degrees(normalizeAngle(pages[index].rotation)));
    output.addPage(page);

    if (!font) return;
    // Marks are anchored in the source page's user space, which is what drawText
    // expects — the page's own rotation carries them along.
    const onPage = annotations.filter(
      (annotation) => annotation.pageIndex === pages[index].sourceIndex,
    );

    if (asObjects) {
      writeAnnotationObjects(output, page, onPage, font, appearances);
      return;
    }

    for (const annotation of onPage) {
      stampAnnotation(
        page,
        annotation,
        { x: annotation.x, y: annotation.y, size: annotation.size },
        font,
      );
    }
  });

  output.setTitle(original.getTitle() ?? '');
  output.setAuthor(original.getAuthor() ?? '');
  output.setSubject(original.getSubject() ?? '');
  output.setCreator(original.getCreator() ?? '');
  output.setModificationDate(new Date());

  // The output starts from `PDFDocument.create()`, so the attachment has to be
  // written afresh every build, exactly like the metadata above.
  if (asObjects && options.state) {
    await writeEditorState(output, options.state);
  }

  return output.save();
}

/** Turns `report.pdf` into `report-edited.pdf`. */
export function editedFileName(name: string): string {
  const withoutExtension = name.replace(/\.pdf$/i, '');
  return `${withoutExtension || 'document'}-edited.pdf`;
}

/** Turns what someone typed into a name a download can carry. */
export function downloadFileName(typed: string, fallback: string): string {
  const base = typed
    .replace(/\.pdf$/i, '')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    // Leading dots hide the file on Unix; trailing dots and spaces are dropped
    // silently by Windows, which would leave a name nobody asked for.
    .replace(/^[.\s]+|[.\s]+$/g, '');

  return base ? `${base}.pdf` : fallback;
}
