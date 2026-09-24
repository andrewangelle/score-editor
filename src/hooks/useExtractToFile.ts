import { useExtractWith } from '#/hooks/useExtractWith';
import { documentFileHandle } from '#/lib/pdf/document/document.bytes';
import { writePdfFile } from '#/lib/pdf/fileAccess';
import { documentFileReplaced, selectDocumentId } from '#/store/document.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { selectRegions } from '#/store/selectors';

/**
 * Replaces the opened file with the cut regions — the one action here that
 * destroys something on disk. The score stays open in memory so the regions
 * can be adjusted and written again, but the file no longer holds it, which
 * is what `documentFileReplaced` records.
 */
export function useExtractToFile() {
  const dispatch = useAppDispatch();
  const documentId = useAppSelector(selectDocumentId);
  const regions = useAppSelector(selectRegions);
  const extractWith = useExtractWith();
  const fileHandle = documentFileHandle(documentId);

  return function handleExtractToFile() {
    if (!fileHandle) return;

    return extractWith(async (extracted) => {
      await writePdfFile(fileHandle, extracted);
      dispatch(documentFileReplaced());
      const count = regions.length;
      return `Replaced ${fileHandle.name} with ${count} ${count === 1 ? 'region' : 'regions'}`;
    });
  };
}
