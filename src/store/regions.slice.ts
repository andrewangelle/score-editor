import { createSlice, current, type PayloadAction } from '@reduxjs/toolkit';
import {
  createRegion,
  type Region,
  removeRegion,
  updateRegion,
} from '#/lib/pdf/regions';
import type { Rect } from '#/lib/pdf/staffDetection';
import { documentClosed, documentOpened } from '#/store/document.slice';

/**
 * The rectangles extraction will cut.
 *
 * Detection proposes a set derived from the checked parts; the moment the user
 * draws or drags one, that proposal stops applying and their list becomes the
 * truth. `manual` holds that takeover — null while the part checkboxes are
 * still in charge.
 *
 * Because the proposal lives in the score slice, the first hand edit has to be
 * told what was on screen to take over from: that is the `visible` field on
 * these payloads, and it is read only when `manual` is still null.
 */
type RegionsState = {
  manual: Region[] | null;
  selectedId: string | null;
};

const initialState: RegionsState = { manual: null, selectedId: null };

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
      reducer(
        state,
        action: PayloadAction<{
          visible: readonly Region[];
          region: Region;
        }>,
      ) {
        const base = editable(state, action.payload.visible);
        // The number depends on the list being joined, which only the reducer
        // can see; the id does not, which is why it is minted in `prepare`.
        state.manual = [
          ...base,
          { ...action.payload.region, label: `Region ${base.length + 1}` },
        ];
      },
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
    },

    /** Hands control back to the part checkboxes. */
    regionsReset() {
      return initialState;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(documentOpened, () => initialState)
      .addCase(documentClosed, () => initialState);
  },
  selectors: {
    selectManualRegions: (state) => state.manual,
    selectSelectedRegionId: (state) => state.selectedId,
    /** True once the user has taken the rectangles over by hand. */
    selectIsManual: (state) => state.manual !== null,
  },
});

export const {
  regionSelected,
  regionAdded,
  regionChanged,
  regionRemoved,
  regionsReset,
} = regionsSlice.actions;

export const { selectManualRegions, selectSelectedRegionId, selectIsManual } =
  regionsSlice.selectors;
