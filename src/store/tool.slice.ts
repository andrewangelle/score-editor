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
  /**
   * The value picked from the menu, carried by every mark placed until it is
   * picked again. Null means the mark opens an editor to be typed into, which
   * is the only way positions and performance notes are ever written.
   */
  value: string | null;
};

const initialState: ToolState = {
  active: null,
  color: DEFAULT_COLOR,
  value: null,
};

export const toolSlice = createSlice({
  name: 'tool',
  initialState,
  reducers: {
    /** Picks a tool, or puts the active one away when it is picked again. */
    toolToggled(state, action: PayloadAction<Tool>) {
      state.active = state.active === action.payload ? null : action.payload;
      // A value belongs to the kind it was picked for: a 6 chosen for strings
      // must not follow the cursor into fingerings, where there is no sixth.
      state.value = null;
    },

    annotationColorPicked(state, action: PayloadAction<AnnotationColor>) {
      state.color = action.payload;
    },

    /** Picks a value off the menu, or puts it back when it is picked again. */
    annotationValuePicked(state, action: PayloadAction<string>) {
      state.value = state.value === action.payload ? null : action.payload;
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
    /** The menu value the next mark carries, if one is picked. */
    selectAnnotationValue: (state): string | null =>
      state.active === 'regions' ? null : state.value,
  },
});

export const { toolToggled, annotationColorPicked, annotationValuePicked } =
  toolSlice.actions;

export const {
  selectIsEditingRegions,
  selectPlacing,
  selectAnnotationColor,
  selectAnnotationValue,
} = toolSlice.selectors;
