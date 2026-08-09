/**
 * Finds musical staves in an engraved PDF by looking at vector geometry.
 *
 * A staff is a run of long, evenly spaced horizontal rules. Notation software
 * draws those as either stroked lines or very thin filled rectangles, and — this
 * is the part that matters — it batches many of them into a *single* path made of
 * many subpaths. Engravers emit a whole staff, and often every barline on the
 * page, as one path operation. So we decompose each path into its subpaths and
 * measure those: wide + almost zero height means "horizontal rule".
 *
 * Everything here is in PDF user space (origin bottom-left, y increases upward),
 * which is the same space `pdf-lib` clips and draws in. Keeping one coordinate
 * system end to end is what lets a detected staff be handed straight to
 * `embedPage` without a conversion step.
 */

/** The pdf.js operator codes we care about. `pdfjs.OPS` satisfies this. */
export type PdfOps = {
  transform: number;
  save: number;
  restore: number;
  constructPath: number;
  paintFormXObjectBegin?: number;
  paintFormXObjectEnd?: number;
};

type OperatorList = { fnArray: number[]; argsArray: unknown[][] };

/** The slice of pdf.js's page object this module needs. */
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
  /** y of the topmost rule. */
  top: number;
  /** y of the bottommost rule. Equal to `top` on a one-line staff. */
  bottom: number;
  left: number;
  right: number;
  /**
   * Distance between adjacent rules; the engraving's unit of scale. A one-line
   * staff has no internal spacing of its own, so it inherits the page's.
   */
  lineSpacing: number;
  /** 5 for standard notation, 6 for guitar TAB, 1 for some percussion. */
  lineCount: number;
  /**
   * Top of everything that visually belongs to this staff — ledger lines, high
   * notes, dynamics, ottava brackets — not just the staff lines. Never reaches
   * into a neighbouring staff's own lines.
   */
  contentTop: number;
  /** Bottom of the same extent. */
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
  /**
   * How far the topmost and bottommost staves on a page may grow beyond their
   * own lines, in staff-heights. Staves in between are bounded by their
   * neighbours instead; this only stops a title or page number from dragging an
   * outer band across the page.
   */
  maxContentGrowth: number;
};

export const DEFAULT_DETECTION: DetectionOptions = {
  maxRuleThickness: 2.5,
  minRuleWidthRatio: 0.5,
  ruleMergeTolerance: 1,
  spacingTolerance: 0.25,
  // Wide enough for one-line percussion through standard notation (5) and
  // guitar or bass TAB (6), with headroom for the unusual.
  minLinesPerStaff: 1,
  maxLinesPerStaff: 8,
  staffBreakFactor: 1.75,
  maxContentGrowth: 4,
};

/** Nominal vertical extent of a staff, so a one-line staff still has a size. */
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

/** An axis-aligned box in whatever space it was measured in. */
type Box = { left: number; bottom: number; right: number; top: number };

/**
 * pdf.js encodes a path as a flat run of `[op, ...coords]`. These are its
 * `DrawOPS` values; the coordinate counts are 2, 2, 6 and 0 respectively.
 */
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
 * Splits one path buffer into a bounding box per subpath.
 *
 * Each `moveTo` begins a new subpath, so a path holding a staff's five lines
 * yields five boxes rather than one 18pt-tall box that no thickness test would
 * ever accept. Curve control points are folded into the box, which can only
 * overstate a subpath's height — and overstating means "not a rule", so a curve
 * is never mistaken for a staff line.
 *
 * Returns null if the buffer is not in the expected encoding, letting the caller
 * fall back to the aggregate bounding box pdf.js supplies.
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

/** The raw path buffer pdf.js puts in `args[1]`, if it is one. */
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

/** Maps a box through the CTM into page space. */
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

function toMatrix(value: unknown): Matrix | null {
  const m = value as ArrayLike<number> | undefined;
  if (!m || typeof m !== 'object' || m.length < 6) return null;
  const out = [m[0], m[1], m[2], m[3], m[4], m[5]];
  return out.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (out as Matrix)
    : null;
}

