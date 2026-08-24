import { useState } from 'react';
import { ColorPicker } from '#/components/ScorePartsPanel/ColorPicker/ColorPicker';
import { IrregularSystemsNote } from '#/components/ScorePartsPanel/IrregularSystemsNote';
import { ManualInfo } from '#/components/ScorePartsPanel/ManualInfo';
import { PlaceButton } from '#/components/ScorePartsPanel/PlaceButton/PlaceButton';
import {
  EXTRACT_BUTTON_CLASS,
  MARKINGS_CHECKBOX_CLASS,
  MARKINGS_LABEL_CLASS,
  PANEL_CLASS,
  PART_CHECKBOX_CLASS,
  PART_NAME_INPUT_CLASS,
  PLACE_BUTTON_GRID_CLASS,
  REPLACE_BUTTON_CLASS,
  REPLACE_CANCEL_BUTTON_CLASS,
  REPLACE_CONFIRM_BUTTON_CLASS,
  REPLACE_CONFIRM_CLASS,
  RESET_REGIONS_BUTTON_CLASS,
} from '#/components/ScorePartsPanel/ScorePartsPanel.styles';
import type { Part } from '#/lib/pdf/partExtraction';
import { selectAnnotationCount } from '#/store/annotations.slice';
import { useAppDispatch, useAppSelector } from '#/store/hooks';
import { regionsReset, selectIsManual } from '#/store/regions.slice';
import {
  markingsToggled,
  partRenamed,
  partToggled,
  selectIrregularSystems,
  selectKeepMarkings,
  selectMarkingCounts,
  selectParts,
  selectSelectedOrdinals,
  selectSystemCount,
} from '#/store/score.slice';
import { selectRegions } from '#/store/selectors';
import {
  annotationColorPicked,
  selectAnnotationColor,
  selectIsEditingRegions,
  selectPlacing,
  toolToggled,
} from '#/store/tool.slice';

type ScorePartsPanelProps = {
  /** Extraction needs the document bytes, so it stays with the editor. */
  onExtract: () => void;
  /**
   * Where the regions can be written in place, if anywhere. Null when the file
   * was not opened through a picker that gives a writable handle.
   */
  replaceTarget: { name: string; onReplace: () => void } | null;
  isBusy: boolean;
};

