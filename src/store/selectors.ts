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
import { selectPages, selectSelectedPageId } from './document.slice';

/**
 * Selectors that read across two slices. They live here rather than in one of
 * them because a slice reaching into its neighbour stops being movable.
 */

const NO_REGIONS: Region[] = [];

const selectDetectedRegions = createSelector(
  [selectAnalysis, selectSelectedOrdinals, selectPartNames],
  (analysis, ordinals, names) =>
    analysis ? regionsFromParts(analysis.pages, ordinals, names) : NO_REGIONS,
);

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

export const selectSelectedPage = createSelector(
  [selectPages, selectSelectedPageId],
  (pages, selectedId) =>
    pages.find((page) => page.id === selectedId) ?? pages[0],
);

export const selectSourcePage = createSelector(
  [selectAnalysis, selectSelectedPage],
  (analysis, selectedPage) => analysis?.pages[selectedPage?.sourceIndex ?? -1],
);

export const selectOverlay = createSelector(
  [
    selectAnalysis,
    selectSourcePage,
    selectSelectedPage,
    (_state, pageWidth?: number) => pageWidth,
  ],
  (analysis, sourcePage, selectedPage, pageWidth) =>
    analysis &&
    sourcePage &&
    pageWidth &&
    selectedPage &&
    selectedPage.rotation === 0
      ? { analysis, sourcePage, scale: pageWidth / sourcePage.width }
      : null,
);
