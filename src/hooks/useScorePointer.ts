import { createContext, useContext, useRef } from 'react';

export type ScorePointerPosition = {
  pageIndex: number;
  x: number;
  y: number;
};

export type ScorePointerRef = React.RefObject<ScorePointerPosition | null>;

const ScorePointerContext = createContext<ScorePointerRef | null>(null);

export const ScorePointerProvider = ScorePointerContext.Provider;

export function useScorePointerRef(): ScorePointerRef {
  const fallback = useRef<ScorePointerPosition | null>(null);
  return useContext(ScorePointerContext) ?? fallback;
}

export function useCreateScorePointerRef(): ScorePointerRef {
  return useRef<ScorePointerPosition | null>(null);
}