export function ScorePartsPanel({
  onExtract,
  replaceTarget,
  isBusy,
}: ScorePartsPanelProps) {
  const dispatch = useAppDispatch();
  /**
   * The one thing here that cannot be undone: the score the file held is gone
   * from disk afterwards, and only the copy in this tab can put it back. So it
   * asks rather than acting on the click that lands on it.
   */
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const annotationCount = useAppSelector(selectAnnotationCount);
  const parts = useAppSelector(selectParts);
  const selectedOrdinals = useAppSelector(selectSelectedOrdinals);
  const irregularSystems = useAppSelector(selectIrregularSystems);
  const systems = useAppSelector(selectSystemCount);
  const regionCount = useAppSelector(selectRegions).length;
  const isManual = useAppSelector(selectIsManual);
  const editingRegions = useAppSelector(selectIsEditingRegions);
  const placing = useAppSelector(selectPlacing);
  const annotationColor = useAppSelector(selectAnnotationColor);
  const keepMarkings = useAppSelector(selectKeepMarkings);
  const markings = useAppSelector(selectMarkingCounts);

  return (
    <aside className={PANEL_CLASS}>
      <section>
        <h2 className="font-semibold text-slate-900 text-sm">Parts</h2>
        <p className="mt-0.5 text-slate-500 text-xs">
          {parts.length} staves · {systems} systems detected
        </p>

        {isManual && <ManualInfo />}

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
                aria-label={`Name for staff ${part.ordinal + 1}`}
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
            Keep measure numbers &amp; tempo marks
            <span className="block text-slate-500">
              {markings.measure} measure{' '}
              {markings.measure === 1 ? 'number' : 'numbers'}
              {' · '}
              {markings.tempo} tempo {markings.tempo === 1 ? 'mark' : 'marks'}{' '}
              found. A score prints these for the system as a whole, so they are
              stamped above every part cut from it.
            </span>
          </span>
        </label>

        <button
          type="button"
          onClick={onExtract}
          disabled={isBusy || regionCount === 0}
          className={EXTRACT_BUTTON_CLASS}
        >
          {isBusy
            ? 'Extracting…'
            : `Extract ${regionCount} ${regionCount === 1 ? 'region' : 'regions'}`}
        </button>

        {replaceTarget &&
          (confirmingReplace ? (
            <div className={REPLACE_CONFIRM_CLASS}>
              <p className="text-red-800 text-xs">
                Replace{' '}
                <span className="font-medium">{replaceTarget.name}</span> with
                the {regionCount} {regionCount === 1 ? 'region' : 'regions'}?
                The score in that file is overwritten, and only this tab still
                has it.
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
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingReplace(false)}
                  className={REPLACE_CANCEL_BUTTON_CLASS}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingReplace(true)}
              disabled={isBusy || regionCount === 0}
              className={REPLACE_BUTTON_CLASS}
            >
              Extract into {replaceTarget.name}
            </button>
          ))}
      </section>

      <section className="border-slate-200 border-t pt-4">
        <h2 className="font-semibold text-slate-900 text-sm">Regions</h2>
        <p className="mt-0.5 text-slate-500 text-xs">
          The rectangles that will be cut. Detection proposes them; adjust or
          add your own for anything it gets wrong — or for a PDF with no staves
          at all.
        </p>

        <div className="mt-3 flex">
          <PlaceButton
            active={editingRegions}
            onClick={() => dispatch(toolToggled('regions'))}
          >
            {editingRegions ? 'Done editing' : 'Edit regions'}
          </PlaceButton>
        </div>

        {editingRegions && (
          <p className="mt-2 text-slate-500 text-xs">
            Drag on empty space to add. Drag a rectangle to move it, or its
            edges to resize. Select one to delete it.
          </p>
        )}

        <button
          type="button"
          onClick={() => dispatch(regionsReset())}
          disabled={!isManual}
          className={RESET_REGIONS_BUTTON_CLASS}
        >
          Reset to detected staves
        </button>
      </section>

      <section className="border-slate-200 border-t pt-4">
        <h2 className="font-semibold text-slate-900 text-sm">Notes</h2>
        <p className="mt-0.5 text-slate-500 text-xs">
          Click the page to place. Notes stay anchored to the music, so they
          follow into every part you extract.
        </p>

        {/*
          A grid rather than a row: four labels of different lengths in one flex
          line leave "Fingering" and "Performance" different widths, and these
          are picked up and put down constantly.
        */}
        <div className={PLACE_BUTTON_GRID_CLASS}>
          <PlaceButton
            active={placing === 'fingering'}
            onClick={() => dispatch(toolToggled('fingering'))}
          >
            Fingering
          </PlaceButton>
          <PlaceButton
            active={placing === 'string'}
            onClick={() => dispatch(toolToggled('string'))}
          >
            String ③
          </PlaceButton>
          <PlaceButton
            active={placing === 'position'}
            onClick={() => dispatch(toolToggled('position'))}
          >
            Position Ⅴ
          </PlaceButton>
          <PlaceButton
            active={placing === 'note'}
            onClick={() => dispatch(toolToggled('note'))}
          >
            Performance
          </PlaceButton>
        </div>

        <ColorPicker
          value={annotationColor}
          onPick={(color) => dispatch(annotationColorPicked(color))}
        />

        {placing === 'position' && (
          <p className="mt-2 text-slate-500 text-xs">
            Type a roman numeral, or a number to have it converted — 7 becomes
            VII.
          </p>
        )}

        <p className="mt-3 text-slate-500 text-xs">
          {annotationCount} placed · double-click to edit, drag to move
        </p>
      </section>
    </aside>
  );
}
