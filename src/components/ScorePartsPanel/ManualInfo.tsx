import { MANUAL_INFO_CLASS } from '#/components/ScorePartsPanel/ScorePartsPanel.styles';

export function ManualInfo() {
  return (
    <p className={MANUAL_INFO_CLASS}>
      Regions were edited by hand, so they no longer follow these checkboxes.
      Reset them below to go back to the detected staves.
    </p>
  );
}
