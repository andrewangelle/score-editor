import {
  createSelector,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import type { Part } from '#/lib/pdf/partExtraction';
import type { ScoreAnalysis } from '#/lib/pdf/scoreAnalysis';
import { documentClosed, documentOpened } from '#/store/document.slice';

/**
 * What staff detection made of the open document.
 *
 * Analysis is a best-effort enrichment: it runs after the document is already
 * on screen, and a document it cannot read leaves the plain page editor
 * perfectly usable. `analysis` and `note` are therefore the two outcomes of one
 * attempt, never both at once.
 */
type ScoreState = {
  analysis: ScoreAnalysis | null;
  /** Why analysis produced nothing, when it failed. */
  note: string | null;
  /** Ordinals of the parts currently checked for extraction. */
  selectedOrdinals: number[];
  /**
   * Carry each system's measure numbers and tempo marks into the parts cut from
   * it. On by default: a part without them is hard to rehearse from, and a
   * score prints them only above its top staff.
   */
  keepMarkings: boolean;
  /**
   * The document detection is currently describing, or being run for.
   *
   * Analysis is slow enough on a dense score to still be running when the next
   * document is opened, and nothing cancels it. Both outcomes therefore carry
   * the document they were asked about, and one that no longer matches this is
   * dropped rather than attributed to whatever is on screen now.
   */
  documentId: string | null;
};

const initialState: ScoreState = {
  analysis: null,
  note: null,
  selectedOrdinals: [],
  keepMarkings: true,
  documentId: null,
};

const NO_PARTS: Part[] = [];
const NO_IRREGULAR: ScoreAnalysis['irregularSystems'] = [];

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
      // Everything detected starts checked; the user narrows from there.
      state.selectedOrdinals = action.payload.analysis.parts.map(
        (part) => part.ordinal,
      );
    },

    scoreAnalysisFailed(
      state,
      action: PayloadAction<{ documentId: string; message: string }>,
    ) {
      if (action.payload.documentId !== state.documentId) return;
      state.analysis = null;
      state.note = action.payload.message;
      state.selectedOrdinals = [];
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

    markingsToggled(state) {
      state.keepMarkings = !state.keepMarkings;
    },

    partRenamed(
      state,
      action: PayloadAction<{ ordinal: number; name: string }>,
    ) {
      const part = state.analysis?.parts.find(
        (candidate) => candidate.ordinal === action.payload.ordinal,
      );
      if (part) part.name = action.payload.name;
    },
  },
  extraReducers: (builder) => {
    // Detection describes one specific document, so it cannot outlive it.
    builder
      .addCase(documentOpened, (_state, action) => ({
        ...initialState,
        documentId: action.payload.id,
      }))
      .addCase(documentClosed, () => initialState);
  },
  selectors: {
    selectAnalysis: (state) => state.analysis,
    selectAnalysisNote: (state) => state.note,
    selectSelectedOrdinals: (state) => state.selectedOrdinals,
    selectParts: (state) => state.analysis?.parts ?? NO_PARTS,
    selectPartNames: createSelector(
      [(state: ScoreState) => state.analysis?.parts],
      (parts) => parts?.map((part) => part.name) ?? [],
    ),
    selectSelectedParts: createSelector(
      [
        (state: ScoreState) => state.analysis?.parts,
        (state: ScoreState) => state.selectedOrdinals,
      ],
      (parts, ordinals) =>
        parts?.filter((part) => ordinals.includes(part.ordinal)) ?? NO_PARTS,
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
  partRenamed,
  markingsToggled,
} = scoreSlice.actions;

export const {
  selectAnalysis,
  selectAnalysisNote,
  selectSelectedOrdinals,
  selectParts,
  selectPartNames,
  selectSelectedParts,
  selectIrregularSystems,
  selectKeepMarkings,
  selectMarkingCounts,
  selectSystemCount,
} = scoreSlice.selectors;
