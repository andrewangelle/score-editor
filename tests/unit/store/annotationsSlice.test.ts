import {
  type AnnotationKind,
  DEFAULT_COLOR,
  DEFAULT_SIZE,
} from '#/lib/pdf/annotations/annotations';
import {
  annotationCopied,
  annotationMoved,
  annotationPasted,
  annotationPlaced,
  annotationRedone,
  annotationRemoved,
  annotationRetitled,
  annotationsSlice,
  annotationUndone,
} from '#/store/annotations.slice';
import {
  documentClosed,
  documentOpened,
  documentSaved,
} from '#/store/document.slice';

const reduce = annotationsSlice.reducer;
const EMPTY = reduce(undefined, { type: '@@init' });

function run(...actions: Parameters<typeof reduce>[1][]) {
  return actions.reduce(reduce, EMPTY);
}

const place = (kind: AnnotationKind = 'note') =>
  annotationPlaced({ pageIndex: 0, x: 100, y: 400, kind });

describe('annotationPlaced', () => {
  it('anchors a note where it was dropped', () => {
    const [note] = run(place()).items;

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
      const [placed] = run(place(kind)).items;

      expect(placed.size).toBe(DEFAULT_SIZE[kind]);
    }
  });

  it('places a mark in the ink it was given', () => {
    const [placed] = run(
      annotationPlaced({
        pageIndex: 0,
        x: 100,
        y: 400,
        kind: 'note',
        color: 'red',
      }),
    ).items;

    expect(placed.color).toBe('red');
  });

  it('falls back to the default ink when none is given', () => {
    expect(run(place()).items[0].color).toBe(DEFAULT_COLOR);
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
    ).items;

    expect(placed.text).toBe('6');
  });

  it('mints the id outside the reducer, so replaying is stable', () => {
    const action = place();

    expect(reduce(EMPTY, action)).toEqual(reduce(EMPTY, action));
  });

  it('gives each placement its own identity', () => {
    const state = run(place(), place());

    expect(state.items).toHaveLength(2);
    expect(state.items[0].id).not.toBe(state.items[1].id);
  });
});

describe('editing', () => {
  it('commits text to the right note', () => {
    const placed = run(place(), place());
    const state = reduce(
      placed,
      annotationRetitled({ id: placed.items[1].id, text: '1 3 2 4' }),
    );

    expect(state.items.map((note) => note.text)).toEqual(['', '1 3 2 4']);
  });

  it('engraves committed text in the form its kind takes', () => {
    const retitle = (kind: AnnotationKind, text: string) => {
      const placed = run(place(kind));
      return reduce(
        placed,
        annotationRetitled({ id: placed.items[0].id, text }),
      ).items[0].text;
    };

    expect(retitle('position', '7')).toBe('VII');
    expect(retitle('string', 'string 3')).toBe('3');
  });

  it('moves a note without touching its text or kind', () => {
    const placed = run(place('fingering'));
    const retitled = reduce(
      placed,
      annotationRetitled({ id: placed.items[0].id, text: 'ossia' }),
    );
    const [note] = reduce(
      retitled,
      annotationMoved({ id: placed.items[0].id, x: 250, y: 610 }),
    ).items;

    expect(note.x).toBe(250);
    expect(note.y).toBe(610);
    expect(note.text).toBe('ossia');
    expect(note.kind).toBe('fingering');
  });

  it('ignores an id that is no longer there', () => {
    const placed = run(place());
    const state = reduce(placed, annotationMoved({ id: 'gone', x: 0, y: 0 }));

    expect(state.items).toEqual(placed.items);
  });

  it('removes by id', () => {
    const placed = run(place(), place());
    const state = reduce(placed, annotationRemoved(placed.items[0].id));

    expect(state.items.map((note) => note.id)).toEqual([placed.items[1].id]);
  });
});

