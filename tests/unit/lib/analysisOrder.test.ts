import { nextPage } from '#/lib/pdf/analysis/analysis.order';

const none = new Set<number>();

describe('nextPage', () => {
  it('starts at the first page when nothing is prioritised', () => {
    expect(nextPage(none, [], 5)).toBe(0);
  });

  it('takes the first uncached priority', () => {
    expect(nextPage(new Set([7]), [7, 3, 8], 10)).toBe(3);
  });

  it('moves out from the priority once it is cached, forward first', () => {
    const cached = new Set([5]);
    expect(nextPage(cached, [5], 10)).toBe(6);
    cached.add(6);
    expect(nextPage(cached, [5], 10)).toBe(4);
    cached.add(4);
    expect(nextPage(cached, [5], 10)).toBe(7);
  });

  it('measures the distance to the nearest of several priorities', () => {
    // 3 is one from 2; 6 is two from 8.
    expect(nextPage(new Set([2, 8, 9, 7]), [8, 2], 10)).toBe(3);
  });

  it('prefers forward when distances tie across priorities', () => {
    // 2 is one behind 3; 6 is one ahead of 5.
    expect(nextPage(new Set([3, 4, 5]), [3, 5], 10)).toBe(6);
  });

  it('ignores priorities outside the document', () => {
    expect(nextPage(none, [12, -1], 4)).toBe(0);
  });

  it('falls back to the lowest uncached page', () => {
    expect(nextPage(new Set([0, 1, 3]), [], 5)).toBe(2);
  });

  it('fills the run from the first page next when asked to', () => {
    expect(nextPage(none, [5], 10, true)).toBe(5);
    expect(nextPage(new Set([5]), [5], 10, true)).toBe(0);
    expect(nextPage(new Set([0, 1, 5]), [5], 10, true)).toBe(2);
  });

  it('still takes the visible pages before the run', () => {
    expect(nextPage(new Set([0]), [7, 8], 10, true)).toBe(7);
  });

  it('is null when every page is cached', () => {
    expect(nextPage(new Set([0, 1, 2]), [1], 3)).toBeNull();
    expect(nextPage(none, [], 0)).toBeNull();
  });
});
