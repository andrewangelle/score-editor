import { createSlice, current, type PayloadAction } from '@reduxjs/toolkit';
import type { PageEdit } from '#/lib/pdf/document';
import {
  isUnchanged,
  movePage,
  removePage,
  rotateAllPages,
  rotatePage,
} from '#/lib/pdf/edits';

/**
 * The document being edited: which pages it has, in what order, and how far the
 * user has strayed from the upload.
 *
 * The pristine bytes are not here — see `#/lib/pdf/documentBytes`. `id` is what
 * ties this state to that buffer, and `original` is what "unchanged" and
 * "reset" are measured against, since editing only ever rebuilds this page
 * list; the source document itself is untouched until save.
 */
type DocumentState = {
  /** Null when no document is open; otherwise the key for the held bytes. */
  id: string | null;
  name: string;
  pages: PageEdit[];
  /** The page list as uploaded, for reset and the dirty check. */
  original: PageEdit[];
  /** Previous page lists, most recent last. */
  history: PageEdit[][];
  selectedPageId: string | null;
  /**
   * Bumped on every committed page change, undo and reset included.
   *
   * It exists so a message about the document — "Saved score.pdf" — can say
   * which version of it it was true for, and stop being shown once that is no
   * longer the version on screen.
   */
  revision: number;
};

const initialState: DocumentState = {
  id: null,
  name: '',
  pages: [],
  original: [],
  history: [],
  selectedPageId: null,
  revision: 0,
};

/**
 * Commits a new page list, recording the previous one for undo.
 *
 * `change` is handed a plain snapshot rather than the draft, so the edit
 * helpers' "returns its input when nothing moved" contract still holds by
 * identity here and keeps no-ops off the undo stack.
 */
function commit(
  state: DocumentState,
  change: (pages: PageEdit[]) => PageEdit[],
) {
  const previous = current(state).pages;
  const next = change(previous);
  if (next === previous) return;

  state.history.push(previous);
  state.pages = next;
  state.revision += 1;
}

/** Keeps the selection on a page that still exists after a list change. */
function keepSelectionValid(state: DocumentState, preferredIndex = 0) {
  if (state.pages.some((page) => page.id === state.selectedPageId)) return;

  const index = Math.min(preferredIndex, state.pages.length - 1);
  state.selectedPageId = state.pages[index]?.id ?? null;
}

export const documentSlice = createSlice({
  name: 'document',
  initialState,
  reducers: {
    documentOpened(
      state,
      action: PayloadAction<{
        id: string;
        name: string;
        pages: readonly PageEdit[];
      }>,
    ) {
      state.id = action.payload.id;
      state.name = action.payload.name;
      state.pages = [...action.payload.pages];
      state.original = [...action.payload.pages];
      state.history = [];
      state.selectedPageId = action.payload.pages[0]?.id ?? null;
    },

    documentClosed() {
      return initialState;
    },

    pageSelected(state, action: PayloadAction<string>) {
      state.selectedPageId = action.payload;
    },

    pageRotated(state, action: PayloadAction<{ id: string; delta: number }>) {
      const { id, delta } = action.payload;
      commit(state, (pages) => rotatePage(pages, id, delta));
    },

    allPagesRotated(state, action: PayloadAction<number>) {
      commit(state, (pages) => rotateAllPages(pages, action.payload));
    },

    pageMoved(state, action: PayloadAction<{ id: string; direction: -1 | 1 }>) {
      const { id, direction } = action.payload;
      commit(state, (pages) => movePage(pages, id, direction));
    },

    pageDeleted(state, action: PayloadAction<string>) {
      const removedAt = state.pages.findIndex(
        (page) => page.id === action.payload,
      );
      if (removedAt === -1) return;

      commit(state, (pages) => removePage(pages, action.payload));
      // Whatever slid into the deleted page's place is the natural next
      // selection, falling back to the new last page.
      keepSelectionValid(state, removedAt);
    },

    documentReset(state) {
      const snapshot = current(state);
      if (isUnchanged(snapshot.pages, snapshot.original)) return;

      state.history.push(snapshot.pages);
      state.pages = [...snapshot.original];
      state.revision += 1;
      keepSelectionValid(state);
    },

    undone(state) {
      const previous = current(state).history.at(-1);
      if (!previous) return;

      state.history.pop();
      state.pages = previous;
      state.revision += 1;
      keepSelectionValid(state);
    },
  },
  selectors: {
    selectDocumentId: (state) => state.id,
    selectDocumentName: (state) => state.name,
    selectPages: (state) => state.pages,
    selectPageCount: (state) => state.pages.length,
    selectSelectedPageId: (state) => state.selectedPageId,
    selectCanUndo: (state) => state.history.length > 0,
    selectIsDirty: (state) => !isUnchanged(state.pages, state.original),
    selectRevision: (state) => state.revision,
  },
});

export const {
  documentOpened,
  documentClosed,
  pageSelected,
  pageRotated,
  allPagesRotated,
  pageMoved,
  pageDeleted,
  documentReset,
  undone,
} = documentSlice.actions;

export const {
  selectDocumentId,
  selectDocumentName,
  selectPages,
  selectPageCount,
  selectSelectedPageId,
  selectCanUndo,
  selectIsDirty,
  selectRevision,
} = documentSlice.selectors;
