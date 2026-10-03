import { configureStore, createListenerMiddleware } from '@reduxjs/toolkit';
import {
  analyzePage,
  finishAnalysis,
  openScoreDocument,
  resolveParts,
} from '#/lib/pdf/analysis/analysis.score';
import { documentBytes } from '#/lib/pdf/document/document.bytes';
import {
  type AnalysisExtra,
  type AnalysisStartListening,
  registerAnalysisListeners,
} from '#/store/analysis.listeners';
import { annotationsSlice } from '#/store/annotations.slice';
import { documentSlice } from '#/store/document.slice';
import { regionsSlice } from '#/store/regions.slice';
import { scoreSlice } from '#/store/score.slice';
import { toolSlice } from '#/store/tool.slice';

/**
 * Detection output is plain data but there is a lot of it — a staff for every
 * system on every page. RTK's dev-only immutability and serializability checks
 * walk the whole state tree per dispatch, and that subtree alone costs them tens
 * of milliseconds, which a region drag feels immediately.
 *
 * The checks stay on everywhere they can still catch something; `score.analysis`
 * and `score.pages` are exempt because each entry is written once and only ever
 * read.
 */
const ANALYSIS_PATH = ['score.analysis', 'score.pages'];

/**
 * The listener middleware is per store: `extra` is fixed when it is created, so
 * a shared instance could not take test fakes, and stores would share listeners.
 */
export const makeStore = (extraOverrides: Partial<AnalysisExtra> = {}) => {
  const listenerMiddleware = createListenerMiddleware({
    extra: {
      openScoreDocument,
      analyzePage,
      resolveParts,
      finishAnalysis,
      documentBytes,
      ...extraOverrides,
    } satisfies AnalysisExtra,
  });

  const store = configureStore({
    reducer: {
      document: documentSlice.reducer,
      score: scoreSlice.reducer,
      regions: regionsSlice.reducer,
      annotations: annotationsSlice.reducer,
      tool: toolSlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        immutableCheck: { ignoredPaths: ANALYSIS_PATH },
        serializableCheck: {
          ignoredPaths: ANALYSIS_PATH,
          // Carry the same tree as their payloads.
          ignoredActions: ['score/scoreAnalysed', 'score/scorePageAnalysed'],
        },
      }).prepend(listenerMiddleware.middleware),
  });

  registerAnalysisListeners(
    listenerMiddleware.startListening as AnalysisStartListening,
  );
  return store;
};

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
