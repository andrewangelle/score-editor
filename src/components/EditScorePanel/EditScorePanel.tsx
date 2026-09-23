import { AddAnnotations } from '#/components/EditScorePanel/AddAnnotations';
import { DetectedParts } from '#/components/EditScorePanel/DetectedParts';
import { EditRegions } from '#/components/EditScorePanel/EditRegions';
import { PANEL_CLASS } from '#/components/EditScorePanel/EditScorePanel.styles';
import type { MarkingsExportKind } from '#/lib/pdf/markings/markings.extract';

export type EditScorePanelProps = {
  replaceTarget: { name: string; onReplace: () => void } | null;
  isBusy: boolean;
  onExtract: () => void;
  onExportMarkings: (kind: MarkingsExportKind) => void;
};

export function EditScorePanel({
  onExtract,
  onExportMarkings,
  replaceTarget,
  isBusy,
}: EditScorePanelProps) {
  return (
    <aside data-testid="EditScorePanel" className={PANEL_CLASS}>
      <DetectedParts
        isBusy={isBusy}
        replaceTarget={replaceTarget}
        onExtract={onExtract}
        onExportMarkings={onExportMarkings}
      />
      <AddAnnotations />
      <EditRegions />
    </aside>
  );
}
