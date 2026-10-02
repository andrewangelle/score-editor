import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useState } from 'react';

export type PageSize = { width: number; height: number };

type LoadedPageSizes = {
  pdf: PDFDocumentProxy;
  sizes: PageSize[];
};

const NO_SIZES: PageSize[] = [];

/** `getViewport` applies the page's /Rotate, so a turned page reports turned. */
export function loadPageSizes(
  pdf: Pick<PDFDocumentProxy, 'numPages' | 'getPage'>,
): Promise<PageSize[]> {
  return Promise.all(
    Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const { width, height } = page.getViewport({ scale: 1 });
      return { width, height };
    }),
  );
}

/**
 * Every page's size at scale 1, indexed by source index, read from page
 * metadata without rasterizing. Analysis also carries page sizes, but it lands
 * later, and the viewer has to lay out every page before it does.
 */
export function usePageSizes(pdf: PDFDocumentProxy | null): PageSize[] {
  const [loaded, setLoaded] = useState<LoadedPageSizes | null>(null);

  useEffect(() => {
    if (!pdf) {
      return;
    }
    let cancelled = false;

    loadPageSizes(pdf).then((sizes) => {
      if (!cancelled) {
        setLoaded({ pdf, sizes });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pdf]);

  // Sizes from the previous document must never be laid out against this one.
  return loaded && loaded.pdf === pdf ? loaded.sizes : NO_SIZES;
}
