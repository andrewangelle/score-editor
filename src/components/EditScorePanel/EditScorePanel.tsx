import { AddAnnotations } from '#/components/EditScorePanel/AddAnnotations';
import { DetectedParts } from '#/components/EditScorePanel/DetectedParts';
import { EditRegions } from '#/components/EditScorePanel/EditRegions';
import { PANEL_CLASS } from '#/components/EditScorePanel/EditScorePanel.styles';
import { ScoreMetadata } from '#/components/EditScorePanel/ScoreMetadata';

export function EditScorePanel() {
  return (
    <aside data-testid="EditScorePanel" className={PANEL_CLASS}>
      <DetectedParts />
      <AddAnnotations />
      <ScoreMetadata />
      <EditRegions />
    </aside>
  );
}
