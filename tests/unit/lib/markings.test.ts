import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFNumber,
  rgb,
  StandardFonts,
} from 'pdf-lib';
import {
  detectMarkings,
  type Marking,
  notationFonts,
  textMarkings,
} from '#/lib/pdf/markings/markings';
import { extractRegions } from '#/lib/pdf/partExtraction';
import {
  DEFAULT_LAYOUT,
  markingRows,
  markingStackHeight,
  type Region,
  regionsFromParts,
} from '#/lib/pdf/regions';
import type { PageStaves, PageTextItem, Staff } from '#/lib/pdf/staffDetection';

/**
 * Synthetic pages, built directly rather than drawn and re-read: what these
 * exercise is the reasoning about placement, which takes staves and text boxes
 * and nothing else.
 */
const STAFF_HEIGHT = 20;

function staff(top: number): Staff {
  return {
    top,
    bottom: top - STAFF_HEIGHT,
    left: 100,
    right: 500,
    lineSpacing: 5,
    lineCount: 5,
    contentTop: top,
    contentBottom: top - STAFF_HEIGHT,
  };
}

function page(pageIndex: number, tops: number[]): PageStaves {
  const staves = tops.map(staff);
  return {
    pageIndex,
    width: 612,
    height: 792,
    systems: [
      {
        staves,
        left: 100,
        right: 500,
        top: staves[0].top,
        bottom: staves[staves.length - 1].bottom,
      },
    ],
  };
}

function text(
  str: string,
  x: number,
  y: number,
  { size = 8, font = 'text' } = {},
): PageTextItem {
  return {
    str,
    fontName: font,
    rect: {
      left: x,
      right: x + str.length * size * 0.6,
      bottom: y,
      top: y + size,
    },
  };
}

/** Four pages of a two-staff score, numbered above the top staff. */
function numberedScore(numbers: number[], y: (top: number) => number) {
  const pages = numbers.map((_, index) => page(index, [700, 600]));
  const text_ = numbers.map((value, index) => [
    text(String(value), 96, y(pages[index].systems[0].staves[0].top)),
  ]);
  return { pages, text: text_ };
}

describe('textMarkings', () => {
  it('joins a marking split across items on one baseline', () => {
    const runs = textMarkings([
      text('Andante', 120, 720),
      text('=', 158, 720),
      text('96', 165, 720),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].str.replace(/\s+/g, ' ')).toBe('Andante = 96');
  });

  it('keeps markings a system apart from each other', () => {
    const runs = textMarkings([
      text('rit.', 120, 720),
      text('a tempo', 400, 720),
    ]);
    expect(runs.map((run) => run.str)).toEqual(['rit.', 'a tempo']);
  });

  it('takes the run’s font from the item that sets most of it', () => {
    // A metronome mark: the note is one glyph of the notation font, the rest is
    // text. Reading the first item's font would file the whole mark as notation.
    const runs = textMarkings([
      text('q', 120, 720, { font: 'notation' }),
      text('= 120', 127, 720),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].fontName).toBe('text');
  });
});

describe('notationFonts', () => {
  it('names the font whose glyphs sit on the staff', () => {
    const one = page(0, [700]);
    const notes = [696, 692, 688, 684].map((y, i) =>
      text('œ', 150 + i * 20, y, { font: 'notation' }),
    );
    const words = [720, 740].map((y) => text('Allegro', 120, y));

    const fonts = notationFonts([...notes, ...words], one.systems);
    expect([...fonts]).toEqual(['notation']);
  });
});

