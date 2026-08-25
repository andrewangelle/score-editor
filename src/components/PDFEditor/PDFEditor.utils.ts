import {
  SAVE,
  SAVE_A_COPY,
  SAVING,
} from '#/components/PDFEditor/PDFEditor.constants';
import type { PdfFileHandle } from '#/lib/pdf/fileAccess';

export function getSaveButtonTitle(fileHandle: PdfFileHandle | null) {
  return fileHandle
    ? `Overwrite ${fileHandle.name}`
    : 'Name and download an edited copy';
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
