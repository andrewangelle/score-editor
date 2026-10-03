import { PARTS } from '#/components/PDFEditor/PDFEditor.constants';
import { PARTS_ASIDE_CLASS } from '#/components/PDFEditor/PDFEditor.styles';
import { getLoadingStavesMessage } from '#/components/PDFEditor/PDFEditor.utils';
import { useAppSelector } from '#/store/hooks';
import {
  selectAnalysisNote,
  selectAnalysisProgress,
} from '#/store/score.slice';

export function LoadingStaves() {
  const progress = useAppSelector(selectAnalysisProgress);
  return (
    <aside className={PARTS_ASIDE_CLASS}>
      <h2 className="font-semibold text-slate-900 text-sm">{PARTS}</h2>
      <p className="mt-2 text-slate-500 text-xs">
        {getLoadingStavesMessage(progress)}
      </p>
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