describe('detectMarkings', () => {
  it('reads a numbering that climbs through the document', () => {
    const { pages, text: items } = numberedScore(
      [1, 9, 17, 25],
      (top) => top + 5,
    );
    const found = detectMarkings(pages, items);

    expect(found.flat().map((mark) => mark.text)).toEqual([
      '1',
      '9',
      '17',
      '25',
    ]);
    expect(found.flat().every((mark) => mark.kind === 'measure')).toBe(true);
  });

  it('reads a numbering printed below the bottom staff', () => {
    const pages = [0, 1, 2, 3].map((index) => page(index, [700, 600]));
    const items = [4, 12, 20, 28].map((value) => [
      text(String(value), 96, 600 - STAFF_HEIGHT - 12),
    ]);

    expect(
      detectMarkings(pages, items)
        .flat()
        .map((m) => m.text),
    ).toEqual(['4', '12', '20', '28']);
  });

  it('leaves page numbers alone', () => {
    const pages = [0, 1, 2, 3].map((index) => page(index, [700, 600]));
    // Numbering at one height, page numbers a line further out — both bare
    // numbers climbing through the document, and only one of them a numbering.
    const items = pages.map((_page, index) => [
      text(String(index * 8 + 1), 96, 705),
      text(String(index + 1), 480, 730),
    ]);

    const found = detectMarkings(pages, items).flat();
    expect(found.map((mark) => mark.text)).toEqual(['1', '9', '17', '25']);
  });

  it('leaves tuplet digits alone', () => {
    const pages = [0, 1, 2, 3].map((index) => page(index, [700, 600]));
    const items = pages.map((_page, index) => [
      text(String(index * 8 + 1), 96, 712),
      // Tight against the staff and much smaller, as a tuplet is engraved.
      text('3', 200, 701, { size: 3 }),
      text('3', 300, 701, { size: 3 }),
    ]);

    expect(
      detectMarkings(pages, items)
        .flat()
        .map((m) => m.text),
    ).toEqual(['1', '9', '17', '25']);
  });

  it('keeps a tempo mark above the system, not an instruction inside it', () => {
    const pages = [page(0, [700, 600])];
    const items = [
      [
        text('Andante = 96', 120, 715),
        // Above the second staff: that player's own instruction, and already
        // inside the band cut for them.
        text('pizz.', 120, 615),
      ],
    ];

    const found = detectMarkings(pages, items).flat();
    expect(found.map((mark) => mark.text)).toEqual(['Andante = 96']);
    expect(found[0].kind).toBe('tempo');
  });

  it('reads boxed text above the system as a rehearsal mark, not a tempo', () => {
    const pages = [page(0, [700, 600])];
    // "B" is 4.8 wide and 8 tall; its box is stroked with a little room around it.
    const box = { left: 298, right: 307, bottom: 713, top: 724 };
    pages[0].ink = [box];
    pages[0].frames = [box];
    const items = [[text('Andante = 96', 120, 715), text('B', 300, 715)]];

    const found = detectMarkings(pages, items).flat();
    expect(found.map((mark) => [mark.text, mark.kind])).toEqual([
      ['Andante = 96', 'tempo'],
      ['B', 'rehearsal'],
    ]);
  });

  it('reads only a metronome mark as a tempo, and other words as directions', () => {
    const pages = [page(0, [700, 600])];
    // Three runs, not four: a system any busier is read as a line of lyrics.
    const items = [
      [
        text('q = 60-72', 110, 715),
        text('flutter tongue', 200, 715),
        text('accel. ad lib.', 340, 715),
      ],
    ];

    const found = detectMarkings(pages, items).flat();
    expect(found.map((mark) => [mark.text, mark.kind])).toEqual([
      ['q = 60-72', 'tempo'],
      ['flutter tongue', 'direction'],
      ['accel. ad lib.', 'direction'],
    ]);
  });

  it('does not read a filled shape behind text as a rehearsal box', () => {
    const pages = [page(0, [700, 600])];
    // Same outline as a rehearsal box, but painted rather than stroked.
    pages[0].ink = [{ left: 298, right: 307, bottom: 713, top: 724 }];
    const items = [[text('B', 300, 715)]];

    expect(detectMarkings(pages, items).flat()[0].kind).toBe('direction');
  });

  it('does not read a stroke far larger than the text as its box', () => {
    const pages = [page(0, [700, 600])];
    // A slur arching over the words: it spans them, but is no snug frame.
    pages[0].frames = [{ left: 100, right: 300, bottom: 712, top: 740 }];
    const items = [[text('rit.', 150, 715)]];

    expect(detectMarkings(pages, items).flat()[0].kind).toBe('direction');
  });

  it('leaves the notation font’s own glyphs alone', () => {
    const pages = [page(0, [700, 600])];
    const notes = [696, 692, 688].map((y, i) =>
      text('œ', 150 + i * 20, y, { font: 'notation' }),
    );
    const items = [
      [
        ...notes,
        // A high note on ledger lines, printed above the staff in the same font.
        text('œ', 220, 715, { font: 'notation' }),
      ],
    ];

    expect(detectMarkings(pages, items).flat()).toEqual([]);
  });

  it('takes in the box drawn around a measure number', () => {
    const { pages, text: items } = numberedScore(
      [1, 9, 17, 25],
      (top) => top + 6,
    );
    // The enclosure engravers draw around a boxed number.
    for (const held of pages) {
      held.ink = [{ left: 92, right: 116, bottom: 702, top: 720 }];
    }

    const [first] = detectMarkings(pages, items).flat();
    expect(first.rect.left).toBeLessThanOrEqual(92);
    expect(first.rect.top).toBeGreaterThanOrEqual(720);
  });

  it('rejects a group of small repeating values (fingerings)', () => {
    // Simulate guitar fingering digits 1-6 scattered across 20 pages at the
    // same placement as measure numbers. The values repeat heavily and never
    // climb beyond 6, so they should not be read as a measure numbering.
    const pages = Array.from({ length: 20 }, (_, i) => page(i, [700, 600]));
    const fingeringValues = [1, 3, 2, 4, 6, 5, 2, 3, 1, 4];
    const items = pages.map(() =>
      fingeringValues.map((v, j) => text(String(v), 96 + j * 40, 712)),
    );

    const found = detectMarkings(pages, items).flat();
    expect(found.filter((m) => m.kind === 'measure')).toHaveLength(0);
  });

  it('keeps real measures when fingerings are in a separate group', () => {
    const pages = Array.from({ length: 4 }, (_, i) => page(i, [700, 600]));
    const items = pages.map((_, index) => [
      // Measure numbers: above the staff, consistent size.
      text(String(index * 8 + 1), 96, 712),
      // Fingerings: closer to the staff, smaller size — a separate group.
      text('3', 200, 701, { size: 3 }),
      text('2', 300, 701, { size: 3 }),
    ]);

    const measures = detectMarkings(pages, items)
      .flat()
      .filter((m) => m.kind === 'measure');
    expect(measures.map((m) => m.text)).toEqual(['1', '9', '17', '25']);
  });

  it('filters lyrics from tempo candidates on dense systems', () => {
    const pages = [page(0, [700, 600])];
    const items = [
      [
        text('Allegro = 96', 120, 715),
        // Lyric syllables scattered above staff 0 — same system, far enough
        // apart not to merge with the tempo mark.
        text('so', 250, 715),
        text('li', 290, 715),
        text('dão', 330, 715),
        text('u', 380, 715),
      ],
    ];

    const found = detectMarkings(pages, items).flat();
    const tempos = found.filter((m) => m.kind === 'tempo');
    expect(tempos).toHaveLength(1);
    expect(tempos[0].text).toBe('Allegro = 96');
  });

  it('filters syllable-hyphenated lyrics regardless of density', () => {
    const pages = [page(0, [700, 600])];
    const items = [[text('Allegro', 120, 715), text('es- tá', 250, 715)]];

    const found = detectMarkings(pages, items).flat();
    expect(found.map((m) => m.text)).toEqual(['Allegro']);
  });
});

