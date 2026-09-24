import {
  COULD_NOT_ANALYZE,
  COULD_NOT_OPEN,
} from '#/components/PDFDropzone/PDFDropzone.constants';
import { PdfLoadError } from '#/lib/pdf/document/document.errors';

export function getFileOpenErrorMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return `The file picker could not be opened: ${message}`;
}

export function getFileHandleError(cause: unknown) {
  if (cause instanceof PdfLoadError) return cause.message;
  return `${COULD_NOT_OPEN}: ${cause instanceof Error ? cause.message : String(cause)}`;
}

export function getAnalyseScoreError(cause: unknown) {
  if (cause instanceof Error) return cause.message;
  return COULD_NOT_ANALYZE;
}
