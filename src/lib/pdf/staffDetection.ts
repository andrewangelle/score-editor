/**
 * Finds musical staves in an engraved PDF by looking at vector geometry.
 *
 * Engravers batch a whole staff — often every barline on the page too — into a
 * single path made of many subpaths, so paths are decomposed into subpaths
 * before being measured: wide + almost zero height means "horizontal rule".
 *
 * Everything is in PDF user space, the same space `pdf-lib` clips and draws in,
 * so a detected staff can go straight to `embedPage` with no conversion.
 */
export type PdfOps = {
  transform: number;
  save: number;
  restore: number;
  constructPath: number;
  paintFormXObjectBegin?: number;
  paintFormXObjectEnd?: number;
};

type OperatorList = { fnArray: number[]; argsArray: unknown[][] };

export type StaffSourcePage = {
  getOperatorList(): Promise<OperatorList>;
  getViewport(options: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
};

export type Rect = {
  left: number;
  bottom: number;
  right: number;
  top: number;
};

export type Staff = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  lineSpacing: number;
  /** 5 for standard notation, 6 for guitar TAB, 1 for some percussion. */
  lineCount: number;
  /** Extent of everything that visually belongs to this staff — ledger lines, dynamics, etc */
  contentTop: number;
  contentBottom: number;
};

