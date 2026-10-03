import { createSelector } from '@reduxjs/toolkit';
import {
  DEFAULT_SIZE,
  hasAnnotationValueMenu,
} from '#/lib/pdf/annotations/annotations';
import { EDITOR_STATE_VERSION } from '#/lib/pdf/editorState';
import { staffBounds } from '#/lib/pdf/partExtraction';
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
  selectParts,
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
const NO_STAFF_HINTS: never[] = [];

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

export const selectSourcePageAt = createSelector(
  [selectAnalysis, (_state, sourceIndex: number) => sourceIndex],
  (analysis, sourceIndex) => analysis?.pages[sourceIndex],
);

/**
 * Several pages are mounted at once, each calling this with its own
 * `sourceIndex`. RTK 2's default `weakMapMemoize` caches per argument tuple, so
 * they do not evict each other — `lruMemoize` here would recompute every page on
 * every render.
 */
export const selectOverlay = createSelector(
  [
    selectSourcePageAt,
    (_state, sourceIndex: number) => sourceIndex,
    (_state, _sourceIndex: number, pageWidth: number) => pageWidth,
  ],
  (sourcePage, sourceIndex, pageWidth) =>
    sourcePage && pageWidth
      ? {
          pageIndex: sourceIndex,
          pageWidth: sourcePage.width,
          pageHeight: sourcePage.height,
          scale: pageWidth / sourcePage.width,
          systems: sourcePage.systems,
        }
      : null,
);

export const selectStaffHints = createSelector(
  [selectOverlay, selectParts],
  (overlay, parts) =>
    overlay?.systems.flatMap((system, systemIndex) =>
      system.staves.map((_, ordinal) => {
        const { top, bottom } = staffBounds(system, ordinal, overlay.systems);
        return {
          id: `${systemIndex}-${ordinal}`,
          top: (overlay.pageHeight - top) * overlay.scale,
          height: (top - bottom) * overlay.scale,
          name: parts?.[ordinal]?.name,
        };
      }),
    ) ?? NO_STAFF_HINTS,
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

export const selectSelectedAnnotationColor = createSelector(
  [selectAnnotations, selectSelectedAnnotationId],
  (items, id) => {
    if (!id) return null;
    return items.find((a) => a.id === id)?.color ?? null;
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
    if (!selectedAnnotationId) {
      return fontSize ?? '';
    }
    const kindDefault = placing ? DEFAULT_SIZE[placing] : null;
    const userHasTyped = fontSize !== null && fontSize !== kindDefault;
    return userHasTyped ? fontSize : (selectedAnnotationSize ?? '');
  },
);

export const selectAnnotationCarrying = createSelector(
  [selectPlacing, selectAnnotationValue],
  (placing, value) => {
    if (placing && value) {
      return { kind: placing, text: value };
    }

    return null;
  },
);