describe('undo/redo', () => {
  it('undoes a placement by removing the annotation', () => {
    const state = run(place());
    const undone = reduce(state, annotationUndone());

    expect(undone.items).toHaveLength(0);
  });

  it('redoes a placement by re-inserting the same annotation', () => {
    const state = run(place());
    const id = state.items[0].id;
    const undone = reduce(state, annotationUndone());
    const redone = reduce(undone, annotationRedone());

    expect(redone.items).toHaveLength(1);
    expect(redone.items[0].id).toBe(id);
  });

  it('undoes a move by restoring the original position', () => {
    const placed = run(place());
    const moved = reduce(
      placed,
      annotationMoved({ id: placed.items[0].id, x: 200, y: 500 }),
    );
    const undone = reduce(moved, annotationUndone());

    expect(undone.items[0].x).toBe(100);
    expect(undone.items[0].y).toBe(400);
  });

  it('redoes a move by re-applying the new position', () => {
    const placed = run(place());
    const moved = reduce(
      placed,
      annotationMoved({ id: placed.items[0].id, x: 200, y: 500 }),
    );
    const undone = reduce(moved, annotationUndone());
    const redone = reduce(undone, annotationRedone());

    expect(redone.items[0].x).toBe(200);
    expect(redone.items[0].y).toBe(500);
  });

  it('undoes a retitle by restoring the old text', () => {
    const placed = run(place());
    const retitled = reduce(
      placed,
      annotationRetitled({ id: placed.items[0].id, text: 'hello' }),
    );
    const undone = reduce(retitled, annotationUndone());

    expect(undone.items[0].text).toBe('');
  });

  it('undoes a removal by re-inserting the annotation', () => {
    const placed = run(place());
    const id = placed.items[0].id;
    const removed = reduce(placed, annotationRemoved(id));
    const undone = reduce(removed, annotationUndone());

    expect(undone.items).toHaveLength(1);
    expect(undone.items[0].id).toBe(id);
  });

  it('caps the undo stack at 3 entries', () => {
    const state = run(place(), place(), place(), place());

    expect(state.undoStack).toHaveLength(3);
  });

  it('clears the redo stack on a new mutation', () => {
    const placed = run(place());
    const undone = reduce(placed, annotationUndone());

    expect(undone.redoStack).toHaveLength(1);

    const newPlacement = reduce(undone, place());

    expect(newPlacement.redoStack).toHaveLength(0);
  });

  it('resets stacks on documentOpened', () => {
    const state = run(place(), place());

    expect(state.undoStack.length).toBeGreaterThan(0);

    const opened = reduce(
      state,
      documentOpened({ id: 'new-doc', name: 'other.pdf', pages: [] }),
    );

    expect(opened.undoStack).toHaveLength(0);
    expect(opened.redoStack).toHaveLength(0);
    expect(opened.clipboard).toBeNull();
  });

  it('is a no-op when the undo stack is empty', () => {
    const undone = reduce(EMPTY, annotationUndone());

    expect(undone).toEqual(EMPTY);
  });

  it('is a no-op when the redo stack is empty', () => {
    const redone = reduce(EMPTY, annotationRedone());

    expect(redone).toEqual(EMPTY);
  });
});

describe('clipboard', () => {
  it('copies an annotation to the clipboard', () => {
    const placed = run(place());
    const copied = reduce(placed, annotationCopied(placed.items[0].id));

    expect(copied.clipboard).toEqual({
      kind: 'note',
      text: '',
      color: DEFAULT_COLOR,
      pageIndex: 0,
      x: 100,
      y: 400,
    });
  });

  it('pastes a new annotation with a different id but same properties', () => {
    const placed = run(
      annotationPlaced({
        pageIndex: 0,
        x: 100,
        y: 400,
        kind: 'fingering',
        color: 'red',
        text: '3',
      }),
    );
    const copied = reduce(placed, annotationCopied(placed.items[0].id));
    const pasted = reduce(
      copied,
      annotationPasted({
        pageIndex: 2,
        x: 300,
        y: 600,
        kind: 'fingering',
        color: 'red',
        text: '3',
      }),
    );

    expect(pasted.items).toHaveLength(2);
    expect(pasted.items[1].id).not.toBe(pasted.items[0].id);
    expect(pasted.items[1].kind).toBe('fingering');
    expect(pasted.items[1].text).toBe('3');
    expect(pasted.items[1].color).toBe('red');
    expect(pasted.items[1].pageIndex).toBe(2);
    expect(pasted.items[1].x).toBe(300);
    expect(pasted.items[1].y).toBe(600);
  });

  it('paste pushes an undo entry that can remove the pasted annotation', () => {
    const placed = run(place());
    const copied = reduce(placed, annotationCopied(placed.items[0].id));
    const pasted = reduce(
      copied,
      annotationPasted({
        pageIndex: 0,
        x: 200,
        y: 500,
        kind: 'note',
        color: DEFAULT_COLOR,
        text: '',
      }),
    );
    const undone = reduce(pasted, annotationUndone());

    expect(undone.items).toHaveLength(1);
    expect(undone.items[0].id).toBe(placed.items[0].id);
  });

  it('ignores a copy of an id that does not exist', () => {
    const placed = run(place());
    const copied = reduce(placed, annotationCopied('nonexistent'));

    expect(copied.clipboard).toBeNull();
  });
});

