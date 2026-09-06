import type { Region } from '#/lib/pdf/regions';
import { documentClosed } from '#/store/document.slice';
import {
  regionAdded,
  regionChanged,
  regionRemoved,
  regionSelected,
  regionsReset,
  regionsSlice,
} from '#/store/regions.slice';

const rect = (top: number) => ({ left: 0, right: 600, bottom: top - 50, top });

const DETECTED: Region[] = [
  {
    id: 'd1',
    pageIndex: 0,
    rect: rect(700),
    label: 'Flute',
    groupKey: 'sys-0',
  },
  {
    id: 'd2',
    pageIndex: 0,
    rect: rect(600),
    label: 'Guitar',
    groupKey: 'sys-0',
  },
];

const reduce = regionsSlice.reducer;
const FOLLOWING_DETECTION = reduce(undefined, { type: '@@init' });

function run(...actions: Parameters<typeof reduce>[1][]) {
  return actions.reduce(reduce, FOLLOWING_DETECTION);
}

const labels = (state: ReturnType<typeof reduce>) =>
  state.manual?.map((region) => region.label);

describe('taking over from detection', () => {
  it('starts out following the part checkboxes', () => {
    expect(run().manual).toBeNull();
  });

  it('seeds the manual list from what was on screen at the first edit', () => {
    const state = run(
      regionAdded({ visible: DETECTED, pageIndex: 0, rect: rect(400) }),
    );

    expect(labels(state)).toEqual(['Flute', 'Guitar', 'Region 3']);
  });

  it('ignores the seed once the user owns the list', () => {
    const state = run(
      regionRemoved({ visible: DETECTED, id: 'd1' }),
      // A later action carries a stale proposal; it must not resurrect 'd1'.
      regionAdded({ visible: DETECTED, pageIndex: 0, rect: rect(400) }),
    );

    expect(labels(state)).toEqual(['Guitar', 'Region 2']);
  });

  it('numbers a new region by the list it is joining', () => {
    const state = run(
      regionAdded({ visible: [], pageIndex: 0, rect: rect(400) }),
      regionAdded({ visible: [], pageIndex: 0, rect: rect(300) }),
    );

    expect(labels(state)).toEqual(['Region 1', 'Region 2']);
  });
});

describe('editing', () => {
  it('replaces a region in place', () => {
    const moved: Region = { ...DETECTED[0], rect: rect(500) };
    const state = run(regionChanged({ visible: DETECTED, region: moved }));

    expect(state.manual?.map((region) => region.id)).toEqual(['d1', 'd2']);
    expect(state.manual?.[0].rect.top).toBe(500);
  });

  it('clears the selection when the selected region goes', () => {
    const state = run(
      regionSelected('d1'),
      regionRemoved({ visible: DETECTED, id: 'd1' }),
    );

    expect(state.selectedId).toBeNull();
    expect(labels(state)).toEqual(['Guitar']);
  });

  it('keeps the selection when a different region goes', () => {
    const state = run(
      regionSelected('d2'),
      regionRemoved({ visible: DETECTED, id: 'd1' }),
    );

    expect(state.selectedId).toBe('d2');
  });
});

describe('handing control back', () => {
  it('drops the manual list and the selection on reset', () => {
    const state = run(
      regionSelected('d1'),
      regionRemoved({ visible: DETECTED, id: 'd2' }),
      regionsReset(),
    );

    expect(state.manual).toBeNull();
    expect(state.selectedId).toBeNull();
  });

  it('does the same when the document closes', () => {
    const state = run(
      regionRemoved({ visible: DETECTED, id: 'd2' }),
      documentClosed(),
    );

    expect(state.manual).toBeNull();
  });
});
