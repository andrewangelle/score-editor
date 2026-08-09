import { DEFAULT_SIZE } from '#/lib/pdf/annotations';
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

const place = (kind: 'note' | 'fingering' = 'note') =>
  annotationPlaced({ pageIndex: 0, x: 100, y: 400, kind });

describe('annotationPlaced', () => {
  it('anchors a note where it was dropped', () => {
    const [note] = run(place());

    expect(note.pageIndex).toBe(0);
    expect(note.x).toBe(100);
    expect(note.y).toBe(400);
    expect(note.text).toBe('');
  });

  it('sizes a fingering and a performance note differently', () => {
    const [fingering] = run(place('fingering'));
    const [note] = run(place('note'));

    expect(fingering.size).toBe(DEFAULT_SIZE.fingering);
    expect(note.size).toBe(DEFAULT_SIZE.note);
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
