import { usePageContext } from '#/components/PDFViewer/PageContext';
import type { Cursor } from '#/components/ScoreOverlay/ScoreOverlay';
import {
  cursorMarkInk,
  getCursorMarkStyles,
} from '#/components/ScoreOverlay/ScoreOverlay.styles';
import { DEFAULT_SIZE } from '#/lib/pdf/annotations/annotations';
import { useAppSelector } from '#/store/hooks';
import { selectAnnotationCarrying, selectOverlay } from '#/store/selectors';
import {
  selectAnnotationColor,
  selectAnnotationFontSize,
} from '#/store/tool.slice';

type AnnotationCursorPreviewProps = {
  cursor: Cursor | null;
};

export function AnnotationCursorPreview({
  cursor,
}: AnnotationCursorPreviewProps) {
  const { sourceIndex, pageWidth } = usePageContext();
  const color = useAppSelector(selectAnnotationColor);
  const carrying = useAppSelector(selectAnnotationCarrying);
  const overlay = useAppSelector((state) =>
    selectOverlay(state, sourceIndex, pageWidth),
  );
  const fontSize = useAppSelector(selectAnnotationFontSize);

  if (carrying && cursor && overlay) {
    return (
      <div
        data-testid="AnnotationCursorPreview"
        aria-hidden
        className={getCursorMarkStyles(carrying.kind === 'string')}
        style={{
          left: cursor.clientX,
          top: cursor.clientY,
          ...cursorMarkInk(
            carrying.kind,
            color,
            overlay.scale,
            fontSize ?? DEFAULT_SIZE[carrying.kind],
          ),
        }}
      >
        {carrying.text}
      </div>
    );
  }
  return null;
}
