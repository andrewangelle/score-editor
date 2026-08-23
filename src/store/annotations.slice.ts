import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  type AnnotationColor,
  type AnnotationKind,
  createAnnotation,
  DEFAULT_SIZE,
  normalizeAnnotationText,
  removeAnnotation,
  type ScoreAnnotation,
} from '#/lib/pdf/annotations';
import {
  documentClosed,
  documentOpened,
  documentRestored,
} from '#/store/document.slice';

/**
 * Fingerings and performance notes, anchored to the uploaded document. Only
 * committed values arrive: the overlay handles typing and dragging locally, so
 * the store sees the text on blur and the position on pointer-up.
 */
const initialState: ScoreAnnotation[] = [];

export const annotationsSlice = createSlice({
  name: 'annotations',
  initialState,
  reducers: {
    annotationPlaced: {
      reducer(state, action: PayloadAction<ScoreAnnotation>) {
        state.push(action.payload);
      },
      // `createAnnotation` mints a random id, so it must not run in the
      // reducer: replaying the same action would otherwise produce new state.
      prepare(input: {
        pageIndex: number;
        x: number;
        y: number;
        kind: AnnotationKind;
        color?: AnnotationColor;
      }) {
        return {
          payload: createAnnotation(
            input.pageIndex,
            input.x,
            input.y,
            input.kind,
            '',
            input.color,
          ),
        };
      },
    },

    annotationRetitled(
      state,
      action: PayloadAction<{ id: string; text: string }>,
    ) {
      const annotation = state.find(
        (candidate) => candidate.id === action.payload.id,
      );
      // Normalizing on commit rather than per keystroke keeps a position
      // readable as "1" while it is typed towards "12", and still guarantees
      // only engravable values are stored.
      if (annotation) {
        annotation.text = normalizeAnnotationText(
          annotation.kind,
          action.payload.text,
        );
      }
    },

    annotationMoved(
      state,
      action: PayloadAction<{ id: string; x: number; y: number }>,
    ) {
      const annotation = state.find(
        (candidate) => candidate.id === action.payload.id,
      );
      if (annotation) {
        annotation.x = action.payload.x;
        annotation.y = action.payload.y;
      }
    },

    annotationRemoved(state, action: PayloadAction<string>) {
      return removeAnnotation(state, action.payload);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(documentOpened, () => initialState)
      .addCase(documentClosed, () => initialState)
      // Migrate any previous annotations to current default size
      .addCase(documentRestored, (_state, action) =>
        action.payload.annotations.map((annotation) => ({
          ...annotation,
          size: DEFAULT_SIZE[annotation.kind],
        })),
      );
  },
  selectors: {
    selectAnnotations: (state) => state,
    selectAnnotationCount: (state) => state.length,
  },
});

export const {
  annotationPlaced,
  annotationRetitled,
  annotationMoved,
  annotationRemoved,
} = annotationsSlice.actions;

export const { selectAnnotations, selectAnnotationCount } =
  annotationsSlice.selectors;