describe('markings on regions', () => {
  /** Three staves, the top one's content grown to take in the tempo mark. */
  const source = () => {
    const held = page(0, [700, 600, 500]);
    held.systems[0].staves[0].contentTop = 730;
    return held;
  };

  const markings: Marking[] = [
    {
      id: 'm-1',
      kind: 'tempo',
      text: 'Andante = 96',
      pageIndex: 0,
      systemIndex: 0,
      rect: { left: 120, right: 200, bottom: 714, top: 726 },
    },
  ];

  it('carries a system’s markings into the bands cut below it', () => {
    const [top, bottom] = regionsFromParts([{ ...source(), markings }], [0, 2]);

    // The top band already contains the mark; the lower one has to be given it.
    expect(top.markings).toEqual([]);
    expect(bottom.markings?.map((mark) => mark.text)).toEqual(['Andante = 96']);
  });

  it('makes room above a band for what is stamped on it', () => {
    const [, bottom] = regionsFromParts([{ ...source(), markings }], [0, 2]);

    expect(markingStackHeight(bottom)).toBeGreaterThan(12);
    expect(
      markingStackHeight(bottom, { ...DEFAULT_LAYOUT, keepMarkings: false }),
    ).toBe(0);
  });

  it('stacks markings engraved on different lines, and shares a line', () => {
    const region: Region = {
      id: 'r',
      pageIndex: 0,
      groupKey: 'g',
      label: 'Band',
      rect: { left: 0, right: 612, bottom: 560, top: 620 },
      markings: [
        { ...markings[0], id: 'a' },
        // Same line as the first.
        {
          ...markings[0],
          id: 'b',
          rect: { left: 300, right: 340, bottom: 715, top: 725 },
        },
        // A line above both.
        {
          ...markings[0],
          id: 'c',
          rect: { left: 120, right: 260, bottom: 740, top: 754 },
        },
      ],
    };

    const rows = markingRows(region);
    expect(rows).toHaveLength(2);
    expect(rows[0].markings.map((mark) => mark.id)).toEqual(['a', 'b']);
    expect(rows[1].markings.map((mark) => mark.id)).toEqual(['c']);
  });
});

