import { useState } from 'react';
import { CollapsibleSection } from '#/components/EditScorePanel/CollapsibleSection';
import type { EditScorePanelProps } from '#/components/EditScorePanel/EditScorePanel';
import {
  CANCEL,
  DESELECT_ALL,
  EXPORT_TEMPO_MAP,
  EXPORT_TIME_SIGNATURE_MAP,
  KEEP_MEASURE,
  MANUAL_INFO,
  PARTS,
  REPLACE,
  SELECT_ALL,
  TEMPO_MARKS,
} from '#/components/EditScorePanel/EditScorePanel.constants';
import {
  EXPORT_MARKINGS_BUTTON_CLASS,
  EXTRACT_BUTTON_CLASS,
  MANUAL_INFO_CLASS,
  MARKINGS_CHECKBOX_CLASS,
  MARKINGS_LABEL_CLASS,
  PART_CHECKBOX_CLASS,
  PART_NAME_INPUT_CLASS,
  REPLACE_BUTTON_CLASS,
  REPLACE_CANCEL_BUTTON_CLASS,
  REPLACE_CONFIRM_BUTTON_CLASS,
  REPLACE_CONFIRM_CLASS,
  TOGGLE_ALL_PARTS_BUTTON_CLASS,
} from '#/components/EditScorePanel/EditScorePanel.styles';
import {
  getBusyMessage,
  getDetectedPartsMessage,
  getDetectionDescription,
  getExtractIntoMessage,
  getPartNameLabel,
  getReplaceConfirmMessage,
} from '#/components/EditScorePanel/EditScorePanel.utils';
import { IrregularSystemsNote } from '#/components/EditScorePanel/IrregularSystemsNote';
import type { Part } from '#/lib/pdf/partExtraction';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { selectIsManual } from '#/store/regions.slice';
import {
  allPartsToggled,
  markingsToggled,
  partRenamed,
  partToggled,
  selectAllPartsSelected,
  selectIrregularSystems,
  selectKeepMarkings,
  selectMarkingCounts,
  selectParts,
  selectSelectedOrdinals,
  selectSystemCount,
} from '#/store/score.slice';
import { selectRegions } from '#/store/selectors';

export function DetectedParts({
  onExtract,
  onExportMarkings,
  replaceTarget,
  isBusy,
}: EditScorePanelProps) {
  const dispatch = useAppDispatch();
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const parts = useAppSelector(selectParts);
  const selectedOrdinals = useAppSelector(selectSelectedOrdinals);
  const allSelected = useAppSelector(selectAllPartsSelected);
  const irregularSystems = useAppSelector(selectIrregularSystems);
  const instruments = useAppSelector(selectSystemCount);
  const regionCount = useAppSelector(selectRegions).length;
  const isManual = useAppSelector(selectIsManual);
  const keepMarkings = useAppSelector(selectKeepMarkings);
  const markings = useAppSelector(selectMarkingCounts);

  return (
    <CollapsibleSection
      data-testid="DetectedParts"
      title={PARTS}
      headerRight={
        <button
          type="button"
          onClick={() => dispatch(allPartsToggled())}
          disabled={isManual || parts.length === 0}
          className={TOGGLE_ALL_PARTS_BUTTON_CLASS}
        >
          {allSelected ? DESELECT_ALL : SELECT_ALL}
        </button>
      }
    >
      <p className="mt-0.5 text-slate-500 text-xs">
        {getDetectedPartsMessage(parts, instruments)}
      </p>

      {isManual && <p className={MANUAL_INFO_CLASS}>{MANUAL_INFO}</p>}

      <ul className="mt-3 space-y-1">
        {parts.map((part: Part) => (
          <li key={part.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              id={part.id}
              checked={selectedOrdinals.includes(part.ordinal)}
              onChange={() => dispatch(partToggled(part.ordinal))}
              disabled={isManual}
              className={PART_CHECKBOX_CLASS}
            />
            <input
              aria-label={getPartNameLabel(part.ordinal)}
              value={part.name}
              onChange={(event) =>
                dispatch(
                  partRenamed({
                    ordinal: part.ordinal,
                    name: event.target.value,
                  }),
                )
              }
              className={PART_NAME_INPUT_CLASS}
            />
          </li>
        ))}
      </ul>

      {irregularSystems.length > 0 && <IrregularSystemsNote />}

      <label className={MARKINGS_LABEL_CLASS}>
        <input
          type="checkbox"
          checked={keepMarkings}
          onChange={() => dispatch(markingsToggled())}
          className={MARKINGS_CHECKBOX_CLASS}
        />
        <span>
          {KEEP_MEASURE} &amp; {TEMPO_MARKS}
          <span className="block text-slate-500">
            {getDetectionDescription(markings)}
          </span>
        </span>
      </label>

      <button
        type="button"
        onClick={onExtract}
        disabled={isBusy || regionCount === 0}
        className={EXTRACT_BUTTON_CLASS}
      >
        {getBusyMessage(isBusy, regionCount)}
      </button>

      <button
        type="button"
        onClick={() => onExportMarkings('time-signature')}
        disabled={isBusy || markings.timeSignature === 0}
        className={EXPORT_MARKINGS_BUTTON_CLASS}
      >
        {EXPORT_TIME_SIGNATURE_MAP}
      </button>

      <button
        type="button"
        onClick={() => onExportMarkings('tempo')}
        disabled={isBusy || markings.tempo === 0}
        className={EXPORT_MARKINGS_BUTTON_CLASS}
      >
        {EXPORT_TEMPO_MAP}
      </button>

      {replaceTarget && (
        <>
          {confirmingReplace && (
            <div className={REPLACE_CONFIRM_CLASS}>
              <p className="text-red-800 text-xs">
                {REPLACE}{' '}
                <span className="font-medium">{replaceTarget.name}</span>{' '}
                {getReplaceConfirmMessage(regionCount)}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingReplace(false);
                    replaceTarget.onReplace();
                  }}
                  disabled={isBusy}
                  className={REPLACE_CONFIRM_BUTTON_CLASS}
                >
                  {REPLACE}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingReplace(false)}
                  className={REPLACE_CANCEL_BUTTON_CLASS}
                >
                  {CANCEL}
                </button>
              </div>
            </div>
          )}

          {!confirmingReplace && (
            <button
              type="button"
              onClick={() => setConfirmingReplace(true)}
              disabled={isBusy || regionCount === 0}
              className={REPLACE_BUTTON_CLASS}
            >
              {getExtractIntoMessage(replaceTarget.name)}
            </button>
          )}
        </>
      )}
    </CollapsibleSection>
  );
}
