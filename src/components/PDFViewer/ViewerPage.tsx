import { memo } from 'react';
import { Page } from 'react-pdf';
import { PageContext } from '#/components/PDFViewer/PageContext';
import {
  PAGE_FRAME_CLASS,
  PAGE_SLOT_CLASS,
} from '#/components/PDFViewer/PDFViewer.styles';
import { RegionLayer } from '#/components/RegionLayer/RegionLayer';
import { ScoreOverlay } from '#/components/ScoreOverlay/ScoreOverlay';
import type { PageEdit } from '#/lib/pdf/document/document';

type ViewerPageProps = {
  index: number;
  page: PageEdit;
  top: number;
  pageWidth: number;
  height: number;
};

/**
 * One page of the continuous view. The frame is sized before the canvas
 * renders, so a page still rasterizing is a blank sheet, never a collapsed box.
 */
export const ViewerPage = memo(function ViewerPage({
  index,
  page,
  top,
  pageWidth,
  height,
}: ViewerPageProps) {
  return (
    <div data-testid="ViewerPage" className={PAGE_SLOT_CLASS} style={{ top }}>
      <section
        aria-label={`Page ${index + 1}`}
        data-page-index={index}
        data-source-index={page.sourceIndex}
        className={PAGE_FRAME_CLASS}
        style={{ width: pageWidth, height }}
      >
        <Page
          pageNumber={page.sourceIndex + 1}
          width={pageWidth}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          loading={null}
          className="isolate"
        />

        <PageContext
          value={{ pageId: page.id, sourceIndex: page.sourceIndex, pageWidth }}
        >
          <ScoreOverlay />
          <RegionLayer />
        </PageContext>
      </section>
    </div>
  );
});
