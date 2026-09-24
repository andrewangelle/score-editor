import {
  type ChangeEvent,
  type DragEvent,
  useId,
  useRef,
  useState,
} from 'react';
import {
  CHOOSE_FILE,
  CHOOSE_FILE_DISCLAIMER,
  DROP_INSTRUCTION_DESCRIPTION,
  DROP_INSTRUCTION_HEADING,
} from '#/components/PDFDropzone/PDFDropzone.constants';
import {
  CHOOSE_FILE_BUTTON_CLASS,
  CHOOSE_FILE_INPUT_LABEL_CLASS,
  getDragContainerStyles,
} from '#/components/PDFDropzone/PDFDropzone.styles';
import {
  getAnalyseScoreError,
  getFileHandleError,
  getFileOpenErrorMessage,
} from '#/components/PDFDropzone/PDFDropzone.utils';
import { readPdfFile } from '#/lib/pdf/document/document';
import { holdDocumentBytes } from '#/lib/pdf/document/document.bytes';
import {
  droppedFileHandle,
  type PdfFileHandle,
  pickPdfFile,
  supportsInPlaceSave,
} from '#/lib/pdf/fileAccess';
import { analyzeScore } from '#/lib/pdf/scoreAnalysis';
import {
  documentErrorReported,
  documentOpened,
  documentRestored,
  documentWorkFinished,
  documentWorkStarted,
  selectIsBusy,
} from '#/store/document.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { scoreAnalysed, scoreAnalysisFailed } from '#/store/score.slice';

export function PDFDropzone() {
  const dispatch = useAppDispatch();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const [canPick] = useState(supportsInPlaceSave);
  const isBusy = useAppSelector(selectIsBusy);

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);

    if (isBusy) {
      return;
    }

    const file = event.dataTransfer.files.item(0);
    if (!file) {
      return;
    }

    const item = event.dataTransfer.items[0];
    handleFile(file, await droppedFileHandle(item));
  }

  async function handlePick() {
    try {
      const picked = await pickPdfFile();
      if (picked) {
        handleFile(picked.file, picked.handle);
      }
    } catch (cause) {
      reportError(getFileOpenErrorMessage(cause));
    }
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();

    dragDepth.current += 1;

    if (!isBusy) {
      setIsDragging(true);
    }
  }

  function onDragLeave(_event: DragEvent<HTMLDivElement>) {
    dragDepth.current -= 1;

    if (dragDepth.current <= 0) {
      setIsDragging(false);
    }
  }

  function onInputChange(
    event: ChangeEvent<HTMLInputElement, HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (file) {
      handleFile(file, null);
    }

    // reset after handling
    event.target.value = '';
  }

  /**
   * Runs after the document is on screen: a best-effort enrichment, so a score
   * that cannot be parsed leaves the plain page editor usable.
   */
  async function analyseScore(id: string, source: Uint8Array) {
    try {
      dispatch(
        scoreAnalysed({ documentId: id, analysis: await analyzeScore(source) }),
      );
    } catch (cause) {
      dispatch(
        scoreAnalysisFailed({
          documentId: id,
          message: getAnalyseScoreError(cause),
        }),
      );
    }
  }

  function reportError(message: string) {
    dispatch(documentErrorReported(message));
  }

  async function handleFile(file: File, handle: PdfFileHandle | null) {
    dispatch(documentWorkStarted());
    try {
      const loaded = await readPdfFile(file);
      const id = crypto.randomUUID();

      // Hand off the bytes before announcing the document
      holdDocumentBytes(id, loaded.bytes, handle);
      dispatch(documentOpened({ id, name: loaded.name, pages: loaded.pages }));

      // Strictly after the open: every slice empties itself on that.
      if (loaded.annotations.length > 0 || loaded.state) {
        dispatch(
          documentRestored({
            annotations: loaded.annotations,
            state: loaded.state,
          }),
        );
      }
      void analyseScore(id, loaded.bytes);
    } catch (cause) {
      reportError(getFileHandleError(cause));
    } finally {
      dispatch(documentWorkFinished());
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target wraps a real file input, which carries the accessible affordance.
    <div
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={handleDrop}
      className={getDragContainerStyles(isDragging, isBusy)}
    >
      <p className="text-lg font-medium text-slate-800">
        {DROP_INSTRUCTION_HEADING}
      </p>

      <p className="text-sm text-slate-500">{DROP_INSTRUCTION_DESCRIPTION}</p>

      {canPick && (
        <button
          type="button"
          onClick={handlePick}
          disabled={isBusy}
          className={CHOOSE_FILE_BUTTON_CLASS}
        >
          {CHOOSE_FILE}
        </button>
      )}

      {!canPick && (
        <>
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={isBusy}
            onChange={onInputChange}
          />
          <label htmlFor={inputId} className={CHOOSE_FILE_INPUT_LABEL_CLASS}>
            {CHOOSE_FILE}
          </label>
        </>
      )}

      <p className="mt-2 text-slate-400 text-xs">{CHOOSE_FILE_DISCLAIMER}</p>
    </div>
  );
}
