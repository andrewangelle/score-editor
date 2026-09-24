import { downloadBytes } from '#/components/PDFEditor/PDFEditor.utils';
import { SaveCopyPrompt } from '#/components/PDFEditor/SaveCopyPrompt';
import { useSaveWith } from '#/hooks/useSaveWith';
import { downloadFileName, editedFileName } from '#/lib/pdf/document/document';
import {
  saveCopyPromptClosed,
  selectDocumentName,
  selectIsNamingCopy,
} from '#/store/document.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';

export function SaveFileCopyPrompt() {
  const dispatch = useAppDispatch();
  const isNamingCopy = useAppSelector(selectIsNamingCopy);
  const name = useAppSelector(selectDocumentName);
  const saveWith = useSaveWith();

  function handleSaveACopy(typed: string) {
    dispatch(saveCopyPromptClosed());

    return saveWith((edited) => {
      const fileName = downloadFileName(typed, editedFileName(name));
      downloadBytes(edited, fileName, 'application/pdf');
      return `Saved ${fileName}`;
    });
  }

  return (
    <SaveCopyPrompt
      open={isNamingCopy}
      suggestion={editedFileName(name)}
      onSave={handleSaveACopy}
      onCancel={() => dispatch(saveCopyPromptClosed())}
    />
  );
}
