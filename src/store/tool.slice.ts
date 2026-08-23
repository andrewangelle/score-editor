import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AnnotationColor, AnnotationKind } from '#/lib/pdf/annotations';
import { DEFAULT_COLOR } from '#/lib/pdf/annotations';
import { documentClosed, documentOpened } from '#/store/document.slice';

/**
 * Which tool the page surface is currently under.
 *
 * Editing rectangles and dropping notes are mutually exclusive — the region
 * layer and the note layer both want the same clicks — so this is one value
 * rather than two flags that have to be talked out of disagreeing.
 */
export type Tool = AnnotationKind | 'regions';

type ToolState = {
  /** Null means plain page editing: no overlay is taking clicks. */
  active: Tool | null;
  color: AnnotationColor;
};

const initialState: ToolState = { active: null, color: DEFAULT_COLOR };

export const toolSlice = createSlice({
  name: 'tool',
  initialState,
  reducers: {
    /** Picks a tool, or puts the active one away when it is picked again. */
    toolToggled(state, action: PayloadAction<Tool>) {
      state.active = state.active === action.payload ? null : action.payload;
    },

    annotationColorPicked(state, action: PayloadAction<AnnotationColor>) {
      state.color = action.payload;
    },
  },
  extraReducers: (builder) => {
    const closeDocument = (state: ToolState): ToolState => ({
      ...initialState,
      color: state.color,
    });

    builder
      .addCase(documentOpened, closeDocument)
      .addCase(documentClosed, closeDocument);
  },
  selectors: {
    selectIsEditingRegions: (state) => state.active === 'regions',
    /** The note kind being placed, if the active tool places notes at all. */
    selectPlacing: (state): AnnotationKind | null =>
      state.active === 'regions' ? null : state.active,
    selectAnnotationColor: (state) => state.color,
  },
});

export const { toolToggled, annotationColorPicked } = toolSlice.actions;

export const { selectIsEditingRegions, selectPlacing, selectAnnotationColor } =
  toolSlice.selectors;
