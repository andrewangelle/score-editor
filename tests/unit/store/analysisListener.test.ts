import type {
  ScoreAnalysis,
  ScoreDocument,
} from '#/lib/pdf/analysis/analysis.score';
import type { PageStaves, PdfOps } from '#/lib/pdf/staffDetection';
import { makeStore } from '#/store';
import { documentClosed, documentOpened } from '#/store/document.slice';
import {
  analysisPrioritised,
  partToggled,
  scorePageAnalysed,
} from '#/store/score.slice';

type Gate = {
  documentId: string;
  index: number;
  resolve: () => void;
  reject: (cause: Error) => void;
};

function detectedPage(pageIndex: number): PageStaves {
  return {
    pageIndex,
    width: 612,
    height: 792,
    systems: [],
    ink: [],
    frames: [],
    text: [],
  };
}

/** Lets the runner's `delay(0)` and the awaits around it play out. */
async function settle() {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const PARTS = [
  { id: 'part-0', ordinal: 0, name: 'Flute' },
  { id: 'part-1', ordinal: 1, name: 'Cello' },
];

/**
 * A store whose runner analyses fake documents. In manual mode every
 * `analyzePage` waits until the test releases it. The first staves are on
 * `stavesFrom`, so parts resolve once every page up to it is in.
 */
function setup(
  pageCounts: Record<string, number>,
  { manual = false, stavesFrom = 0 } = {},
) {
  const bytesById = new Map<string, Uint8Array>();
  const idOf = new Map<Uint8Array | ScoreDocument, string>();
  for (const id of Object.keys(pageCounts)) {
    const bytes = new Uint8Array([bytesById.size]);
    bytesById.set(id, bytes);
    idOf.set(bytes, id);
  }

  const analysed: { documentId: string; index: number }[] = [];
  const gates: Gate[] = [];
  const destroyed: string[] = [];
  const finished: { documentId: string; detected: readonly PageStaves[] }[] =
    [];
  const opened = vi.fn();

  const store = makeStore({
    documentBytes: (id) => (id === null ? null : (bytesById.get(id) ?? null)),

    async openScoreDocument(bytes) {
      const documentId = idOf.get(bytes) as string;
      opened(documentId);
      const doc: ScoreDocument = {
        numPages: pageCounts[documentId],
        getPage: () => Promise.reject(new Error('not used by the fake')),
        ops: {} as PdfOps,
        destroy: async () => {
          destroyed.push(documentId);
        },
      };
      idOf.set(doc, documentId);
      return doc;
    },

    analyzePage(doc, index) {
      const documentId = idOf.get(doc) as string;
      analysed.push({ documentId, index });
      if (!manual) {
        return Promise.resolve(detectedPage(index));
      }

      return new Promise((resolve, reject) => {
        gates.push({
          documentId,
          index,
          resolve: () => resolve(detectedPage(index)),
          reject,
        });
      });
    },

    async resolveParts(_doc, pages) {
      return pages.some((page) => page.pageIndex === stavesFrom) ? PARTS : null;
    },

    async finishAnalysis(doc, detected): Promise<ScoreAnalysis> {
      const documentId = idOf.get(doc) as string;
      finished.push({ documentId, detected });
      return {
        pages: detected.map((page) => ({
          pageIndex: page.pageIndex,
          width: page.width,
          height: page.height,
          systems: page.systems,
          markings: [],
        })),
        parts: PARTS,
        irregularSystems: [],
      };
    },
  });

  // Integer keys enumerate in numeric order, so arrival order is tracked here.
  const arrivals: number[] = [];
  store.subscribe(() => {
    for (const key of Object.keys(store.getState().score.pages)) {
      if (!arrivals.includes(Number(key))) {
        arrivals.push(Number(key));
      }
    }
  });

  function open(id: string) {
    arrivals.length = 0;
    store.dispatch(documentOpened({ id, name: `${id}.pdf`, pages: [] }));
  }

  async function release(index: number, documentId?: string) {
    const gate = gates.find(
      (g) =>
        g.index === index &&
        (documentId === undefined || g.documentId === documentId),
    );
    if (!gate) {
      throw new Error(`page ${index} is not waiting`);
    }
    gates.splice(gates.indexOf(gate), 1);
    gate.resolve();
    await settle();
  }

  async function fail(index: number, cause: Error) {
    const gate = gates.find((g) => g.index === index);
    if (!gate) {
      throw new Error(`page ${index} is not waiting`);
    }
    gates.splice(gates.indexOf(gate), 1);
    gate.reject(cause);
    await settle();
  }

  return {
    store,
    open,
    release,
    fail,
    analysed,
    arrivals,
    destroyed,
    finished,
    opened,
  };
}

describe('the analysis runner', () => {
  it('caches pages in priority order, then outward from it', async () => {
    const { store, open, arrivals } = setup({ doc: 5 });

    open('doc');
    store.dispatch(analysisPrioritised([2]));
    await settle();

    // Page 0 jumps the queue only because the part list waits on it.
    expect(arrivals).toEqual([2, 0, 3, 1, 4]);
    expect(store.getState().score.analysis).not.toBeNull();
  });

  it('reads up from the first page until parts are found', async () => {
    const { store, open, arrivals } = setup({ doc: 6 }, { stavesFrom: 2 });

    open('doc');
    store.dispatch(analysisPrioritised([4]));
    await settle();

    expect(arrivals).toEqual([4, 0, 1, 2, 5, 3]);
  });

  it('detects parts before the last page, once the first staves are in', async () => {
    const { store, open, release } = setup(
      { doc: 4 },
      { manual: true, stavesFrom: 1 },
    );

    open('doc');
    await settle();
    await release(0);
    expect(store.getState().score.parts).toBeNull();

    await release(1);
    expect(store.getState().score.parts).toEqual(PARTS);
    expect(store.getState().score.selectedOrdinals).toEqual([0, 1]);
    expect(store.getState().score.analysis).toBeNull();
  });

  it('keeps a selection made before analysis completes', async () => {
    const { store, open, release } = setup({ doc: 2 }, { manual: true });

    open('doc');
    await settle();
    await release(0);
    store.dispatch(partToggled(0));
    await release(1);

    expect(store.getState().score.analysis).not.toBeNull();
    expect(store.getState().score.selectedOrdinals).toEqual([1]);
  });

  it('leaves parts to the final pass when no page has staves', async () => {
    const { store, open, release } = setup(
      { doc: 2 },
      { manual: true, stavesFrom: -1 },
    );

    open('doc');
    await settle();
    await release(0);
    expect(store.getState().score.parts).toBeNull();

    await release(1);
    expect(store.getState().score.parts).toEqual(PARTS);
  });

  it('reports the total before any page lands', async () => {
    const { store, open } = setup({ doc: 3 }, { manual: true });

    open('doc');
    await settle();

    expect(store.getState().score.pageCount).toBe(3);
    expect(store.getState().score.pages).toEqual({});
  });

  it('never analyses a page twice, even when the priority changes', async () => {
    const { store, open, release, analysed } = setup(
      { doc: 5 },
      { manual: true },
    );

    open('doc');
    await settle();
    store.dispatch(analysisPrioritised([3]));
    await release(0);
    store.dispatch(analysisPrioritised([0, 3]));
    await release(3);
    await release(1);
    store.dispatch(analysisPrioritised([3]));
    await release(4);
    await release(2);

    const order = analysed.map(({ index }) => index);
    expect(order).toEqual([0, 3, 1, 4, 2]);
    expect(store.getState().score.analysis).not.toBeNull();
  });

  it('still analyses a page the store already holds', async () => {
    const { store, open, analysed, finished } = setup({ doc: 3 });

    open('doc');
    store.dispatch(
      scorePageAnalysed({
        documentId: 'doc',
        page: { ...detectedPage(1), markings: [] },
      }),
    );
    await settle();

    expect(analysed.map(({ index }) => index).sort()).toEqual([0, 1, 2]);
    expect(finished[0].detected.map((page) => page.pageIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(store.getState().score.analysis).not.toBeNull();
    expect(store.getState().score.note).toBeNull();
  });

  it('runs the document-wide pass once, after the last page', async () => {
    const { store, open, release, finished } = setup(
      { doc: 3 },
      { manual: true },
    );

    open('doc');
    await settle();
    await release(0);
    await release(1);

    expect(finished).toHaveLength(0);
    expect(store.getState().score.analysis).toBeNull();

    await release(2);

    expect(finished).toHaveLength(1);
    expect(store.getState().score.analysis?.pages).toHaveLength(3);
  });

  it('stops when another document is opened', async () => {
    const { store, open, release, analysed, destroyed, finished } = setup(
      { first: 3, second: 2 },
      { manual: true },
    );

    open('first');
    await settle();
    await release(0, 'first');
    open('second');
    await settle();
    await release(1, 'first');

    expect(destroyed).toContain('first');
    expect(
      analysed.filter(({ documentId }) => documentId === 'first'),
    ).toHaveLength(2);
    expect(store.getState().score.pages[1]).toBeUndefined();

    await release(0, 'second');
    await release(1, 'second');

    expect(finished.map(({ documentId }) => documentId)).toEqual(['second']);
    expect(store.getState().score.documentId).toBe('second');
    expect(store.getState().score.analysis).not.toBeNull();
  });

  it('stops when the document is closed', async () => {
    const { store, open, release, analysed, destroyed, finished } = setup(
      { doc: 3 },
      { manual: true },
    );

    open('doc');
    await settle();
    store.dispatch(documentClosed());
    await release(0);

    expect(analysed).toHaveLength(1);
    expect(destroyed).toEqual(['doc']);
    expect(finished).toHaveLength(0);
    expect(store.getState().score.pages).toEqual({});
  });

  it('fails the document when a page cannot be analysed', async () => {
    const { store, open, release, fail, destroyed } = setup(
      { doc: 3 },
      { manual: true },
    );

    open('doc');
    await settle();
    await release(0);
    expect(store.getState().score.pages[0]).toBeDefined();

    await fail(1, new Error('too many drawing layers'));

    expect(store.getState().score.note).toBe('too many drawing layers');
    expect(store.getState().score.analysis).toBeNull();
    expect(store.getState().score.pages).toEqual({});
    expect(destroyed).toEqual(['doc']);
  });

  it('fails the document when it cannot be opened', async () => {
    const broken = makeStore({
      documentBytes: () => new Uint8Array(),
      openScoreDocument: () => Promise.reject(new Error('Invalid PDF')),
    });
    broken.dispatch(documentOpened({ id: 'doc', name: 'x.pdf', pages: [] }));
    await settle();

    expect(broken.getState().score.note).toBe('Invalid PDF');
  });

  it('does nothing for a document whose bytes are not held', async () => {
    const { store, opened } = setup({});

    store.dispatch(documentOpened({ id: 'unheld', name: 'x.pdf', pages: [] }));
    await settle();

    const score = store.getState().score;
    expect(opened).not.toHaveBeenCalled();
    expect(score.pageCount).toBeNull();
    expect(score.pages).toEqual({});
    expect(score.analysis).toBeNull();
    expect(score.note).toBeNull();
  });
});
