import { MAX_PDF_BYTES } from '#/lib/pdf/document';

export const megabytes = Math.round(MAX_PDF_BYTES / (1024 * 1024));

export function getFileOpenErrorMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return `The file picker could not be opened: ${message}`;
}

export const DROP_INSTRUCTION_HEADING = 'Drop a PDF here';
export const DROP_INSTRUCTION_DESCRIPTION = `or choose one from your machine — up to ${megabytes} MB`;
export const CHOOSE_FILE = 'Choose file';
export const CHOOSE_FILE_DISCLAIMER =
  'Your file stays in this browser tab. Nothing is uploaded to a server.';
