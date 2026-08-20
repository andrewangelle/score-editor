import { createSelector } from '@reduxjs/toolkit';
import { EDITOR_STATE_VERSION } from '#/lib/pdf/editorState';
import { type Region, regionsFromParts } from '#/lib/pdf/regions';
import { selectManualRegions } from '#/store/regions.slice';
import {
  selectAnalysis,
  selectKeepMarkings,
  selectPartNames,
  selectRenames,
  selectSelectedOrdinals,
} from '#/store/score.slice';

/**
 * Selectors that answer a question no single slice owns.
 *
 * These live here rather than in a slice because they read across two of them,
 * and a slice that reached into its neighbour would stop being movable.
 */

const NO_REGIONS: Region[] = [];

/** The rectangles detection proposes for the parts currently checked. */
const selectDetectedRegions = createSelector(
  [selectAnalysis, selectSelectedOrdinals, selectPartNames],
  (analysis, ordinals, names) =>
    analysis ? regionsFromParts(analysis.pages, ordinals, names) : NO_REGIONS,
);

/** What extraction will actually cut: the user's rectangles, or detection's. */
export const selectRegions = createSelector(
  [selectManualRegions, selectDetectedRegions],
  (manual, detected) => manual ?? detected,
);

export const selectEditorState = createSelector(
  [
    selectManualRegions,
    selectKeepMarkings,
    selectSelectedOrdinals,
    selectRenames,
  ],
  (regions, keepMarkings, selectedOrdinals, partNames) => ({
    v: EDITOR_STATE_VERSION,
    regions,
    keepMarkings,
    selectedOrdinals,
    partNames,
  }),
);
