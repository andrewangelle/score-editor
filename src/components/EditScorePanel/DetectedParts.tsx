import { useState } from 'react';
import { CollapsibleSection } from '#/components/EditScorePanel/CollapsibleSection';
import {
  CANCEL,
  DESELECT_ALL,
  KEEP_MEASURE,
  MANUAL_INFO,
  PARTS,
  REPLACE,
  SELECT_ALL,
  TEMPO_MARKS,
} from '#/components/EditScorePanel/EditScorePanel.constants';
import {
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
import { downloadBytes } from '#/components/PDFEditor/PDFEditor.utils';
import { useExtractToFile } from '#/hooks/useExtractToFile';
import { useExtractWith } from '#/hooks/useExtractWith';
import { documentFileHandle } from '#/lib/pdf/document/document.bytes';
import { type Part, partFileName } from '#/lib/pdf/partExtraction';
import {
  selectDocumentId,
  selectDocumentName,
  selectIsBusy,
} from '#/store/document.slice';
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
  selectSelectedParts,
  selectSystemCount,
} from '#/store/score.slice';
import { selectRegions } from '#/store/selectors';

export function DetectedParts() {
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
  const name = useAppSelector(selectDocumentName);
  const selectedParts = useAppSelector(selectSelectedParts);
  const extractWith = useExtractWith();
  const isBusy = useAppSelector(selectIsBusy);
  const documentId = useAppSelector(selectDocumentId);
  const fileHandle = documentFileHandle(documentId);
  const handleExtractToFile = useExtractToFile();

  const replaceTarget = fileHandle
    ? { name: fileHandle.name, onReplace: handleExtractToFile }
    : null;

  /** Downloads the cut regions, leaving the score where it is. */
  function handleExtract() {
    return extractWith((extracted) => {
      const fileName = partFileName(
        name,
        isManual ? [] : selectedParts,
        'regions',
      );
      downloadBytes(extracted, fileName, 'application/pdf');
      return `Saved ${fileName}`;
    });
  }

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
        onClick={handleExtract}
        disabled={isBusy || regionCount === 0}
        className={EXTRACT_BUTTON_CLASS}
      >
        {getBusyMessage(isBusy, regionCount)}
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