/**
 * The distinct clips `embedPage` cut out of the source, by height.
 *
 * Counted by object rather than by resource entry: drawing one embedded page
 * twice names it twice in the page's resources, and the whole point of the
 * dedupe is that it is the same object underneath.
 */
function liftedClips(doc: PDFDocument): number[] {
  const seen = new Map<string, number>();

  for (const held of doc.getPages()) {
    const xobjects = held.node
      .Resources()
      ?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xobjects) continue;

    for (const key of xobjects.keys()) {
      const ref = String(xobjects.get(key));
      const entry = xobjects.lookup(key);
      const form =
        entry instanceof PDFDict
          ? entry
          : ((entry as { dict?: PDFDict })?.dict ?? null);
      const bbox = form?.lookupMaybe(PDFName.of('BBox'), PDFArray);
      if (!bbox) continue;
      const at = (i: number) => (bbox.lookup(i) as PDFNumber).asNumber();
      seen.set(ref, at(3) - at(1));
    }
  }

  return [...seen.values()];
}

describe('time-signature detection', () => {
  function twoStaffPage(pageIndex = 0): PageStaves {
    return page(pageIndex, [700, 600]);
  }

  function notationDigit(
    str: string,
    x: number,
    y: number,
    height = 12.8,
  ): PageTextItem {
    return {
      str,
      fontName: 'notation',
      rect: { left: x, right: x + 5.1, bottom: y, top: y + height },
    };
  }

  function notationNote(x: number, y: number): PageTextItem {
    return {
      str: 'œ',
      fontName: 'notation',
      rect: { left: x, right: x + 6, bottom: y, top: y + 10 },
    };
  }

  // Notation font needs ≥4 items with ≥50% on-staff to register.
  function notationFontItems(): PageTextItem[] {
    return [
      notationNote(150, 688),
      notationNote(170, 692),
      notationNote(190, 696),
      notationNote(210, 684),
    ];
  }

  it('detects a stacked time signature on the top staff', () => {
    const pages = [twoStaffPage()];
    const topStaff = pages[0].systems[0].staves[0];
    const midY = topStaff.bottom + (topStaff.top - topStaff.bottom) / 2;
    const items = [
      [
        ...notationFontItems(),
        notationDigit('5', 111.3, midY + 2),
        notationDigit('4', 111.5, midY - 12),
      ],
    ];

    const found = detectMarkings(pages, items).flat();
    const timeSigs = found.filter((m) => m.kind === 'time-signature');
    expect(timeSigs).toHaveLength(1);
    expect(timeSigs[0].text).toBe('5/4');
  });

  it('does not detect a stacked pair on an inner staff', () => {
    const pages = [twoStaffPage()];
    const innerStaff = pages[0].systems[0].staves[1];
    const midY = innerStaff.bottom + (innerStaff.top - innerStaff.bottom) / 2;
    const items = [
      [
        ...notationFontItems(),
        notationDigit('3', 111.3, midY + 2),
        notationDigit('4', 111.5, midY - 12),
      ],
    ];

    const found = detectMarkings(pages, items).flat();
    expect(found.filter((m) => m.kind === 'time-signature')).toHaveLength(0);
  });

  it('rejects three items at one x-position', () => {
    const pages = [twoStaffPage()];
    const topStaff = pages[0].systems[0].staves[0];
    const midY = topStaff.bottom + (topStaff.top - topStaff.bottom) / 2;
    const items = [
      [
        ...notationFontItems(),
        notationDigit('5', 111.3, midY + 6),
        notationDigit('4', 111.5, midY - 2),
        notationDigit('8', 111.4, midY - 10),
      ],
    ];

    const found = detectMarkings(pages, items).flat();
    expect(found.filter((m) => m.kind === 'time-signature')).toHaveLength(0);
  });

  it('does not classify non-digit notation text as a time signature', () => {
    const pages = [twoStaffPage()];
    const items = [
      [
        ...notationFontItems(),
        {
          str: 'mf',
          fontName: 'notation',
          rect: { left: 120, right: 140, bottom: 715, top: 725 },
        },
      ],
    ];

    const found = detectMarkings(pages, items).flat();
    expect(found.filter((m) => m.kind === 'time-signature')).toHaveLength(0);
  });

  it('does not interfere with measure numbers', () => {
    const pages = [twoStaffPage()];
    const topStaff = pages[0].systems[0].staves[0];
    const midY = topStaff.bottom + (topStaff.top - topStaff.bottom) / 2;
    const items = [
      [
        ...notationFontItems(),
        notationDigit('4', 111.3, midY + 2),
        notationDigit('4', 111.5, midY - 12),
        text('1', 96, topStaff.top + 5),
      ],
    ];

    const found = detectMarkings(pages, items).flat();
    expect(found.filter((m) => m.kind === 'time-signature')).toHaveLength(1);
    expect(found.filter((m) => m.kind === 'measure')).toHaveLength(0);
  });

  it('detects SMuFL-encoded time-signature digits', () => {
    const pages = [twoStaffPage()];
    const topStaff = pages[0].systems[0].staves[0];
    const midY = topStaff.bottom + (topStaff.top - topStaff.bottom) / 2;
    // U+E084 = SMuFL time-signature digit 4
    const smufl4 = String.fromCodePoint(0xe084);
    const items = [
      [
        ...notationFontItems(),
        notationDigit(smufl4, 111.3, midY + 2),
        notationDigit(smufl4, 111.5, midY - 12),
      ],
    ];

    const found = detectMarkings(pages, items).flat();
    const timeSigs = found.filter((m) => m.kind === 'time-signature');
    expect(timeSigs).toHaveLength(1);
    expect(timeSigs[0].text).toBe('4/4');
  });

  it('detects mixed SMuFL numerator and denominator', () => {
    const pages = [twoStaffPage()];
    const topStaff = pages[0].systems[0].staves[0];
    const midY = topStaff.bottom + (topStaff.top - topStaff.bottom) / 2;
    // U+E083 = 3, U+E088 = 8
    const smufl3 = String.fromCodePoint(0xe083);
    const smufl8 = String.fromCodePoint(0xe088);
    const items = [
      [
        ...notationFontItems(),
        notationDigit(smufl3, 111.3, midY + 2),
        notationDigit(smufl8, 111.5, midY - 12),
      ],
    ];

    const found = detectMarkings(pages, items).flat();
    const timeSigs = found.filter((m) => m.kind === 'time-signature');
    expect(timeSigs).toHaveLength(1);
    expect(timeSigs[0].text).toBe('3/8');
  });

  it('ignores a lone notation digit with no pair', () => {
    const pages = [twoStaffPage()];
    const topStaff = pages[0].systems[0].staves[0];
    const midY = topStaff.bottom + (topStaff.top - topStaff.bottom) / 2;
    const items = [[...notationFontItems(), notationDigit('3', 111.3, midY)]];

    const found = detectMarkings(pages, items).flat();
    expect(found.filter((m) => m.kind === 'time-signature')).toHaveLength(0);
  });
});

