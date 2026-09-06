import {
  COULD_NOT_ANALYZE,
  COULD_NOT_EXTRACT,
  COULD_NOT_OPEN,
  COULD_NOT_SAVE,
  EDIT_TITLE,
  OVERWRITE,
  SAVE,
  SAVE_A_COPY,
  SAVING,
} from '#/components/PDFEditor/PDFEditor.constants';
import { PdfLoadError } from '#/lib/pdf/document';
import type { PdfFileHandle } from '#/lib/pdf/fileAccess';

export function getSaveButtonTitle(fileHandle: PdfFileHandle | null) {
  return fileHandle ? `${OVERWRITE} ${fileHandle.name}` : EDIT_TITLE;
}

export function getSaveButtonCTA(
  isBusy: boolean,
  fileHandle: PdfFileHandle | null,
) {
  if (isBusy) {
    return SAVING;
  }

  if (fileHandle) {
    return SAVE;
  }

  return SAVE_A_COPY;
}

export function getFileHandleError(cause: unknown) {
  if (cause instanceof PdfLoadError) return cause.message;
  return `${COULD_NOT_OPEN}: ${cause instanceof Error ? cause.message : String(cause)}`;
}

export function getAnalyseScoreError(cause: unknown) {
  if (cause instanceof Error) return cause.message;
  return COULD_NOT_ANALYZE;
}

export function getExtractError(cause: unknown) {
  if (cause instanceof Error) return cause.message;
  return COULD_NOT_EXTRACT;
}

export function getSaveError(cause: unknown) {
  if (cause instanceof Error) return cause.message;
  return COULD_NOT_SAVE;
}

export function downloadBytes(
  bytes: Uint8Array,
  fileName: string,
  type: string,
): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}
