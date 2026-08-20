import { createAnnotation } from '#/lib/pdf/annotations';
import type { EditorState } from '#/lib/pdf/editorState';
import type { Region } from '#/lib/pdf/regions';
import type { ScoreAnalysis } from '#/lib/pdf/scoreAnalysis';
import { makeStore } from '#/store';
import { documentOpened, documentRestored } from '#/store/document.slice';
import { scoreAnalysed, scoreAnalysisFailed } from '#/store/score.slice';

const DOC = 'doc-1';

const REGION: Region = {
  id: 'region-1',
  pageIndex: 0,
  rect: { left: 0, right: 612, bottom: 100, top: 240 },
  label: 'Guitar I',
  groupKey: '0:0',
};

const MARK = createAnnotation(0, 120, 300, 'string', '3');

function analysis(names: string[]): ScoreAnalysis {
  return {
    pages: [
      { pageIndex: 0, width: 612, height: 792, systems: [], markings: [] },
    ],
    parts: names.map((name, ordinal) => ({
      id: `part-${ordinal}`,
      ordinal,
      name,
    })),
    irregularSystems: [],
  };
}

const THREE_PARTS = analysis(['Flute', 'Guitar', 'Cello']);

const STATE: EditorState = {
  v: 1,
  regions: [REGION],
  keepMarkings: false,
  selectedOrdinals: [0, 2],
  partNames: [{ ordinal: 1, name: 'Guitar I' }],
};

function restored(state: EditorState | null, annotations = [MARK]) {
  const store = makeStore();
  store.dispatch(documentOpened({ id: DOC, name: 'score.pdf', pages: [] }));
  store.dispatch(documentRestored({ annotations, state }));
  return store;
}

function analysed(store: ReturnType<typeof makeStore>, detected = THREE_PARTS) {
  store.dispatch(scoreAnalysed({ documentId: DOC, analysis: detected }));
  return store.getState();
}

describe('what lands immediately', () => {
  it('puts the marks back as editable annotations', () => {
    expect(restored(STATE).getState().annotations).toEqual([MARK]);
  });

  it('puts the hand-drawn rectangles back', () => {
    expect(restored(STATE).getState().regions.manual).toEqual([REGION]);
  });

  it('leaves detection in charge when the file drew no rectangles', () => {
    // Null means the part checkboxes still propose the regions.
    const state = restored({ ...STATE, regions: null }).getState();

    expect(state.regions.manual).toBeNull();
  });

  it('restores the markings choice', () => {
    expect(restored(STATE).getState().score.keepMarkings).toBe(false);
  });

  it('takes the marks even from a file with no state attachment', () => {
    const state = restored(null).getState();

    expect(state.annotations).toEqual([MARK]);
    expect(state.regions.manual).toBeNull();
    expect(state.score.keepMarkings).toBe(true);
  });
});

describe('what waits for detection', () => {
  it('holds the selection until there are parts to apply it to', () => {
    const store = restored(STATE);

    expect(store.getState().score.selectedOrdinals).toEqual([]);
    expect(analysed(store).score.selectedOrdinals).toEqual([0, 2]);
  });

  it('clears the pending selection once it has been applied', () => {
    // Otherwise re-analysing would silently undo later changes to the selection.
    const store = restored(STATE);

    expect(analysed(store).score.pendingOrdinals).toBeNull();
  });

  it('drops the pending selection when detection finds no score at all', () => {
    const store = restored(STATE);
    store.dispatch(
      scoreAnalysisFailed({ documentId: DOC, message: 'no staves' }),
    );

    expect(store.getState().score.pendingOrdinals).toBeNull();
  });

  it('honours a stored selection of nothing', () => {
    const store = restored({ ...STATE, selectedOrdinals: [] });

    expect(analysed(store).score.selectedOrdinals).toEqual([]);
  });
});

describe('reconciling against what was detected this time', () => {
  it('drops ordinals no part answers to any more', () => {
    // A detection change that finds one staff too few re-points every part
    // below it, so a stored ordinal can name a part that is not there.
    const store = restored({ ...STATE, selectedOrdinals: [0, 2, 5] });

    expect(analysed(store).score.selectedOrdinals).toEqual([0, 2]);
  });

  it('falls back to the detected default when nothing survives', () => {
    const store = restored({ ...STATE, selectedOrdinals: [7, 8] });

    expect(analysed(store).score.selectedOrdinals).toEqual([0, 1, 2]);
  });

  it('applies a rename to the ordinal that still exists', () => {
    const store = restored(STATE);

    expect(analysed(store).score.renames).toEqual({ 1: 'Guitar I' });
  });

  it('shows nothing for a rename whose ordinal is gone', () => {
    const store = restored({
      ...STATE,
      partNames: [
        { ordinal: 0, name: 'Piccolo' },
        { ordinal: 9, name: 'Tuba' },
      ],
    });
    analysed(store);

    // The rename is kept in case the ordinal comes back, but names no part now.
    const names = store
      .getState()
      .score.analysis?.parts.map(
        (part) => store.getState().score.renames[part.ordinal] ?? part.name,
      );
    expect(names).toEqual(['Piccolo', 'Guitar', 'Cello']);
  });
});

describe('following the document', () => {
  it('is wiped by the next document being opened', () => {
    const store = restored(STATE);
    analysed(store);
    store.dispatch(documentOpened({ id: 'doc-2', name: 'other.pdf', pages: [] }));

    const state = store.getState();
    expect(state.annotations).toEqual([]);
    expect(state.regions.manual).toBeNull();
    expect(state.score.renames).toEqual({});
    expect(state.score.keepMarkings).toBe(true);
    expect(state.score.pendingOrdinals).toBeNull();
  });

  it('would be wiped if it were dispatched before the open', () => {
    // The ordering in `handleFile` is load-bearing, not stylistic.
    const store = makeStore();
    store.dispatch(documentRestored({ annotations: [MARK], state: STATE }));
    store.dispatch(documentOpened({ id: DOC, name: 'score.pdf', pages: [] }));

    expect(store.getState().annotations).toEqual([]);
  });
});
