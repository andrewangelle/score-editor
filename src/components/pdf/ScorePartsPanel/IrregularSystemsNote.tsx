import { useAppSelector } from '#/hooks';
import { selectIrregularSystems } from '#/store/score.slice';

export function IrregularSystemsNote() {
  const irregularSystems = useAppSelector(selectIrregularSystems);
  return (
    <p className="mt-3 rounded bg-amber-50 p-2 text-amber-800 text-xs">
      {irregularSystems.length}{' '}
      {irregularSystems.length === 1 ? 'system has' : 'systems have'} a
      different number of staves than the first. Those systems are extracted by
      staff position, so check the result around page{' '}
      {irregularSystems[0].pageIndex + 1}.
    </p>
  );
}
