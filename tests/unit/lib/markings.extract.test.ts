import type { Marking } from '#/lib/pdf/markings/markings';
import {
  collectMarkingsRows,
  markingsExportFileName,
} from '#/lib/pdf/markings/markings.extract';
import type { ScoreAnalysis, ScorePage } from '#/lib/pdf/scoreAnalysis';

function marking(
  overrides: Partial<Marking> & { kind: Marking['kind'] },
): Marking {
  return {
    id: `m-${Math.random().toString(36).slice(2, 6)}`,
    text: '',
    pageIndex: 0,
    systemIndex: 0,
    rect: { left: 100, right: 150, bottom: 700, top: 720 },
    ...overrides,
  };
}

function scorePage(
  pageIndex: number,
  systemCount: number,
  markings: Marking[] = [],
): ScorePage {
  return {
    pageIndex,
    width: 612,
    height: 792,
    systems: Array.from({ length: systemCount }, (_, i) => ({
      staves: [
        {
          top: 700 - i * 100,
          bottom: 680 - i * 100,
          left: 100,
          right: 500,
          lineSpacing: 5,
          lineCount: 5,
          contentTop: 700 - i * 100,
          contentBottom: 680 - i * 100,
        },
      ],
      left: 100,
      right: 500,
      top: 700 - i * 100,
      bottom: 680 - i * 100,
    })),
    markings,
  };
}

function analysis(pages: ScorePage[]): ScoreAnalysis {
  return {
    pages,
    parts: [{ id: 'part-0', ordinal: 0, name: 'Staff 1' }],
    irregularSystems: [],
  };
}

describe('collectMarkingsRows', () => {
  it('groups events with their nearest measure number', () => {
    const m1 = marking({
      kind: 'measure',
      text: '1',
      rect: { left: 100, right: 120, bottom: 720, top: 730 },
    });
    const m5 = marking({
      kind: 'measure',
      text: '5',
      rect: { left: 300, right: 320, bottom: 720, top: 730 },
    });
    const m9 = marking({
      kind: 'measure',
      text: '9',
      pageIndex: 0,
      systemIndex: 0,
      rect: { left: 400, right: 420, bottom: 720, top: 730 },
    });
    const tempo1 = marking({
      kind: 'tempo',
      text: 'Allegro',
      rect: { left: 105, right: 180, bottom: 740, top: 750 },
    });
    const tempo5 = marking({
      kind: 'tempo',
      text: 'Andante',
      rect: { left: 305, right: 380, bottom: 740, top: 750 },
    });

    const result = collectMarkingsRows(
      analysis([scorePage(0, 1, [m1, m5, m9, tempo1, tempo5])]),
    );

    expect(result.measuresInferred).toBe(false);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].measure).toBe(1);
    expect(result.rows[0].eventMarkings[0].text).toBe('Allegro');
    expect(result.rows[1].measure).toBe(5);
    expect(result.rows[1].eventMarkings[0].text).toBe('Andante');
  });

  it('includes time-signature events', () => {
    const m1 = marking({ kind: 'measure', text: '1' });
    const ts = marking({
      kind: 'time-signature',
      text: '3/4',
      rect: { left: 105, right: 120, bottom: 690, top: 710 },
    });

    const result = collectMarkingsRows(analysis([scorePage(0, 1, [m1, ts])]));

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].eventMarkings[0].text).toBe('3/4');
    expect(result.rows[0].eventMarkings[0].kind).toBe('time-signature');
  });

  it('orders time signatures before tempo marks in a row', () => {
    const m1 = marking({ kind: 'measure', text: '1' });
    const tempo = marking({
      kind: 'tempo',
      text: 'Allegro',
      rect: { left: 105, right: 180, bottom: 740, top: 750 },
    });
    const ts = marking({
      kind: 'time-signature',
      text: '4/4',
      rect: { left: 105, right: 120, bottom: 690, top: 710 },
    });

    const result = collectMarkingsRows(
      analysis([scorePage(0, 1, [m1, tempo, ts])]),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].eventMarkings[0].kind).toBe('time-signature');
    expect(result.rows[0].eventMarkings[1].kind).toBe('tempo');
  });

  it('parses bracketed measure numbers via numericValue', () => {
    const m = marking({
      kind: 'measure',
      text: '[9]',
      rect: { left: 100, right: 130, bottom: 720, top: 730 },
    });
    const tempo = marking({
      kind: 'tempo',
      text: 'rit.',
      rect: { left: 105, right: 140, bottom: 740, top: 750 },
    });

    const result = collectMarkingsRows(analysis([scorePage(0, 1, [m, tempo])]));

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].measure).toBe(9);
    expect(result.rows[0].measureMarking).toBe(m);
  });

  it('infers sequential measures when none are detected', () => {
    const tempo = marking({
      kind: 'tempo',
      text: 'Allegro',
      pageIndex: 0,
      systemIndex: 0,
      rect: { left: 105, right: 180, bottom: 740, top: 750 },
    });

    const result = collectMarkingsRows(analysis([scorePage(0, 2, [tempo])]));

    expect(result.measuresInferred).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].measure).toBe(1);
    expect(result.rows[0].measureMarking).toBeNull();
  });

  it('numbers systems across pages without restarting', () => {
    const tempo1 = marking({
      kind: 'tempo',
      text: 'Allegro',
      pageIndex: 0,
      systemIndex: 0,
      rect: { left: 105, right: 180, bottom: 740, top: 750 },
    });
    const tempo2 = marking({
      kind: 'tempo',
      text: 'Andante',
      pageIndex: 1,
      systemIndex: 0,
      rect: { left: 105, right: 180, bottom: 740, top: 750 },
    });

    const result = collectMarkingsRows(
      analysis([scorePage(0, 3, [tempo1]), scorePage(1, 3, [tempo2])]),
    );

    expect(result.measuresInferred).toBe(true);
    const measures = result.rows.map((r) => r.measure);
    expect(measures).toEqual([1, 4]);
  });

  it('returns empty rows when no tempo or time-signature markings exist', () => {
    const m1 = marking({ kind: 'measure', text: '1' });
    const result = collectMarkingsRows(analysis([scorePage(0, 1, [m1])]));

    expect(result.rows).toHaveLength(0);
  });

  it('associates a tempo marking between two measure numbers correctly', () => {
    const m5 = marking({
      kind: 'measure',
      text: '5',
      rect: { left: 100, right: 120, bottom: 720, top: 730 },
    });
    const m9 = marking({
      kind: 'measure',
      text: '9',
      rect: { left: 400, right: 420, bottom: 720, top: 730 },
    });
    const tempo = marking({
      kind: 'tempo',
      text: 'rit.',
      rect: { left: 250, right: 280, bottom: 740, top: 750 },
    });

    const result = collectMarkingsRows(
      analysis([scorePage(0, 1, [m5, m9, tempo])]),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].measure).toBe(5);
    expect(result.rows[0].eventMarkings[0].text).toBe('rit.');
  });
});

describe('markingsExportFileName', () => {
  it('replaces .pdf with -markings.pdf', () => {
    expect(markingsExportFileName('score.pdf')).toBe('score-markings.pdf');
  });

  it('uses "score" as fallback for empty name', () => {
    expect(markingsExportFileName('')).toBe('score-markings.pdf');
  });
});
