import { configureStore } from '@reduxjs/toolkit';
import { annotationsSlice } from '#/store/annotations.slice';
import { documentSlice } from '#/store/document.slice';
import { regionsSlice } from '#/store/regions.slice';
import { scoreSlice } from '#/store/score.slice';
import { toolSlice } from '#/store/tool.slice';

export const makeStore = () =>
  configureStore({
    reducer: {
      document: documentSlice.reducer,
      score: scoreSlice.reducer,
      regions: regionsSlice.reducer,
      annotations: annotationsSlice.reducer,
      tool: toolSlice.reducer,
    },
  });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
