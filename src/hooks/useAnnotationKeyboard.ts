import { useEffect } from 'react';
import type { ScorePointerRef } from '#/hooks/useScorePointer';
import {
  annotationCopied,
  annotationPasted,
  annotationRedone,
  annotationUndone,
  selectCanRedoAnnotation,
  selectCanUndoAnnotation,
  selectClipboard,
  selectSelectedAnnotationId,
} from '#/store/annotations.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';

const PASTE_OFFSET = 5;

export function useAnnotationKeyboard(pointerRef: ScorePointerRef) {
  const dispatch = useAppDispatch();
  const selectedId = useAppSelector(selectSelectedAnnotationId);
  const clipboard = useAppSelector(selectClipboard);
  const canUndo = useAppSelector(selectCanUndoAnnotation);
  const canRedo = useAppSelector(selectCanRedoAnnotation);

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // ensure Ctrl is clicked
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.key === 'c' && selectedId) {
        event.preventDefault();
        dispatch(annotationCopied(selectedId));
        return;
      }

      if (event.key === 'v' && clipboard) {
        event.preventDefault();
        const pointer = pointerRef.current;
        if (pointer) {
          dispatch(
            annotationPasted({
              pageIndex: pointer.pageIndex,
              x: pointer.x,
              y: pointer.y,
              kind: clipboard.kind,
              color: clipboard.color,
              text: clipboard.text,
              size: clipboard.size,
            }),
          );
        } else {
          dispatch(
            annotationPasted({
              pageIndex: clipboard.pageIndex,
              x: clipboard.x + PASTE_OFFSET,
              y: clipboard.y - PASTE_OFFSET,
              kind: clipboard.kind,
              color: clipboard.color,
              text: clipboard.text,
              size: clipboard.size,
            }),
          );
        }
        return;
      }

      if (event.key === 'z' && !event.shiftKey && canUndo) {
        event.preventDefault();
        dispatch(annotationUndone());
        return;
      }

      if (event.key === 'z' && event.shiftKey && canRedo) {
        event.preventDefault();
        dispatch(annotationRedone());
      }
    }

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [dispatch, selectedId, clipboard, canUndo, canRedo, pointerRef]);
}