export type System = {
  staves: Staff[];
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type PageStaves = {
  pageIndex: number;
  width: number;
  height: number;
  systems: System[];
  clips?: Rect[] | null;
  /**
   * ink and text represent ever annotation on the page,
   * so a second reader (`markings.ts`) doesn't need to recompute
   */
  ink?: Rect[];
  text?: PageTextItem[];
};

export type DetectionOptions = {
  /** Paths taller than this are not rules. Generous: some engravers use 1pt+. */
  maxRuleThickness: number;
  /** Rules shorter than this fraction of the widest rule are ignored. */
  minRuleWidthRatio: number;
  /** Rules within this vertical distance are treated as one broken rule. */
  ruleMergeTolerance: number;
  /** Allowed deviation of staff line spacing, as a fraction of the mean. */
  spacingTolerance: number;
  /** Smallest number of rules that can constitute a staff. */
  minLinesPerStaff: number;
  /** Largest number of rules that can constitute a staff. */
  maxLinesPerStaff: number;
  /**
   * A vertical gap this many times the page's typical line spacing ends the
   * current staff and begins the next.
   */
  staffBreakFactor: number;
  maxContentGrowth: number;
  /** How far a rule's ends may sit from the staff's, */
  staffEdgeTolerance: number;
};

const UNAMBIGUOUS_STAFF_LINES = 4;

/**
 * How far a chain of ink may step, in staff line spacings. Ledger lines are
 * spaced by the staff's own line spacing
 */
const CHAIN_REACH_FACTOR = 1.75;

/**
 * How far below its baseline a glyph reaches, as a fraction of the font size.
 */
const TEXT_DESCENT = 0.25;

export const DEFAULT_DETECTION: DetectionOptions = {
  maxRuleThickness: 2.5,
  minRuleWidthRatio: 0.5,
  ruleMergeTolerance: 1,
  spacingTolerance: 0.25,
  minLinesPerStaff: 1,
  maxLinesPerStaff: 8,
  staffBreakFactor: 1.75,
  maxContentGrowth: 4,
  staffEdgeTolerance: 0.02,
};

export async function detectPageStaves(
  page: StaffSourcePage,
  pageIndex: number,
  ops: PdfOps,
  options: DetectionOptions = DEFAULT_DETECTION,
): Promise<PageStaves> {
  const viewport = page.getViewport({ scale: 1 });
  const operators = await page.getOperatorList();

  const { boxes, clips } = collectGeometry(operators, ops);
  const rules = consolidateRules(rulesFromBoxes(boxes, options), options);
  const staves = groupIntoStaves(rules, options);
  const text = await readVisibleText(page, clips);
  const ink = [...boxes, ...text.map((item) => withDescent(item.rect))];
  const systems = groupIntoSystems(
    attachContentBounds(staves, ink, options),
    verticalsFromBoxes(boxes, options),
    options,
  );

  return {
    pageIndex,
    width: viewport.width,
    height: viewport.height,
    systems,
    clips,
    ink: boxes,
    text,
  };
}

export function staffHeight(staff: Staff): number {
  return Math.max(staff.top - staff.bottom, staff.lineSpacing * 4);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** A horizontal rule: a candidate staff line. */
type Rule = { y: number; left: number; right: number };
type Box = { left: number; bottom: number; right: number; top: number };

const DRAW_MOVE_TO = 0;
const DRAW_LINE_TO = 1;
const DRAW_CURVE_TO = 2;
const DRAW_CLOSE_PATH = 3;

function grow(box: Box, x: number, y: number): void {
  if (x < box.left) box.left = x;
  if (x > box.right) box.right = x;
  if (y < box.bottom) box.bottom = y;
  if (y > box.top) box.top = y;
}

/**
 * Splits one path buffer into a bounding box per subpath
 */
export function subpathBoxes(buffer: ArrayLike<number>): Box[] | null {
  const boxes: Box[] = [];
  let current: Box | null = null;

  for (let i = 0; i < buffer.length; ) {
    const op = buffer[i++];

    if (op === DRAW_MOVE_TO) {
      if (i + 2 > buffer.length) return null;
      if (current) boxes.push(current);
      const x = buffer[i++];
      const y = buffer[i++];
      current = { left: x, right: x, bottom: y, top: y };
      continue;
    }

    if (op === DRAW_LINE_TO) {
      if (!current || i + 2 > buffer.length) return null;
      grow(current, buffer[i++], buffer[i++]);
      continue;
    }

    if (op === DRAW_CURVE_TO) {
      if (!current || i + 6 > buffer.length) return null;
      for (let point = 0; point < 3; point++) {
        grow(current, buffer[i++], buffer[i++]);
      }
      continue;
    }

    // closePath returns to the subpath's start, which is already in the box.
    if (op === DRAW_CLOSE_PATH) continue;

    return null;
  }

  if (current) boxes.push(current);
  return boxes;
}

function pathBuffer(arg: unknown): ArrayLike<number> | null {
  const data = arg as ArrayLike<unknown> | undefined;
  if (!data || typeof data !== 'object' || data.length === 0) return null;

  const first = data[0] as ArrayLike<number> | undefined;

  // Once rendered, pdf.js swaps the buffer for a Path2D we cannot read.
  if (
    !first ||
    typeof first !== 'object' ||
    typeof first.length !== 'number' ||
    typeof first[0] !== 'number'
  ) {
    return null;
  }
  return first;
}

function transformBox(ctm: Matrix, box: Box): Box {
  const corners: [number, number][] = [
    applyMatrix(ctm, box.left, box.bottom),
    applyMatrix(ctm, box.right, box.bottom),
    applyMatrix(ctm, box.left, box.top),
    applyMatrix(ctm, box.right, box.top),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    bottom: Math.min(...ys),
    top: Math.max(...ys),
  };
}

/** A clip that admits nothing; `intersect` rejects everything against it. */
const EMPTY_CLIP: Box = { left: 1, bottom: 1, right: -1, top: -1 };

/**
 * The bounds are inclusive on purpose: a staff line is a box of (almost) zero
 * height, and one sitting exactly on the edge of a clip region is still drawn.
 */
function intersect(a: Box, b: Box): Box | null {
  const left = Math.max(a.left, b.left);
  const bottom = Math.max(a.bottom, b.bottom);
  const right = Math.min(a.right, b.right);
  const top = Math.min(a.top, b.top);
  return left <= right && bottom <= top ? { left, bottom, right, top } : null;
}

function toMatrix(value: unknown): Matrix | null {
  const m = value as ArrayLike<number> | undefined;
  if (!m || typeof m !== 'object' || m.length < 6) return null;
  const out = [m[0], m[1], m[2], m[3], m[4], m[5]];
  return out.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (out as Matrix)
    : null;
}

export type PageGeometry = {
  boxes: Box[];
  clips: Box[] | null;
};

/**
 * The single geometry pass: staff lines, barlines and "ink near a staff" are all
 * read off its result rather than by re-walking the operators.
 */
export function collectGeometry(
  operators: OperatorList,
  ops: PdfOps,
): PageGeometry {
  const boxes: Box[] = [];
  const clips: Box[] = [];
  let ctm: Matrix = IDENTITY;
  let clip: Box | null = null;
  const stack: { ctm: Matrix; clip: Box | null }[] = [];
  let unclipped = false;

  const recorded = new Set<Box>();

  const push = (box: Box): void => {
    const visible = clip ? intersect(box, clip) : box;
    if (!visible) return;
    boxes.push(visible);

    if (!clip) {
      unclipped = true;
      return;
    }

    if (!recorded.has(clip)) {
      recorded.add(clip);
      clips.push(clip);
    }
  };

  for (let i = 0; i < operators.fnArray.length; i++) {
    const fn = operators.fnArray[i];
    const args = operators.argsArray[i];

    if (fn === ops.save) {
      stack.push({ ctm, clip });
      continue;
    }

    if (fn === ops.restore) {
      const previous = stack.pop();
      ctm = previous?.ctm ?? IDENTITY;
      clip = previous?.clip ?? null;
      continue;
    }

    if (fn === ops.transform) {
      const m = toMatrix(args);
      if (m) ctm = multiply(ctm, m);
      continue;
    }

    if (
      ops.paintFormXObjectBegin !== undefined &&
      fn === ops.paintFormXObjectBegin
    ) {
      stack.push({ ctm, clip });

      const matrix = toMatrix(args?.[0]);
      if (matrix) ctm = multiply(ctm, matrix);

      const bbox = args?.[1] as ArrayLike<number> | undefined;
      if (bbox && bbox.length >= 4) {
        const region = transformBox(ctm, {
          left: Math.min(bbox[0], bbox[2]),
          bottom: Math.min(bbox[1], bbox[3]),
          right: Math.max(bbox[0], bbox[2]),
          top: Math.max(bbox[1], bbox[3]),
        });

        // Nested forms that miss each other clip everything away; `null` would
        // read as "unclipped", so keep an impossible box instead.
        clip = clip ? (intersect(clip, region) ?? EMPTY_CLIP) : region;
      }
      continue;
    }

    if (
      ops.paintFormXObjectEnd !== undefined &&
      fn === ops.paintFormXObjectEnd
    ) {
      const previous = stack.pop();
      ctm = previous?.ctm ?? IDENTITY;
      clip = previous?.clip ?? null;
      continue;
    }
    if (fn !== ops.constructPath) continue;

    if (clip && clip.left > clip.right) continue;

    // pdf.js hands us [drawOp, [pathBuffer], [minX, minY, maxX, maxY]].
    const buffer = pathBuffer(args?.[1]);
    const subpaths = buffer ? subpathBoxes(buffer) : null;

    if (subpaths) {
      for (const box of subpaths) push(transformBox(ctm, box));
      continue;
    }

    // No readable path: fall back to the aggregate box pdf.js computed, which
    // only ever resolves paths that are a single subpath on their own.
    const minMax = args?.[2] as ArrayLike<number> | undefined;
    if (!minMax || minMax.length < 4) continue;

    push(
      transformBox(ctm, {
        left: minMax[0],
        bottom: minMax[1],
        right: minMax[2],
        top: minMax[3],
      }),
    );
  }

  return { boxes, clips: unclipped || clips.length === 0 ? null : clips };
}

/** Horizontal rules: wide, near-zero height. Candidate staff lines. */
export function rulesFromBoxes(
  boxes: readonly Box[],
  options: DetectionOptions = DEFAULT_DETECTION,
): Rule[] {
  const rules: Rule[] = [];
  for (const box of boxes) {
    if (box.top - box.bottom > options.maxRuleThickness) continue;
    if (box.right - box.left <= 0) continue;
    rules.push({
      y: (box.top + box.bottom) / 2,
      left: box.left,
      right: box.right,
    });
  }
  return rules;
}

/** A vertical rule: a candidate barline or system bracket. */
export type VerticalRule = { x: number; bottom: number; top: number };

export function verticalsFromBoxes(
  boxes: readonly Box[],
  options: DetectionOptions = DEFAULT_DETECTION,
): VerticalRule[] {
  const verticals: VerticalRule[] = [];
  for (const box of boxes) {
    const width = box.right - box.left;
    const height = box.top - box.bottom;
    if (width > options.maxRuleThickness) continue;
    if (height <= width) continue;
    verticals.push({
      x: (box.left + box.right) / 2,
      bottom: box.bottom,
      top: box.top,
    });
  }
  return verticals;
}

export function collectRules(
  operators: OperatorList,
  ops: PdfOps,
  options: DetectionOptions = DEFAULT_DETECTION,
): Rule[] {
  return rulesFromBoxes(collectGeometry(operators, ops).boxes, options);
}

/** Total length covered by a set of possibly overlapping spans. */
function unionLength(spans: [number, number][]): number {
  if (spans.length === 0) return 0;
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [start, end] = sorted[0];

  for (const [left, right] of sorted.slice(1)) {
    if (left > end) {
      total += end - start;
      start = left;
      end = right;
    } else {
      end = Math.max(end, right);
    }
  }
  return total + (end - start);
}

/**
 * Merges rules at the same height and drops anything too short to be a staff
 * line, relative to the longest rule on the page.
 */
export function consolidateRules(
  rules: Rule[],
  options: DetectionOptions = DEFAULT_DETECTION,
): Rule[] {
  if (rules.length === 0) return [];

  const sorted = [...rules].sort((a, b) => b.y - a.y);
  const groups: { y: number; longest: number; spans: [number, number][] }[] =
    [];

  for (const rule of sorted) {
    const last = groups.at(-1);
    const length = rule.right - rule.left;

    if (last && Math.abs(last.y - rule.y) <= options.ruleMergeTolerance) {
      last.spans.push([rule.left, rule.right]);
      if (length > last.longest) {
        last.longest = length;
        last.y = rule.y;
      }
      continue;
    }
    groups.push({
      y: rule.y,
      longest: length,
      spans: [[rule.left, rule.right]],
    });
  }

  const measured = groups.map((group) => ({
    y: group.y,
    left: Math.min(...group.spans.map((s) => s[0])),
    right: Math.max(...group.spans.map((s) => s[1])),
    covered: unionLength(group.spans),
  }));

  const widest = Math.max(...measured.map((r) => r.covered));
  const minWidth = widest * options.minRuleWidthRatio;
  return measured
    .filter((rule) => rule.covered >= minWidth)
    .map(({ y, left, right }) => ({ y, left, right }));
}

/**
 * Groups consecutive rules into staves by segmenting wherever the vertical gap
 * jumps above the page's typical line spacing.
 */
export function groupIntoStaves(
  rules: Rule[],
  options: DetectionOptions = DEFAULT_DETECTION,
): Staff[] {
  if (rules.length === 0) return [];

  const gaps: number[] = [];
  for (let i = 0; i < rules.length - 1; i++) {
    gaps.push(rules[i].y - rules[i + 1].y);
  }

  const typicalSpacing = gaps.length > 0 ? median(gaps) : 0;
  const breakAt = typicalSpacing * options.staffBreakFactor;

  /** Do two rules begin and end together, to within one of their widths? */
  const sharesEdges = (rule: Rule, reference: Rule): boolean => {
    const slack =
      (reference.right - reference.left) * options.staffEdgeTolerance;
    return (
      Math.abs(rule.left - reference.left) <= slack &&
      Math.abs(rule.right - reference.right) <= slack
    );
  };

  const staffLinesOnly = (segment: Rule[]): Rule[] => {
    if (segment.length < 2) return segment;

    const agreeing = segment.map(
      (reference) =>
        segment.filter((rule) => sharesEdges(rule, reference)).length,
    );
    let best = 0;
    for (let i = 1; i < segment.length; i++) {
      const wider =
        segment[i].right - segment[i].left >
        segment[best].right - segment[best].left;
      if (
        agreeing[i] > agreeing[best] ||
        (agreeing[i] === agreeing[best] && wider)
      ) {
        best = i;
      }
    }

    return segment.filter((rule) => sharesEdges(rule, segment[best]));
  };

  const grouped: Rule[][] = [[rules[0]]];
  for (let i = 1; i < rules.length; i++) {
    if (breakAt > 0 && gaps[i - 1] > breakAt) grouped.push([rules[i]]);
    else grouped[grouped.length - 1].push(rules[i]);
  }

  const segments = grouped.map(staffLinesOnly);
  const full = segments.filter(
    (segment) => segment.length >= UNAMBIGUOUS_STAFF_LINES,
  );

  const alignsWithStaves = (segment: Rule[]): boolean => {
    if (full.length === 0) return true; // A page of nothing but short staves.

    const middle = (segment[0].y + segment[segment.length - 1].y) / 2;
    const at = (run: Rule[]) => (run[0].y + run[run.length - 1].y) / 2;
    const nearest = full.reduce((best, candidate) =>
      Math.abs(at(candidate) - middle) < Math.abs(at(best) - middle)
        ? candidate
        : best,
    );

    return segment.every((rule) => sharesEdges(rule, nearest[0]));
  };

  const staves: Staff[] = [];

  for (const segment of segments) {
    if (
      segment.length < options.minLinesPerStaff ||
      segment.length > options.maxLinesPerStaff
    ) {
      continue;
    }

    if (
      segment.length < UNAMBIGUOUS_STAFF_LINES &&
      !alignsWithStaves(segment)
    ) {
      continue;
    }

    const spacings: number[] = [];
    for (let i = 0; i < segment.length - 1; i++) {
      spacings.push(segment[i].y - segment[i + 1].y);
    }

    // A staff's own lines are evenly spaced; an uneven run is unrelated rules
    // that happened to sit close together. One- and two-line staves have too
    // few gaps to judge, so they are taken at face value.
    if (spacings.length >= 2) {
      const mean = spacings.reduce((sum, g) => sum + g, 0) / spacings.length;
      const uniform = spacings.every(
        (g) => Math.abs(g - mean) <= mean * options.spacingTolerance,
      );
      if (!uniform) continue;
    }

    const top = segment[0].y;
    const bottom = segment[segment.length - 1].y;

    staves.push({
      top,
      bottom,
      left: Math.min(...segment.map((r) => r.left)),
      right: Math.max(...segment.map((r) => r.right)),
      lineSpacing:
        spacings.length > 0
          ? spacings.reduce((sum, g) => sum + g, 0) / spacings.length
          : typicalSpacing,
      lineCount: segment.length,
      // Until the page's ink is examined, a staff is only as tall as its lines.
      contentTop: top,
      contentBottom: bottom,
    });
  }

  return staves;
}

/**
 * Follows a run of ink outwards from a staff (`direction` 1 up, -1 down) and
 * reports how far it reaches.
 */
function chainOutwards(
  staff: Staff,
  candidates: readonly Box[],
  reach: number,
  direction: 1 | -1,
  start: number,
  seed: readonly Box[] = [],
): number {
  const up = direction === 1;
  const pool = candidates
    .filter((box) => (up ? box.bottom > staff.top : box.top < staff.bottom))
    .sort((a, b) => (up ? a.bottom - b.bottom : b.top - a.top));

  const run: Box[] = [
    {
      left: staff.left,
      right: staff.right,
      bottom: staff.bottom,
      top: staff.top,
    },
    ...seed,
  ];
  const taken = new Set<number>();
  let frontier = start;

  // A box can be reachable only via one sorted after it, so sweep again while
  // anything new is caught. Two passes settle almost always.
  for (let pass = 0; pass < 4; pass++) {
    let grew = false;

    for (let i = 0; i < pool.length; i++) {
      if (taken.has(i)) continue;
      const box = pool[i];

      const joins = run.some(
        (held) =>
          box.right >= held.left &&
          box.left <= held.right &&
          (up
            ? box.bottom <= held.top + reach
            : box.top >= held.bottom - reach),
      );
      if (!joins) continue;

      taken.add(i);
      run.push(box);
      frontier = up
        ? Math.max(frontier, box.top)
        : Math.min(frontier, box.bottom);
      grew = true;
    }

    if (!grew) break;
  }

  return frontier;
}

/**
 * Widens each staff's band to cover everything drawn that belongs to it, rather
 * than stopping at the outermost staff line.
 */
export function attachContentBounds(
  staves: readonly Staff[],
  ink: readonly Box[],
  options: DetectionOptions = DEFAULT_DETECTION,
): Staff[] {
  if (staves.length === 0) return [];

  const ordered = [...staves].sort((a, b) => b.top - a.top);

  const spans = ordered.map((staff) => ({
    top: staff.top,
    bottom: staff.bottom,
  }));

  const claimable = ink.filter((box) => {
    let crossed = 0;
    for (const span of spans) {
      if (box.bottom <= span.top && box.top >= span.bottom) crossed++;
      if (crossed > 1) return false;
    }
    return true;
  });

  return ordered.map((staff, index) => {
    const room = staffHeight(staff) * options.maxContentGrowth;
    const staffAbove = ordered[index - 1];
    const staffBelow = ordered[index + 1];
    const ceiling = staffAbove ? staffAbove.bottom : staff.top + room;
    const floor = staffBelow ? staffBelow.top : staff.bottom - room;
    const reach = (staff.lineSpacing || 1) * CHAIN_REACH_FACTOR;
    const near = claimable.filter(
      (box) =>
        box.right >= staff.left &&
        box.left <= staff.right &&
        box.bottom <= ceiling &&
        box.top >= floor,
    );

    let top = staff.top;
    let bottom = staff.bottom;

    const straddling: Box[] = [];

    for (const box of near) {
      if (box.bottom <= staff.top && box.top >= staff.bottom) {
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
        straddling.push(box);
      }
    }

    /**
     * Extends an edge past anything small it lands in the middle of.
     */
    const whole = (edge: number, direction: 1 | -1): number => {
      const up = direction === 1;
      const limit = up ? edge + reach : edge - reach;
      let moved = edge;
      for (const box of near) {
        if (box.top <= edge || box.bottom >= edge) continue;
        if (up ? box.top > limit : box.bottom < limit) continue;
        moved = up ? Math.max(moved, box.top) : Math.min(moved, box.bottom);
      }
      return moved;
    };

    const reachedTop = Math.min(
      chainOutwards(staff, near, reach, 1, top, straddling),
      ceiling,
    );
    const reachedBottom = Math.max(
      chainOutwards(staff, near, reach, -1, bottom, straddling),
      floor,
    );

    return {
      ...staff,
      contentTop: Math.min(whole(reachedTop, 1), ceiling),
      contentBottom: Math.max(whole(reachedBottom, -1), floor),
    };
  });
}

/**
 * Does a vertical rule run from the upper staff's lines to the lower staff's?
 */
function bridged(
  above: Staff,
  below: Staff,
  verticals: readonly VerticalRule[],
  tolerance: number,
): boolean {
  return verticals.some(
    (rule) =>
      rule.top >= above.bottom - tolerance &&
      rule.bottom <= below.top + tolerance,
  );
}

export function groupIntoSystems(
  staves: Staff[],
  verticals?: readonly VerticalRule[],
  options: DetectionOptions = DEFAULT_DETECTION,
): System[] {
  if (staves.length === 0) return [];

  const ordered = [...staves].sort((a, b) => b.top - a.top);
  const gaps: number[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    gaps.push(ordered[i].bottom - ordered[i + 1].top);
  }

  const useVerticals = verticals !== undefined && verticals.length > 0;
  const threshold = useVerticals ? 0 : systemGapThreshold(gaps, ordered);

  const groups: Staff[][] = [[ordered[0]]];
  for (let i = 1; i < ordered.length; i++) {
    const together = useVerticals
      ? bridged(ordered[i - 1], ordered[i], verticals, options.maxRuleThickness)
      : gaps[i - 1] <= threshold;

    if (together) groups[groups.length - 1].push(ordered[i]);
    else groups.push([ordered[i]]);
  }

  return groups.map((group) => ({
    staves: group,
    left: Math.min(...group.map((s) => s.left)),
    right: Math.max(...group.map((s) => s.right)),
    top: Math.max(...group.map((s) => s.top)),
    bottom: Math.min(...group.map((s) => s.bottom)),
  }));
}

function systemGapThreshold(gaps: number[], staves: Staff[]): number {
  const fallback = staffHeight(staves[0]) * 2;
  if (gaps.length < 2) return fallback;

  const sorted = [...gaps].sort((a, b) => a - b);
  let bestRatio = 1;
  let splitAt = -1;
  for (let i = 0; i < sorted.length - 1; i++) {
    // Guard against zero/near-zero gaps producing an infinite ratio.
    const ratio = (sorted[i + 1] + 1) / (sorted[i] + 1);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      splitAt = i;
    }
  }

  // A jump under 1.6x is normal variation inside one system, not a system break.
  if (splitAt === -1 || bestRatio < 1.6) return fallback;
  return (sorted[splitAt] + sorted[splitAt + 1]) / 2;
}

/**
 * pdf.js reports the text layer whole, with no record of the form XObject a run
 * came from, so text hidden by a clipping form still arrives. Anything missing
 * every clip region is invisible ink — most notably the rest of the score
 * inside an extracted part.
 */
function isVisible(
  box: Box,
  clips: readonly Rect[] | null | undefined,
): boolean {
  if (!clips || clips.length === 0) return true;
  return clips.some((clip) => intersect(box, clip) !== null);
}

type TextItem = {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
  fontName?: string;
};

function textItemBox(item: TextItem): Box {
  const x = item.transform[4];
  const y = item.transform[5];
  return {
    left: x,
    right: x + (item.width ?? 0),
    bottom: y,
    top: y + (item.height ?? 0),
  };
}

/** A text rect dropped onto its baseline, so descenders fall inside it. */
function withDescent(rect: Rect): Rect {
  const drop = (rect.top - rect.bottom) * TEXT_DESCENT;
  return { ...rect, top: rect.top - drop, bottom: rect.bottom - drop };
}

export type PageTextItem = {
  str: string;
  rect: Rect;
  fontName: string;
};

export async function readVisibleText(
  page: StaffSourcePage,
  clips?: readonly Rect[] | null,
): Promise<PageTextItem[]> {
  let items: TextItem[];
  try {
    const content = await page.getTextContent();
    items = content.items as TextItem[];
  } catch {
    return [];
  }

  const read: PageTextItem[] = [];
  for (const item of items) {
    if (typeof item?.str !== 'string' || !item.str.trim()) continue;
    if (!Array.isArray(item.transform) || item.transform.length < 6) continue;
    const rect = textItemBox(item);
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.bottom)) continue;
    if (!isVisible(rect, clips)) continue;
    read.push({ str: item.str, rect, fontName: item.fontName ?? '' });
  }
  return read;
}

