import { createContext, useContext } from 'react';

export type PageContextValue = {
  /** The page's `PageEdit` id, stable across moves and deletes. */
  pageId: string;
  /** The page's index in the source PDF, which is what overlays are keyed by. */
  sourceIndex: number;
  pageWidth: number;
};

export const PageContext = createContext<PageContextValue | null>(null);

export function usePageContext(): PageContextValue {
  const value = useContext(PageContext);
  if (!value) {
    throw new Error('usePageContext must be used inside a PageContext');
  }
  return value;
}
