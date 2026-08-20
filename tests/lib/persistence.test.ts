/**
 * The whole cycle: mark, save, close, reopen, save again. `annotationObjects`
 * proves the mechanism; this proves the file the performer keeps is the one
 * they get back.
 */

import { PDFDocument, PDFDict, PDFName, StandardFonts } from 'pdf-lib';
import { createAnnotation } from '#/lib/pdf/annotations';
import { readAnnotationObjects } from '#/lib/pdf/annotationObjects';
import {
  buildEditedPdf,
  type PageEdit,
  readPdfFile,
} from '#/lib/pdf/document';
import { EDITOR_STATE_VERSION, type EditorState } from '#/lib/pdf/editorState';
import type { Region } from '#/lib/pdf/regions';

const MARKS = [
  createAnnotation(0, 100, 200, 'fingering', '1 3 2'),
  createAnnotation(0, 140, 210, 'string', '3'),
  createAnnotation(1, 220, 400, 'position', '7'),
  createAnnotation(1, 260, 410, 'note', 'sul tasto'),
];

const REGION: Region = {
  id: 'region-1',
  pageIndex: 0,
  rect: { left: 0, right: 612, bottom: 100, top: 240 },
  label: 'Guitar I',
  groupKey: '0:0',
};

const STATE: EditorState = {
  v: EDITOR_STATE_VERSION,
  regions: [REGION],
  keepMarkings: false,
  selectedOrdinals: [0, 2],
  partNames: [{ ordinal: 1, name: 'Guitar I' }],
};

async function score(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of ['one', 'two']) {
    doc.addPage([612, 792]).drawText(label, { x: 50, y: 50, size: 12, font });
  }
  return doc.save();
}

function layout(count: number): PageEdit[] {
  return Array.from({ length: count }, (_, sourceIndex) => ({
    id: `page-${sourceIndex}`,
    sourceIndex,
    rotation: 0,
  }));
}

function reopen(bytes: Uint8Array, name = 'score.pdf') {
  return readPdfFile(new File([bytes as BlobPart], name));
}

async function annotationCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc
    .getPages()
    .reduce((total, page) => total + (page.node.Annots()?.size() ?? 0), 0);
}

describe('saving marks as objects', () => {
  it('gives them all back on reopen', async () => {
    const saved = await buildEditedPdf(await score(), layout(2), MARKS, {
      marks: 'objects',
      state: STATE,
    });

    const reopened = await reopen(saved);

    expect(reopened.annotations).toEqual(MARKS);
    expect(reopened.state).toEqual(STATE);
    expect(reopened.pages).toHaveLength(2);
  });

  it('hands back bytes with the marks already lifted out', async () => {
    // These become the session's source. With the marks still in them the
    // viewer would paint them under the overlay's own copy, and detection would
    // read the performer's ink as engraving.
    const saved = await buildEditedPdf(await score(), layout(2), MARKS, {
      marks: 'objects',
      state: STATE,
    });

    const reopened = await reopen(saved);

    expect(await annotationCount(reopened.bytes)).toBe(0);
    expect(
      readAnnotationObjects(await PDFDocument.load(reopened.bytes)),
    ).toEqual([]);
  });

  it('does not double up however many times the file is saved over', async () => {
    // The compounding this guards against is silent: the marks would look
    // right, just a little bolder each time.
    let bytes = await score();

    for (let round = 0; round < 4; round += 1) {
      const opened = await reopen(bytes);
      bytes = await buildEditedPdf(
        opened.bytes,
        layout(2),
        opened.annotations.length ? opened.annotations : MARKS,
        { marks: 'objects', state: opened.state ?? STATE },
      );
    }

    expect(await annotationCount(bytes)).toBe(MARKS.length);
    expect(readAnnotationObjects(await PDFDocument.load(bytes))).toEqual(MARKS);
  });

  it('keeps the marks on the pages they were left on when pages are reordered', async () => {
    // What reopens is the arrangement that was saved, and a mark's page index
    // has to follow it there.
    const reversed: PageEdit[] = [
      { id: 'page-b', sourceIndex: 1, rotation: 0 },
      { id: 'page-a', sourceIndex: 0, rotation: 0 },
    ];

    const saved = await buildEditedPdf(await score(), reversed, MARKS, {
      marks: 'objects',
      state: STATE,
    });
    const reopened = await reopen(saved);

    // The marks that were on source page 1 now sit on page 0, and say so.
    expect(
      reopened.annotations.map((mark) => [mark.text, mark.pageIndex]),
    ).toEqual([
      ['VII', 0],
      ['sul tasto', 0],
      ['1 3 2', 1],
      ['3', 1],
    ]);
  });
});

describe('saving marks flattened', () => {
  it('leaves nothing to restore', async () => {
    // A part handed to a player is a print artifact: ink no viewer can decide
    // not to print, and nothing that can be edited back out.
    const saved = await buildEditedPdf(await score(), layout(2), MARKS, {
      marks: 'flattened',
      state: STATE,
    });

    const reopened = await reopen(saved);

    expect(await annotationCount(saved)).toBe(0);
    expect(reopened.annotations).toEqual([]);
    expect(reopened.state).toBeNull();
  });

  it('is what a caller that says nothing gets', async () => {
    const saved = await buildEditedPdf(await score(), layout(2), MARKS);

    expect(await annotationCount(saved)).toBe(0);
  });
});

describe('opening a file this app never touched', () => {
  it('reports no marks and no state', async () => {
    const reopened = await reopen(await score());

    expect(reopened.annotations).toEqual([]);
    expect(reopened.state).toBeNull();
  });

  it('hands back the file`s own bytes untouched', async () => {
    // Nothing was taken out, so nothing is rewritten.
    const bytes = await score();
    const reopened = await reopen(bytes);

    // Byte for byte: a re-serialization by pdf-lib would not come out identical.
    expect(reopened.bytes).toStrictEqual(bytes);
  });

  it('leaves an annotation that was already there alone', async () => {
    const doc = await PDFDocument.load(await score());
    doc
      .getPages()[0]
      .node.addAnnot(
        doc.context.register(
          doc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [0, 0, 10, 10],
          }),
        ),
      );
    const bytes = await doc.save();

    const reopened = await reopen(bytes);

    expect(reopened.annotations).toEqual([]);
    expect(await annotationCount(reopened.bytes)).toBe(1);
  });

  it('carries a foreign annotation through a save', async () => {
    // Saving is a rebuild from the source, so a link in the opened score has to
    // still be in the one the performer keeps.
    const doc = await PDFDocument.load(await score());
    doc
      .getPages()[0]
      .node.addAnnot(
        doc.context.register(
          doc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [0, 0, 10, 10],
          }),
        ),
      );

    const saved = await buildEditedPdf(await doc.save(), layout(2), MARKS, {
      marks: 'objects',
      state: STATE,
    });

    const reloaded = await PDFDocument.load(saved);
    const subtypes = reloaded
      .getPages()
      .flatMap((page) => page.node.Annots()?.asArray() ?? [])
      .map((entry) =>
        String(
          reloaded.context.lookupMaybe(entry, PDFDict)?.get(PDFName.of('Subtype')),
        ),
      );

    expect(subtypes.filter((subtype) => subtype === '/Link')).toHaveLength(1);
    expect(subtypes.filter((subtype) => subtype === '/Stamp')).toHaveLength(
      MARKS.length,
    );
  });
});
