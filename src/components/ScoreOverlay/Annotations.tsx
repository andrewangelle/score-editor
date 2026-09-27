import type { Dispatch, PointerEvent, SetStateAction } from 'react';
import type { Drag } from '#/components/ScoreOverlay/ScoreOverlay';
import {
  ANNOTATION_EDIT_HINT,
  SELECTED_ANNOTATION_ACTION_HINT,
} from '#/components/ScoreOverlay/ScoreOverlay.constants';
import {
  ANNOTATION_ANCHOR_CLASS,
  DRAFT_INPUT_CLASS,
  getAnnotationStyles,
} from '#/components/ScoreOverlay/ScoreOverlay.styles';
import {
  ANNOTATION_COLORS,
  type AnnotationKind,
  DEFAULT_COLOR,
  normalizeAnnotationText,
} from '#/lib/pdf/annotations/annotations';
import { toScreenPoint } from '#/lib/pdf/pageCoordinates';
import {
  annotationRemoved,
  annotationRetitled,
  selectAnnotations,
  selectSelectedAnnotationId,
} from '#/store/annotations.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { selectOverlay } from '#/store/selectors';

const PLACEHOLDER: Record<AnnotationKind, string> = {
  fingering: 'e.g. 1 3 2 4',
  string: 'String, e.g. 3',
  position: 'Position, e.g. V or 5',
  note: 'Performance note',
};

type AnnotationsProps = {
  editing: string | null;
  pageWidth: number;
  drag: Drag | null;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  setEditing: Dispatch<SetStateAction<string | null>>;
  onAnnotationPointerDown: (
    annotation: Drag,
  ) => (event: PointerEvent<HTMLButtonElement>) => void;
};

export function Annotations({
  editing,
  drag,
  pageWidth,
  draft,
  setDraft,
  setEditing,
  onAnnotationPointerDown,
}: AnnotationsProps) {
  const dispatch = useAppDispatch();
  const annotations = useAppSelector(selectAnnotations);
  const selectedId = useAppSelector(selectSelectedAnnotationId);
  const overlay = useAppSelector((state) => selectOverlay(state, pageWidth));

  const pageAnnotations = annotations.filter(
    (annotation) => annotation.pageIndex === overlay?.pageIndex,
  );

  function commitDraft(id: string, kind: AnnotationKind) {
    if (normalizeAnnotationText(kind, draft)) {
      dispatch(annotationRetitled({ id, text: draft }));
    } else {
      dispatch(annotationRemoved(id));
    }
    setEditing(null);
  }

  if (!overlay) {
    return null;
  }

  return pageAnnotations.map((annotation) => {
    const anchor = drag?.id === annotation.id ? drag : annotation;
    const screen = toScreenPoint(anchor, overlay.pageHeight, overlay.scale);
    const markFontSize = Math.max(3, annotation.size * overlay.scale);
    const circled = annotation.kind === 'string';
    const isSelected = annotation.id === selectedId;
    const ink = (
      ANNOTATION_COLORS[annotation.color] ?? ANNOTATION_COLORS[DEFAULT_COLOR]
    ).css;

    return (
      <div
        key={annotation.id}
        className={ANNOTATION_ANCHOR_CLASS}
        style={{ left: screen.x, top: screen.y }}
      >
        {editing === annotation.id ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: a freshly placed note is useless without focus
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => commitDraft(annotation.id, annotation.kind)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.currentTarget.blur();
              }
            }}
            className={DRAFT_INPUT_CLASS}
            placeholder={PLACEHOLDER[annotation.kind]}
          />
        ) : (
          <button
            type="button"
            onPointerDown={onAnnotationPointerDown(annotation)}
            onDoubleClick={() => {
              setEditing(annotation.id);
              setDraft(annotation.text);
            }}
            title={
              isSelected
                ? SELECTED_ANNOTATION_ACTION_HINT
                : ANNOTATION_EDIT_HINT
            }
            className={getAnnotationStyles(circled, isSelected)}
            style={
              circled
                ? {
                    fontSize: markFontSize,
                    color: ink,
                    borderColor: ink,
                    width: markFontSize * 1.8,
                    height: markFontSize * 1.8,
                  }
                : { fontSize: markFontSize, color: ink }
            }
          >
            {annotation.text || '…'}
          </button>
        )}
      </div>
    );
  });
}
