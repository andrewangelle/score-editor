import { CollapsibleSection } from '#/components/EditScorePanel/CollapsibleSection';
import { ColorPicker } from '#/components/EditScorePanel/ColorPicker/ColorPicker';
import {
  ANNOTATION_VALUE_HINT,
  ANNOTATIONS,
  ANNOTATIONS_DESCRIPTION,
  FINGERING,
  PERFORMANCE,
  POSITION,
  POSITION_HINT,
  SELECT_ANNOTATION,
  STRING,
} from '#/components/EditScorePanel/EditScorePanel.constants';
import {
  PLACE_BUTTON_GRID_CLASS,
  SUBSECTION_CLASS,
} from '#/components/EditScorePanel/EditScorePanel.styles';
import { getAnnotationCountMessage } from '#/components/EditScorePanel/EditScorePanel.utils';
import { PlaceButton } from '#/components/EditScorePanel/PlaceButton/PlaceButton';
import { UpdateFontSize } from '#/components/EditScorePanel/UpdateFontSize/UpdateFontSize';
import { hasAnnotationValueMenu } from '#/lib/pdf/annotations/annotations';
import { selectAnnotationCount } from '#/store/annotations.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import {
  annotationColorPicked,
  selectAnnotationColor,
  selectPlacing,
  toolToggled,
} from '#/store/tool.slice';

export function AddAnnotations() {
  const dispatch = useAppDispatch();
  const annotationCount = useAppSelector(selectAnnotationCount);
  const placing = useAppSelector(selectPlacing);
  const annotationColor = useAppSelector(selectAnnotationColor);

  return (
    <CollapsibleSection
      data-testid="AddAnnotations"
      className="border-slate-200 border-t pt-4"
      title={ANNOTATIONS}
    >
      <p className="mt-0.5 text-slate-500 text-xs">{ANNOTATIONS_DESCRIPTION}</p>

      <p className={SUBSECTION_CLASS}>{SELECT_ANNOTATION}</p>

      <div className={PLACE_BUTTON_GRID_CLASS}>
        <PlaceButton
          active={placing === 'fingering'}
          onClick={() => dispatch(toolToggled('fingering'))}
        >
          {FINGERING}
        </PlaceButton>
        <PlaceButton
          active={placing === 'string'}
          onClick={() => dispatch(toolToggled('string'))}
        >
          {STRING}
        </PlaceButton>
        <PlaceButton
          active={placing === 'position'}
          onClick={() => dispatch(toolToggled('position'))}
        >
          {POSITION}
        </PlaceButton>
        <PlaceButton
          active={placing === 'note'}
          onClick={() => dispatch(toolToggled('note'))}
        >
          {PERFORMANCE}
        </PlaceButton>
      </div>

      <ColorPicker
        value={annotationColor}
        onPick={(color) => dispatch(annotationColorPicked(color))}
      />

      <UpdateFontSize />

      {placing && hasAnnotationValueMenu(placing) && (
        <p className="mt-2 text-slate-500 text-xs">{ANNOTATION_VALUE_HINT}</p>
      )}

      {placing === 'position' && (
        <p className="mt-2 text-slate-500 text-xs">{POSITION_HINT}</p>
      )}

      <p className="mt-3 text-slate-500 text-xs">
        {getAnnotationCountMessage(annotationCount)}
      </p>
    </CollapsibleSection>
  );
}