describe('extraction with markings', () => {
  async function source(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const held = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    held.drawText('Andante = 96', { x: 120, y: 714, size: 10, font });
    held.drawRectangle({
      x: 100,
      y: 560,
      width: 400,
      height: 40,
      color: rgb(0.9, 0.9, 0.9),
    });
    return doc.save();
  }

  const region: Region = {
    id: 'band',
    pageIndex: 0,
    groupKey: 'g',
    label: 'Band',
    rect: { left: 0, right: 612, bottom: 550, top: 610 },
    markings: [
      {
        id: 'm-1',
        kind: 'tempo',
        text: 'Andante = 96',
        pageIndex: 0,
        systemIndex: 0,
        rect: { left: 118, right: 200, bottom: 712, top: 728 },
      },
    ],
  };

  it('lifts the marking alongside the band', async () => {
    const out = await PDFDocument.load(
      await extractRegions(await source(), [region], {
        width: 612,
        height: 792,
      }),
    );
    // Two clips: the band, and the marking stamped above it.
    expect(liftedClips(out)).toHaveLength(2);
  });

  it('lifts the band alone when markings are turned off', async () => {
    const out = await PDFDocument.load(
      await extractRegions(
        await source(),
        [region],
        { width: 612, height: 792 },
        { layout: { ...DEFAULT_LAYOUT, keepMarkings: false } },
      ),
    );
    expect(liftedClips(out)).toHaveLength(1);
  });

  it('lifts one copy of a marking shared by several bands', async () => {
    const bands = [0, 1, 2].map((index) => ({
      ...region,
      id: `band-${index}`,
      rect: { ...region.rect, bottom: 400 + index * 60, top: 450 + index * 60 },
    }));

    const out = await PDFDocument.load(
      await extractRegions(await source(), bands, { width: 612, height: 792 }),
    );
    // Three bands, one shared marking: four clips, not six.
    expect(liftedClips(out)).toHaveLength(4);
  });
});
