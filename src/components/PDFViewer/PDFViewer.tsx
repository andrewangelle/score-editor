import { useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { PDFPageStrip } from '#/components/PDFPageStrip/PDFPageStrip';
import {
  RENDER_ERROR,
  RENDERING,
  TOOLS_HIDDEN,
} from '#/components/PDFViewer/PDFViewer.constants';
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
import { usePageWidth } from '#/hooks/usePageWidth';
import { useScrollEdgePaging } from '#/hooks/useScrollEdgePaging';
import { WORKER_SRC } from '#/lib/pdf/pdfjsClient';
import type { TurnDirection } from '#/lib/scrollEdgePaging';
import { pageSelected, selectPages } from '#/store/document.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { selectAnalysis, selectParts } from '#/store/score.slice';
import { selectOverlay, selectSelectedPage } from '#/store/selectors';

pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;

type PdfViewerProps = {
  bytes: Uint8Array;
};

export function PDFViewer({ bytes }: PdfViewerProps) {
  const dispatch = useAppDispatch();
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const pageWidth = usePageWidth(stage);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pages = useAppSelector(selectPages);
  const analysis = useAppSelector(selectAnalysis);
  const parts = useAppSelector(selectParts);
  const file = useMemo(() => ({ data: bytes.slice() }), [bytes]);
  const selectedPage = useAppSelector(selectSelectedPage);
  const overlay = useAppSelector((state) => selectOverlay(state, pageWidth));

  function turnPage(direction: TurnDirection) {
    const index = pages.findIndex((page) => page.id === selectedPage?.id);
    const next = pages[index + direction];
    if (index === -1 || !next) return false;

    dispatch(pageSelected(next.id));
    return true;
  }

  useScrollEdgePaging({
    container: stage,
    pageKey: selectedPage?.id ?? null,
    onTurn: turnPage,
  });

  if (loadError) {
    return (
      <p className={VIEWER_ERROR_CLASS} role="alert">
        {RENDER_ERROR}: {loadError}
      </p>
    );
  }

  return (
    <Document
      file={file}
      onLoadError={(error) => setLoadError(error.message)}
      loading={<p className={VIEWER_MESSAGE_CLASS}>{RENDERING}</p>}
      error={
        <p className={VIEWER_ERROR_CLASS} role="alert">
          {RENDER_ERROR}.
        </p>
      }
      className={DOCUMENT_CLASS}
    >
      <nav aria-label="Pages" className={PAGE_NAV_CLASS}>
        <PDFPageStrip />
      </nav>

      <div ref={setStage} className={STAGE_CLASS}>
        {selectedPage && pageWidth && (
          <div className={PAGE_FRAME_CLASS}>
            <Page
              key={selectedPage.id}
              pageNumber={selectedPage.sourceIndex + 1}
              rotate={selectedPage.rotation}
              width={pageWidth}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="isolate"
            />

            {overlay && (
              <>
                <ScoreOverlay
                  pageIndex={selectedPage.sourceIndex}
                  pageHeight={overlay.sourcePage.height}
                  scale={overlay.scale}
                  systems={overlay.sourcePage.systems}
                  parts={parts}
                />
                <RegionLayer
                  pageIndex={selectedPage.sourceIndex}
                  pageWidth={overlay.sourcePage.width}
                  pageHeight={overlay.sourcePage.height}
                  scale={overlay.scale}
                />
              </>
            )}
          </div>
        )}
      </div>

      {analysis && selectedPage && selectedPage.rotation !== 0 && (
        <p className={ROTATED_NOTICE_CLASS}>{TOOLS_HIDDEN}</p>
      )}
    </Document>
  );
}
