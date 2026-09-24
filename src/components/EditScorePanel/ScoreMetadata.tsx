import { CollapsibleSection } from '#/components/EditScorePanel/CollapsibleSection';
import {
  EXPORT_TEMPO_MAP,
  EXPORT_TIME_SIGNATURE_MAP,
  SCORE_METADATA,
} from '#/components/EditScorePanel/EditScorePanel.constants';
import { EXPORT_MARKINGS_BUTTON_CLASS } from '#/components/EditScorePanel/EditScorePanel.styles';
import { markingsExportOpened, selectIsBusy } from '#/store/document.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { selectMarkingCounts } from '#/store/score.slice';

export function ScoreMetadata() {
  const markings = useAppSelector(selectMarkingCounts);
  const dispatch = useAppDispatch();
  const isBusy = useAppSelector(selectIsBusy);

  return (
    <CollapsibleSection
      data-testid="ScoreMetadata"
      className="border-slate-200 border-t pt-4"
      title={SCORE_METADATA}
    >
      <button
        type="button"
        onClick={() => dispatch(markingsExportOpened('time-signature'))}
        disabled={isBusy || markings.timeSignature === 0}
        className={EXPORT_MARKINGS_BUTTON_CLASS}
      >
        {EXPORT_TIME_SIGNATURE_MAP}
      </button>

      <button
        type="button"
        onClick={() => dispatch(markingsExportOpened('tempo'))}
        disabled={isBusy || markings.tempo === 0}
        className={EXPORT_MARKINGS_BUTTON_CLASS}
      >
        {EXPORT_TEMPO_MAP}
      </button>
    </CollapsibleSection>
  );
}
