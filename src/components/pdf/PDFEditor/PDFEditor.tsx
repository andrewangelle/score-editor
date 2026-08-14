import { ClientOnly } from '@tanstack/react-router';
import { lazy, Suspense, useState } from 'react';
import { PDFDropzone } from '#/components/pdf/PDFDropzone';
import { ErrorMessage } from '#/components/pdf/PDFEditor/ErrorMessage';
import { LoadingViewer } from '#/components/pdf/PDFEditor/LoadingViewer';
import { ScorePartsPanel } from '#/components/pdf/ScorePartsPanel/ScorePartsPanel';
import { ToolbarButton } from '#/components/pdf/ToolbarButton';
import { useAppDispatch, useAppSelector } from '#/hooks';
import { downloadBytes } from '#/lib/download';
import {
  buildEditedPdf,
  editedFileName,
  PdfLoadError,
  readPdfFile,
} from '#/lib/pdf/document';
import {
  documentBytes,
  holdDocumentBytes,
  releaseDocumentBytes,
} from '#/lib/pdf/documentBytes';
import { extractRegions, partFileName } from '#/lib/pdf/partExtraction';
import { DEFAULT_LAYOUT, sortRegions } from '#/lib/pdf/regions';
import { analyzeScore } from '#/lib/pdf/scoreAnalysis';
import { selectAnnotations } from '#/store/annotations.slice';
import {
  allPagesRotated,
  documentClosed,
  documentOpened,
  documentReset,
  selectCanUndo,
  selectDocumentId,
  selectDocumentName,
  selectIsDirty,
  selectPageCount,
  selectPages,
  selectRevision,
  undone,
} from '#/store/document.slice';
import { selectIsManual } from '#/store/regions.slice';
import {
  scoreAnalysed,
  scoreAnalysisFailed,
  selectAnalysis,
  selectAnalysisNote,
  selectKeepMarkings,
  selectSelectedParts,
} from '#/store/score.slice';
import { selectRegions } from '#/store/selectors';

// react-pdf reaches for browser globals at import time, so it must never be
// evaluated during SSR — hence a dynamic import behind ClientOnly.
const PDFViewer = lazy(() =>
  import('../PDFViewer').then((module) => ({ default: module.PDFViewer })),
);

