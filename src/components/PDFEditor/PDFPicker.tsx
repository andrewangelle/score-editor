import { PDFDropzone } from '#/components/PDFDropzone/PDFDropzone';
import {
  EDITOR_DESCRIPTION,
  READING_PDF,
  SCORE_EDITOR,
} from '#/components/PDFEditor/PDFEditor.constants';
import {
  INTRO_CONTAINER_CLASS,
  INTRO_ERROR_CLASS,
} from '#/components/PDFEditor/PDFEditor.styles';
import { selectDocumentError, selectIsBusy } from '#/store/document.slice';
import { useAppSelector } from '#/store/hooks';

export function PDFPicker() {
  const isBusy = useAppSelector(selectIsBusy);
  const error = useAppSelector(selectDocumentError);

  return (
    <div data-testid="PDFPicker" className={INTRO_CONTAINER_CLASS}>
      <h1 className="text-3xl font-bold text-slate-900">{SCORE_EDITOR}</h1>
      <p className="mt-2 mb-8 text-slate-600">{EDITOR_DESCRIPTION}</p>

      <PDFDropzone />

      {isBusy && <p className="mt-4 text-sm text-slate-500">{READING_PDF}</p>}

      {error && (
        <p className={INTRO_ERROR_CLASS} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
