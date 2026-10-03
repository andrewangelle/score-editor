import { degrees, PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  analysisPriority,
  renderedHeight,
  sameIndices,
  toSourceIndices,
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

describe('analysisPriority', () => {
  // The virtualizer mounts the visible range plus two pages either side.
  function mounted(start: number, end: number, count: number) {
    const items: number[] = [];
    for (
      let i = Math.max(start - 2, 0);
      i <= Math.min(end + 2, count - 1);
      i++
    ) {
      items.push(i);
    }
    return items;
  }

  it('puts the visible pages first, then the overscan nearest to them', () => {
    const range = { startIndex: 5, endIndex: 6 };
    expect(analysisPriority(range, mounted(5, 6, 20), -1)).toEqual([
      5, 6, 7, 4, 8, 3,
    ]);
  });

  it('handles overscan clipped at the top of the list', () => {
    const range = { startIndex: 0, endIndex: 0 };
    expect(analysisPriority(range, mounted(0, 0, 20), -1)).toEqual([0, 1, 2]);
  });

  it('handles overscan clipped at the bottom of the list', () => {
    const range = { startIndex: 9, endIndex: 9 };
    expect(analysisPriority(range, mounted(9, 9, 10), -1)).toEqual([9, 8, 7]);
  });

  it('adds the pinned page last', () => {
    const range = { startIndex: 5, endIndex: 5 };
    const items = withPinned(mounted(5, 5, 20), 15);
    expect(analysisPriority(range, items, 15)).toEqual([5, 6, 4, 7, 3, 15]);
  });

  it('does not repeat a pinned page that is already mounted', () => {
    const range = { startIndex: 5, endIndex: 5 };
    expect(analysisPriority(range, mounted(5, 5, 20), 6)).toEqual([
      5, 6, 4, 7, 3,
    ]);
  });
});

describe('toSourceIndices', () => {
  it('maps to source pages, dropping duplicates and keeping order', () => {
    const pages = [
      { sourceIndex: 0 },
      { sourceIndex: 2 },
      { sourceIndex: 2 },
      { sourceIndex: 1 },
    ];
    expect(toSourceIndices([2, 1, 3, 0], pages)).toEqual([2, 1, 0]);
  });
});

describe('sameIndices', () => {
  it('compares element by element', () => {
    expect(sameIndices([1, 2], [1, 2])).toBe(true);
    expect(sameIndices([1, 2], [2, 1])).toBe(false);
    expect(sameIndices([1], [1, 2])).toBe(false);
  });
});
