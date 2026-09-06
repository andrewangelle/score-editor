import type { ScoreAnalysis } from '#/lib/pdf/scoreAnalysis';
import { documentClosed, documentOpened } from '#/store/document.slice';
import {
  allPartsToggled,
  partRenamed,
  partToggled,
  scoreAnalysed,
  scoreAnalysisFailed,
  scoreSlice,
  selectPartNames,
} from '#/store/score.slice';

const ANALYSIS: ScoreAnalysis = {
  pages: [
    { pageIndex: 0, width: 612, height: 792, systems: [], markings: [] },
  ],
  parts: [
    { id: 'part-0', ordinal: 0, name: 'Flute' },
    { id: 'part-1', ordinal: 1, name: 'Guitar' },
    { id: 'part-2', ordinal: 2, name: 'Cello' },
  ],
  irregularSystems: [],
};

const DOC = 'doc-1';

const OPENED = scoreSlice.reducer(
  undefined,
  documentOpened({ id: DOC, name: 'score.pdf', pages: [] }),
);

const ANALYSED = scoreSlice.reducer(
  OPENED,
  scoreAnalysed({ documentId: DOC, analysis: ANALYSIS }),
);

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
      scoreSlice.reducer(
        OPENED,
        scoreAnalysisFailed({ documentId: DOC, message: 'no staves found' }),
      ),
      scoreAnalysed({ documentId: DOC, analysis: ANALYSIS }),
    );

    expect(recovered.note).toBeNull();
    expect(recovered.analysis).toEqual(ANALYSIS);
  });
});

describe('scoreAnalysisFailed', () => {
  it('leaves a note and nothing to extract', () => {
    const state = run(
      scoreAnalysisFailed({
        documentId: DOC,
        message: 'not an engraved score',
      }),
    );

    expect(state.analysis).toBeNull();
    expect(state.note).toBe('not an engraved score');
    expect(state.selectedOrdinals).toEqual([]);
  });
});

/**
 * Detection is slow enough on a dense score to still be running when the next
 * document is opened, and nothing cancels it.
 */
describe('an analysis that has been overtaken', () => {
  const opened2 = scoreSlice.reducer(
    ANALYSED,
    documentOpened({ id: 'doc-2', name: 'other.pdf', pages: [] }),
  );

  it('does not land on the document that replaced it', () => {
    const state = scoreSlice.reducer(
      opened2,
      scoreAnalysed({ documentId: DOC, analysis: ANALYSIS }),
    );

    expect(state.analysis).toBeNull();
    expect(state.selectedOrdinals).toEqual([]);
  });

  it('does not report its failure against that document either', () => {
    const state = scoreSlice.reducer(
      opened2,
      scoreAnalysisFailed({ documentId: DOC, message: 'no staves found' }),
    );

    expect(state.note).toBeNull();
  });

  it('is ignored once the document is closed', () => {
    const state = scoreSlice.reducer(
      scoreSlice.reducer(ANALYSED, documentClosed()),
      scoreAnalysed({ documentId: DOC, analysis: ANALYSIS }),
    );

    expect(state.analysis).toBeNull();
  });

  it('still lands when it is the document being waited on', () => {
    const state = scoreSlice.reducer(
      opened2,
      scoreAnalysed({ documentId: 'doc-2', analysis: ANALYSIS }),
    );

    expect(state.analysis).toEqual(ANALYSIS);
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

describe('allPartsToggled', () => {
  const { selectAllPartsSelected } = scoreSlice.selectors;

  it('clears a full selection', () => {
    const state = run(allPartsToggled());

    expect(state.selectedOrdinals).toEqual([]);
    expect(selectAllPartsSelected({ score: state })).toBe(false);
  });

  it('fills an empty one', () => {
    const state = run(allPartsToggled(), allPartsToggled());

    expect(state.selectedOrdinals).toEqual([0, 1, 2]);
    expect(selectAllPartsSelected({ score: state })).toBe(true);
  });

  it('fills a part-way one rather than clearing it', () => {
    const state = run(partToggled(1), allPartsToggled());

    expect(state.selectedOrdinals).toEqual([0, 1, 2]);
  });

  it('reports nothing selected when nothing was detected', () => {
    expect(selectAllPartsSelected({ score: OPENED })).toBe(false);
  });
});

describe('partRenamed', () => {
  it('renames by ordinal, leaving the rest alone', () => {
    const state = run(partRenamed({ ordinal: 1, name: 'Guitar I' }));

    expect(selectPartNames({ score: state })).toEqual([
      'Flute',
      'Guitar I',
      'Cello',
    ]);
  });

  it('leaves detection itself untouched', () => {
    // A name lives beside the analysis, never inside it: detection output is
    // recomputed on every open, and a name written into it could not survive
    // one.
    const state = run(partRenamed({ ordinal: 1, name: 'Guitar I' }));

    expect(state.analysis?.parts.map((part) => part.name)).toEqual([
      'Flute',
      'Guitar',
      'Cello',
    ]);
  });

  it('shows nothing for an ordinal that was never detected', () => {
    const state = run(partRenamed({ ordinal: 9, name: 'Tuba' }));

    expect(selectPartNames({ score: state })).toEqual([
      'Flute',
      'Guitar',
      'Cello',
    ]);
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
    const empty = scoreSlice.reducer(
      OPENED,
      scoreAnalysisFailed({ documentId: DOC, message: 'none' }),
    );

    // A fresh array each call would retrigger every subscribed component.
    expect(selectParts({ score: empty })).toBe(selectParts({ score: empty }));
  });
});
