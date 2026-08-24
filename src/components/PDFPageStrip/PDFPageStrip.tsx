import { useEffect, useRef } from 'react';
import { Page } from 'react-pdf';
import {
  getThumbnailStyles,
  PAGE_CONTROLS_CLASS,
  PAGE_LABEL_CLASS,
  PAGE_LIST_CLASS,
} from '#/components/PDFPageStrip/PDFPageStrip.styles';
import { StripButton } from '#/components/StripButton/StripButton';
import {
  pageDeleted,
  pageMoved,
  pageRotated,
  pageSelected,
  selectPages,
  selectSelectedPageId,
} from '#/store/document.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';

const THUMBNAIL_WIDTH = 108;

export function PDFPageStrip() {
  const dispatch = useAppDispatch();
  const pages = useAppSelector(selectPages);
  const selectedId = useAppSelector(selectSelectedPageId);
  const selectedItem = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (!selectedId) return;

    selectedItem.current?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [selectedId]);

  return (
    <ol className={PAGE_LIST_CLASS}>
      {pages.map((page, index) => {
        const isSelected = page.id === selectedId;

        return (
          <li key={page.id} ref={isSelected ? selectedItem : null}>
            <button
              type="button"
              onClick={() => dispatch(pageSelected(page.id))}
              aria-current={isSelected}
              className={getThumbnailStyles(isSelected)}
            >
              <span className="flex justify-center overflow-hidden">
                <Page
                  pageNumber={page.sourceIndex + 1}
                  rotate={page.rotation}
                  width={THUMBNAIL_WIDTH}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading=""
                />
              </span>
              <span className={PAGE_LABEL_CLASS}>Page {index + 1}</span>
            </button>

            <div className={PAGE_CONTROLS_CLASS}>
              <StripButton
                label={`Rotate page ${index + 1} left`}
                onClick={() =>
                  dispatch(pageRotated({ id: page.id, delta: -90 }))
                }
              >
                ↺
              </StripButton>
              <StripButton
                label={`Rotate page ${index + 1} right`}
                onClick={() =>
                  dispatch(pageRotated({ id: page.id, delta: 90 }))
                }
              >
                ↻
              </StripButton>
              <StripButton
                label={`Move page ${index + 1} up`}
                disabled={index === 0}
                onClick={() =>
                  dispatch(pageMoved({ id: page.id, direction: -1 }))
                }
              >
                ↑
              </StripButton>
              <StripButton
                label={`Move page ${index + 1} down`}
                disabled={index === pages.length - 1}
                onClick={() =>
                  dispatch(pageMoved({ id: page.id, direction: 1 }))
                }
              >
                ↓
              </StripButton>
              <StripButton
                label={`Delete page ${index + 1}`}
                disabled={pages.length === 1}
                destructive
                onClick={() => dispatch(pageDeleted(page.id))}
              >
                ✕
              </StripButton>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
