import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AnnotationKind } from '#/lib/pdf/annotations';
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
};

const initialState: ToolState = { active: null };

export const toolSlice = createSlice({
  name: 'tool',
  initialState,
  reducers: {
    /** Picks a tool, or puts the active one away when it is picked again. */
    toolToggled(state, action: PayloadAction<Tool>) {
      state.active = state.active === action.payload ? null : action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(documentOpened, () => initialState)
      .addCase(documentClosed, () => initialState);
  },
  selectors: {
    selectIsEditingRegions: (state) => state.active === 'regions',
    /** The note kind being placed, if the active tool places notes at all. */
    selectPlacing: (state): AnnotationKind | null =>
      state.active === 'regions' ? null : state.active,
  },
});

export const { toolToggled } = toolSlice.actions;

export const { selectIsEditingRegions, selectPlacing } = toolSlice.selectors;
