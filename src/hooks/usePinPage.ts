import { useEffect } from 'react';
import { usePageContext } from '#/components/PDFViewer/PageContext';
import { useAppDispatch } from '#/store/hooks';
import { activePageCleared, activePageSet } from '#/store/tool.slice';

/** Keeps this page mounted while `active`, however far it is scrolled away. */
export function usePinPage(active: boolean) {
  const dispatch = useAppDispatch();
  const { pageId } = usePageContext();

  useEffect(() => {
    if (!active) {
      return;
    }

    dispatch(activePageSet(pageId));
    return () => {
      dispatch(activePageCleared(pageId));
    };
  }, [active, pageId, dispatch]);
}
