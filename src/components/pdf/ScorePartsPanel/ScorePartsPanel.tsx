import { IrregularSystemsNote } from '#/components/pdf/ScorePartsPanel/IrregularSystemsNote';
import { ManualInfo } from '#/components/pdf/ScorePartsPanel/ManualInfo';
import { PlaceButton } from '#/components/pdf/ScorePartsPanel/PlaceButton';
import { useAppDispatch, useAppSelector } from '#/hooks';
import type { Part } from '#/lib/pdf/partExtraction';
import { selectAnnotationCount } from '#/store/annotations.slice';
import { regionsReset, selectIsManual } from '#/store/regions.slice';
import {
  partRenamed,
  partToggled,
  selectIrregularSystems,
  selectParts,
  selectSelectedOrdinals,
  selectSystemCount,
} from '#/store/score.slice';
import { selectRegions } from '#/store/selectors';
import {
  selectIsEditingRegions,
  selectPlacing,
  toolToggled,
} from '#/store/tool.slice';

type ScorePartsPanelProps = {
  /** Extraction needs the document bytes, so it stays with the editor. */
  onExtract: () => void;
  isBusy: boolean;
};

export function ScorePartsPanel({ onExtract, isBusy }: ScorePartsPanelProps) {
  const dispatch = useAppDispatch();
  const annotationCount = useAppSelector(selectAnnotationCount);
  const parts = useAppSelector(selectParts);
  const selectedOrdinals = useAppSelector(selectSelectedOrdinals);
  const irregularSystems = useAppSelector(selectIrregularSystems);
  const systems = useAppSelector(selectSystemCount);
  const regionCount = useAppSelector(selectRegions).length;
  const isManual = useAppSelector(selectIsManual);
  const editingRegions = useAppSelector(selectIsEditingRegions);
  const placing = useAppSelector(selectPlacing);

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l border-slate-200 bg-white p-4">
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
                className="size-4 shrink-0 accent-blue-600 disabled:opacity-40"
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
                className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-sm hover:border-slate-300 focus:border-blue-400 focus:outline-none"
              />
            </li>
          ))}
        </ul>

        {irregularSystems.length > 0 && <IrregularSystemsNote />}

        <button
          type="button"
          onClick={onExtract}
          disabled={isBusy || regionCount === 0}
          className="mt-4 w-full rounded-lg bg-blue-600 px-3 py-2 font-medium text-sm text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isBusy
            ? 'Extracting…'
            : `Extract ${regionCount} ${regionCount === 1 ? 'region' : 'regions'}`}
        </button>
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
          className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-slate-700 text-xs hover:border-slate-400 disabled:opacity-40"
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

        <div className="mt-3 flex gap-2">
          <PlaceButton
            active={placing === 'fingering'}
            onClick={() => dispatch(toolToggled('fingering'))}
          >
            Fingering
          </PlaceButton>
          <PlaceButton
            active={placing === 'note'}
            onClick={() => dispatch(toolToggled('note'))}
          >
            Performance
          </PlaceButton>
        </div>

        <p className="mt-3 text-slate-500 text-xs">
          {annotationCount} placed · double-click to edit, drag to move
        </p>
      </section>
    </aside>
  );
}
