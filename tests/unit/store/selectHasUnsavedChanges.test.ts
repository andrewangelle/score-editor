import type { PageEdit } from '#/lib/pdf/document/document';
import { annotationPlaced, annotationsSlice } from '#/store/annotations.slice';
import {
  documentOpened,
  documentSaved,
  documentSlice,
  pageMoved,
} from '#/store/document.slice';
import { regionAdded, regionsSlice } from '#/store/regions.slice';
import { selectHasUnsavedChanges } from '#/store/selectors';

const PAGES: PageEdit[] = [
  { id: 'a', sourceIndex: 0 },
  { id: 'b', sourceIndex: 1 },
];

function freshState() {
  const open = documentOpened({ id: 'doc-1', name: 'score.pdf', pages: PAGES });
  return {
    document: documentSlice.reducer(undefined, open),
    annotations: annotationsSlice.reducer(undefined, open),
    regions: regionsSlice.reducer(undefined, open),
  };
}

describe('selectHasUnsavedChanges (combined)', () => {
  it('is false on a freshly opened document', () => {
    expect(selectHasUnsavedChanges(freshState())).toBe(false);
  });

  it('is true when only pages are dirty', () => {
    const state = freshState();
    state.document = documentSlice.reducer(
      state.document,
      pageMoved({ id: 'a', direction: 1 }),
    );

    expect(selectHasUnsavedChanges(state)).toBe(true);
  });

  it('is true when only annotations are dirty', () => {
    const state = freshState();
    state.annotations = annotationsSlice.reducer(
      state.annotations,
      annotationPlaced({ pageIndex: 0, x: 100, y: 200, kind: 'note' }),
    );

    expect(selectHasUnsavedChanges(state)).toBe(true);
  });

  it('is true when only regions are dirty', () => {
    const state = freshState();
    state.regions = regionsSlice.reducer(
      state.regions,
      regionAdded({
        visible: [],
        pageIndex: 0,
        rect: { left: 0, right: 600, bottom: 100, top: 200 },
      }),
    );

    expect(selectHasUnsavedChanges(state)).toBe(true);
  });

  it('is false when all slices have been saved', () => {
    const state = freshState();
    state.document = documentSlice.reducer(
      state.document,
      pageMoved({ id: 'a', direction: 1 }),
    );
    state.annotations = annotationsSlice.reducer(
      state.annotations,
      annotationPlaced({ pageIndex: 0, x: 100, y: 200, kind: 'note' }),
    );
    state.regions = regionsSlice.reducer(
      state.regions,
      regionAdded({
        visible: [],
        pageIndex: 0,
        rect: { left: 0, right: 600, bottom: 100, top: 200 },
      }),
    );

    // Save settles all three
    state.document = documentSlice.reducer(state.document, documentSaved());
    state.annotations = annotationsSlice.reducer(
      state.annotations,
      documentSaved(),
    );
    state.regions = regionsSlice.reducer(state.regions, documentSaved());

    expect(selectHasUnsavedChanges(state)).toBe(false);
  });

  it('stays true when pages are saved but annotations are not', () => {
    const state = freshState();
    state.document = documentSlice.reducer(
      state.document,
      pageMoved({ id: 'a', direction: 1 }),
    );
    state.annotations = annotationsSlice.reducer(
      state.annotations,
      annotationPlaced({ pageIndex: 0, x: 100, y: 200, kind: 'note' }),
    );

    // Only save the document slice revision (simulate incomplete save)
    state.document = documentSlice.reducer(state.document, documentSaved());

    expect(selectHasUnsavedChanges(state)).toBe(true);
  });
});
