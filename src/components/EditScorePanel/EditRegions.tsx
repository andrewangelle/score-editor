import { CollapsibleSection } from '#/components/EditScorePanel/CollapsibleSection';
import {
  DONE_EDITING,
  EDIT_REGIONS,
  EDIT_REGIONS_HINT,
  REGIONS,
  REGIONS_DESCRIPTION,
  RESET_REGIONS,
} from '#/components/EditScorePanel/EditScorePanel.constants';
import { RESET_REGIONS_BUTTON_CLASS } from '#/components/EditScorePanel/EditScorePanel.styles';
import { PlaceButton } from '#/components/EditScorePanel/PlaceButton/PlaceButton';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { regionsReset, selectIsManual } from '#/store/regions.slice';
import { selectIsEditingRegions, toolToggled } from '#/store/tool.slice';

export function EditRegions() {
  const dispatch = useAppDispatch();
  const isManual = useAppSelector(selectIsManual);
  const editingRegions = useAppSelector(selectIsEditingRegions);

  return (
    <CollapsibleSection
      data-testid="EditRegionsSection"
      className="border-slate-200 border-t pt-4"
      title={REGIONS}
    >
      <p className="mt-0.5 text-slate-500 text-xs">{REGIONS_DESCRIPTION}</p>

      <div className="mt-3 flex">
        <PlaceButton
          active={editingRegions}
          onClick={() => dispatch(toolToggled('regions'))}
        >
          {editingRegions ? DONE_EDITING : EDIT_REGIONS}
        </PlaceButton>
      </div>

      {editingRegions && (
        <p className="mt-2 text-slate-500 text-xs">{EDIT_REGIONS_HINT}</p>
      )}

      <button
        type="button"
        onClick={() => dispatch(regionsReset())}
        disabled={!isManual}
        className={RESET_REGIONS_BUTTON_CLASS}
      >
        {RESET_REGIONS}
      </button>
    </CollapsibleSection>
  );
}
