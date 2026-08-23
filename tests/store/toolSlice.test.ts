import { DEFAULT_COLOR } from '#/lib/pdf/annotations';
import { documentClosed, documentOpened } from '#/store/document.slice';
import {
  annotationColorPicked,
  toolSlice,
  toolToggled,
} from '#/store/tool.slice';

const reduce = toolSlice.reducer;
const IDLE = reduce(undefined, { type: '@@init' });

function run(...actions: Parameters<typeof reduce>[1][]) {
  return actions.reduce(reduce, IDLE);
}

describe('toolToggled', () => {
  it('picks a tool up', () => {
    expect(run(toolToggled('fingering')).active).toBe('fingering');
  });

  it('puts the same tool back down', () => {
    expect(
      run(toolToggled('regions'), toolToggled('regions')).active,
    ).toBeNull();
  });

  it('swaps directly between tools without a null in between', () => {
    const state = run(toolToggled('regions'), toolToggled('note'));

    expect(state.active).toBe('note');
  });
});

describe('exclusivity', () => {
  const { selectPlacing, selectIsEditingRegions } = toolSlice.selectors;

  it('never reports placing and region editing at once', () => {
    for (const tool of ['regions', 'fingering', 'note'] as const) {
      const state = { tool: run(toolToggled(tool)) };
      const both =
        selectPlacing(state) !== null && selectIsEditingRegions(state);

      expect(both).toBe(false);
    }
  });

  it('reads the region tool as not placing notes', () => {
    const state = { tool: run(toolToggled('regions')) };

    expect(selectPlacing(state)).toBeNull();
    expect(selectIsEditingRegions(state)).toBe(true);
  });

  it('reads a note tool as placing that kind', () => {
    const state = { tool: run(toolToggled('fingering')) };

    expect(selectPlacing(state)).toBe('fingering');
    expect(selectIsEditingRegions(state)).toBe(false);
  });
});

describe('choosing the ink', () => {
  it('starts on the default', () => {
    expect(IDLE.color).toBe(DEFAULT_COLOR);
  });

  it('holds the ink the next mark will be placed in', () => {
    expect(run(annotationColorPicked('red')).color).toBe('red');
  });

  it('is independent of which tool is up', () => {
    // Ink and kind are separate choices: picking green for fingerings should
    // not put the fingering tool down, and vice versa.
    const state = run(toolToggled('fingering'), annotationColorPicked('green'));

    expect(state.active).toBe('fingering');
    expect(state.color).toBe('green');
    expect(run(annotationColorPicked('green'), toolToggled('note'))).toEqual({
      active: 'note',
      color: 'green',
    });
  });
});

describe('following the document', () => {
  it('puts the tool away when the document opens or closes', () => {
    expect(run(toolToggled('note'), documentClosed()).active).toBeNull();
    expect(
      run(
        toolToggled('note'),
        documentOpened({ id: 'doc-2', name: 'x.pdf', pages: [] }),
      ).active,
    ).toBeNull();
  });

  it('carries the chosen ink into the next document', () => {
    // Someone who marks in green is still marking in green in the next score;
    // the tool is put away with the document, but the ink is not.
    expect(run(annotationColorPicked('purple'), documentClosed()).color).toBe(
      'purple',
    );
    expect(
      run(
        annotationColorPicked('purple'),
        documentOpened({ id: 'doc-2', name: 'x.pdf', pages: [] }),
      ).color,
    ).toBe('purple');
  });
});
