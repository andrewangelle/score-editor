import { configureStore } from '@reduxjs/toolkit';
import { annotationsSlice } from '#/store/annotations.slice';
import { documentSlice } from '#/store/document.slice';
import { regionsSlice } from '#/store/regions.slice';
import { scoreSlice } from '#/store/score.slice';
import { toolSlice } from '#/store/tool.slice';

/**
 * Detection output is plain data, but there is a lot of it: a staff for every
 * system on every page, each a handful of numbers. The development-only
 * immutability and serializability checks walk the whole state tree on every
 * dispatch, and that subtree alone puts them tens of milliseconds behind — which
 * a region drag, dispatching as the pointer comes up, feels immediately.
 *
 * The checks stay on everywhere they can still catch something. `score.analysis`
 * is exempt because it is written once by `scoreAnalysed` and only ever read.
 */
const ANALYSIS_PATH = ['score.analysis'];

export const makeStore = () =>
  configureStore({
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
          // Carries the same tree as its payload.
          ignoredActions: ['score/scoreAnalysed'],
        },
      }),
  });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
