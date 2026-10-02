import { usePageContext } from '#/components/PDFViewer/PageContext';
import {
  STAFF_HINT_CLASS,
  STAFF_LABEL_CLASS,
} from '#/components/ScoreOverlay/ScoreOverlay.styles';
import { useAppSelector } from '#/store/hooks';
import { selectStaffHints } from '#/store/selectors';

export function StaffHints() {
  const { sourceIndex, pageWidth } = usePageContext();
  const staffHints = useAppSelector((state) =>
    selectStaffHints(state, sourceIndex, pageWidth),
  );
  return staffHints.map(({ id, top, height, name }, index) => (
    <div
      data-testid={`StaffHint-${index}`}
      key={id}
      aria-hidden
      className={STAFF_HINT_CLASS}
      style={{
        left: 0,
        top,
        width: '100%',
        height,
      }}
    >
      {name && <span className={STAFF_LABEL_CLASS}>{name}</span>}
    </div>
  ));
}
