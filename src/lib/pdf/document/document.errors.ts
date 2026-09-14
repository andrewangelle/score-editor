import { MAX_PDF_BYTES } from '#/lib/pdf/document/document';

export class PdfLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfLoadError';
  }

  static fileTooLarge(name: string, size: number) {
    return `"${name}" is ${formatBytes(size)}. The limit is ${formatBytes(MAX_PDF_BYTES)}.`;
  }

  static incorrectFileType(name: string) {
    return `"${name}" does not look like a PDF file.`;
  }

  static passwordProtected(name: string) {
    return `"${name}" is password protected and cannot be opened.`;
  }

  static failedToRead(name: string, detail: string) {
    return `"${name}" could not be read: ${detail}`;
  }

  static noData(name: string) {
    return `"${name}" is empty.`;
  }

  static noPages() {
    return 'A PDF must have at least one page.';
  }

  static fileHasNoPages(name: string) {
    return `"${name}" contains no pages.`;
  }
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1
    ? `${mb.toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
