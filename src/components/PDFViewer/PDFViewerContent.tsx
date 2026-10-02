import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useMemo, useState } from 'react';
import { Document, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { PDFPageStrip } from '#/components/PDFPageStrip/PDFPageStrip';
import { PageList } from '#/components/PDFViewer/PageList';
import {
  RENDER_ERROR,
  RENDERING,
} from '#/components/PDFViewer/PDFViewer.constants';
import {
  DOCUMENT_CLASS,
  PAGE_NAV_CLASS,
  STAGE_CLASS,
  VIEWER_ERROR_CLASS,
  VIEWER_MESSAGE_CLASS,
} from '#/components/PDFViewer/PDFViewer.styles';
import { usePageSizes } from '#/hooks/usePageSizes';
import { usePageWidth } from '#/hooks/usePageWidth';
import { WORKER_SRC } from '#/lib/pdf/pdfjsClient';

pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;

type PdfViewerProps = {
  bytes: Uint8Array;
};

export function PDFViewerContent({ bytes }: PdfViewerProps) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const pageWidth = usePageWidth(stage);
  const sizes = usePageSizes(pdf);
  const [loadError, setLoadError] = useState<string | null>(null);
  const file = useMemo(() => ({ data: bytes.slice() }), [bytes]);
  const isLaidOut = pdf !== null && sizes.length === pdf.numPages;
  const isReady = stage && pageWidth && isLaidOut;

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
      onLoadSuccess={setPdf}
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

      <div ref={setStage} data-testid="ViewerStage" className={STAGE_CLASS}>
        {isReady && (
          <PageList stage={stage} sizes={sizes} pageWidth={pageWidth} />
        )}

        {!isReady && <p className={VIEWER_MESSAGE_CLASS}>{RENDERING}</p>}
      </div>
    </Document>
  );
}
