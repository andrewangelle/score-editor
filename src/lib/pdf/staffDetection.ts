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

/** `pdfjs.OPS` satisfies this. */
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
  /** y of the topmost rule. */
  top: number;
  /** y of the bottommost rule. Equal to `top` on a one-line staff. */
  bottom: number;
  left: number;
  right: number;
  /** Distance between adjacent rules. A one-line staff inherits the page's. */
  lineSpacing: number;
  /** 5 for standard notation, 6 for guitar TAB, 1 for some percussion. */
  lineCount: number;
  /**
   * Extent of everything that visually belongs to this staff — ledger lines,
   * dynamics, ottava brackets — not just the lines. Never reaches into a
   * neighbouring staff's own lines.
   */
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
  /**
   * Regions the page's form XObjects clip their content to. Carried so the text
   * layer — which pdf.js reports unclipped — can be filtered by the same
   * visibility rules the geometry already respects.
   */
  clips?: Rect[] | null;
  /**
   * Every box drawn on the page, so a second reader (`markings.ts`) need not
   * re-walk the operators. Thousands of these on a dense page: callers holding a
   * page beyond the read that produced it are expected to drop this first.
   */
  ink?: Rect[];
  /** Bulky for the same reason `ink` is, and to be dropped on the same terms. */
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
  /**
   * How far the topmost and bottommost staves on a page may grow beyond their
   * own lines, in staff-heights. Staves in between are bounded by their
   * neighbours instead; this only stops a title or page number from dragging an
   * outer band across the page.
   */
  maxContentGrowth: number;
  /**
   * How far a rule's ends may sit from the staff's, as a fraction of the staff's
   * width, and still be one of its lines. Sharing the system's edges is the one
   * thing separating a staff line from the other long horizontals a score is
   * full of: a rule stopping short is an 8va bracket, hairpin, bend or gliss,
   * however neatly spaced — and admitting one invents a part, shifting every
   * ordinal beneath it.
   */
  staffEdgeTolerance: number;
};

/**
 * Nothing else in engraving stacks this many evenly spaced rules, so this many
 * lines is a staff on its own evidence. Fewer has to look like one in width too.
 */
const UNAMBIGUOUS_STAFF_LINES = 4;

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
  staffEdgeTolerance: 0.02,
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
 * Splits one path buffer into a bounding box per subpath, so a path holding a
 * staff's five lines yields five boxes rather than one 18pt-tall box that no
 * thickness test would accept. Curve control points are folded in, which can
 * only overstate a height — and overstating means "not a rule", so a curve is
 * never mistaken for a staff line.
 *
 * Returns null on an unrecognised encoding, so the caller can fall back to the
 * aggregate bounding box pdf.js supplies.
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
  /** Page-space box per subpath drawn, already clipped to what is visible. */
  boxes: Box[];
  /**
   * Regions the page's form XObjects clip to, null when nothing clips. Only
   * meaningful for filtering things measured outside this pass, i.e. text.
   */
  clips: Box[] | null;
};

