import {
  downloadBytes,
  getExportMarkingsError,
  getExportMarkingsLabel,
} from '#/components/PDFEditor/PDFEditor.utils';
import { SaveCopyPrompt } from '#/components/PDFEditor/SaveCopyPrompt';
import { documentBytes } from '#/lib/pdf/document/document.bytes';
import type { MarkingsExportKind } from '#/lib/pdf/markings/markings.extract';
import {
  extractMarkings,
  markingsExportFileName,
} from '#/lib/pdf/markings/markings.extract';
import {
  documentErrorReported,
  documentStatusReported,
  documentWorkFinished,
  documentWorkStarted,
  markingsExportClosed,
  selectDocumentId,
  selectDocumentName,
  selectMarkingsExport,
  selectRevision,
} from '#/store/document.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { selectAnalysis } from '#/store/score.slice';

export function SaveMarkingsPrompt() {
  const dispatch = useAppDispatch();
  const markingsExport = useAppSelector(selectMarkingsExport);
  const analysis = useAppSelector(selectAnalysis);
  const documentId = useAppSelector(selectDocumentId);
  const bytes = documentBytes(documentId);
  const revision = useAppSelector(selectRevision);
  const name = useAppSelector(selectDocumentName);

  async function handleExportMarkings(kind: MarkingsExportKind, typed: string) {
    dispatch(markingsExportClosed());
    if (!bytes || !analysis) {
      return;
    }

    dispatch(documentWorkStarted());
    try {
      const exported = await extractMarkings(bytes, analysis, kind);
      const fileName = typed.endsWith('.pdf') ? typed : `${typed}.pdf`;
      downloadBytes(exported, fileName, 'application/pdf');
      dispatch(
        documentStatusReported({ message: `Saved ${fileName}`, revision }),
      );
    } catch (cause) {
      const error = getExportMarkingsError(cause);
      dispatch(documentErrorReported(error));
    } finally {
      dispatch(documentWorkFinished());
    }
  }

  return (
    <SaveCopyPrompt
      key={markingsExport.kind}
      open={markingsExport.open}
      suggestion={markingsExportFileName(name, markingsExport.kind)}
      onSave={(typed) => handleExportMarkings(markingsExport.kind, typed)}
      onCancel={() => dispatch(markingsExportClosed())}
      inputId="export-markings-name"
      label={getExportMarkingsLabel(markingsExport.kind)}
    />
  );
}
