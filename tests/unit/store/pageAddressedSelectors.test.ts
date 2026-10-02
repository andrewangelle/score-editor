import type { ScoreAnalysis } from '#/lib/pdf/scoreAnalysis';
import { documentOpened } from '#/store/document.slice';
import { scoreAnalysed, scoreSlice } from '#/store/score.slice';
import { selectOverlay, selectStaffHints } from '#/store/selectors';

const ANALYSIS: ScoreAnalysis = {
  pages: [
    { pageIndex: 0, width: 612, height: 792, systems: [], markings: [] },
    { pageIndex: 1, width: 792, height: 612, systems: [], markings: [] },
  ],
  parts: [],
  irregularSystems: [],
};

const STATE = {
  score: [
    documentOpened({ id: 'doc-1', name: 'score.pdf', pages: [] }),
    scoreAnalysed({ documentId: 'doc-1', analysis: ANALYSIS }),
  ].reduce(scoreSlice.reducer, undefined),
};

describe('page-addressed selectors', () => {
  it('derive each page from its own source index', () => {
    expect(selectOverlay(STATE, 0, 612)).toMatchObject({
      pageIndex: 0,
      scale: 1,
    });
    expect(selectOverlay(STATE, 1, 396)).toMatchObject({
      pageIndex: 1,
      scale: 0.5,
    });
  });

  it('is null for a page analysis has not reached', () => {
    expect(selectOverlay(STATE, 5, 612)).toBeNull();
  });

  // Every mounted page calls these with its own index; a single-entry cache
  // would hand each one a fresh object and re-render every page every time.
  it('keeps a stable result per page across interleaved calls', () => {
    const first = selectOverlay(STATE, 0, 600);
    const second = selectOverlay(STATE, 1, 600);

    expect(selectOverlay(STATE, 0, 600)).toBe(first);
    expect(selectOverlay(STATE, 1, 600)).toBe(second);

    const hints = selectStaffHints(STATE, 0, 600);
    selectStaffHints(STATE, 1, 600);
    expect(selectStaffHints(STATE, 0, 600)).toBe(hints);
  });
});
