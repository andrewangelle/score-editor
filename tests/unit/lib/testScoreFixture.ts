/**
 * Generates a synthetic engraved score for tests.
 *
 * It reproduces the features that make real detection hard — barlines and braces
 * spanning staves, beams, ledger lines, slurs and hairpins — so the staff finder
 * has to discriminate rather than just collect every path on the page.
 */

import {
  lineTo,
  moveTo,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
  setLineWidth,
  stroke,
} from 'pdf-lib';

export type FixtureOptions = {
  pageCount: number;
  systemsPerPage: number;
  partNames: string[];
  /**
   * Lines in each part's staff, indexed alongside `partNames`. Defaults to five
   * for every part; set entries to 6 for TAB or 1 for percussion.
   */
  lineCounts?: number[];
  /** Distance between adjacent staff lines. */
  lineSpacing: number;
  /** Blank space between the bottom line of a staff and the top of the next. */
  staffGap: number;
  /** Blank space between systems. */
  systemGap: number;
  /**
   * Emit a staff's lines, and a system's barlines, as one path made of many
   * subpaths — which is what MuseScore, Finale and LilyPond all do.
   *
   * This defaults to on because it is what real engraved PDFs look like, and a
   * detector that only reads each path's overall bounding box sees a staff as
   * one 24pt-tall blob and finds nothing at all. Set it false to get one path
   * per line, which some simpler producers do emit.
   */
  batchedPaths: boolean;
  /**
   * Stacked ledger lines reaching `reach` points above the given staff's top
   * line, as a dense chord high above the staff produces. Used to check that a
   * part's band grows to keep them.
   */
  highNotes?: { ordinal: number; reach: number };
  /**
   * Long horizontals that look like staff lines but are not, drawn against
   * every staff: rows of beams set a fraction of a line-space off a staff line,
   * a bracket line in the gap below the staff, and a pair of gliss lines spaced
   * exactly as staff lines are.
   *
   * All three are ordinary engraving, and each has its own way of destroying a
   * part list — the beams by dragging a staff line off its true height until the
   * staff no longer looks evenly spaced, the other two by adding lines or whole
   * staves that no instrument plays. Off by default so the other fixtures stay
   * legible; see the decoy tests for what each one costs.
   */
  staffLineDecoys: boolean;
};

export const FIXTURE_DEFAULTS: FixtureOptions = {
  pageCount: 2,
  systemsPerPage: 3,
  partNames: ['Drums', 'Bass', 'Gtr 1', 'Gtr 2'],
  lineSpacing: 6,
  staffGap: 30,
  systemGap: 70,
  batchedPaths: true,
  staffLineDecoys: false,
};

type Segment = { x1: number; y1: number; x2: number; y2: number };

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
const LEFT = 90;
const RIGHT = 560;

export type FixtureStaff = {
  page: number;
  system: number;
  ordinal: number;
  top: number;
};

/**
 * Draws segments as a single path of many subpaths, or as one path each.
 *
 * The batched form is the whole point of this helper: `moveTo`/`lineTo` pairs
 * accumulate into one path operator, so pdf.js reports a single bounding box
 * covering all of them. Anything reading only that box cannot see the
 * individual lines.
 */
function drawSegments(
  page: ReturnType<PDFDocument['addPage']>,
  segments: Segment[],
  thickness: number,
  batched: boolean,
): void {
  if (segments.length === 0) return;

  if (!batched) {
    for (const s of segments) {
      page.drawLine({
        start: { x: s.x1, y: s.y1 },
        end: { x: s.x2, y: s.y2 },
        thickness,
        color: rgb(0, 0, 0),
      });
    }
    return;
  }

  page.pushOperators(
    pushGraphicsState(),
    setLineWidth(thickness),
    ...segments.flatMap((s) => [moveTo(s.x1, s.y1), lineTo(s.x2, s.y2)]),
    stroke(),
    popGraphicsState(),
  );
}

