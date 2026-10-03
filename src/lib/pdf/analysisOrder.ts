/**
 * Which page analysis should detect next: what the reader is looking at, then
 * what they are nearest to, then whatever is left. Null once every page is in.
 *
 * Distance ties go forward, since a reader is more likely to scroll down.
 */
export function nextPage(
  cached: ReadonlySet<number>,
  priority: readonly number[],
  total: number,
): number | null {
  const open = (index: number) =>
    index >= 0 && index < total && !cached.has(index);

  const wanted = priority.find(open);
  if (wanted !== undefined) {
    return wanted;
  }

  const anchors = priority.filter((index) => index >= 0 && index < total);
  if (anchors.length > 0) {
    for (let distance = 1; distance < total; distance++) {
      const ahead = anchors.find((index) => open(index + distance));
      if (ahead !== undefined) {
        return ahead + distance;
      }
      const behind = anchors.find((index) => open(index - distance));
      if (behind !== undefined) {
        return behind - distance;
      }
    }
  }

  for (let index = 0; index < total; index++) {
    if (open(index)) {
      return index;
    }
  }
  return null;
}
