import { getSaveError } from '#/components/PDFEditor/PDFEditor.utils';
import { buildEditedPdf } from '#/lib/pdf/document/document';
import { documentBytes } from '#/lib/pdf/document/document.bytes';
import { selectAnnotations } from '#/store/annotations.slice';
import {
  documentErrorReported,
  documentStatusReported,
  documentWorkFinished,
  documentWorkStarted,
  selectDocumentId,
  selectPages,
  selectRevision,
} from '#/store/document.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { selectEditorState } from '#/store/selectors';

/**
 * Builds the edited document and hands it to `write`, whose return value is
 * reported as the save message. Builds from the pristine upload rather than
 * whatever was last written, which is what lets the same file be saved over
 * repeatedly without edits compounding.
 */
export function useSaveWith() {
  const dispatch = useAppDispatch();
  const documentId = useAppSelector(selectDocumentId);
  const revision = useAppSelector(selectRevision);
  const pages = useAppSelector(selectPages);
  const annotations = useAppSelector(selectAnnotations);
  const editorState = useAppSelector(selectEditorState);
  const bytes = documentBytes(documentId);

  return async function saveWith(
    write: (edited: Uint8Array) => Promise<string> | string,
  ) {
    if (!bytes) return;

    dispatch(documentWorkStarted());
    try {
      const edited = await buildEditedPdf(bytes, pages, annotations, {
        marks: 'objects',
        state: editorState,
      });
      const message = await write(edited);
      dispatch(documentStatusReported({ message, revision }));
    } catch (cause) {
      dispatch(documentErrorReported(getSaveError(cause)));
    } finally {
      dispatch(documentWorkFinished());
    }
  };
}
