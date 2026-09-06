import {
  rectToScreen,
  toPdfPoint,
  toScreenPoint,
} from '#/lib/pdf/pageCoordinates';

const PAGE_HEIGHT = 792;

describe('page coordinates', () => {
  it('flips the vertical axis', () => {
    // Clicking the very top of the page is y = pageHeight in PDF space.
    expect(toPdfPoint(0, 0, PAGE_HEIGHT, 1)).toEqual({ x: 0, y: PAGE_HEIGHT });
    // ...and the very bottom is y = 0.
    expect(toPdfPoint(0, PAGE_HEIGHT, PAGE_HEIGHT, 1)).toEqual({ x: 0, y: 0 });
  });

  it('accounts for the render scale', () => {
    const point = toPdfPoint(200, 100, PAGE_HEIGHT, 2);
    expect(point).toEqual({ x: 100, y: PAGE_HEIGHT - 50 });
  });

  it('round-trips a click back to the same pixel', () => {
    for (const scale of [0.5, 1, 1.37, 2]) {
      for (const [x, y] of [
        [0, 0],
        [123, 456],
        [611, 791],
      ]) {
        const pdf = toPdfPoint(x, y, PAGE_HEIGHT, scale);
        const back = toScreenPoint(pdf, PAGE_HEIGHT, scale);
        expect(back.x).toBeCloseTo(x, 6);
        expect(back.y).toBeCloseTo(y, 6);
      }
    }
  });

  it('maps a rectangle to CSS box geometry, top edge first', () => {
    const box = rectToScreen(
      { left: 50, bottom: 600, right: 250, top: 700 },
      PAGE_HEIGHT,
      1,
    );
    expect(box).toEqual({
      left: 50,
      top: PAGE_HEIGHT - 700,
      width: 200,
      height: 100,
    });
  });

  it('keeps a rectangle on the page under scaling', () => {
    const box = rectToScreen(
      { left: 0, bottom: 0, right: 612, top: PAGE_HEIGHT },
      PAGE_HEIGHT,
      0.5,
    );
    expect(box).toEqual({
      left: 0,
      top: 0,
      width: 306,
      height: PAGE_HEIGHT / 2,
    });
  });

  it('places a note above a staff line higher on screen than the line itself', () => {
    const staffTop = 700;
    const note = toScreenPoint({ x: 0, y: staffTop + 10 }, PAGE_HEIGHT, 1);
    const line = toScreenPoint({ x: 0, y: staffTop }, PAGE_HEIGHT, 1);
    expect(note.y).toBeLessThan(line.y);
  });
});
