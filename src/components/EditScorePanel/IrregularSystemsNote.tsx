import { IRREGULAR_SYSTEMS_NOTE_CLASS } from '#/components/EditScorePanel/EditScorePanel.styles';
import { getIrregularSystemsMessage } from '#/components/EditScorePanel/EditScorePanel.utils';
import { useAppSelector } from '#/store/hooks';
import { selectIrregularSystems } from '#/store/score.slice';

export function IrregularSystemsNote() {
  const irregularSystems = useAppSelector(selectIrregularSystems);
  return (
    <p className={IRREGULAR_SYSTEMS_NOTE_CLASS}>
      {getIrregularSystemsMessage(
        irregularSystems.length,
        irregularSystems[0].pageIndex,
      )}
    </p>
  );
}
