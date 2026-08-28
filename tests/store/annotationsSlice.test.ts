import {
  type AnnotationKind,
  DEFAULT_COLOR,
  DEFAULT_SIZE,
} from '#/lib/pdf/annotations';
import {
  annotationMoved,
  annotationPlaced,
  annotationRemoved,
  annotationRetitled,
  annotationsSlice,
} from '#/store/annotations.slice';
import { documentClosed } from '#/store/document.slice';

const reduce = annotationsSlice.reducer;
const EMPTY = reduce(undefined, { type: '@@init' });

function run(...actions: Parameters<typeof reduce>[1][]) {
  return actions.reduce(reduce, EMPTY);
}

const place = (kind: AnnotationKind = 'note') =>
  annotationPlaced({ pageIndex: 0, x: 100, y: 400, kind });

describe('annotationPlaced', () => {
  it('anchors a note where it was dropped', () => {
    const [note] = run(place());

    expect(note.pageIndex).toBe(0);
    expect(note.x).toBe(100);
    expect(note.y).toBe(400);
    expect(note.text).toBe('');
  });

  it('sizes each kind of mark from its kind', () => {
    for (const kind of [
      'fingering',
      'string',
      'position',
      'note',
    ] as const satisfies AnnotationKind[]) {
      const [placed] = run(place(kind));

      expect(placed.size).toBe(DEFAULT_SIZE[kind]);
    }
  });

  it('places a mark in the ink it was given', () => {
    const [placed] = run(
      annotationPlaced({ pageIndex: 0, x: 100, y: 400, kind: 'note', color: 'red' }),
    );

    expect(placed.color).toBe('red');
  });

  it('falls back to the default ink when none is given', () => {
    expect(run(place())[0].color).toBe(DEFAULT_COLOR);
  });

  it('places a mark carrying the value picked off the menu', () => {
    const [placed] = run(
      annotationPlaced({
        pageIndex: 0,
        x: 100,
        y: 400,
        kind: 'string',
        text: '6',
      }),
    );

    // Normalized on the way in, so a menu value is engravable immediately and
    // never needs the editor a blank mark opens.
    expect(placed.text).toBe('6');
  });

  it('mints the id outside the reducer, so replaying is stable', () => {
    // The same action object applied twice must produce the same state; an id
    // generated inside the reducer would differ on every replay.
    const action = place();

    expect(reduce(EMPTY, action)).toEqual(reduce(EMPTY, action));
  });

  it('gives each placement its own identity', () => {
    const state = run(place(), place());

    expect(state).toHaveLength(2);
    expect(state[0].id).not.toBe(state[1].id);
  });
});

describe('editing', () => {
  it('commits text to the right note', () => {
    const placed = run(place(), place());
    const state = reduce(
      placed,
      annotationRetitled({ id: placed[1].id, text: '1 3 2 4' }),
    );

    expect(state.map((note) => note.text)).toEqual(['', '1 3 2 4']);
  });

  it('engraves committed text in the form its kind takes', () => {
    // Whoever dispatches this — the overlay today, anything else later — should
    // not have to know that a position is roman and a string number is a digit.
    const retitle = (kind: AnnotationKind, text: string) => {
      const placed = run(place(kind));
      return reduce(placed, annotationRetitled({ id: placed[0].id, text }))[0]
        .text;
    };

    expect(retitle('position', '7')).toBe('VII');
    expect(retitle('string', 'string 3')).toBe('3');
  });

  it('moves a note without touching its text or kind', () => {
    const placed = run(place('fingering'));
    const retitled = reduce(
      placed,
      annotationRetitled({ id: placed[0].id, text: 'ossia' }),
    );
    const [note] = reduce(
      retitled,
      annotationMoved({ id: placed[0].id, x: 250, y: 610 }),
    );

    expect(note.x).toBe(250);
    expect(note.y).toBe(610);
    expect(note.text).toBe('ossia');
    expect(note.kind).toBe('fingering');
  });

  it('ignores an id that is no longer there', () => {
    const placed = run(place());
    const state = reduce(placed, annotationMoved({ id: 'gone', x: 0, y: 0 }));

    expect(state).toEqual(placed);
  });

  it('removes by id', () => {
    const placed = run(place(), place());
    const state = reduce(placed, annotationRemoved(placed[0].id));

    expect(state.map((note) => note.id)).toEqual([placed[1].id]);
  });
});

describe('following the document', () => {
  it('drops the notes when the document closes', () => {
    const placed = run(place(), place());

    expect(reduce(placed, documentClosed())).toEqual([]);
  });
});