/**
 * The single geometry pass: staff lines, barlines and "ink near a staff" are all
 * read off its result rather than by re-walking the operators.
 *
 * Form XObjects matter twice over. Their matrix has to be composed in or boxes
 * land in the wrong place, and their `BBox` *clips* — a form may carry a whole
 * source page while showing only a sliver, which is exactly what an extracted
 * part is. Ignoring it means re-reading a part finds every staff of the score it
 * came from.
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

  // Once anything is drawn with no clip at all, the collected clips are useless
  // as a visibility test: the page shows everything, so they rule out nothing.
  let unclipped = false;
  const recorded = new Set<Box>();

  const push = (box: Box): void => {
    const visible = clip ? intersect(box, clip) : box;
    if (!visible) return;
    boxes.push(visible);

    // Record the clip actually in force, not every form's bbox: an outer form
    // often spans the whole page, and collecting those makes the set rule out
    // nothing — which is how a part counts the score it was cut from as visible.
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
      // pdf.js hands us [matrix, bbox]; the bbox is in the form's own space, so
      // it is measured after the matrix is composed in.
      const m = toMatrix(args?.[0]);
      if (m) ctm = multiply(ctm, m);

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

    // Nothing inside the clip can be drawn, so skip the path decode entirely.
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

/**
 * Vertical rules: narrow, and clearly taller than wide. Note stems qualify too,
 * which is harmless — the only question asked of these is whether one reaches
 * from one staff's lines to the next staff's, and a stem never does.
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
 *
 * Length is what a rule *covers*, not its leftmost-to-rightmost span: a staff
 * line interrupted by barlines is still near-continuous and survives, while a
 * row of ledger lines spans as far but covers almost none of it. Measuring the
 * span instead lets ledger lines masquerade as a staff line.
 *
 * A group takes the y of its *longest* rule, never the average. Beams sit a
 * fraction of a point off a staff line and there are dozens of them, so
 * averaging drags the line until it is no longer evenly spaced from its
 * neighbours and the whole staff is discarded — which is how an inner part
 * silently disappears and every ordinal below it shifts up one.
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
 * jumps above the page's typical line spacing. Line count is an *output* rather
 * than an assumption, which is what lets standard notation (5), TAB (6) and
 * one-line percussion coexist in one system.
 *
 * Typical spacing is the median gap: within-staff gaps outnumber between-staff
 * gaps several times over, so the median lands on the line spacing without
 * needing to know the staff size first.
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

  /**
   * Drops rules that do not share the run's edges, which edges are the run's own
   * being settled by vote: a staff's lines agree, and whatever landed among them
   * does not. Intruders are removed rather than allowed to split the run — a
   * staff cut in half at its third line is two staves no instrument plays.
   */
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

  /**
   * Does a run too short to vouch for itself line up with the full staves around
   * it? Compared against the *nearest* full staff, not the page as a whole,
   * because a piece's first system is indented and genuinely does not reach as
   * far left as the rest — page-wide, its percussion staff would be discarded.
   */
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

    // Too few lines to be a staff on the stack alone, so it has to be one on
    // position: a percussion staff spans the system exactly as its neighbours
    // do, a pair of gliss lines drawn between two staves does not.
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
 *
 * A box joins the run only if it sits within `reach` of something already in it
 * *and* overlaps that horizontally — a ledger-line stack is a column rising out
 * of one point on the staff, not a licence to absorb anything at that height.
 * Without the horizontal test a dense page chains straight through the gap into
 * the next instrument's music, because on some row there is always ink.
 *
 * The staff's own lines seed the run at full width, so the first step outwards
 * can begin anywhere along it; from there it narrows to whatever it caught.
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
 *
 * A box is claimable only if it overlaps no staff's lines but that one's. That
 * single rule discards the page background, the system bracket and every barline
 * joining two staves, leaving exactly the ink that should travel with the part.
 * It also means a band can grow right up to — never into — the staff next door.
 */
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
    // which claimable ink can never cross. The allowance is only needed at the
    // open ends of the page, where a title or page number is otherwise the
    // nearest thing to chain onto.
    const staffAbove = ordered[index - 1];
    const staffBelow = ordered[index + 1];
    const ceiling = staffAbove ? staffAbove.bottom : staff.top + room;
    const floor = staffBelow ? staffBelow.top : staff.bottom - room;
    // Ledger lines are spaced by the staff's own line spacing, so a chain step
    // is allowed to be a little wider than that and no more.
    const reach = (staff.lineSpacing || 1) * 1.5;

    // Both bounds are clamped to the ceiling and floor and chaining only travels
    // outwards, so ink outside that window cannot change either answer.
    // Excluding it up front keeps this affordable on an extracted part, which
    // still holds the whole score's ink, clipped out of sight but present.
    const near = claimable.filter(
      (box) =>
        box.right >= staff.left &&
        box.left <= staff.right &&
        box.bottom <= ceiling &&
        box.top >= floor,
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
 * Does a vertical rule run from the upper staff's lines to the lower staff's?
 * A barline or bracket doing so is the engraving's own statement that the two
 * staves are played together.
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
 * Splits staves into systems. Vertical rules decide it where known, because
 * spacing alone cannot tell an eight-stave orchestral system from eight evenly
 * spaced one-staff systems on a lead sheet — the gaps look identical.
 *
 * Without them, fall back to the widest proportional jump in the sorted gaps,
 * which adapts to the engraving's own scale.
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

  // Text counts as ink a staff can claim, so lyrics, dynamics and tempo marks
  // travel with the music they sit against.
  const text = await readVisibleText(page, clips);
  const ink = [...boxes, ...text.map((item) => item.rect)];
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

export type PageTextItem = {
  str: string;
  rect: Rect;
  /**
   * Most engravers subset fonts per page, so this pdf.js handle identifies a
   * font *within* a page and nowhere else.
   */
  fontName: string;
};

/** The page's text, boxed and filtered to what is actually visible. */
export async function readVisibleText(
  page: StaffSourcePage,
  clips?: readonly Rect[] | null,
): Promise<PageTextItem[]> {
  let items: TextItem[];
  try {
    const content = await page.getTextContent();
    items = content.items as TextItem[];
  } catch {
    // A scanned score simply has no text layer.
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

/**
 * Guesses part names from the instrument labels left of the first system. Most
 * scores label only that system in full, so callers must treat position within
 * the system — not the name — as a part's identity, and these as titles only.
 */
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
        // Labels of parts that were clipped away are still in the text layer;
        // reading one would name a staff after a part that is not there.
        isVisible(textItemBox(item as TextItem), clips),
    );
  } catch {
    // A scanned score simply has no text layer.
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
    // Read top-to-bottom, then left-to-right, so both a two-line label and a
    // multi-word one ("Gtr 1") come back in reading order.
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

/**
 * Narrows label candidates to the text line closest to the staff, plus any line
 * close enough to be a second line of the same label.
 *
 * The candidate band is deliberately generous — engravers place labels above,
 * beside and below the staff — which also lets a neighbour's label in, and an
 * extracted part carries hidden copies of every label in the score. So the
 * nearest line wins and only a line within a couple of staff spaces of it (a
 * wrapped label, never the next staff's) may join it.
 */
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
