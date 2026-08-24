import { useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { PDFPageStrip } from '#/components/PDFPageStrip/PDFPageStrip';
import {
  DOCUMENT_CLASS,
  PAGE_FRAME_CLASS,
  PAGE_NAV_CLASS,
  ROTATED_NOTICE_CLASS,
  STAGE_CLASS,
  VIEWER_ERROR_CLASS,
  VIEWER_MESSAGE_CLASS,
} from '#/components/PDFViewer/PDFViewer.styles';
import { RegionLayer } from '#/components/RegionLayer/RegionLayer';
import { ScoreOverlay } from '#/components/ScoreOverlay/ScoreOverlay';
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
      <p className={VIEWER_ERROR_CLASS} role="alert">
        This PDF could not be displayed: {loadError}
      </p>
    );
  }

  return (
    <Document
      file={file}
      onLoadError={(error) => setLoadError(error.message)}
      loading={<p className={VIEWER_MESSAGE_CLASS}>Rendering PDF…</p>}
      error={
        <p className={VIEWER_ERROR_CLASS} role="alert">
          This PDF could not be displayed.
        </p>
      }
      className={DOCUMENT_CLASS}
    >
      <nav aria-label="Pages" className={PAGE_NAV_CLASS}>
        <PDFPageStrip />
      </nav>

      <div ref={setStage} className={STAGE_CLASS}>
        {selected && pageWidth ? (
          <div className={PAGE_FRAME_CLASS}>
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
        <p className={ROTATED_NOTICE_CLASS}>
          Score tools are hidden while this page is rotated.
        </p>
      ) : null}
    </Document>
  );
}
