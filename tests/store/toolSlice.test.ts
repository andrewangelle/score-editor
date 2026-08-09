import { documentClosed, documentOpened } from '#/store/document.slice';
import { toolSlice, toolToggled } from '#/store/tool.slice';

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
});
