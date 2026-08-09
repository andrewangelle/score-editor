import type { PageEdit } from '#/lib/pdf/document';
import {
  allPagesRotated,
  documentClosed,
  documentOpened,
  documentReset,
  documentSlice,
  pageDeleted,
  pageMoved,
  pageRotated,
  pageSelected,
  undone,
} from '#/store/document.slice';

const PAGES: PageEdit[] = [
  { id: 'a', sourceIndex: 0, rotation: 0 },
  { id: 'b', sourceIndex: 1, rotation: 0 },
  { id: 'c', sourceIndex: 2, rotation: 0 },
];

const OPEN = documentSlice.reducer(
  undefined,
  documentOpened({ id: 'doc-1', name: 'score.pdf', pages: PAGES }),
);

/** Applies a sequence of actions, so tests read as a user session. */
function run(...actions: Parameters<typeof documentSlice.reducer>[1][]) {
  return actions.reduce(documentSlice.reducer, OPEN);
}

const ids = (state: ReturnType<typeof documentSlice.reducer>) =>
  state.pages.map((page) => page.id);

describe('documentOpened', () => {
  it('seeds the edit list, the baseline and the selection', () => {
    expect(OPEN.id).toBe('doc-1');
    expect(OPEN.name).toBe('score.pdf');
    expect(ids(OPEN)).toEqual(['a', 'b', 'c']);
    expect(OPEN.original).toEqual(PAGES);
    expect(OPEN.selectedPageId).toBe('a');
    expect(OPEN.history).toEqual([]);
  });

  it('copies the page list rather than aliasing the caller', () => {
    expect(OPEN.pages).not.toBe(PAGES);
    expect(OPEN.original).not.toBe(OPEN.pages);
  });
});

describe('page edits', () => {
  it('records the previous list for undo', () => {
    const state = run(pageRotated({ id: 'a', delta: 90 }));

    expect(state.pages[0].rotation).toBe(90);
    expect(state.history).toHaveLength(1);
    expect(state.history[0][0].rotation).toBe(0);
  });

  it('normalises rotation past a full turn', () => {
    const state = run(
      allPagesRotated(270),
      allPagesRotated(180),
      allPagesRotated(-90),
    );

    expect(state.pages.map((page) => page.rotation)).toEqual([0, 0, 0]);
  });

  it('keeps a move that changes nothing off the undo stack', () => {
    const state = run(pageMoved({ id: 'a', direction: -1 }));

    expect(ids(state)).toEqual(['a', 'b', 'c']);
    expect(state.history).toEqual([]);
  });

  it('reorders pages without disturbing the selection', () => {
    const state = run(pageMoved({ id: 'a', direction: 1 }));

    expect(ids(state)).toEqual(['b', 'a', 'c']);
    expect(state.selectedPageId).toBe('a');
  });

  it('ignores an edit aimed at a page that is not there', () => {
    const state = run(pageDeleted('gone'));

    expect(ids(state)).toEqual(['a', 'b', 'c']);
    expect(state.history).toEqual([]);
  });
});

describe('selection', () => {
  it('follows an explicit choice', () => {
    expect(run(pageSelected('c')).selectedPageId).toBe('c');
  });

  it('moves to whatever took the deleted page’s place', () => {
    const state = run(pageSelected('b'), pageDeleted('b'));

    expect(ids(state)).toEqual(['a', 'c']);
    expect(state.selectedPageId).toBe('c');
  });

  it('falls back to the new last page when the end is deleted', () => {
    const state = run(pageSelected('c'), pageDeleted('c'));

    expect(state.selectedPageId).toBe('b');
  });

  it('survives deleting a page that was not selected', () => {
    const state = run(pageSelected('c'), pageDeleted('a'));

    expect(state.selectedPageId).toBe('c');
  });

  it('empties out when the last page goes', () => {
    const state = run(pageDeleted('a'), pageDeleted('b'), pageDeleted('c'));

    expect(state.pages).toEqual([]);
    expect(state.selectedPageId).toBeNull();
  });
});

