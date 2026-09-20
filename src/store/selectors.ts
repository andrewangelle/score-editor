import { createSelector } from '@reduxjs/toolkit';
import {
  DEFAULT_SIZE,
  hasAnnotationValueMenu,
} from '#/lib/pdf/annotations/annotations';
import { EDITOR_STATE_VERSION } from '#/lib/pdf/editorState';
import { type Region, regionsFromParts } from '#/lib/pdf/regions';
import {
  selectAnnotations,
  selectHasUnsavedAnnotations,
  selectSelectedAnnotationId,
} from '#/store/annotations.slice';
import {
  selectHasUnsavedChanges as selectHasUnsavedDocument,
  selectPages,
  selectSelectedPageId,
} from '#/store/document.slice';
import {
  selectHasUnsavedRegions,
  selectManualRegions,
} from '#/store/regions.slice';
import {
  selectAnalysis,
  selectKeepMarkings,
  selectPartNames,
  selectRenames,
  selectSelectedOrdinals,
} from '#/store/score.slice';
import {
  selectAnnotationFontSize,
  selectAnnotationValue,
  selectPlacing,
} from '#/store/tool.slice';

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
    analysis && sourcePage && pageWidth && selectedPage
      ? { analysis, sourcePage, scale: pageWidth / sourcePage.width }
      : null,
);

export const selectAnnotationValueMenu = createSelector(
  [selectPlacing, selectAnnotationValue],
  (placing, value) => {
    const kind = placing && hasAnnotationValueMenu(placing) ? placing : null;
    return {
      value,
      kind,
    };
  },
);

export const selectSelectedAnnotationSize = createSelector(
  [selectAnnotations, selectSelectedAnnotationId],
  (items, id) => {
    if (!id) return null;
    return items.find((a) => a.id === id)?.size ?? null;
  },
);

export const selectHasUnsavedChanges = createSelector(
  [
    selectHasUnsavedDocument,
    selectHasUnsavedAnnotations,
    selectHasUnsavedRegions,
  ],
  (document, annotations, regions) => document || annotations || regions,
);

export const selectAnnotationFontSizeValue = createSelector(
  [
    selectSelectedAnnotationId,
    selectSelectedAnnotationSize,
    selectAnnotationFontSize,
    selectPlacing,
  ],
  (selectedAnnotationId, selectedAnnotationSize, fontSize, placing) => {
    if (!selectedAnnotationId) return fontSize ?? '';
    const kindDefault = placing ? DEFAULT_SIZE[placing] : null;
    const userHasTyped = fontSize !== null && fontSize !== kindDefault;
    return userHasTyped ? fontSize : (selectedAnnotationSize ?? '');
  },
);
