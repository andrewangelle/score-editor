import { MAX_PDF_BYTES } from '#/lib/pdf/document';

export const megabytes = Math.round(MAX_PDF_BYTES / (1024 * 1024));

export function getFileOpenErrorMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return `The file picker could not be opened: ${message}`;
}
