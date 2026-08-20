import {
  createAction,
  createSlice,
  current,
  type PayloadAction,
} from '@reduxjs/toolkit';
import type { ScoreAnnotation } from '#/lib/pdf/annotations';
import type { PageEdit } from '#/lib/pdf/document';
import type { EditorState } from '#/lib/pdf/editorState';
import {
  isUnchanged,
  movePage,
  removePage,
  rotateAllPages,
  rotatePage,
} from '#/lib/pdf/edits';

/**
 * Work recovered from the file that was just opened.
 *
 * A standalone action because it belongs to no one slice: marks go to
 * annotations, rectangles to regions, the part selection to score. It must be
 * dispatched *after* `documentOpened` — every slice resets itself on the open.
 *
 * The document slice itself ignores it. Page arrangement is session-local by
 * design: a deleted page's content is genuinely absent from the saved file, so
 * no record of the deletion could put it back.
 */
export const documentRestored = createAction<{
  annotations: ScoreAnnotation[];
  /** Null when the file carried marks but no state attachment. */
  state: EditorState | null;
}>('document/restored');

/**
 * The document being edited: which pages it has, in what order, and how far the
 * user has strayed from the upload.
 *
 * The pristine bytes live in `#/lib/pdf/documentBytes`; `id` ties this state to
 * that buffer. Editing only ever rebuilds this page list — the source document
 * is untouched until save.
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
   * Bumped on every committed page change, undo and reset included, so a message
   * about the document ("Saved score.pdf") can say which version it was true
   * for and stop being shown once that is no longer what is on screen.
   */
  revision: number;
  /**
   * The revision last written back over the source file. Null if it never has
   * been, the only state a document opened without a writable handle can be in.
   */
  savedRevision: number | null;
  /**
   * False once extraction has been written over the source file: it then holds
   * cut regions, which no revision of this document is. Without this the header
   * would go on calling a document "saved" while the file holds something else.
   */
  fileHoldsDocument: boolean;
};

const initialState: DocumentState = {
  id: null,
  name: '',
  pages: [],
  original: [],
  history: [],
  selectedPageId: null,
  revision: 0,
  savedRevision: null,
  fileHoldsDocument: true,
};

/**
 * Commits a new page list, recording the previous one for undo. `change` is
 * handed a plain snapshot rather than the draft, so the edit helpers' "returns
 * its input when nothing moved" contract still holds by identity and keeps
 * no-ops off the undo stack.
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
      state.savedRevision = null;
      state.fileHoldsDocument = true;
    },

    /**
     * The edits as they stand are now what the source file contains. Only
     * saving over the file itself counts — downloading a copy leaves the
     * original exactly as unsaved as it was.
     */
    documentSaved(state) {
      state.savedRevision = state.revision;
      // Saving puts the document back in a file that extraction may have taken.
      state.fileHoldsDocument = true;
    },

    /**
     * The extracted regions have been written over the source file. The document
     * is untouched and still on screen; the file simply no longer agrees with
     * it, and no amount of undoing will make it agree — only saving over it.
     */
    documentFileReplaced(state) {
      state.fileHoldsDocument = false;
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
      // Whatever slid into the deleted page's place is the next selection.
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
    /**
     * Before the first save this is just dirtiness against the upload. After
     * one it is measured against what was written, because undoing back to the
     * uploaded page list no longer means the file agrees — it holds the version
     * that was saved over it.
     */
    selectHasUnsavedChanges: (state) =>
      !state.fileHoldsDocument ||
      (state.savedRevision === null
        ? !isUnchanged(state.pages, state.original)
        : state.savedRevision !== state.revision),
    selectRevision: (state) => state.revision,
  },
});

export const {
  documentOpened,
  documentClosed,
  documentSaved,
  documentFileReplaced,
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
  selectHasUnsavedChanges,
  selectRevision,
} = documentSlice.selectors;
