import { useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { PDFPageStrip } from '#/components/PDFPageStrip';
import { RegionLayer } from '#/components/RegionLayer';
import { ScoreOverlay } from '#/components/ScoreOverlay';
import { useEdgeScrollPaging } from '#/hooks/useEdgeScrollPaging';
import { useElementWidth } from '#/hooks/useElementWidth';
import type { TurnDirection } from '#/lib/edgeScrollPaging';
import { WORKER_SRC } from '#/lib/pdf/pdfjsClient';
import {
  pageSelected,
  selectPages,
  selectSelectedPageId,
} from '#/store/document.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { selectAnalysis, selectParts } from '#/store/score.slice';

pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;

const MAX_PAGE_WIDTH = 900;

type PdfViewerProps = {
  /** The one thing that cannot come from the store: see `documentBytes`. */
  bytes: Uint8Array;
};

export function PDFViewer({ bytes }: PdfViewerProps) {
  const dispatch = useAppDispatch();
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const stageWidth = useElementWidth(stage);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pages = useAppSelector(selectPages);
  const selectedId = useAppSelector(selectSelectedPageId);
  const analysis = useAppSelector(selectAnalysis);
  const parts = useAppSelector(selectParts);
  const file = useMemo(() => ({ data: bytes.slice() }), [bytes]);

  const selected = pages.find((page) => page.id === selectedId) ?? pages[0];
  const pageWidth = stageWidth
    ? Math.min(stageWidth - 32, MAX_PAGE_WIDTH)
    : undefined;
  const sourcePage = analysis?.pages[selected?.sourceIndex ?? -1];
  const overlay =
    analysis && sourcePage && pageWidth && selected && selected.rotation === 0
      ? { analysis, sourcePage, scale: pageWidth / sourcePage.width }
      : null;

  function turnPage(direction: TurnDirection) {
    const index = pages.findIndex((page) => page.id === selected?.id);
    const next = pages[index + direction];
    if (index === -1 || !next) return false;

    dispatch(pageSelected(next.id));
    return true;
  }

  useEdgeScrollPaging({
    container: stage,
    pageKey: selected?.id ?? null,
    onTurn: turnPage,
  });

  if (loadError) {
    return (
      <p className="p-8 text-red-700 text-sm" role="alert">
        This PDF could not be displayed: {loadError}
      </p>
    );
  }

  return (
    <Document
      file={file}
      onLoadError={(error) => setLoadError(error.message)}
      loading={<p className="p-8 text-slate-500 text-sm">Rendering PDF…</p>}
      error={
        <p className="p-8 text-red-700 text-sm" role="alert">
          This PDF could not be displayed.
        </p>
      }
      className="flex min-h-0 flex-1"
    >
      <nav
        aria-label="Pages"
        className="w-40 shrink-0 overflow-y-auto border-slate-200 border-r bg-slate-100"
      >
        <PDFPageStrip />
      </nav>

      <div
        ref={setStage}
        className="flex-1 overflow-auto overscroll-contain bg-slate-200 p-4"
      >
        {selected && pageWidth ? (
          <div className="relative mx-auto w-fit shadow-lg">
            <Page
              key={selected.id}
              pageNumber={selected.sourceIndex + 1}
              rotate={selected.rotation}
              width={pageWidth}
              // The overlays own this surface, so pdf.js's text and annotation
              // layers have nothing left to do: they cannot be selected through
              // an overlay, and each page view paid for a text-content round
              // trip and a span per text run to build them.
              renderTextLayer={false}
              renderAnnotationLayer={false}
              // Those layers carry z-indexes of their own (2 and 3) while
              // react-pdf's wrapper is `position: relative` with none, so they
              // painted above the overlays and swallowed clicks meant for them.
              // `isolate` keeps that from mattering if either is switched on.
              className="isolate"
            />
            {overlay ? (
              <>
                <ScoreOverlay
                  pageIndex={selected.sourceIndex}
                  pageHeight={overlay.sourcePage.height}
                  scale={overlay.scale}
                  systems={overlay.sourcePage.systems}
                  parts={parts}
                />
                <RegionLayer
                  pageIndex={selected.sourceIndex}
                  pageWidth={overlay.sourcePage.width}
                  pageHeight={overlay.sourcePage.height}
                  scale={overlay.scale}
                />
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {analysis && selected && selected.rotation !== 0 ? (
        <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-slate-900/80 px-3 py-1 text-white text-xs">
          Score tools are hidden while this page is rotated.
        </p>
      ) : null}
    </Document>
  );
}
