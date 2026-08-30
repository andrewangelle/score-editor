import { ClientOnly } from '@tanstack/react-router';
import { lazy, Suspense, useState } from 'react';
import { AnnotationValueMenu } from '#/components/AnnotationValueMenu/AnnotationValueMenu';
import { PDFDropzone } from '#/components/PDFDropzone/PDFDropzone';
import { LoadingViewer } from '#/components/PDFEditor/LoadingViewer';
import {
  EDITOR_DESCRIPTION,
  LOADING_STAVES,
  PARTS,
  READING_PDF,
  RESET,
  ROTATE_LEFT,
  ROTATE_RIGHT,
  SAVE_A_COPY,
  SCORE_EDITOR,
  UNDO,
} from '#/components/PDFEditor/PDFEditor.constants';
import {
  ERROR_MESSAGE_CLASS,
  HEADER_CLASS,
  INTRO_CONTAINER_CLASS,
  INTRO_ERROR_CLASS,
  PARTS_ASIDE_CLASS,
  SAVE_BUTTON_CLASS,
  STATUS_DISMISS_BUTTON_CLASS,
  STATUS_MESSAGE_CLASS,
} from '#/components/PDFEditor/PDFEditor.styles';
import {
  getAnalyseScoreError,
  getExtractError,
  getFileHandleError,
  getSaveButtonCTA,
  getSaveButtonTitle,
  getSaveError,
} from '#/components/PDFEditor/PDFEditor.utils';
import { SaveCopyPrompt } from '#/components/PDFEditor/SaveCopyPrompt';
import { ScorePartsPanel } from '#/components/ScorePartsPanel/ScorePartsPanel';
import { ToolbarButton } from '#/components/ToolbarButton/ToolbarButton';
import { downloadBytes } from '#/lib/download';
import {
  buildEditedPdf,
  downloadFileName,
  editedFileName,
  readPdfFile,
} from '#/lib/pdf/document';
import {
  documentBytes,
  documentFileHandle,
  holdDocumentBytes,
  releaseDocumentBytes,
} from '#/lib/pdf/documentBytes';
import type { EditorState } from '#/lib/pdf/editorState';
import { type PdfFileHandle, writePdfFile } from '#/lib/pdf/fileAccess';
import { extractRegions, partFileName } from '#/lib/pdf/partExtraction';
import { DEFAULT_LAYOUT, sortRegions } from '#/lib/pdf/regions';
import { analyzeScore } from '#/lib/pdf/scoreAnalysis';
import { selectAnnotations } from '#/store/annotations.slice';
import {
  allPagesRotated,
  documentClosed,
  documentFileReplaced,
  documentOpened,
  documentReset,
  documentRestored,
  documentSaved,
  selectCanUndo,
  selectDocumentId,
  selectDocumentName,
  selectHasUnsavedChanges,
  selectIsDirty,
  selectPageCount,
  selectPages,
  selectRevision,
  undone,
} from '#/store/document.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { selectIsManual } from '#/store/regions.slice';
import {
  scoreAnalysed,
  scoreAnalysisFailed,
  selectAnalysis,
  selectAnalysisNote,
  selectKeepMarkings,
  selectSelectedParts,
} from '#/store/score.slice';
import { selectEditorState, selectRegions } from '#/store/selectors';

// react-pdf reaches for browser globals at import time, so it must never be
// evaluated during SSR — hence a dynamic import behind ClientOnly.
const PDFViewer = lazy(() =>
  import('../PDFViewer/PDFViewer').then((module) => ({
    default: module.PDFViewer,
  })),
);