describe('undone', () => {
  it('steps back through the edits one at a time', () => {
    const state = run(
      pageDeleted('b'),
      pageRotated({ id: 'a', delta: 90 }),
      undone(),
    );

    expect(ids(state)).toEqual(['a', 'c']);
    expect(state.pages[0].rotation).toBe(0);
    expect(state.history).toHaveLength(1);
  });

  it('restores a deleted page and reselects it when nothing else is valid', () => {
    const state = run(pageDeleted('a'), pageDeleted('c'), undone(), undone());

    expect(ids(state)).toEqual(['a', 'b', 'c']);
    expect(state.selectedPageId).toBe('b');
  });

  it('does nothing with an empty history', () => {
    expect(run(undone())).toEqual(OPEN);
  });
});

describe('documentReset', () => {
  it('returns to the uploaded page list and keeps it undoable', () => {
    const state = run(pageDeleted('b'), allPagesRotated(90), documentReset());

    expect(state.pages).toEqual(PAGES);
    expect(documentSlice.selectors.selectIsDirty({ document: state })).toBe(
      false,
    );
    expect(state.history.at(-1)).toHaveLength(2);
  });

  it('is a no-op on an untouched document', () => {
    expect(run(documentReset())).toEqual(OPEN);
  });
});

describe('documentClosed', () => {
  it('leaves nothing of the previous document behind', () => {
    const state = run(pageDeleted('b'), documentClosed());

    expect(state.id).toBeNull();
    expect(state.pages).toEqual([]);
    expect(state.history).toEqual([]);
    expect(state.selectedPageId).toBeNull();
  });
});

describe('revision', () => {
  const { selectRevision } = documentSlice.selectors;
  const revisionOf = (state: ReturnType<typeof documentSlice.reducer>) =>
    selectRevision({ document: state });

  it('starts at zero for a freshly opened document', () => {
    expect(revisionOf(OPEN)).toBe(0);
  });

  it('moves on for every kind of page change', () => {
    const rotated = run(pageRotated({ id: 'a', delta: 90 }));
    const deleted = documentSlice.reducer(rotated, pageDeleted('b'));
    const undoneAgain = documentSlice.reducer(deleted, undone());
    const wasReset = documentSlice.reducer(undoneAgain, documentReset());

    expect([rotated, deleted, undoneAgain, wasReset].map(revisionOf)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('does not move for selection, which is not an edit', () => {
    expect(revisionOf(run(pageSelected('c')))).toBe(0);
  });

  it('does not move for an edit that changed nothing', () => {
    expect(revisionOf(run(pageMoved({ id: 'a', direction: -1 })))).toBe(0);
    expect(revisionOf(run(pageDeleted('gone')))).toBe(0);
    expect(revisionOf(run(undone()))).toBe(0);
    expect(revisionOf(run(documentReset()))).toBe(0);
  });

  it('never returns to a spent number, so an undo does not revive a banner', () => {
    // Undo restores the pages but not the moment: a message about the state
    // before the edit must not start applying again.
    const edited = run(pageRotated({ id: 'a', delta: 90 }));
    const backAgain = documentSlice.reducer(edited, undone());

    expect(backAgain.pages).toEqual(OPEN.pages);
    expect(revisionOf(backAgain)).not.toBe(revisionOf(OPEN));
  });
});

describe('selectors', () => {
  it('reports dirtiness against the upload, not the last action', () => {
    const { selectIsDirty, selectCanUndo, selectPageCount } =
      documentSlice.selectors;
    const rotated = run(pageRotated({ id: 'a', delta: 90 }));
    const backAgain = documentSlice.reducer(rotated, undone());

    expect(selectIsDirty({ document: rotated })).toBe(true);
    expect(selectIsDirty({ document: backAgain })).toBe(false);
    // Undoing spends the history entry, so there is nothing left to undo.
    expect(selectCanUndo({ document: backAgain })).toBe(false);
    expect(selectPageCount({ document: backAgain })).toBe(3);
  });
});
