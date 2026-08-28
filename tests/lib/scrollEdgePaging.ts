import {
  GESTURE_GAP_MS,
  initialPagingState,
  PAGE_TURN_THRESHOLD,
  type PagingState,
  stepPaging,
  unlock,
  type WheelInput,
  wheelPixels,
} from '#/lib/scrollEdgePaging';

function panel(scrollTop: number): Omit<WheelInput, 'deltaY' | 'at'> {
  return { scrollTop, scrollHeight: 1600, clientHeight: 800 };
}

const AT_TOP = panel(0);
const MID_PAGE = panel(400);
const AT_BOTTOM = panel(800);

function scroll(
  state: PagingState,
  deltaY: number,
  count: number,
  where: Omit<WheelInput, 'deltaY' | 'at'>,
  startAt = 1000,
) {
  const turns: number[] = [];
  let current = state;

  for (let i = 0; i < count; i += 1) {
    const step = stepPaging(current, {
      ...where,
      deltaY,
      at: startAt + i * 20,
    });
    current = step.state;
    if (step.turn) turns.push(step.turn);
  }

  return { state: current, turns };
}

describe('scroll edge paging', () => {
  it('leaves a scroll that has page left to it alone', () => {
    const { turns } = scroll(initialPagingState, 100, 20, MID_PAGE);
    expect(turns).toEqual([]);
  });

  it('turns forward once the wheel pushes past the bottom', () => {
    const { turns } = scroll(initialPagingState, 100, 2, AT_BOTTOM);
    expect(turns).toEqual([1]);
  });

  it('turns back when the wheel pushes past the top', () => {
    const { turns } = scroll(initialPagingState, -100, 2, AT_TOP);
    expect(turns).toEqual([-1]);
  });

  it('does not turn on the event that merely arrives at the edge', () => {
    const { turns } = scroll(initialPagingState, 100, 1, AT_BOTTOM);
    expect(turns).toEqual([]);
  });

  it('turns one page per gesture, however long the momentum runs', () => {
    const { turns } = scroll(initialPagingState, 60, 40, AT_BOTTOM);
    expect(turns).toEqual([1]);
  });

  it('turns again once the reader starts a new gesture', () => {
    const first = scroll(initialPagingState, 60, 40, AT_BOTTOM);
    const second = scroll(
      first.state,
      60,
      40,
      AT_BOTTOM,
      first.state.lastEventAt + GESTURE_GAP_MS,
    );
    expect(second.turns).toEqual([1]);
  });

  it('reports the gesture boundary that lifted the lock', () => {
    const { state } = scroll(initialPagingState, 60, 40, AT_BOTTOM);
    expect(state.locked).toBe(true);

    const continued = stepPaging(state, {
      ...AT_BOTTOM,
      deltaY: 60,
      at: state.lastEventAt + GESTURE_GAP_MS - 1,
    });
    expect(continued.rearmed).toBe(false);

    const fresh = stepPaging(state, {
      ...AT_BOTTOM,
      deltaY: 60,
      at: state.lastEventAt + GESTURE_GAP_MS,
    });
    expect(fresh.rearmed).toBe(true);
    expect(fresh.state.locked).toBe(false);
  });

  it('does not carry travel from one edge over to the other', () => {
    let state = initialPagingState;
    for (const deltaY of [-100, 100, -100, 100]) {
      const step = stepPaging(state, { ...panel(0), deltaY, at: 1000 });
      state = step.state;
      expect(step.turn).toBe(0);
    }
  });

  it('forgets accumulated travel when the scroll leaves the edge', () => {
    const pushed = scroll(initialPagingState, 100, 1, AT_BOTTOM);
    const away = stepPaging(pushed.state, {
      ...MID_PAGE,
      deltaY: 100,
      at: pushed.state.lastEventAt + 20,
    });
    expect(away.state.travel).toBe(0);

    const back = scroll(
      away.state,
      100,
      1,
      AT_BOTTOM,
      away.state.lastEventAt + 20,
    );
    expect(back.turns).toEqual([]);
  });

  it('turns on a page that is shorter than the panel', () => {
    const short = { scrollTop: 0, scrollHeight: 500, clientHeight: 800 };
    expect(scroll(initialPagingState, 100, 2, short).turns).toEqual([1]);
    expect(scroll(initialPagingState, -100, 2, short).turns).toEqual([-1]);
  });

  it('needs a deliberate push, not a stray horizontal gesture', () => {
    const sideways = stepPaging(initialPagingState, {
      ...AT_BOTTOM,
      deltaY: 0,
      at: 1000,
    });
    expect(sideways.turn).toBe(0);
    expect(sideways.state.direction).toBe(0);
  });

  it('hears the next push after a turn that had nowhere to go', () => {
    const refused = scroll(
      initialPagingState,
      PAGE_TURN_THRESHOLD,
      1,
      AT_BOTTOM,
    );
    expect(refused.turns).toEqual([1]);

    const released = unlock(refused.state);
    const again = scroll(
      released,
      PAGE_TURN_THRESHOLD,
      1,
      AT_BOTTOM,
      released.lastEventAt + 20,
    );
    expect(again.turns).toEqual([1]);
  });

  it('normalizes wheel deltas reported in lines or pages', () => {
    expect(wheelPixels(100, 0, 800)).toBe(100);
    expect(wheelPixels(3, 1, 800)).toBe(48);
    expect(wheelPixels(1, 2, 800)).toBe(800);
  });
});
