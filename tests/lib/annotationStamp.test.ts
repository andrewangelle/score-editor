/**
 * What actually reaches the page.
 *
 * A string identifier is only a string identifier because of the circle around
 * it — an uncircled 3 sitting over a staff reads as a fingering, which is a
 * different instruction, to the player's other hand. So the ring is asserted
 * here, along with the thing that makes it look drawn rather than calculated:
 * that it is centred on the digit, whatever width that digit happens to be.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { AnnotationKind, ScoreAnnotation } from '#/lib/pdf/annotations';
import { createAnnotation } from '#/lib/pdf/annotations';
import { stampAnnotation } from '#/lib/pdf/annotationStamp';
import { recorder } from '#tests/lib/stampRecorder';

const font = await (async () => {
  const pdf = await PDFDocument.create();
  return pdf.embedFont(StandardFonts.Helvetica);
})();

const SIZE = 10;

function stamp(kind: AnnotationKind, text: string, size = SIZE) {
  const recording = recorder();
  const annotation: ScoreAnnotation = {
    ...createAnnotation(0, 40, 100, kind, text),
    size,
  };

  stampAnnotation(
    recording.page,
    annotation,
    { x: 40, y: 100, size },
    font,
  );

  return { ...recording, annotation };
}

describe('stampAnnotation', () => {
  it('draws a fingering as bare text at its anchor', () => {
    const { texts, circles } = stamp('fingering', '1 3 2 4');

    expect(texts).toEqual([{ text: '1 3 2 4', x: 40, y: 100, size: SIZE }]);
    expect(circles).toHaveLength(0);
  });

  it('draws a position as the numeral it was normalized to', () => {
    const { texts, circles } = stamp('position', '7');

    expect(texts[0].text).toBe('VII');
    expect(circles).toHaveLength(0);
  });

  it('rings a string identifier', () => {
    const { texts, circles } = stamp('string', '3');

    expect(texts[0].text).toBe('3');
    expect(circles).toHaveLength(1);
  });

  it('centres the ring on the digit, not on the anchor', () => {
    const narrow = stamp('string', '1').circles[0];
    const wide = stamp('string', '12').circles[0];

    const centre = (text: string) => 40 + font.widthOfTextAtSize(text, SIZE) / 2;
    expect(narrow.x).toBeCloseTo(centre('1'));
    expect(wide.x).toBeCloseTo(centre('12'));
    // Same anchor, same baseline: only the horizontal centre moves.
    expect(wide.y).toBeCloseTo(narrow.y);
  });

  it('opens the ring wide enough to clear the digits inside it', () => {
    for (const text of ['1', '12']) {
      const { circles } = stamp('string', text);
      const width = font.widthOfTextAtSize(text, SIZE);

      expect(circles[0].size * 2).toBeGreaterThan(width);
    }
  });

  it('scales the ring with the mark', () => {
    // Extraction stamps at the region's scale, so a half-size string number has
    // to arrive with a half-size circle rather than a full one around it.
    const full = stamp('string', '3', SIZE).circles[0];
    const half = stamp('string', '3', SIZE / 2).circles[0];

    expect(half.size).toBeCloseTo(full.size / 2);
  });

  it('says nothing for a mark with no text', () => {
    // A blank annotation exists for as long as its editor is open, and it must
    // not leave an empty circle behind if it is baked in that state.
    const { texts, circles } = stamp('string', '   ');

    expect(texts).toHaveLength(0);
    expect(circles).toHaveLength(0);
  });
});
