import { useEffect, useState } from 'react';

/**
 * Tracks the content width of an element so the PDF page can be rendered at the
 * exact pixel width available, rather than scaled with CSS after rasterizing.
 */
export function useElementWidth(element: HTMLElement | null): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, [element]);

  return width;
}
