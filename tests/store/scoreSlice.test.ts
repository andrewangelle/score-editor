import type { ScoreAnalysis } from '#/lib/pdf/scoreAnalysis';
import { documentClosed, documentOpened } from '#/store/document.slice';
import {
  partRenamed,
  partToggled,
  scoreAnalysed,
  scoreAnalysisFailed,
  scoreSlice,
} from '#/store/score.slice';

const ANALYSIS: ScoreAnalysis = {
  pages: [{ pageIndex: 0, width: 612, height: 792, systems: [] }],
  parts: [
    { id: 'part-0', ordinal: 0, name: 'Flute' },
    { id: 'part-1', ordinal: 1, name: 'Guitar' },
    { id: 'part-2', ordinal: 2, name: 'Cello' },
  ],
  irregularSystems: [],
};

const ANALYSED = scoreSlice.reducer(undefined, scoreAnalysed(ANALYSIS));

function run(...actions: Parameters<typeof scoreSlice.reducer>[1][]) {
  return actions.reduce(scoreSlice.reducer, ANALYSED);
}

describe('scoreAnalysed', () => {
  it('checks every detected part', () => {
    expect(ANALYSED.analysis).toEqual(ANALYSIS);
    expect(ANALYSED.selectedOrdinals).toEqual([0, 1, 2]);
    expect(ANALYSED.note).toBeNull();
  });

  it('clears a note left by an earlier failure', () => {
    const recovered = scoreSlice.reducer(
      scoreSlice.reducer(undefined, scoreAnalysisFailed('no staves found')),
      scoreAnalysed(ANALYSIS),
    );

    expect(recovered.note).toBeNull();
    expect(recovered.analysis).toEqual(ANALYSIS);
  });
});

describe('scoreAnalysisFailed', () => {
  it('leaves a note and nothing to extract', () => {
    const state = run(scoreAnalysisFailed('not an engraved score'));

    expect(state.analysis).toBeNull();
    expect(state.note).toBe('not an engraved score');
    expect(state.selectedOrdinals).toEqual([]);
  });
});

describe('partToggled', () => {
  it('unchecks a part', () => {
    expect(run(partToggled(1)).selectedOrdinals).toEqual([0, 2]);
  });

  it('rechecks it back into staff order, not at the end', () => {
    expect(run(partToggled(0), partToggled(0)).selectedOrdinals).toEqual([
      0, 1, 2,
    ]);
  });

  it('allows checking nothing at all', () => {
    const state = run(partToggled(0), partToggled(1), partToggled(2));

    expect(state.selectedOrdinals).toEqual([]);
  });
});

describe('partRenamed', () => {
  it('renames by ordinal, leaving the rest alone', () => {
    const state = run(partRenamed({ ordinal: 1, name: 'Guitar I' }));

    expect(state.analysis?.parts.map((part) => part.name)).toEqual([
      'Flute',
      'Guitar I',
      'Cello',
    ]);
  });

  it('ignores an ordinal that was never detected', () => {
    expect(run(partRenamed({ ordinal: 9, name: 'Tuba' }))).toEqual(ANALYSED);
  });
});

describe('following the document', () => {
  it('drops detection when the document closes', () => {
    const state = run(documentClosed());

    expect(state.analysis).toBeNull();
    expect(state.selectedOrdinals).toEqual([]);
  });

  it('drops detection when a different document is opened', () => {
    const state = run(
      documentOpened({ id: 'doc-2', name: 'other.pdf', pages: [] }),
    );

    expect(state.analysis).toBeNull();
    expect(state.note).toBeNull();
  });
});

describe('selectors', () => {
  const { selectPartNames, selectSelectedParts, selectParts } =
    scoreSlice.selectors;

  it('reads names in staff order', () => {
    expect(selectPartNames({ score: ANALYSED })).toEqual([
      'Flute',
      'Guitar',
      'Cello',
    ]);
  });

  it('narrows the parts to what is checked', () => {
    const state = run(partToggled(1));

    expect(
      selectSelectedParts({ score: state }).map((part) => part.name),
    ).toEqual(['Flute', 'Cello']);
  });

  it('returns a stable empty list when nothing was detected', () => {
    const empty = scoreSlice.reducer(undefined, scoreAnalysisFailed('none'));

    // A fresh array each call would retrigger every subscribed component.
    expect(selectParts({ score: empty })).toBe(selectParts({ score: empty }));
  });
});
