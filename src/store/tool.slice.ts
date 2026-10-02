import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  AnnotationColor,
  AnnotationKind,
} from '#/lib/pdf/annotations/annotations';
import { DEFAULT_COLOR, DEFAULT_SIZE } from '#/lib/pdf/annotations/annotations';
import { annotationSelected } from '#/store/annotations.slice';
import { documentClosed, documentOpened } from '#/store/document.slice';

export type Tool = AnnotationKind | 'regions';

type ToolState = {
  active: Tool | null;
  color: AnnotationColor;
  value: string | null;
  fontSize: number | null;
  /**
   * The page with an edit or drag in progress, by page id. The viewer keeps it
   * mounted while it is scrolled out of view, which would otherwise throw the
   * edit away with the component holding it.
   */
  activePageId: string | null;
};

const initialState: ToolState = {
  active: null,
  color: DEFAULT_COLOR,
  value: null,
  fontSize: null,
  activePageId: null,
};

export const toolSlice = createSlice({
  name: 'tool',
  initialState,
  reducers: {
    /** Picks a tool, or puts the active one away when it is picked again. */
    toolToggled(state, action: PayloadAction<Tool>) {
      state.active = state.active === action.payload ? null : action.payload;
      state.value = null;
      state.fontSize =
        state.active !== null && state.active !== 'regions'
          ? DEFAULT_SIZE[state.active]
          : null;
    },

    annotationColorPicked(state, action: PayloadAction<AnnotationColor>) {
      state.color = action.payload;
    },

    annotationValuePicked(state, action: PayloadAction<string>) {
      state.value = state.value === action.payload ? null : action.payload;
    },

    annotationFontSizePicked(state, action: PayloadAction<number>) {
      state.fontSize = action.payload;
    },

    annotationFontSizeReset(state) {
      state.fontSize = null;
    },

    activePageSet(state, action: PayloadAction<string>) {
      state.activePageId = action.payload;
    },

    /** Only clears the page named, so a stale clear cannot unpin a newer one. */
    activePageCleared(state, action: PayloadAction<string>) {
      if (state.activePageId === action.payload) state.activePageId = null;
    },
  },
  extraReducers(builder) {
    const closeDocument = (state: ToolState): ToolState => ({
      ...initialState,
      color: state.color,
      fontSize: state.fontSize,
    });

    builder
      .addCase(documentOpened, closeDocument)
      .addCase(documentClosed, closeDocument)
      .addCase(annotationSelected, (state) => {
        state.fontSize =
          state.active && state.active !== 'regions'
            ? DEFAULT_SIZE[state.active]
            : null;
      });
  },
  selectors: {
    selectIsEditingRegions(state) {
      return state.active === 'regions';
    },

    /** The note kind being placed, if the active tool places notes at all. */
    selectPlacing(state): AnnotationKind | null {
      if (state.active === 'regions') {
        return null;
      }
      return state.active;
    },

    selectAnnotationColor(state) {
      return state.color;
    },

    /** The menu value the next mark carries, if one is picked. */
    selectAnnotationValue(state): string | null {
      if (state.active === 'regions') {
        return null;
      }
      return state.value;
    },

    selectAnnotationFontSize(state) {
      return state.fontSize;
    },

    selectActivePageId(state) {
      return state.activePageId;
    },
  },
});

export const {
  toolToggled,
  annotationColorPicked,
  annotationValuePicked,
  annotationFontSizePicked,
  annotationFontSizeReset,
  activePageSet,
  activePageCleared,
} = toolSlice.actions;

export const {
  selectIsEditingRegions,
  selectPlacing,
  selectAnnotationColor,
  selectAnnotationValue,
  selectAnnotationFontSize,
  selectActivePageId,
} = toolSlice.selectors;
