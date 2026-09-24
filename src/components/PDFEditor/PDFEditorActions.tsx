import {
  REDO_MARK,
  RESET,
  SAVE_A_COPY,
  UNDO,
  UNDO_MARK,
} from '#/components/PDFEditor/PDFEditor.constants';
import {
  HEADER_CLASS,
  SAVE_BUTTON_CLASS,
} from '#/components/PDFEditor/PDFEditor.styles';
import {
  getSaveButtonCTA,
  getSaveButtonTitle,
} from '#/components/PDFEditor/PDFEditor.utils';
import { ToolbarButton } from '#/components/PDFEditor/ToolbarButton/ToolbarButton';
import { useSaveWith } from '#/hooks/useSaveWith';
import {
  documentFileHandle,
  releaseDocumentBytes,
} from '#/lib/pdf/document/document.bytes';
import { writePdfFile } from '#/lib/pdf/fileAccess';
import {
  annotationRedone,
  annotationUndone,
  selectCanRedoAnnotation,
  selectCanUndoAnnotation,
} from '#/store/annotations.slice';
import {
  documentClosed,
  documentReset,
  documentSaved,
  saveCopyPromptOpened,
  selectCanUndo,
  selectDocumentId,
  selectDocumentName,
  selectIsBusy,
  selectIsDirty,
  selectIsNamingCopy,
  selectPageCount,
  undone,
} from '#/store/document.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { selectHasUnsavedChanges } from '#/store/selectors';

export function PDFEditorActions() {
  const dispatch = useAppDispatch();
  const name = useAppSelector(selectDocumentName);
  const pageCount = useAppSelector(selectPageCount);
  const dirty = useAppSelector(selectIsDirty);
  const unsaved = useAppSelector(selectHasUnsavedChanges);
  const canUndo = useAppSelector(selectCanUndo);
  const canUndoAnnotation = useAppSelector(selectCanUndoAnnotation);
  const canRedoAnnotation = useAppSelector(selectCanRedoAnnotation);
  const isNamingCopy = useAppSelector(selectIsNamingCopy);
  const documentId = useAppSelector(selectDocumentId);
  const fileHandle = documentFileHandle(documentId);
  const isBusy = useAppSelector(selectIsBusy);
  const saveWith = useSaveWith();

  function handleSaveToFile() {
    if (!fileHandle) {
      return;
    }

    return saveWith(async (edited) => {
      await writePdfFile(fileHandle, edited);
      dispatch(documentSaved());
      return `Saved to ${fileHandle.name}`;
    });
  }

  function handleClose() {
    // Also clears the status, error and any open prompt.
    dispatch(documentClosed());
    releaseDocumentBytes();
  }

  return (
    <header data-testid="PDFEditorActions" className={HEADER_CLASS}>
      <div className="mr-auto min-w-0">
        <h1 className="truncate font-semibold text-slate-900" title={name}>
          {name}
        </h1>
        <p className="text-xs text-slate-500">
          {pageCount} {pageCount === 1 ? 'page' : 'pages'}
          {unsaved ? ' · unsaved changes' : ''}
        </p>
      </div>

      <ToolbarButton
        data-testid="ToolbarButton-UNDO"
        disabled={!canUndo}
        onClick={() => dispatch(undone())}
      >
        {UNDO}
      </ToolbarButton>

      <ToolbarButton
        data-testid="ToolbarButton-UNDO_MARK"
        title="Undo last annotation edit (Cmd/Ctrl+Z)"
        disabled={!canUndoAnnotation}
        onClick={() => dispatch(annotationUndone())}
      >
        {UNDO_MARK}
      </ToolbarButton>

      <ToolbarButton
        data-testid="ToolbarButton-REDO_MARK"
        title="Redo last annotation edit (Cmd/Ctrl+Shift+Z)"
        disabled={!canRedoAnnotation}
        onClick={() => dispatch(annotationRedone())}
      >
        {REDO_MARK}
      </ToolbarButton>

      <ToolbarButton
        data-testid="ToolbarButton-RESET"
        disabled={!dirty}
        onClick={() => dispatch(documentReset())}
      >
        {RESET}
      </ToolbarButton>

      <ToolbarButton data-testid="ToolbarButton-CLOSE" onClick={handleClose}>
        Close
      </ToolbarButton>

      {fileHandle && (
        <ToolbarButton
          data-testid="ToolbarButton-SAVE_A_COPY"
          disabled={isBusy || isNamingCopy}
          onClick={() => dispatch(saveCopyPromptOpened())}
        >
          {SAVE_A_COPY}
        </ToolbarButton>
      )}

      <button
        data-testid="SaveButton"
        type="button"
        onClick={
          fileHandle ? handleSaveToFile : () => dispatch(saveCopyPromptOpened())
        }
        disabled={isBusy || !unsaved || (!fileHandle && isNamingCopy)}
        title={getSaveButtonTitle(fileHandle)}
        className={SAVE_BUTTON_CLASS}
      >
        {getSaveButtonCTA(isBusy, fileHandle)}
      </button>
    </header>
  );
}
