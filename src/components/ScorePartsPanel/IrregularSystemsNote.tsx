import { IRREGULAR_SYSTEMS_NOTE_CLASS } from '#/components/ScorePartsPanel/ScorePartsPanel.styles';
import { useAppSelector } from '#/store/hooks';
import { selectIrregularSystems } from '#/store/score.slice';

export function IrregularSystemsNote() {
  const irregularSystems = useAppSelector(selectIrregularSystems);
  return (
    <p className={IRREGULAR_SYSTEMS_NOTE_CLASS}>
      {irregularSystems.length}{' '}
      {irregularSystems.length === 1 ? 'system has' : 'systems have'} a
      different number of staves than the first. Those systems are extracted by
      staff position, so check the result around page{' '}
      {irregularSystems[0].pageIndex + 1}.
    </p>
  );
}
