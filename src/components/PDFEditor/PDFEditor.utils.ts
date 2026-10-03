import {
  COULD_NOT_EXTRACT,
  COULD_NOT_SAVE,
  EDIT_TITLE,
  LOADING_STAVES,
  OVERWRITE,
  READING_MARKINGS,
  SAVE,
  SAVE_A_COPY,
  SAVING,
} from '#/components/PDFEditor/PDFEditor.constants';
import type { PdfFileHandle } from '#/lib/pdf/fileAccess';
import type { MarkingsExportKind } from '#/lib/pdf/markings/markings.types';

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

/**
 * Once every page is in, the document-wide pass is still running; saying so
 * keeps the panel from looking stuck at "80 of 80".
 */
export function getLoadingStavesMessage(
  progress: { analysed: number; total: number } | null,
) {
  if (!progress) {
    return LOADING_STAVES;
  }
  if (progress.analysed >= progress.total) {
    return READING_MARKINGS;
  }
  return `${LOADING_STAVES} ${progress.analysed} of ${progress.total} pages`;
}

export function getExtractError(cause: unknown) {
  if (cause instanceof Error) {
    return cause.message;
  }
  return COULD_NOT_EXTRACT;
}

export function getSaveError(cause: unknown) {
  if (cause instanceof Error) {
    return cause.message;
  }
  return COULD_NOT_SAVE;
}

export function getExportMarkingsLabel(kind: MarkingsExportKind) {
  return kind === 'time-signature'
    ? 'Export time signature map as'
    : 'Export tempo map as';
}

export function getExportMarkingsError(cause: unknown) {
  if (cause instanceof Error) {
    return cause.message;
  }
  return 'Could not export markings';
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