/**
 * Walks the operator list and collects a page-space box for every subpath drawn,
 * resolving each through the transform stack in force where it was drawn.
 *
 * Form XObjects matter here: notation software often nests page content inside
 * them, and their matrix has to be composed in or every box lands in the wrong
 * place.
 *
 * This is the single geometry pass. Staff lines, barlines and "all the ink near
 * a staff" are all read off the result rather than re-walking the operators.
 */
export function collectBoxes(operators: OperatorList, ops: PdfOps): Box[] {
  const boxes: Box[] = [];
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];

  for (let i = 0; i < operators.fnArray.length; i++) {
    const fn = operators.fnArray[i];
    const args = operators.argsArray[i];

    if (fn === ops.save) {
      stack.push(ctm);
      continue;
    }
    if (fn === ops.restore) {
      ctm = stack.pop() ?? IDENTITY;
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
      stack.push(ctm);
      const m = toMatrix(args?.[0]);
      if (m) ctm = multiply(ctm, m);
      continue;
    }
    if (
      ops.paintFormXObjectEnd !== undefined &&
      fn === ops.paintFormXObjectEnd
    ) {
      ctm = stack.pop() ?? IDENTITY;
      continue;
    }
    if (fn !== ops.constructPath) continue;

    // pdf.js hands us [drawOp, [pathBuffer], [minX, minY, maxX, maxY]].
    const buffer = pathBuffer(args?.[1]);
    const subpaths = buffer ? subpathBoxes(buffer) : null;

    if (subpaths) {
      for (const box of subpaths) boxes.push(transformBox(ctm, box));
      continue;
    }

    // No readable path: fall back to the aggregate box pdf.js computed. This
    // only ever resolves paths that are a single subpath on their own.
    const minMax = args?.[2] as ArrayLike<number> | undefined;
    if (!minMax || minMax.length < 4) continue;

    boxes.push(
      transformBox(ctm, {
        left: minMax[0],
        bottom: minMax[1],
        right: minMax[2],
        top: minMax[3],
      }),
    );
  }

  return boxes;
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

/**
 * Vertical rules: narrow, and clearly taller than they are wide. Note stems
 * qualify too, which is harmless — the only question ever asked of these is
 * whether one reaches from one staff's lines all the way to the next staff's,
 * and a stem never does.
 */
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

/** Convenience wrapper: the horizontal rules on a page, in one call. */
export function collectRules(
  operators: OperatorList,
  ops: PdfOps,
  options: DetectionOptions = DEFAULT_DETECTION,
): Rule[] {
  return rulesFromBoxes(collectBoxes(operators, ops), options);
}

/** Total length covered by a set of possibly overlapping intervals. */
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
 * Merges rules that sit at the same height and drops anything too short to be a
 * staff line, judged relative to the longest rule on the page.
 *
 * A rule's length is how much it actually *covers*, not the distance from its
 * leftmost to its rightmost piece. A staff line interrupted by barlines is still
 * near-continuous and survives; a row of separate ledger lines spans just as far
 * but covers almost none of it, and is correctly rejected. Measuring the span
 * instead lets a row of ledger lines masquerade as a staff line.
 */
