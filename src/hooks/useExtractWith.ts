import { getExtractError } from '#/components/PDFEditor/PDFEditor.utils';
import { documentBytes } from '#/lib/pdf/document/document.bytes';
import { extractRegions } from '#/lib/pdf/partExtraction';
import { DEFAULT_LAYOUT, sortRegions } from '#/lib/pdf/regions';
import { selectAnnotations } from '#/store/annotations.slice';
import {
  documentErrorReported,
  documentStatusReported,
  documentWorkFinished,
  documentWorkStarted,
  selectDocumentId,
  selectRevision,
} from '#/store/document.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { selectAnalysis, selectKeepMarkings } from '#/store/score.slice';
import { selectRegions } from '#/store/selectors';

/**
 * Cuts the regions and hands the result to `write`, whose return value is
 * reported as the save message.
 */
export function useExtractWith() {
  const dispatch = useAppDispatch();
  const documentId = useAppSelector(selectDocumentId);
  const revision = useAppSelector(selectRevision);
  const analysis = useAppSelector(selectAnalysis);
  const regions = useAppSelector(selectRegions);
  const keepMarkings = useAppSelector(selectKeepMarkings);
  const annotations = useAppSelector(selectAnnotations);
  const bytes = documentBytes(documentId);

  return async function extractWith(
    write: (extracted: Uint8Array) => Promise<string> | string,
  ) {
    if (!bytes || !analysis) return;

    dispatch(documentWorkStarted());
    try {
      const extracted = await extractRegions(
        bytes,
        sortRegions(regions),
        analysis.pages[0],
        { annotations, layout: { ...DEFAULT_LAYOUT, keepMarkings } },
      );
      const message = await write(extracted);
      dispatch(documentStatusReported({ message, revision }));
    } catch (cause) {
      dispatch(documentErrorReported(getExtractError(cause)));
    } finally {
      dispatch(documentWorkFinished());
    }
  };
}
