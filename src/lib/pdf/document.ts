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

export const MAX_PDF_BYTES = 100 * 1024 * 1024;

/** A PDF header may be preceded by junk bytes; the spec-tolerant scan window. */
const HEADER_SCAN_BYTES = 1024;

export type PageEdit = {
  /** Stable identity for React keys and selection, unrelated to position. */
  id: string;
  sourceIndex: number;
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
  marks?: 'objects' | 'flattened';
  state?: EditorState | null;
};

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

  const appearances = appearanceCache();

  copied.forEach((page, index) => {
    page.setRotation(degrees(normalizeAngle(pages[index].rotation)));
    output.addPage(page);

    if (!font) return;

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
