export const PAGE_TURN_THRESHOLD = 120;

export const GESTURE_GAP_MS = 250;

const EDGE_TOLERANCE = 2;

const LINE_HEIGHT = 16;

export type TurnDirection = -1 | 1;

export type PagingState = {
  direction: TurnDirection | 0;
  travel: number;
  locked: boolean;
  lastEventAt: number;
};

export const initialPagingState: PagingState = {
  direction: 0,
  travel: 0,
  locked: false,
  lastEventAt: Number.NEGATIVE_INFINITY,
};

export type WheelInput = {
  deltaY: number;
  at: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export type PagingStep = {
  state: PagingState;
  turn: TurnDirection | 0;
  rearmed: boolean;
};

export function wheelPixels(
  deltaY: number,
  deltaMode: number,
  clientHeight: number,
): number {
  if (deltaMode === 1) return deltaY * LINE_HEIGHT;
  if (deltaMode === 2) return deltaY * clientHeight;
  return deltaY;
}

function edgePushedAgainst(input: WheelInput): TurnDirection | 0 {
  const distanceToBottom =
    input.scrollHeight - input.scrollTop - input.clientHeight;

  if (input.deltaY > 0 && distanceToBottom <= EDGE_TOLERANCE) return 1;
  if (input.deltaY < 0 && input.scrollTop <= EDGE_TOLERANCE) return -1;
  return 0;
}

export function stepPaging(state: PagingState, input: WheelInput): PagingStep {
  const rearmed = input.at - state.lastEventAt >= GESTURE_GAP_MS;
  const carried = rearmed ? initialPagingState : state;
  const direction = edgePushedAgainst(input);

  if (direction === 0) {
    return {
      state: { ...carried, direction: 0, travel: 0, lastEventAt: input.at },
      turn: 0,
      rearmed,
    };
  }

  const travel =
    direction === carried.direction
      ? carried.travel + Math.abs(input.deltaY)
      : Math.abs(input.deltaY);

  if (carried.locked || travel < PAGE_TURN_THRESHOLD) {
    return {
      state: { ...carried, direction, travel, lastEventAt: input.at },
      turn: 0,
      rearmed,
    };
  }

  return {
    state: { direction, travel: 0, locked: true, lastEventAt: input.at },
    turn: direction,
    rearmed,
  };
}

export function unlock(state: PagingState): PagingState {
  return { ...state, locked: false };
}
