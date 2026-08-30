import {
  createSelector,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import type { Part } from '#/lib/pdf/partExtraction';
import type { ScoreAnalysis } from '#/lib/pdf/scoreAnalysis';
import {
  documentClosed,
  documentOpened,
  documentRestored,
} from '#/store/document.slice';

/**
 * What staff detection made of the open document.
 */
type ScoreState = {
  analysis: ScoreAnalysis | null;
  /** Why analysis produced nothing, when it failed. */
  note: string | null;
  selectedOrdinals: number[];
  keepMarkings: boolean;
  /** Names the user typed, by ordinal. */
  renames: Record<number, string>;
  /** A restored part selection waiting for the analysis it describes */
  pendingOrdinals: number[] | null;
  documentId: string | null;
};

const initialState: ScoreState = {
  analysis: null,
  note: null,
  selectedOrdinals: [],
  keepMarkings: true,
  renames: {},
  pendingOrdinals: null,
  documentId: null,
};

const NO_PARTS: Part[] = [];
const NO_IRREGULAR: ScoreAnalysis['irregularSystems'] = [];

/**
 * At module scope rather than inline, so the three selectors that need renamed
 * parts share one memoized result instead of each recomputing the map.
 */
const selectRenamedParts = createSelector(
  [
    (state: ScoreState) => state.analysis?.parts,
    (state: ScoreState) => state.renames,
  ],
  (parts, renames) =>
    parts?.map((part) => {
      const renamed = renames[part.ordinal];
      return renamed === undefined ? part : { ...part, name: renamed };
    }) ?? NO_PARTS,
);

export const scoreSlice = createSlice({
  name: 'score',
  initialState,
  reducers: {
    scoreAnalysed(
      state,
      action: PayloadAction<{ documentId: string; analysis: ScoreAnalysis }>,
    ) {
      if (action.payload.documentId !== state.documentId) return;

      state.analysis = action.payload.analysis;
      state.note = null;

      const detected = action.payload.analysis.parts.map(
        (part) => part.ordinal,
      );
      state.selectedOrdinals = detected;

      const pending = state.pendingOrdinals;
      if (!pending) return;
      state.pendingOrdinals = null;

      // Ex: a detection now finding eleven staves where it once found twelve
      const kept = pending.filter((ordinal) => detected.includes(ordinal));
      if (kept.length > 0 || pending.length === 0) {
        state.selectedOrdinals = kept;
      }
    },

    scoreAnalysisFailed(
      state,
      action: PayloadAction<{ documentId: string; message: string }>,
    ) {
      if (action.payload.documentId !== state.documentId) return;
      state.analysis = null;
      state.note = action.payload.message;
      state.selectedOrdinals = [];
      // There are no parts to apply it against, and none are coming.
      state.pendingOrdinals = null;
    },

    partToggled(state, action: PayloadAction<number>) {
      const at = state.selectedOrdinals.indexOf(action.payload);
      if (at === -1) {
        // Kept in staff order, which is the order extraction reads them in.
        state.selectedOrdinals.push(action.payload);
        state.selectedOrdinals.sort((a, b) => a - b);
      } else {
        state.selectedOrdinals.splice(at, 1);
      }
    },

    allPartsToggled(state) {
      const detected = state.analysis?.parts.map((part) => part.ordinal) ?? [];
      state.selectedOrdinals =
        state.selectedOrdinals.length === detected.length ? [] : detected;
    },

    markingsToggled(state) {
      state.keepMarkings = !state.keepMarkings;
    },

    partRenamed(
      state,
      action: PayloadAction<{ ordinal: number; name: string }>,
    ) {
      state.renames[action.payload.ordinal] = action.payload.name;
    },
  },
  extraReducers(builder) {
    // Detection describes one specific document, so it cannot outlive it.
    builder
      .addCase(documentOpened, (_state, action) => ({
        ...initialState,
        documentId: action.payload.id,
      }))
      .addCase(documentClosed, () => initialState)
      .addCase(documentRestored, (state, action) => {
        const restored = action.payload.state;
        if (!restored) return;

        state.keepMarkings = restored.keepMarkings;
        state.pendingOrdinals = restored.selectedOrdinals;
        for (const { ordinal, name } of restored.partNames) {
          state.renames[ordinal] = name;
        }
      });
  },
  selectors: {
    selectAnalysis: (state) => state.analysis,
    selectAnalysisNote: (state) => state.note,
    selectSelectedOrdinals: (state) => state.selectedOrdinals,
    selectParts: selectRenamedParts,
    selectPartNames: createSelector([selectRenamedParts], (parts) =>
      parts.map((part) => part.name),
    ),
    selectAllPartsSelected: createSelector(
      [selectRenamedParts, (state: ScoreState) => state.selectedOrdinals],
      (parts, ordinals) => parts.length > 0 && ordinals.length === parts.length,
    ),
    selectSelectedParts: createSelector(
      [selectRenamedParts, (state: ScoreState) => state.selectedOrdinals],
      (parts, ordinals) =>
        parts.filter((part) => ordinals.includes(part.ordinal)),
    ),
    selectRenames: createSelector(
      [(state: ScoreState) => state.renames],
      (renames) =>
        Object.entries(renames).map(([ordinal, name]) => ({
          ordinal: Number(ordinal),
          name,
        })),
    ),

    selectIrregularSystems: (state) =>
      state.analysis?.irregularSystems ?? NO_IRREGULAR,

    selectKeepMarkings: (state) => state.keepMarkings,

    /** How many measure numbers and tempo marks detection found, by kind. */
    selectMarkingCounts: createSelector(
      [(state: ScoreState) => state.analysis?.pages],
      (pages) => {
        const markings = pages?.flatMap((page) => page.markings) ?? [];
        return {
          measure: markings.filter((mark) => mark.kind === 'measure').length,
          tempo: markings.filter((mark) => mark.kind === 'tempo').length,
        };
      },
    ),
    selectSystemCount: createSelector(
      [(state: ScoreState) => state.analysis?.pages],
      (pages) =>
        pages?.reduce((sum, page) => sum + page.systems.length, 0) ?? 0,
    ),
  },
});

export const {
  scoreAnalysed,
  scoreAnalysisFailed,
  partToggled,
  allPartsToggled,
  partRenamed,
  markingsToggled,
} = scoreSlice.actions;

export const {
  selectAnalysis,
  selectAnalysisNote,
  selectSelectedOrdinals,
  selectParts,
  selectPartNames,
  selectAllPartsSelected,
  selectSelectedParts,
  selectRenames,
  selectIrregularSystems,
  selectKeepMarkings,
  selectMarkingCounts,
  selectSystemCount,
} = scoreSlice.selectors;
