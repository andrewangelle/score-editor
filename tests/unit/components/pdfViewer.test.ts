import { degrees, PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  renderedHeight,
  withPinned,
} from '#/components/PDFViewer/PDFViewer.utils';
import { loadPageSizes } from '#/hooks/usePageSizes';

const A4 = { width: 595, height: 842 };

describe('renderedHeight', () => {
  it('scales the height by the same factor as the width', () => {
    expect(renderedHeight(A4, 595)).toBe(842);
    expect(renderedHeight(A4, 900)).toBeCloseTo(1273.61, 2);
  });

  it('makes a landscape page shorter than it is wide', () => {
    const landscape = { width: A4.height, height: A4.width };
    expect(renderedHeight(landscape, 900)).toBeLessThan(900);
  });
});

describe('loadPageSizes', () => {
  async function load(build: (doc: PDFDocument) => void) {
    const doc = await PDFDocument.create();
    build(doc);
    const pdf = await pdfjs.getDocument({
      data: await doc.save(),
      isEvalSupported: false,
    }).promise;
    try {
      return await loadPageSizes(pdf);
    } finally {
      await pdf.destroy();
    }
  }

  it('returns every page, indexed by source index', async () => {
    const sizes = await load((doc) => {
      doc.addPage([A4.width, A4.height]);
      doc.addPage([A4.height, A4.width]);
    });

    expect(sizes).toEqual([A4, { width: A4.height, height: A4.width }]);
  });

  it('reports a /Rotate page as it is displayed', async () => {
    const sizes = await load((doc) => {
      doc.addPage([A4.width, A4.height]).setRotation(degrees(90));
    });

    expect(sizes).toEqual([{ width: A4.height, height: A4.width }]);
  });
});

describe('withPinned', () => {
  it('leaves the range alone when nothing is pinned', () => {
    const range = [2, 3, 4];
    expect(withPinned(range, -1)).toBe(range);
  });

  it('does not repeat a pinned page already in range', () => {
    expect(withPinned([2, 3, 4], 3)).toEqual([2, 3, 4]);
  });

  it('keeps the range ascending, whichever side the pin is on', () => {
    expect(withPinned([5, 6, 7], 1)).toEqual([1, 5, 6, 7]);
    expect(withPinned([0, 1, 2], 9)).toEqual([0, 1, 2, 9]);
  });
});
