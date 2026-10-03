import { EditScorePanel } from '#/components/EditScorePanel/EditScorePanel';
import { AnnotationValueMenu } from '#/components/PDFEditor/AnnotationValueMenu/AnnotationValueMenu';
import { AnalysisNote, LoadingStaves } from '#/components/PDFEditor/Messages';
import { ERROR_MESSAGE_CLASS } from '#/components/PDFEditor/PDFEditor.styles';
import { PDFEditorActions } from '#/components/PDFEditor/PDFEditorActions';
import { SaveFileCopyPrompt } from '#/components/PDFEditor/SaveFileCopyPrompt';
import { SaveMarkingsPrompt } from '#/components/PDFEditor/SaveMarkingsPrompt';
import { StatusMessage } from '#/components/PDFEditor/StatusMessage';
import { PDFViewer } from '#/components/PDFViewer/PDFViewer';
import {
  selectDocumentError,
  selectStatusMessage,
} from '#/store/document.slice';
import { useAppSelector } from '#/store/hooks';
import { selectAnalysisNote, selectPartsDetected } from '#/store/score.slice';

export function PDFEditor() {
  const partsDetected = useAppSelector(selectPartsDetected);
  const analysisNote = useAppSelector(selectAnalysisNote);
  const statusMessage = useAppSelector(selectStatusMessage);
  const error = useAppSelector(selectDocumentError);

  return (
    <div className="flex h-screen flex-col" data-testid="PDFEditor">
      {/* header elements */}
      <PDFEditorActions />
      <AnnotationValueMenu />
      <SaveFileCopyPrompt />
      <SaveMarkingsPrompt />
      {error && (
        <p className={ERROR_MESSAGE_CLASS} role="alert">
          {error}
        </p>
      )}
      {statusMessage && <StatusMessage />}

      <main className="flex min-h-0 flex-1">
        {/* Center panel and document viewer */}
        <PDFViewer />

        {/** Right side panel and editor */}
        {partsDetected && !analysisNote && <EditScorePanel />}
        {!partsDetected && analysisNote && <AnalysisNote />}
        {!partsDetected && !analysisNote && <LoadingStaves />}
      </main>
    </div>
  );
}
