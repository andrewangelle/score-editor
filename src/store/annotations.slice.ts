import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  type AnnotationClipboard,
  type AnnotationColor,
  type AnnotationKind,
  type AnnotationUndoEntry,
  createAnnotation,
  DEFAULT_SIZE,
  normalizeAnnotationText,
  removeAnnotation,
  type ScoreAnnotation,
} from '#/lib/pdf/annotations/annotations';
import {
  documentClosed,
  documentOpened,
  documentRestored,
  documentSaved,
} from '#/store/document.slice';

const MAX_UNDO = 3;

type AnnotationsState = {
  items: ScoreAnnotation[];
  /** The items as they were at open or restore, for the pre-save dirty check. */
  original: ScoreAnnotation[];
  undoStack: AnnotationUndoEntry[];
  redoStack: AnnotationUndoEntry[];
  clipboard: AnnotationClipboard;
  selectedId: string | null;
  revision: number;
  savedRevision: number | null;
};

const initialState: AnnotationsState = {
  items: [],
  original: [],
  undoStack: [],
  redoStack: [],
  clipboard: null,
  selectedId: null,
  revision: 0,
  savedRevision: null,
};

function annotationsUnchanged(
  a: readonly ScoreAnnotation[],
  b: readonly ScoreAnnotation[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (item, i) =>
      item.id === b[i].id &&
      item.pageIndex === b[i].pageIndex &&
      item.x === b[i].x &&
      item.y === b[i].y &&
      item.text === b[i].text &&
      item.kind === b[i].kind &&
      item.color === b[i].color,
  );
}

function pushUndo(state: AnnotationsState, entry: AnnotationUndoEntry) {
  state.undoStack.push(entry);
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  state.redoStack = [];
}

function applyInverse(state: AnnotationsState, entry: AnnotationUndoEntry) {
  switch (entry.type) {
    case 'place': {
      state.items = removeAnnotation(state.items, entry.annotation.id);
      break;
    }
    case 'remove': {
      state.items.push(entry.annotation);
      break;
    }
    case 'move': {
      const annotation = state.items.find((a) => a.id === entry.id);
      if (annotation) {
        annotation.x = entry.from.x;
        annotation.y = entry.from.y;
      }
      break;
    }
    case 'retitle': {
      const annotation = state.items.find((a) => a.id === entry.id);
      if (annotation) annotation.text = entry.from;
      break;
    }
  }
}

function applyForward(state: AnnotationsState, entry: AnnotationUndoEntry) {
  switch (entry.type) {
    case 'place': {
      state.items.push(entry.annotation);
      break;
    }
    case 'remove': {
      state.items = removeAnnotation(state.items, entry.annotation.id);
      break;
    }
    case 'move': {
      const annotation = state.items.find((a) => a.id === entry.id);
      if (annotation) {
        annotation.x = entry.to.x;
        annotation.y = entry.to.y;
      }
      break;
    }
    case 'retitle': {
      const annotation = state.items.find((a) => a.id === entry.id);
      if (annotation) annotation.text = entry.to;
      break;
    }
  }
}