describe('unsaved annotations', () => {
  const unsaved = (state: ReturnType<typeof reduce>) =>
    annotationsSlice.selectors.selectHasUnsavedAnnotations({
      annotations: state,
    });

  it('starts clean', () => {
    expect(unsaved(EMPTY)).toBe(false);
  });

  it('reports unsaved after a placement', () => {
    expect(unsaved(run(place()))).toBe(true);
  });

  it('reports unsaved after a move', () => {
    const placed = run(place());
    const moved = reduce(
      placed,
      annotationMoved({ id: placed.items[0].id, x: 200, y: 500 }),
    );

    expect(unsaved(moved)).toBe(true);
  });

  it('reports unsaved after a retitle', () => {
    const placed = run(place());
    const retitled = reduce(
      placed,
      annotationRetitled({ id: placed.items[0].id, text: 'hello' }),
    );

    expect(unsaved(retitled)).toBe(true);
  });

  it('clears when removing returns to the original state', () => {
    const placed = run(place());
    const removed = reduce(placed, annotationRemoved(placed.items[0].id));

    expect(unsaved(removed)).toBe(false);
  });

  it('reports unsaved when removing leaves items that differ from the original', () => {
    const placed = run(place(), place());
    const removed = reduce(placed, annotationRemoved(placed.items[0].id));

    expect(unsaved(removed)).toBe(true);
  });

  it('clears when undo returns to the original state', () => {
    const placed = run(place());
    const undone = reduce(placed, annotationUndone());

    expect(unsaved(undone)).toBe(false);
  });

  it('reports unsaved when undo leaves items that differ from the original', () => {
    const placed = run(place(), place());
    const undone = reduce(placed, annotationUndone());

    expect(unsaved(undone)).toBe(true);
  });

  it('reports unsaved after redo', () => {
    const placed = run(place());
    const undone = reduce(placed, annotationUndone());
    const redone = reduce(undone, annotationRedone());

    expect(unsaved(redone)).toBe(true);
  });

  it('reports unsaved after paste', () => {
    const placed = run(place());
    const copied = reduce(placed, annotationCopied(placed.items[0].id));
    const pasted = reduce(
      copied,
      annotationPasted({
        pageIndex: 0,
        x: 200,
        y: 500,
        kind: 'note',
        color: DEFAULT_COLOR,
        text: '',
      }),
    );

    expect(unsaved(pasted)).toBe(true);
  });

  it('settles once saved', () => {
    const placed = run(place());

    expect(unsaved(reduce(placed, documentSaved()))).toBe(false);
  });

  it('reports unsaved after editing past a save', () => {
    const saved = run(place(), documentSaved());
    const edited = reduce(saved, place());

    expect(unsaved(edited)).toBe(true);
  });

  it('resets on documentOpened', () => {
    const placed = run(place());
    const opened = reduce(
      placed,
      documentOpened({ id: 'new', name: 'other.pdf', pages: [] }),
    );

    expect(unsaved(opened)).toBe(false);
  });

  it('does not count selection as a change', () => {
    expect(unsaved(run(place(), documentSaved()))).toBe(false);
  });
});

describe('following the document', () => {
  it('drops the notes when the document closes', () => {
    const placed = run(place(), place());

    expect(reduce(placed, documentClosed()).items).toEqual([]);
  });
});