export async function guessPartNames(
  page: StaffSourcePage,
  system: System,
  clips?: readonly Rect[] | null,
): Promise<(string | null)[]> {
  let items: TextItem[] = [];
  try {
    const content = await page.getTextContent();
    items = content.items.filter(
      (item): item is TextItem =>
        typeof (item as TextItem)?.str === 'string' &&
        Array.isArray((item as TextItem)?.transform) &&
        isVisible(textItemBox(item as TextItem), clips),
    );
  } catch {
    return system.staves.map(() => null);
  }

  return system.staves.map((staff) => {
    const height = staffHeight(staff);
    const inBand = items.filter((item) => {
      const x = item.transform[4];
      const y = item.transform[5];
      const withinBand = y <= staff.top + height && y >= staff.bottom - height;
      return withinBand && x < staff.left && item.str.trim().length > 0;
    });

    const candidates = nearestLines(inBand, staff);
    if (candidates.length === 0) return null;

    return (
      candidates
        .sort(
          (a, b) =>
            b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
        )
        .map((item) => item.str.trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim() || null
    );
  });
}

function nearestLines(items: TextItem[], staff: Staff): TextItem[] {
  if (items.length === 0) return [];

  const distance = (item: TextItem): number => {
    const y = item.transform[5];
    if (y > staff.top) return y - staff.top;
    if (y < staff.bottom) return staff.bottom - y;
    return 0;
  };

  const nearest = Math.min(...items.map(distance));
  const reach = Math.max(staff.lineSpacing * 2, 1);
  return items.filter((item) => distance(item) <= nearest + reach);
}