export const annotationsSlice = createSlice({
  name: 'annotations',
  initialState,
  reducers: {
    annotationPlaced: {
      reducer(state, action: PayloadAction<ScoreAnnotation>) {
        pushUndo(state, { type: 'place', annotation: action.payload });
        state.items.push(action.payload);
        state.revision += 1;
      },
      prepare(input: {
        pageIndex: number;
        x: number;
        y: number;
        kind: AnnotationKind;
        color?: AnnotationColor;
        text?: string;
      }) {
        return {
          payload: createAnnotation(
            input.pageIndex,
            input.x,
            input.y,
            input.kind,
            input.text ?? '',
            input.color,
          ),
        };
      },
    },

    annotationRetitled(
      state,
      action: PayloadAction<{ id: string; text: string }>,
    ) {
      const annotation = state.items.find(
        (candidate) => candidate.id === action.payload.id,
      );
      if (annotation) {
        const oldText = annotation.text;
        const newText = normalizeAnnotationText(
          annotation.kind,
          action.payload.text,
        );
        pushUndo(state, {
          type: 'retitle',
          id: annotation.id,
          from: oldText,
          to: newText,
        });
        annotation.text = newText;
        state.revision += 1;
      }
    },

    annotationMoved(
      state,
      action: PayloadAction<{ id: string; x: number; y: number }>,
    ) {
      const annotation = state.items.find(
        (candidate) => candidate.id === action.payload.id,
      );
      if (annotation) {
        pushUndo(state, {
          type: 'move',
          id: annotation.id,
          from: { x: annotation.x, y: annotation.y },
          to: { x: action.payload.x, y: action.payload.y },
        });
        annotation.x = action.payload.x;
        annotation.y = action.payload.y;
        state.revision += 1;
      }
    },

    annotationRemoved(state, action: PayloadAction<string>) {
      const annotation = state.items.find(
        (candidate) => candidate.id === action.payload,
      );
      if (annotation) {
        pushUndo(state, {
          type: 'remove',
          annotation: { ...annotation },
        });
      }
      state.items = removeAnnotation(state.items, action.payload);
      if (state.selectedId === action.payload) state.selectedId = null;
      state.revision += 1;
    },

    annotationUndone(state) {
      const entry = state.undoStack.pop();
      if (!entry) return;
      applyInverse(state, entry);
      state.redoStack.push(entry);
      state.revision += 1;
    },

    annotationRedone(state) {
      const entry = state.redoStack.pop();
      if (!entry) return;
      applyForward(state, entry);
      state.undoStack.push(entry);
      if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
      state.revision += 1;
    },

    annotationCopied(state, action: PayloadAction<string>) {
      const annotation = state.items.find(
        (candidate) => candidate.id === action.payload,
      );
      if (annotation) {
        state.clipboard = {
          kind: annotation.kind,
          text: annotation.text,
          color: annotation.color,
          pageIndex: annotation.pageIndex,
          x: annotation.x,
          y: annotation.y,
        };
      }
    },

    annotationPasted: {
      reducer(state, action: PayloadAction<ScoreAnnotation>) {
        pushUndo(state, { type: 'place', annotation: action.payload });
        state.items.push(action.payload);
        state.revision += 1;
      },
      prepare(input: {
        pageIndex: number;
        x: number;
        y: number;
        kind: AnnotationKind;
        color?: AnnotationColor;
        text?: string;
      }) {
        return {
          payload: createAnnotation(
            input.pageIndex,
            input.x,
            input.y,
            input.kind,
            input.text ?? '',
            input.color,
          ),
        };
      },
    },

    annotationSelected(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(documentOpened, () => initialState)
      .addCase(documentClosed, () => initialState)
      .addCase(documentSaved, (state) => {
        state.savedRevision = state.revision;
      })
      .addCase(documentRestored, (state, action) => {
        const restored = action.payload.annotations.map((annotation) => ({
          ...annotation,
          size: DEFAULT_SIZE[annotation.kind],
        }));
        state.items = restored;
        state.original = restored;
      });
  },
  selectors: {
    selectAnnotations: (state) => state.items,
    selectAnnotationCount: (state) => state.items.length,
    selectCanUndoAnnotation: (state) => state.undoStack.length > 0,
    selectCanRedoAnnotation: (state) => state.redoStack.length > 0,
    selectClipboard: (state) => state.clipboard,
    selectSelectedAnnotationId: (state) => state.selectedId,
    selectHasUnsavedAnnotations: (state) =>
      state.savedRevision === null
        ? !annotationsUnchanged(state.items, state.original)
        : state.savedRevision !== state.revision,
  },
});

export const {
  annotationPlaced,
  annotationRetitled,
  annotationMoved,
  annotationRemoved,
  annotationUndone,
  annotationRedone,
  annotationCopied,
  annotationPasted,
  annotationSelected,
} = annotationsSlice.actions;

export const {
  selectAnnotations,
  selectAnnotationCount,
  selectCanUndoAnnotation,
  selectCanRedoAnnotation,
  selectClipboard,
  selectSelectedAnnotationId,
  selectHasUnsavedAnnotations,
} = annotationsSlice.selectors;
