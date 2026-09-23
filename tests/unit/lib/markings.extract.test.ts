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

/** `barlines[i]` is the closing barlines of system `i`; omitted, none are known. */
function scorePage(
  pageIndex: number,
  systemCount: number,
  markings: Marking[] = [],
  barlines: (number[] | undefined)[] = [],
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
      barlines: barlines[i],
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
      'tempo',
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

    const result = collectMarkingsRows(
      analysis([scorePage(0, 1, [m1, ts])]),
      'time-signature',
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].eventMarkings[0].text).toBe('3/4');
    expect(result.rows[0].eventMarkings[0].kind).toBe('time-signature');
  });

  it('exports only the kind it is asked for', () => {
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
    const score = analysis([scorePage(0, 1, [m1, tempo, ts])]);

    const timeSignatures = collectMarkingsRows(score, 'time-signature');
    expect(timeSignatures.rows).toHaveLength(1);
    expect(timeSignatures.rows[0].eventMarkings).toEqual([ts]);

    const tempos = collectMarkingsRows(score, 'tempo');
    expect(tempos.rows).toHaveLength(1);
    expect(tempos.rows[0].eventMarkings).toEqual([tempo]);
  });

  it('leaves rehearsal marks out of the tempo map', () => {
    const m1 = marking({ kind: 'measure', text: '1' });
    const rehearsal = marking({
      kind: 'rehearsal',
      text: 'A',
      rect: { left: 105, right: 115, bottom: 740, top: 750 },
    });

    const result = collectMarkingsRows(
      analysis([scorePage(0, 1, [m1, rehearsal])]),
      'tempo',
    );

    expect(result.rows).toHaveLength(0);
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

    const result = collectMarkingsRows(
      analysis([scorePage(0, 1, [m, tempo])]),
      'tempo',
    );

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

    const result = collectMarkingsRows(
      analysis([scorePage(0, 2, [tempo])]),
      'tempo',
    );

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
      'tempo',
    );

    expect(result.measuresInferred).toBe(true);
    const measures = result.rows.map((r) => r.measure);
    expect(measures).toEqual([1, 4]);
  });

  it('returns empty rows when no markings of the kind exist', () => {
    const m1 = marking({ kind: 'measure', text: '1' });
    const score = analysis([scorePage(0, 1, [m1])]);

    expect(collectMarkingsRows(score, 'tempo').rows).toHaveLength(0);
    expect(collectMarkingsRows(score, 'time-signature').rows).toHaveLength(0);
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
      'tempo',
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].measure).toBe(5);
    expect(result.rows[0].eventMarkings[0].text).toBe('rit.');
  });

  it('includes events on the first system when no measure "1" exists', () => {
    const ts = marking({
      kind: 'time-signature',
      text: '3/4',
      pageIndex: 0,
      systemIndex: 0,
      rect: { left: 105, right: 120, bottom: 690, top: 710 },
    });
    const tempo = marking({
      kind: 'tempo',
      text: 'Allegro',
      pageIndex: 0,
      systemIndex: 0,
      rect: { left: 130, right: 200, bottom: 740, top: 750 },
    });
    const m5 = marking({
      kind: 'measure',
      text: '5',
      pageIndex: 0,
      systemIndex: 1,
      rect: { left: 100, right: 120, bottom: 620, top: 630 },
    });

    // Four bars on the first system, so counting back from 5 lands on 1.
    const score = analysis([
      scorePage(
        0,
        2,
        [ts, tempo, m5],
        [
          [200, 300, 400, 500],
          [300, 500],
        ],
      ),
    ]);

    for (const [kind, event] of [
      ['time-signature', ts],
      ['tempo', tempo],
    ] as const) {
      const result = collectMarkingsRows(score, kind);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].measure).toBe(1);
      expect(result.rows[0].measureMarking).toBeNull();
      expect(result.rows[0].eventMarkings).toEqual([event]);
    }
  });

  it('filters courtesy time signatures at the end of a system', () => {
    const m1 = marking({
      kind: 'measure',
      text: '1',
      pageIndex: 0,
      systemIndex: 0,
      rect: { left: 100, right: 120, bottom: 720, top: 730 },
    });
    const tsCourtesy = marking({
      kind: 'time-signature',
      text: '3/4',
      pageIndex: 0,
      systemIndex: 0,
      // Near the right edge (system spans 100–500, so 480 is at 95%)
      rect: { left: 480, right: 495, bottom: 690, top: 710 },
    });
    const m5 = marking({
      kind: 'measure',
      text: '5',
      pageIndex: 0,
      systemIndex: 1,
      rect: { left: 100, right: 120, bottom: 620, top: 630 },
    });
    const tsReal = marking({
      kind: 'time-signature',
      text: '3/4',
      pageIndex: 0,
      systemIndex: 1,
      rect: { left: 105, right: 120, bottom: 590, top: 610 },
    });

    const result = collectMarkingsRows(
      analysis([scorePage(0, 2, [m1, tsCourtesy, m5, tsReal])]),
      'time-signature',
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].measure).toBe(5);
    expect(result.rows[0].eventMarkings).toHaveLength(1);
    expect(result.rows[0].eventMarkings[0]).toBe(tsReal);
  });

  it('keeps a right-edge time signature when no match exists on the next system', () => {
    const m1 = marking({
      kind: 'measure',
      text: '1',
      pageIndex: 0,
      systemIndex: 0,
      rect: { left: 100, right: 120, bottom: 720, top: 730 },
    });
    const tsEnd = marking({
      kind: 'time-signature',
      text: '5/8',
      pageIndex: 0,
      systemIndex: 0,
      rect: { left: 480, right: 495, bottom: 690, top: 710 },
    });

    const result = collectMarkingsRows(
      analysis([scorePage(0, 1, [m1, tsEnd])]),
      'time-signature',
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].eventMarkings).toHaveLength(1);
    expect(result.rows[0].eventMarkings[0].text).toBe('5/8');
  });
});