export function consolidateRules(
  rules: Rule[],
  options: DetectionOptions = DEFAULT_DETECTION,
): Rule[] {
  if (rules.length === 0) return [];

  const sorted = [...rules].sort((a, b) => b.y - a.y);
  const groups: { y: number; spans: [number, number][] }[] = [];

  for (const rule of sorted) {
    const last = groups.at(-1);
    if (last && Math.abs(last.y - rule.y) <= options.ruleMergeTolerance) {
      last.spans.push([rule.left, rule.right]);
      // Track the running centre so a stack of near-identical rules does not drift.
      last.y = (last.y + rule.y) / 2;
      continue;
    }
    groups.push({ y: rule.y, spans: [[rule.left, rule.right]] });
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
 * Groups consecutive rules into staves.
 *
 * Rather than assuming five lines, this segments the rules wherever the vertical
 * gap jumps well above the page's typical line spacing, and calls each resulting
 * run a staff. That makes the line count an *output* of detection instead of an
 * assumption, which is what lets standard notation (5), guitar and bass TAB (6)
 * and one-line percussion coexist in the same system.
 *
 * The page's typical spacing is taken as the median gap: within-staff gaps
 * outnumber between-staff gaps several times over on any normal page, so the
 * median lands on the line spacing without needing to know the staff size first.
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

  const segments: Rule[][] = [[rules[0]]];
  for (let i = 1; i < rules.length; i++) {
    if (breakAt > 0 && gaps[i - 1] > breakAt) segments.push([rules[i]]);
    else segments[segments.length - 1].push(rules[i]);
  }

  const staves: Staff[] = [];
  for (const segment of segments) {
    if (
      segment.length < options.minLinesPerStaff ||
      segment.length > options.maxLinesPerStaff
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
 * Widens each staff's band to cover everything drawn that belongs to it —
 * ledger lines, notes far above or below the staff, dynamics, ottava brackets,
 * lyrics — instead of stopping at the outermost staff line.
 *
 * A box is claimable by a staff only if it does not overlap *any* staff's lines
 * but that one's. This single rule does a surprising amount of work: it discards
 * the page-background rectangle, the system bracket and every barline joining
 * two staves, because each of those crosses more than one staff. What is left is
 * ink that sits above or below exactly one staff, which is precisely the ink
 * that should travel with it when that part is extracted.
 *
 * Because claimable ink never overlaps a neighbour's lines, a band can grow
 * right up to — but never into — the staff next door. Growth is additionally
 * capped so a page number or footer cannot drag the outermost band down the page.
 */
/**
 * Follows a run of ink outwards from a staff and reports how far it reaches.
 *
 * `direction` is 1 for upwards, -1 for downwards. A box joins the run only if it
 * both sits within `reach` of something already in it *and* overlaps it
 * horizontally — a ledger-line stack is a column rising out of one point on the
 * staff, not a general licence to absorb anything at that height. Without the
 * horizontal test a dense page chains straight through the gap and into the next
 * instrument's music, because on some row or other there is always ink.
 *
 * The staff's own lines seed the run at full width, so the first step outwards
 * can begin anywhere along it; from there the run narrows to whatever it caught.
 */
function chainOutwards(
  staff: Staff,
  candidates: readonly Box[],
  reach: number,
  direction: 1 | -1,
  start: number,
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
  ];
  const taken = new Set<number>();
  let frontier = start;

  // A box can turn out to be reachable only via one sorted after it, so sweep
  // again while anything new is being caught. Two passes settle almost always.
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

export function attachContentBounds(
  staves: readonly Staff[],
  ink: readonly Box[],
  options: DetectionOptions = DEFAULT_DETECTION,
): Staff[] {
  if (staves.length === 0) return [];

  const ordered = [...staves].sort((a, b) => b.top - a.top);

  // Ink crossing two staves' lines belongs to neither: that is the page
  // background, the system bracket, and every barline joining staves together.
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
    // A staff with a neighbour is already bounded by that neighbour's lines,
    // which claimable ink can never cross. The growth allowance is only needed
    // at the open ends of the page, where a title or page number would
    // otherwise be the nearest thing to chain onto.
    const staffAbove = ordered[index - 1];
    const staffBelow = ordered[index + 1];
    const ceiling = staffAbove ? staffAbove.bottom : staff.top + room;
    const floor = staffBelow ? staffBelow.top : staff.bottom - room;
    // Ledger lines are spaced by the staff's own line spacing, so a chain step
    // is allowed to be a little wider than that and no more.
    const reach = (staff.lineSpacing || 1) * 1.5;

    const near = claimable.filter(
      (box) => box.right >= staff.left && box.left <= staff.right,
    );

    let top = staff.top;
    let bottom = staff.bottom;

    // Anything sitting across the staff's own lines is unambiguously its own.
    for (const box of near) {
      if (box.bottom <= staff.top && box.top >= staff.bottom) {
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
      }
    }

    return {
      ...staff,
      contentTop: Math.min(chainOutwards(staff, near, reach, 1, top), ceiling),
      contentBottom: Math.max(
        chainOutwards(staff, near, reach, -1, bottom),
        floor,
      ),
    };
  });
}

/**
 * Does some vertical rule run from the upper staff's lines down to the lower
 * staff's? That is what a barline or system bracket does, and it is the
 * engraving's own statement that the two staves are played together.
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

/**
 * Splits staves into systems.
 *
 * When the page's vertical rules are known, they decide it: staves joined by a
 * barline or bracket are one system. That is a far better signal than spacing,
 * because spacing alone genuinely cannot tell an eight-stave orchestral system
 * from eight evenly spaced one-staff systems on a lead sheet — the gaps look
 * identical. The engraver already drew the answer.
 *
 * Without that information we fall back to spacing: look for the widest
 * proportional jump in the sorted gaps, which adapts to the engraving's own
 * scale, and default to a multiple of the staff height when no jump stands out.
 */
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
 * Boxes for the page's text, so lyrics, dynamics and tempo marks count as ink a
 * staff can claim. Text is a nicety here — a page with no text layer simply
 * contributes nothing.
 */
async function textBoxes(page: StaffSourcePage): Promise<Box[]> {
  try {
    const content = await page.getTextContent();
    const boxes: Box[] = [];

    for (const raw of content.items) {
      const item = raw as {
        transform?: number[];
        width?: number;
        height?: number;
      };
      if (!Array.isArray(item.transform) || item.transform.length < 6) continue;

      const x = item.transform[4];
      const y = item.transform[5];
      const width = item.width ?? 0;
      const height = item.height ?? 0;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      boxes.push({
        left: x,
        right: x + width,
        bottom: y,
        top: y + height,
      });
    }
    return boxes;
  } catch {
    return [];
  }
}

/** Runs the full pipeline for one page. */
export async function detectPageStaves(
  page: StaffSourcePage,
  pageIndex: number,
  ops: PdfOps,
  options: DetectionOptions = DEFAULT_DETECTION,
): Promise<PageStaves> {
  const viewport = page.getViewport({ scale: 1 });
  const operators = await page.getOperatorList();

  const boxes = collectBoxes(operators, ops);
  const rules = consolidateRules(rulesFromBoxes(boxes, options), options);
  const staves = groupIntoStaves(rules, options);

  const ink = [...boxes, ...(await textBoxes(page))];
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
  };
}

type TextItem = { str: string; transform: number[] };

/**
 * Guesses part names from the instrument labels printed to the left of the first
 * system. Only the first system is labelled in full in most scores, so callers
 * should treat position within the system — not the name — as the identity of a
 * part, and use these purely as human-readable titles.
 */
export async function guessPartNames(
  page: StaffSourcePage,
  system: System,
): Promise<(string | null)[]> {
  let items: TextItem[] = [];
  try {
    const content = await page.getTextContent();
    items = content.items.filter(
      (item): item is TextItem =>
        typeof (item as TextItem)?.str === 'string' &&
        Array.isArray((item as TextItem)?.transform),
    );
  } catch {
    // Text extraction is a nicety; a scanned score simply has no text layer.
    return system.staves.map(() => null);
  }

  return system.staves.map((staff) => {
    const height = staffHeight(staff);
    const candidates = items.filter((item) => {
      const x = item.transform[4];
      const y = item.transform[5];
      const withinBand = y <= staff.top + height && y >= staff.bottom - height;
      return withinBand && x < staff.left && item.str.trim().length > 0;
    });

    if (candidates.length === 0) return null;
    // Read left-to-right so multi-word labels ("Gtr 1") come back in order.
    return (
      candidates
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((item) => item.str.trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim() || null
    );
  });
}