export async function buildScoreFixture(
  overrides: Partial<FixtureOptions> = {},
): Promise<{ bytes: Uint8Array; staves: FixtureStaff[] }> {
  const options = { ...FIXTURE_DEFAULTS, ...overrides };
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const linesFor = (ordinal: number) => options.lineCounts?.[ordinal] ?? 5;
  const staves: FixtureStaff[] = [];

  for (let p = 0; p < options.pageCount; p++) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    if (p === 0) {
      page.drawText('Synthetic Score', { x: LEFT, y: 740, size: 18, font });
    }
    let y = p === 0 ? 700 : 730;

    for (let s = 0; s < options.systemsPerPage; s++) {
      const systemTop = y;
      const staffLines: Segment[] = [];
      const barlines: Segment[] = [];
      const ledgers: Segment[] = [];

      options.partNames.forEach((name, ordinal) => {
        staves.push({ page: p, system: s, ordinal, top: y });
        const lines = linesFor(ordinal);
        // A one-line staff has no internal height, so give it a nominal one for
        // the barlines and noteheads drawn against it.
        const staffHeight = Math.max(lines - 1, 1) * options.lineSpacing;

        for (let line = 0; line < lines; line++) {
          const lineY = y - line * options.lineSpacing;
          staffLines.push({ x1: LEFT, y1: lineY, x2: RIGHT, y2: lineY });
        }

        // Instrument label, only on the first system as engravers do.
        if (s === 0) {
          page.drawText(name, {
            x: 34,
            y: y - staffHeight / 2 - 2,
            size: 7,
            font,
          });
        }

        // Barlines: tall and thin, must not be mistaken for staff lines.
        for (const x of [LEFT, 230, 370, RIGHT]) {
          barlines.push({ x1: x, y1: y, x2: x, y2: y - staffHeight });
        }

        // Noteheads, ledger lines and a beam: short or thick horizontals that
        // the width and thickness filters have to reject.
        for (let n = 0; n < 4; n++) {
          const nx = 120 + n * 100;
          page.drawCircle({
            x: nx,
            y: y - staffHeight / 2,
            size: 2.6,
            color: rgb(0, 0, 0),
          });
          const ledgerY = y + options.lineSpacing;
          ledgers.push({
            x1: nx - 6,
            y1: ledgerY,
            x2: nx + 6,
            y2: ledgerY,
          });
        }
        page.drawRectangle({
          x: 120,
          y: y + staffHeight * 0.4,
          width: 90,
          height: 3.2,
          color: rgb(0, 0, 0),
        });

        if (options.staffLineDecoys) {
          const bottomLine = y - staffHeight;
          const middleLine = y - Math.floor((lines - 1) / 2) * options.lineSpacing;

          // Beams, in the three rows a couple of voices produce. Each row sits
          // a fraction of a line-space under the middle staff line, near enough
          // to be taken for part of it. They stop well inside the system, as
          // beams always do — there is a clef in the way.
          for (const step of [0.15, 0.3, 0.45]) {
            const centre = middleLine - step * options.lineSpacing;
            const thickness = options.lineSpacing * 0.15;
            for (let n = 0; n < 8; n++) {
              const x = LEFT + 20 + n * 52;
              page.drawRectangle({
                x,
                y: centre - thickness / 2,
                width: 42,
                height: thickness,
                color: rgb(0, 0, 0),
              });
            }
          }

          // A bracket line under the staff, and a pair of gliss lines below it
          // spaced exactly like staff lines. Both run most of the system but
          // neither reaches its edges.
          const inset = 40;
          const pairTop = bottomLine - options.staffGap * 0.55;
          drawSegments(
            page,
            [bottomLine - options.staffGap * 0.25, pairTop, pairTop - options.lineSpacing].map(
              (lineY) => ({
                x1: LEFT + inset,
                y1: lineY,
                x2: RIGHT - inset,
                y2: lineY,
              }),
            ),
            0.6,
            options.batchedPaths,
          );
        }

        // A chord stacked well above the staff, on ledger lines of its own.
        if (options.highNotes?.ordinal === ordinal) {
          const steps = Math.ceil(
            options.highNotes.reach / options.lineSpacing,
          );
          for (let k = 1; k <= steps; k++) {
            const ledgerY = y + k * options.lineSpacing;
            ledgers.push({ x1: 294, y1: ledgerY, x2: 306, y2: ledgerY });
            page.drawCircle({
              x: 300,
              y: ledgerY,
              size: 2.6,
              color: rgb(0, 0, 0),
            });
          }
        }

        y -= staffHeight + options.staffGap;
      });

      drawSegments(page, staffLines, 0.6, options.batchedPaths);
      drawSegments(page, ledgers, 0.6, options.batchedPaths);
      // Real engravers emit a system's barlines as one path too, so the
      // vertical-rule reader has to split subpaths exactly as the horizontal
      // one does.
      drawSegments(page, barlines, 0.8, options.batchedPaths);

      // Bracket joining the system, plus a hairpin above the top staff.
      page.drawLine({
        start: { x: LEFT - 6, y: systemTop },
        end: { x: LEFT - 6, y: y + options.staffGap },
        thickness: 2,
        color: rgb(0, 0, 0),
      });
      page.drawLine({
        start: { x: 300, y: systemTop + 10 },
        end: { x: 360, y: systemTop + 16 },
        thickness: 0.6,
        color: rgb(0, 0, 0),
      });

      y -= options.systemGap - options.staffGap;
    }
  }

  return { bytes: await doc.save(), staves };
}