describe('collectMarkingsRows counting barlines', () => {
  const number = (text: string, systemIndex: number, left = 100) =>
    marking({
      kind: 'measure',
      text,
      systemIndex,
      rect: { left, right: left + 20, bottom: 720, top: 730 },
    });
  const tempo = (text: string, systemIndex: number, left: number) =>
    marking({
      kind: 'tempo',
      text,
      systemIndex,
      rect: { left, right: left + 40, bottom: 740, top: 750 },
    });

  it('counts bars from the number printed at the start of the system', () => {
    const m22 = number('22', 0);
    const opening = tempo('Allegro', 0, 105);
    const later = tempo('Adagio', 0, 310);

    const result = collectMarkingsRows(
      analysis([
        scorePage(0, 1, [m22, opening, later], [[200, 300, 400, 500]]),
      ]),
      'tempo',
    );

    expect(result.rows.map((row) => row.measure)).toEqual([22, 24]);
    expect(result.rows[0].measureMarking).toBe(m22);
    // Nothing is printed over bar 24, so there is no clip to lift for it.
    expect(result.rows[1].measureMarking).toBeNull();
  });

  it('carries the count across a system with no printed number', () => {
    const result = collectMarkingsRows(
      analysis([
        scorePage(
          0,
          2,
          [number('10', 0), tempo('rit.', 1, 360)],
          [
            [250, 500],
            [200, 350, 500],
          ],
        ),
      ]),
      'tempo',
    );

    expect(result.rows.map((row) => row.measure)).toEqual([14]);
  });

  it('counts back from the first printed number for events before it', () => {
    const result = collectMarkingsRows(
      analysis([
        scorePage(
          0,
          2,
          [
            tempo('Allegro', 0, 105),
            tempo('Meno mosso', 0, 310),
            number('5', 1),
          ],
          [[200, 300, 400, 500], [500]],
        ),
      ]),
      'tempo',
    );

    expect(result.rows.map((row) => row.measure)).toEqual([1, 3]);
  });

  it('counts from 1 when no numbers are printed at all', () => {
    const result = collectMarkingsRows(
      analysis([
        scorePage(
          0,
          2,
          [tempo('Allegro', 0, 105), tempo('rit.', 1, 360)],
          [
            [250, 500],
            [200, 350, 500],
          ],
        ),
      ]),
      'tempo',
    );

    expect(result.measuresInferred).toBe(true);
    expect(result.rows.map((row) => row.measure)).toEqual([1, 5]);
  });

  it('ignores a number the barline count does not corroborate', () => {
    // "12" read off the margin onto the wrong system: it sits in the bar that
    // "14" names, and would pull the tempo mark back two bars.
    const result = collectMarkingsRows(
      analysis([
        scorePage(
          0,
          3,
          [
            number('10', 0),
            number('12', 1),
            number('14', 2),
            number('12', 2, 102),
            tempo('a tempo', 2, 310),
          ],
          [
            [300, 500],
            [300, 500],
            [300, 500],
          ],
        ),
      ]),
      'tempo',
    );

    expect(result.rows.map((row) => row.measure)).toEqual([15]);
  });
});

describe('markingsExportFileName', () => {
  it('names the export after the map it holds', () => {
    expect(markingsExportFileName('score.pdf', 'time-signature')).toBe(
      'score-time-signature-map.pdf',
    );
    expect(markingsExportFileName('score.pdf', 'tempo')).toBe(
      'score-tempo-map.pdf',
    );
  });

  it('uses "score" as fallback for empty name', () => {
    expect(markingsExportFileName('', 'tempo')).toBe('score-tempo-map.pdf');
  });
});
