import { createSlice, current, type PayloadAction } from '@reduxjs/toolkit';
import {
  createRegion,
  type Region,
  removeRegion,
  updateRegion,
} from '#/lib/pdf/regions';
import type { Rect } from '#/lib/pdf/staffDetection';
import {
  documentClosed,
  documentOpened,
  documentRestored,
  documentSaved,
} from '#/store/document.slice';

type RegionsState = {
  manual: Region[] | null;
  /** The manual list at open or restore, for the pre-save dirty check. */
  originalManual: Region[] | null;
  selectedId: string | null;
  revision: number;
  savedRevision: number | null;
};

const initialState: RegionsState = {
  manual: null,
  originalManual: null,
  selectedId: null,
  revision: 0,
  savedRevision: null,
};

function regionsUnchanged(
  a: readonly Region[] | null,
  b: readonly Region[] | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  return a.every(
    (r, i) =>
      r.id === b[i].id &&
      r.pageIndex === b[i].pageIndex &&
      r.label === b[i].label &&
      r.rect.left === b[i].rect.left &&
      r.rect.right === b[i].rect.right &&
      r.rect.top === b[i].rect.top &&
      r.rect.bottom === b[i].rect.bottom,
  );
}

/** The list a hand edit starts from: the user's own, or what they can see. */
function editable(state: RegionsState, visible: readonly Region[]): Region[] {
  return current(state).manual ?? [...visible];
}

export const regionsSlice = createSlice({
  name: 'regions',
  initialState,
  reducers: {
    regionSelected(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload;
    },

    regionAdded: {
      // `createRegion` mints a random id, so it must not run in the reducer:
      // replaying the same action would otherwise produce different state.
      prepare(input: {
        visible: readonly Region[];
        pageIndex: number;
        rect: Rect;
      }) {
        return {
          payload: {
            visible: input.visible,
            region: createRegion(input.pageIndex, input.rect),
          },
        };
      },
      reducer(
        state,
        action: PayloadAction<{
          visible: readonly Region[];
          region: Region;
        }>,
      ) {
        const base = editable(state, action.payload.visible);
        // The number depends on the list being joined, which only the reducer
        // can see; the id does not, hence its being minted in `prepare`.
        state.manual = [
          ...base,
          { ...action.payload.region, label: `Region ${base.length + 1}` },
        ];
        state.revision += 1;
      },
    },

    regionChanged(
      state,
      action: PayloadAction<{ visible: readonly Region[]; region: Region }>,
    ) {
      state.manual = updateRegion(
        editable(state, action.payload.visible),
        action.payload.region.id,
        action.payload.region,
      );
      state.revision += 1;
    },

    regionRemoved(
      state,
      action: PayloadAction<{ visible: readonly Region[]; id: string }>,
    ) {
      state.manual = removeRegion(
        editable(state, action.payload.visible),
        action.payload.id,
      );
      if (state.selectedId === action.payload.id) state.selectedId = null;
      state.revision += 1;
    },

    /** Hands control back to the part checkboxes. */
    regionsReset() {
      return initialState;
    },
  },
  extraReducers(builder) {
    builder
      .addCase(documentOpened, () => initialState)
      .addCase(documentClosed, () => initialState)
      .addCase(documentSaved, (state) => {
        state.savedRevision = state.revision;
      })
      .addCase(documentRestored, (state, action) => {
        const restored = action.payload.state;
        if (restored) {
          state.manual = restored.regions;
          state.originalManual = restored.regions;
        }
      });
  },
  selectors: {
    selectManualRegions: (state) => state.manual,
    selectSelectedRegionId: (state) => state.selectedId,
    /** True once the user has taken the rectangles over by hand. */
    selectIsManual: (state) => state.manual !== null,
    selectHasUnsavedRegions: (state) =>
      state.savedRevision === null
        ? !regionsUnchanged(state.manual, state.originalManual)
        : state.savedRevision !== state.revision,
  },
});

export const {
  regionSelected,
  regionAdded,
  regionChanged,
  regionRemoved,
  regionsReset,
} = regionsSlice.actions;

export const {
  selectManualRegions,
  selectSelectedRegionId,
  selectIsManual,
  selectHasUnsavedRegions,
} = regionsSlice.selectors;