export function PDFEditor() {
  const dispatch = useAppDispatch();
  const documentId = useAppSelector(selectDocumentId);
  const name = useAppSelector(selectDocumentName);
  const pages = useAppSelector(selectPages);
  const pageCount = useAppSelector(selectPageCount);
  const dirty = useAppSelector(selectIsDirty);
  const unsaved = useAppSelector(selectHasUnsavedChanges);
  const canUndo = useAppSelector(selectCanUndo);
  const revision = useAppSelector(selectRevision);

  /** The last save, tagged with the document version it described. */
  const [status, setStatus] = useState<{
    message: string;
    revision: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isNamingCopy, setNamingCopy] = useState(false);
  const analysis = useAppSelector(selectAnalysis);
  const analysisNote = useAppSelector(selectAnalysisNote);
  const selectedParts = useAppSelector(selectSelectedParts);
  const regions = useAppSelector(selectRegions);
  const isManual = useAppSelector(selectIsManual);
  const keepMarkings = useAppSelector(selectKeepMarkings);
  const annotations = useAppSelector(selectAnnotations);
  const editorState: EditorState = useAppSelector(selectEditorState);
  const bytes = documentBytes(documentId);
  const fileHandle = documentFileHandle(documentId);

  function reportSaved(message: string) {
    setStatus({ message, revision });
  }

  async function handleFile(file: File, handle: PdfFileHandle | null) {
    setIsBusy(true);
    setError(null);
    setStatus(null);
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
      setError(getFileHandleError(cause));
    } finally {
      setIsBusy(false);
    }
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

  /** Cuts the regions and hands the result to `write`. */
  async function extractWith(
    write: (extracted: Uint8Array) => Promise<string> | string,
  ) {
    if (!bytes || !analysis) return;

    setIsBusy(true);
    setError(null);
    try {
      const extracted = await extractRegions(
        bytes,
        sortRegions(regions),
        analysis.pages[0],
        { annotations, layout: { ...DEFAULT_LAYOUT, keepMarkings } },
      );
      reportSaved(await write(extracted));
    } catch (cause) {
      setError(getExtractError(cause));
    } finally {
      setIsBusy(false);
    }
  }

  /** Downloads the cut regions, leaving the score where it is. */
  function handleExtract() {
    return extractWith((extracted) => {
      const fileName = partFileName(
        name,
        isManual ? [] : selectedParts,
        'regions',
      );
      downloadBytes(extracted, fileName, 'application/pdf');
      return `Saved ${fileName}`;
    });
  }

  /**
   * Replaces the opened file with the cut regions — the one action here that
   * destroys something on disk. The score stays open in memory so the regions
   * can be adjusted and written again, but the file no longer holds it, which
   * is what `documentFileReplaced` records.
   */
  function handleExtractToFile() {
    if (!fileHandle) return;

    return extractWith(async (extracted) => {
      await writePdfFile(fileHandle, extracted);
      dispatch(documentFileReplaced());
      const count = regions.length;
      return `Replaced ${fileHandle.name} with ${count} ${count === 1 ? 'region' : 'regions'}`;
    });
  }

  /**
   * Writes the edited document out. Builds from the pristine upload rather than
   * whatever was last written, which is what lets the same file be saved over
   * repeatedly without edits compounding.
   */
  async function saveWith(
    write: (edited: Uint8Array) => Promise<string> | string,
  ) {
    if (!bytes) return;

    setIsBusy(true);
    setError(null);
    try {
      reportSaved(
        await write(
          await buildEditedPdf(bytes, pages, annotations, {
            marks: 'objects',
            state: editorState,
          }),
        ),
      );
    } catch (cause) {
      setError(getSaveError(cause));
    } finally {
      setIsBusy(false);
    }
  }

  function handleSaveToFile() {
    if (!fileHandle) return;

    return saveWith(async (edited) => {
      await writePdfFile(fileHandle, edited);
      dispatch(documentSaved());
      return `Saved to ${fileHandle.name}`;
    });
  }

  /** Leaves the original alone and downloads an edited copy beside it. */
  function handleSaveACopy(typed: string) {
    setNamingCopy(false);

    return saveWith((edited) => {
      const fileName = downloadFileName(typed, editedFileName(name));
      downloadBytes(edited, fileName, 'application/pdf');
      return `Saved ${fileName}`;
    });
  }

  function handleClose() {
    dispatch(documentClosed());
    releaseDocumentBytes();
    setStatus(null);
    setError(null);
    setNamingCopy(false);
  }

  function rotateLeft() {
    dispatch(allPagesRotated(-90));
  }

  function rotateRight() {
    dispatch(allPagesRotated(90));
  }

  if (!bytes) {
    return (
      <div className={INTRO_CONTAINER_CLASS}>
        <h1 className="text-3xl font-bold text-slate-900">{SCORE_EDITOR}</h1>
        <p className="mt-2 mb-8 text-slate-600">{EDITOR_DESCRIPTION}</p>

        <PDFDropzone onFile={handleFile} onError={setError} disabled={isBusy} />

        {isBusy && <p className="mt-4 text-sm text-slate-500">{READING_PDF}</p>}

        {error && (
          <p className={INTRO_ERROR_CLASS} role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header className={HEADER_CLASS}>
        <div className="mr-auto min-w-0">
          <h1 className="truncate font-semibold text-slate-900" title={name}>
            {name}
          </h1>
          <p className="text-xs text-slate-500">
            {pageCount} {pageCount === 1 ? 'page' : 'pages'}
            {unsaved ? ' · unsaved changes' : ''}
          </p>
        </div>

        <ToolbarButton onClick={rotateLeft}>{ROTATE_LEFT}</ToolbarButton>

        <ToolbarButton onClick={rotateRight}>{ROTATE_RIGHT}</ToolbarButton>

        <ToolbarButton onClick={() => dispatch(undone())} disabled={!canUndo}>
          {UNDO}
        </ToolbarButton>

        <ToolbarButton
          onClick={() => dispatch(documentReset())}
          disabled={!dirty}
        >
          {RESET}
        </ToolbarButton>

        <ToolbarButton onClick={handleClose}>Close</ToolbarButton>

        {fileHandle && (
          <ToolbarButton
            onClick={() => setNamingCopy(true)}
            disabled={isBusy || isNamingCopy}
          >
            {SAVE_A_COPY}
          </ToolbarButton>
        )}

        <button
          type="button"
          onClick={fileHandle ? handleSaveToFile : () => setNamingCopy(true)}
          disabled={isBusy || (!fileHandle && isNamingCopy)}
          title={getSaveButtonTitle(fileHandle)}
          className={SAVE_BUTTON_CLASS}
        >
          {getSaveButtonCTA(isBusy, fileHandle)}
        </button>
      </header>

      <AnnotationValueMenu />

      <SaveCopyPrompt
        open={isNamingCopy}
        suggestion={editedFileName(name)}
        onSave={handleSaveACopy}
        onCancel={() => setNamingCopy(false)}
      />

      {error && (
        <p className={ERROR_MESSAGE_CLASS} role="alert">
          {error}
        </p>
      )}

      {status && status.revision === revision && (
        <div className={STATUS_MESSAGE_CLASS} role="status">
          <p className="min-w-0 flex-1 truncate">{status.message}</p>

          <button
            type="button"
            onClick={() => setStatus(null)}
            title="Dismiss"
            aria-label="Dismiss"
            className={STATUS_DISMISS_BUTTON_CLASS}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              className="size-3.5"
            >
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
        </div>
      )}

      <main className="flex min-h-0 flex-1">
        <ClientOnly fallback={<LoadingViewer />}>
          <Suspense fallback={<LoadingViewer />}>
            <PDFViewer bytes={bytes} />
          </Suspense>
        </ClientOnly>

        {analysis && !analysisNote && (
          <ScorePartsPanel
            onExtract={handleExtract}
            replaceTarget={
              fileHandle
                ? { name: fileHandle.name, onReplace: handleExtractToFile }
                : null
            }
            isBusy={isBusy}
          />
        )}

        {analysisNote && !analysis && (
          <aside className={PARTS_ASIDE_CLASS}>
            <h2 className="font-semibold text-slate-900 text-sm">{PARTS}</h2>
            <p className="mt-2 text-slate-500 text-xs">{analysisNote}</p>
          </aside>
        )}

        {!analysis && !analysisNote && (
          <aside className={PARTS_ASIDE_CLASS}>
            <h2 className="font-semibold text-slate-900 text-sm">{PARTS}</h2>
            <p className="mt-2 text-slate-500 text-xs">{LOADING_STAVES}</p>
          </aside>
        )}
      </main>
    </div>
  );
}
