/**
 * What `collectGeometry` reports as the page's clips.
 *
 * The clips are the only thing standing between detection and the ink an
 * extracted part carries but does not show, because pdf.js hands over the text
 * layer whole with no record of the form each run came from. A set that covers
 * the page rules nothing out, and every staff then claims ink belonging to its
 * neighbours.
 *
 * Engravers nest form XObjects routinely, so the outer form of an extracted
 * part is full of inner ones — which is what makes the difference between "every
 * bbox seen" and "the clip actually in force" worth a test of its own.
 */

import { collectGeometry, type PdfOps } from '#/lib/pdf/staffDetection';

const OPS: PdfOps = {
  transform: 1,
  save: 2,
  restore: 3,
  constructPath: 4,
  paintFormXObjectBegin: 5,
  paintFormXObjectEnd: 6,
};

const IDENTITY = [1, 0, 0, 1, 0, 0];
const PAGE = { width: 600, height: 800 };

type Op = { fn: number; args: unknown[] };

function operatorList(ops: Op[]) {
  return {
    fnArray: ops.map((op) => op.fn),
    argsArray: ops.map((op) => op.args),
  };
}

/** A path with no readable buffer, so only its bounding box is read. */
const path = (box: number[]): Op => ({
  fn: OPS.constructPath,
  args: [0, undefined, box],
});

const beginForm = (bbox: number[]): Op => ({
  fn: OPS.paintFormXObjectBegin as number,
  args: [IDENTITY, bbox],
});

const endForm: Op = { fn: OPS.paintFormXObjectEnd as number, args: [] };

describe('the clips a page reports', () => {
  it('reports the clip in force, not every form that was entered', () => {
    // An extracted band: a page-sized form holding the source page, clipped
    // down to one system, with the engraver's own nested form inside it.
    const { clips } = collectGeometry(
      operatorList([
        beginForm([0, 0, PAGE.width, PAGE.height]),
        beginForm([0, 100, PAGE.width, 200]),
        path([10, 120, 500, 180]),
        endForm,
        endForm,
      ]),
      OPS,
    );

    expect(clips).not.toBeNull();
    // The page-sized outer form must not be offered as a visibility test: it
    // would admit every last mark on the page.
    for (const clip of clips ?? []) {
      expect(clip.top - clip.bottom).toBeLessThanOrEqual(100);
    }
  });

  it('keeps one entry per band actually drawn into', () => {
    const { clips } = collectGeometry(
      operatorList([
        beginForm([0, 0, PAGE.width, PAGE.height]),
        beginForm([0, 100, PAGE.width, 200]),
        path([10, 120, 500, 180]),
        endForm,
        beginForm([0, 400, PAGE.width, 500]),
        path([10, 420, 500, 480]),
        endForm,
        endForm,
      ]),
      OPS,
    );

    expect(clips).toHaveLength(2);
  });

  it('reports nothing to filter by when the page draws unclipped', () => {
    // A form was entered, but there is also bare page content: the page shows
    // everything, so the clips cannot rule anything out.
    const { clips } = collectGeometry(
      operatorList([
        path([10, 20, 500, 60]),
        beginForm([0, 100, PAGE.width, 200]),
        path([10, 120, 500, 180]),
        endForm,
      ]),
      OPS,
    );

    expect(clips).toBeNull();
  });
});
