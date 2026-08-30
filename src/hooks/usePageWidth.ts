import { useElementWidth } from '#/hooks/useElementWidth';

const MAX_PAGE_WIDTH = 900;

export function usePageWidth(element: HTMLDivElement | null) {
  const stageWidth = useElementWidth(element);
  return stageWidth ? Math.min(stageWidth - 32, MAX_PAGE_WIDTH) : undefined;
}
