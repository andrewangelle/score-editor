import { FINISHING_ANALYSIS_HINT } from '#/components/EditScorePanel/EditScorePanel.constants';
import { FINISHING_ANALYSIS_CLASS } from '#/components/EditScorePanel/EditScorePanel.styles';
import { getFinishingAnalysisMessage } from '#/components/EditScorePanel/EditScorePanel.utils';
import { useAppSelector } from '#/store/hooks';
import { selectAnalysisProgress } from '#/store/score.slice';

export function FinishingAnalysis() {
  const progress = useAppSelector(selectAnalysisProgress);
  return (
    <p
      data-testid="FinishingAnalysis"
      role="status"
      className={FINISHING_ANALYSIS_CLASS}
    >
      {getFinishingAnalysisMessage(progress)}
      <span className="block">{FINISHING_ANALYSIS_HINT}</span>
    </p>
  );
}
