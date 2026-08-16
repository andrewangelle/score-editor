import { useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { PDFPageStrip } from '#/components/PDFPageStrip';
import { RegionLayer } from '#/components/RegionLayer';
import { ScoreOverlay } from '#/components/ScoreOverlay';
import { useAppSelector } from '#/hooks';
import { WORKER_SRC } from '#/lib/pdf/pdfjsClient';
import { useElementWidth } from '#/lib/useElementWidth';
import { selectPages, selectSelectedPageId } from '#/store/document.slice';
import { selectAnalysis } from '#/store/score.slice';

pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;

const MAX_PAGE_WIDTH = 900;

type PdfViewerProps = {
  /** The one thing that cannot come from the store: see `documentBytes`. */
  bytes: Uint8Array;
};

export function PDFViewer({ bytes }: PdfViewerProps) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const stageWidth = useElementWidth(stage);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pages = useAppSelector(selectPages);
  const selectedId = useAppSelector(selectSelectedPageId);
  // Only detection's page geometry is needed here; the layers read the rest.
  const analysis = useAppSelector(selectAnalysis);

  // pdf.js detaches the buffer it is handed, so it gets a dedicated copy and the
  // pristine `bytes` stay usable by pdf-lib when the user saves. Memoized because
  // a new `file` identity would make react-pdf reload the document every render.
  const file = useMemo(() => ({ data: bytes.slice() }), [bytes]);

  const selected = pages.find((page) => page.id === selectedId) ?? pages[0];
  const pageWidth = stageWidth
    ? Math.min(stageWidth - 32, MAX_PAGE_WIDTH)
    : undefined;

  const sourcePage = analysis?.pages[selected?.sourceIndex ?? -1];
  // The overlay maps PDF points to pixels, which only holds while the page is
  // upright; a rotated page would need the transform composed in as well.
  const overlay =
    analysis && sourcePage && pageWidth && selected && selected.rotation === 0
      ? { analysis, sourcePage, scale: pageWidth / sourcePage.width }
      : null;

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

      <div ref={setStage} className="flex-1 overflow-auto bg-slate-200 p-4">
        {selected && pageWidth ? (
          <div className="relative mx-auto w-fit shadow-lg">
            <Page
              key={selected.id}
              pageNumber={selected.sourceIndex + 1}
              rotate={selected.rotation}
              width={pageWidth}
              // The overlays below own this surface, so pdf.js's own text and
              // annotation layers have nothing left to do here: they cannot be
              // selected through an overlay, and each page view was paying for a
              // text-content round trip and a span per text run, thrown away
              // again on the next page. The page strip has always been rendered
              // this way.
              renderTextLayer={false}
              renderAnnotationLayer={false}
              // Those layers carry z-indexes of their own (2 and 3) while
              // react-pdf's wrapper is `position: relative` with none, so they
              // used to paint above the overlays and swallow every click meant
              // for them. `isolate` keeps that from mattering again if either
              // layer is ever switched back on.
              className="isolate"
            />
            {overlay ? (
              <>
                <ScoreOverlay
                  pageIndex={selected.sourceIndex}
                  pageHeight={overlay.sourcePage.height}
                  scale={overlay.scale}
                  systems={overlay.sourcePage.systems}
                  parts={overlay.analysis.parts}
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
