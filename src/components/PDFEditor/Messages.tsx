import {
  LOADING_STAVES,
  PARTS,
} from '#/components/PDFEditor/PDFEditor.constants';
import { PARTS_ASIDE_CLASS } from '#/components/PDFEditor/PDFEditor.styles';
import { useAppSelector } from '#/store/hooks';
import { selectAnalysisNote } from '#/store/score.slice';

export function LoadingStaves() {
  return (
    <aside className={PARTS_ASIDE_CLASS}>
      <h2 className="font-semibold text-slate-900 text-sm">{PARTS}</h2>
      <p className="mt-2 text-slate-500 text-xs">{LOADING_STAVES}</p>
    </aside>
  );
}

export function AnalysisNote() {
  const analysisNote = useAppSelector(selectAnalysisNote);
  return (
    <aside className={PARTS_ASIDE_CLASS}>
      <h2 className="font-semibold text-slate-900 text-sm">{PARTS}</h2>
      <p className="mt-2 text-slate-500 text-xs">{analysisNote}</p>
    </aside>
  );
}
