import { AddAnnotations } from '#/components/EditScorePanel/AddAnnotations';
import { DetectedParts } from '#/components/EditScorePanel/DetectedParts';
import { EditRegions } from '#/components/EditScorePanel/EditRegions';
import { PANEL_CLASS } from '#/components/EditScorePanel/EditScorePanel.styles';
import { FinishingAnalysis } from '#/components/EditScorePanel/FinishingAnalysis';
import { ScoreMetadata } from '#/components/EditScorePanel/ScoreMetadata';
import { useAppSelector } from '#/store/hooks';
import { selectAnalysisComplete } from '#/store/score.slice';

/** Opens once parts are known; what needs every page waits on `complete`. */
export function EditScorePanel() {
  const complete = useAppSelector(selectAnalysisComplete);
  return (
    <aside data-testid="EditScorePanel" className={PANEL_CLASS}>
      {!complete && <FinishingAnalysis />}
      <DetectedParts />
      <AddAnnotations />
      <ScoreMetadata />
      <EditRegions />
    </aside>
  );
}
