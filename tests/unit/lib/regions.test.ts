import {
  clampRect,
  createRegion,
  isUsableRect,
  MIN_REGION_SIZE,
  moveRegion,
  rectFromPoints,
  resizeRegion,
  sortRegions,
} from '#/lib/pdf/regions';

const PAGE = { width: 612, height: 792 };

describe('rectFromPoints', () => {
  it('normalises a drag in any direction', () => {
    const downRight = rectFromPoints({ x: 10, y: 700 }, { x: 200, y: 500 });
    const upLeft = rectFromPoints({ x: 200, y: 500 }, { x: 10, y: 700 });
    expect(downRight).toEqual({ left: 10, right: 200, bottom: 500, top: 700 });
    expect(upLeft).toEqual(downRight);
  });
});

describe('clampRect', () => {
  it('keeps a rectangle inside the page', () => {
    const rect = clampRect(
      { left: -50, right: 900, bottom: -20, top: 1000 },
      PAGE.width,
      PAGE.height,
    );
    expect(rect).toEqual({
      left: 0,
      right: PAGE.width,
      bottom: 0,
      top: PAGE.height,
    });
  });

  it('rights a rectangle dragged inside out', () => {
    const rect = clampRect(
      { left: 300, right: 100, bottom: 600, top: 400 },
      PAGE.width,
      PAGE.height,
    );
    expect(rect.left).toBeLessThan(rect.right);
    expect(rect.bottom).toBeLessThan(rect.top);
  });
});

describe('moveRegion', () => {
  const region = createRegion(0, {
    left: 100,
    right: 300,
    bottom: 400,
    top: 500,
  });

  it('translates without changing size', () => {
    const moved = moveRegion(region, 25, -50, PAGE.width, PAGE.height);
    expect(moved.rect).toEqual({
      left: 125,
      right: 325,
      bottom: 350,
      top: 450,
    });
  });

  it('slides along the page edge instead of shrinking', () => {
    const moved = moveRegion(region, -500, 0, PAGE.width, PAGE.height);
    expect(moved.rect.left).toBe(0);
    // Width is preserved: the region stopped at the edge rather than squashing.
    expect(moved.rect.right - moved.rect.left).toBe(200);
  });

  it('stops at the top of the page', () => {
    const moved = moveRegion(region, 0, 5000, PAGE.width, PAGE.height);
    expect(moved.rect.top).toBe(PAGE.height);
    expect(moved.rect.top - moved.rect.bottom).toBe(100);
  });
});

describe('resizeRegion', () => {
  const region = createRegion(0, {
    left: 100,
    right: 300,
    bottom: 400,
    top: 500,
  });

  it('moves only the dragged edge', () => {
    const resized = resizeRegion(region, 'top', 620, PAGE.width, PAGE.height);
    expect(resized.rect).toEqual({
      left: 100,
      right: 300,
      bottom: 400,
      top: 620,
    });
  });

  it('rights itself when an edge is dragged past its opposite', () => {
    const resized = resizeRegion(region, 'top', 350, PAGE.width, PAGE.height);
    expect(resized.rect.top).toBeGreaterThanOrEqual(resized.rect.bottom);
  });

  it('cannot be dragged off the page', () => {
    const resized = resizeRegion(
      region,
      'right',
      5000,
      PAGE.width,
      PAGE.height,
    );
    expect(resized.rect.right).toBe(PAGE.width);
  });
});

describe('isUsableRect', () => {
  it('rejects a stray click that produced a sliver', () => {
    expect(isUsableRect({ left: 10, right: 12, bottom: 10, top: 400 })).toBe(
      false,
    );
  });

  it('accepts a real drag', () => {
    expect(
      isUsableRect({
        left: 10,
        right: 10 + MIN_REGION_SIZE,
        bottom: 10,
        top: 10 + MIN_REGION_SIZE,
      }),
    ).toBe(true);
  });
});

describe('sortRegions', () => {
  it('orders by page, then down the page', () => {
    const a = {
      ...createRegion(1, { left: 0, right: 10, bottom: 0, top: 10 }),
    };
    const b = {
      ...createRegion(0, { left: 0, right: 10, bottom: 100, top: 200 }),
    };
    const c = {
      ...createRegion(0, { left: 0, right: 10, bottom: 400, top: 500 }),
    };

    expect(sortRegions([a, b, c]).map((r) => r.id)).toEqual([c.id, b.id, a.id]);
  });
});