export function PDFEditor() {
  const dispatch = useAppDispatch();
  const documentId = useAppSelector(selectDocumentId);
  const name = useAppSelector(selectDocumentName);
  const pages = useAppSelector(selectPages);
  const pageCount = useAppSelector(selectPageCount);
  const dirty = useAppSelector(selectIsDirty);
  const canUndo = useAppSelector(selectCanUndo);
  const revision = useAppSelector(selectRevision);

  /**
   * The last save, tagged with the document version it described. Any page
   * edit — from here or from the strip — moves the revision on and the banner
   * stops applying, without anything having to go and clear it.
   */
  const [status, setStatus] = useState<{
    message: string;
    revision: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const analysis = useAppSelector(selectAnalysis);
  const analysisNote = useAppSelector(selectAnalysisNote);
  const selectedParts = useAppSelector(selectSelectedParts);

  const regions = useAppSelector(selectRegions);
  const isManual = useAppSelector(selectIsManual);
  const keepMarkings = useAppSelector(selectKeepMarkings);
  const annotations = useAppSelector(selectAnnotations);

  // The store holds the document's identity and edits; the bytes themselves are
  // too large to belong in it, so the id is what fetches them back.
  const bytes = documentBytes(documentId);

  /** Reports a finished save against the document version it wrote out. */
  function reportSaved(message: string) {
    setStatus({ message, revision });
  }

  async function handleFile(file: File) {
    setIsBusy(true);
    setError(null);
    setStatus(null);
    try {
      const loaded = await readPdfFile(file);
      const id = crypto.randomUUID();
      // Hand off the bytes before announcing the document, so anything reacting
      // to the open finds them already in place.
      holdDocumentBytes(id, loaded.bytes);
      dispatch(documentOpened({ id, name: loaded.name, pages: loaded.pages }));
      void analyseScore(id, loaded.bytes);
    } catch (cause) {
      setError(
        cause instanceof PdfLoadError
          ? cause.message
          : `Could not open that file: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setIsBusy(false);
    }
  }

  /**
   * Staff detection runs after the document is already on screen: it is a
   * best-effort enrichment, so a score that cannot be parsed leaves the plain
   * page editor perfectly usable.
   *
   * Nothing here can be cancelled, so the document it was asked about travels
   * with it; the score slice drops an answer that has been overtaken.
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
          message:
            cause instanceof Error
              ? cause.message
              : 'This document could not be analysed as a score.',
        }),
      );
    }
  }

  async function handleExtract() {
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
      const fileName = partFileName(
        name,
        isManual ? [] : selectedParts,
        'regions',
      );
      downloadBytes(extracted, fileName, 'application/pdf');
      reportSaved(`Saved ${fileName}`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Something went wrong while extracting those parts.',
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSave() {
    if (!bytes) return;

    setIsBusy(true);
    setError(null);
    try {
      const edited = await buildEditedPdf(bytes, pages, annotations);
      const fileName = editedFileName(name);
      downloadBytes(edited, fileName, 'application/pdf');
      reportSaved(`Saved ${fileName}`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Something went wrong while saving.',
      );
    } finally {
      setIsBusy(false);
    }
  }

  /**
   * The score, region, annotation and tool slices all reset themselves on
   * `documentClosed`, so this only has to deal with its own banners.
   */
  function handleClose() {
    dispatch(documentClosed());
    releaseDocumentBytes();
    setStatus(null);
    setError(null);
  }

  function rotateLeft() {
    dispatch(allPagesRotated(-90));
  }

  function rotateRight() {
    dispatch(allPagesRotated(90));
  }

  if (!bytes) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-bold text-slate-900">PDF Editor</h1>
        <p className="mt-2 mb-8 text-slate-600">
          Upload a PDF to rotate, reorder, and remove pages. Upload an engraved
          score and you can also split out individual instruments and mark up
          fingerings and performance notes.
        </p>

        <PDFDropzone onFile={handleFile} disabled={isBusy} />

        {isBusy && <p className="mt-4 text-sm text-slate-500">Reading PDF…</p>}

        {error && (
          <p
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="mr-auto min-w-0">
          <h1 className="truncate font-semibold text-slate-900" title={name}>
            {name}
          </h1>
          <p className="text-xs text-slate-500">
            {pageCount} {pageCount === 1 ? 'page' : 'pages'}
            {dirty ? ' · unsaved changes' : ''}
          </p>
        </div>

        <ToolbarButton onClick={rotateLeft}>Rotate all left</ToolbarButton>

        <ToolbarButton onClick={rotateRight}>Rotate all right</ToolbarButton>

        <ToolbarButton onClick={() => dispatch(undone())} disabled={!canUndo}>
          Undo
        </ToolbarButton>

        <ToolbarButton
          onClick={() => dispatch(documentReset())}
          disabled={!dirty}
        >
          Reset
        </ToolbarButton>

        <ToolbarButton onClick={handleClose}>Close</ToolbarButton>

        <button
          type="button"
          onClick={handleSave}
          disabled={isBusy}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isBusy ? 'Saving…' : 'Save PDF'}
        </button>
      </header>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {status && status.revision === revision && (
        <p className="border-b border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          {status.message}
        </p>
      )}

      <main className="flex min-h-0 flex-1">
        <ClientOnly fallback={<LoadingViewer />}>
          <Suspense fallback={<LoadingViewer />}>
            <PDFViewer bytes={bytes} />
          </Suspense>
        </ClientOnly>

        {analysis && !analysisNote && (
          <ScorePartsPanel onExtract={handleExtract} isBusy={isBusy} />
        )}

        {analysisNote && !analysis && (
          <aside className="w-64 shrink-0 border-slate-200 border-l bg-white p-4">
            <h2 className="font-semibold text-slate-900 text-sm">Parts</h2>
            <p className="mt-2 text-slate-500 text-xs">{analysisNote}</p>
          </aside>
        )}

        {/*
          Detection runs after the page is already on screen, and on a dense
          score it takes a moment. Without this the whole side of the window is
          simply empty until it lands, which reads as a panel that never arrives
          rather than one still being worked out.
        */}
        {!analysis && !analysisNote && (
          <aside className="w-64 shrink-0 border-slate-200 border-l bg-white p-4">
            <h2 className="font-semibold text-slate-900 text-sm">Parts</h2>
            <p className="mt-2 text-slate-500 text-xs">Looking for staves…</p>
          </aside>
        )}
      </main>
    </div>
  );
}
