import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';
import { stampAnnotation } from '#/lib/pdf/annotationStamp';
import type { ScoreAnnotation } from '#/lib/pdf/annotations';

/**
 * Everything is parsed in-memory in the browser, so this is a guard against
 * locking up the tab rather than a server-side resource limit.
 */
export const MAX_PDF_BYTES = 100 * 1024 * 1024;

/** A PDF header may be preceded by junk bytes; the spec-tolerant scan window. */
const HEADER_SCAN_BYTES = 1024;

/**
 * One page of the document being edited.
 *
 * `sourceIndex` always points back into the originally uploaded bytes, which we
 * never mutate. Reordering and deleting are therefore just list operations, and
 * the real document is only rebuilt when the user saves.
 */
export type PageEdit = {
  /** Stable identity for React keys and selection, unrelated to position. */
  id: string;
  /** Zero-based page index in the original uploaded document. */
  sourceIndex: number;
  /** Absolute rotation in degrees, normalized to 0 | 90 | 180 | 270. */
  rotation: number;
};

export type LoadedPdf = {
  name: string;
  /** Pristine bytes of the upload. Never handed to pdf.js, which detaches buffers. */
  bytes: Uint8Array;
  pages: PageEdit[];
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
 * Reads a user-selected file, verifies it really is a PDF, and derives the
 * initial page list. Throws `PdfLoadError` with a message meant for the UI.
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

  return { name: file.name, bytes, pages };
}

/**
 * Rebuilds the document from the original bytes, applying the page order and
 * rotations. Pure pdf-lib, so this is safe to call from a server function too.
 */
export async function buildEditedPdf(
  source: Uint8Array,
  pages: readonly PageEdit[],
  annotations: readonly ScoreAnnotation[] = [],
): Promise<Uint8Array> {
  if (pages.length === 0) {
    throw new PdfLoadError('A PDF must have at least one page.');
  }

  const original = await PDFDocument.load(source, { updateMetadata: false });
  const output = await PDFDocument.create();

  const copied = await output.copyPages(
    original,
    pages.map((page) => page.sourceIndex),
  );

  const font = annotations.length
    ? await output.embedFont(StandardFonts.Helvetica)
    : null;

  copied.forEach((page, index) => {
    // `pages` and `copied` are index-aligned by construction above.
    page.setRotation(degrees(normalizeAngle(pages[index].rotation)));
    output.addPage(page);

    if (!font) return;
    // Annotations are anchored in the source page's user space, which is exactly
    // what drawText expects — the page's own rotation carries them along.
    for (const annotation of annotations) {
      if (annotation.pageIndex !== pages[index].sourceIndex) continue;
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

  return output.save();
}

/** Turns `report.pdf` into `report-edited.pdf`. */
export function editedFileName(name: string): string {
  const withoutExtension = name.replace(/\.pdf$/i, '');
  return `${withoutExtension || 'document'}-edited.pdf`;
}
