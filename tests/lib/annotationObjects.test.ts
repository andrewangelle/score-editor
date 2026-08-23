import {
  PDFArray,
  PDFDict,
  PDFDocument,
  type PDFFont,
  PDFName,
  type PDFPage,
  PDFStream,
  PDFString,
  StandardFonts,
} from 'pdf-lib';
import {
  type AnnotationKind,
  createAnnotation,
  DEFAULT_COLOR,
  type ScoreAnnotation,
} from '#/lib/pdf/annotations';
import {
  appearanceCache,
  readAnnotationObjects,
  stripAnnotationObjects,
  writeAnnotationObjects,
} from '#/lib/pdf/annotationObjects';
import { stampAnnotation } from '#/lib/pdf/annotationStamp';
import { recorder } from '#tests/lib/stampRecorder';

const SUBTYPE = PDFName.of('Subtype');
const AP = PDFName.of('AP');
const N = PDFName.of('N');
const BBOX = PDFName.of('BBox');

async function blank(): Promise<{
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
}> {
  const doc = await PDFDocument.create();
  return {
    doc,
    page: doc.addPage([612, 792]),
    font: await doc.embedFont(StandardFonts.Helvetica),
  };
}

async function roundTrip(annotations: readonly ScoreAnnotation[]) {
  const { doc, page, font } = await blank();
  writeAnnotationObjects(doc, page, annotations, font);

  const reopened = await PDFDocument.load(await doc.save());
  return { reopened, restored: readAnnotationObjects(reopened) };
}

function annots(doc: PDFDocument, pageIndex = 0): PDFDict[] {
  const page = doc.getPages()[pageIndex];
  const array = page.node.Annots();
  if (!array) return [];

  return array
    .asArray()
    .map((entry) => doc.context.lookupMaybe(entry, PDFDict))
    .filter((dict): dict is PDFDict => dict !== undefined);
}

function appearanceRefs(doc: PDFDocument, pageIndex = 0): Set<string> {
  return new Set(
    annots(doc, pageIndex).map((dict) =>
      String(doc.context.lookupMaybe(dict.get(AP), PDFDict)?.get(N)),
    ),
  );
}

function at(kind: AnnotationKind, text: string, x = 100, y = 200) {
  return createAnnotation(0, x, y, kind, text);
}

const HELVETICA = await (async () => {
  const doc = await PDFDocument.create();
  return doc.embedFont(StandardFonts.Helvetica);
})();

describe('round trip', () => {
  it('restores every kind of mark as the mark it was', async () => {
    const written = [
      at('fingering', '1 3 2 4', 100, 200),
      at('string', '12', 140, 210),
      // Normalized on the way in, so what must come back is 'VII', not '7'.
      at('position', '7', 180, 220),
      at('note', 'sul tasto', 220, 230),
    ];

    const { restored } = await roundTrip(written);

    expect(restored).toEqual(written);
  });

  it('restores each mark in the ink it was placed in', async () => {
    const written = [
      { ...at('fingering', '1', 100, 200), color: 'red' as const },
      { ...at('string', '3', 140, 210), color: 'green' as const },
      { ...at('note', 'sul tasto', 180, 220), color: 'purple' as const },
    ];

    const { restored } = await roundTrip(written);

    expect(restored.map((mark) => mark.color)).toEqual([
      'red',
      'green',
      'purple',
    ]);
  });

  it('reads a mark back onto the page it was written on', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = [doc.addPage([612, 792]), doc.addPage([612, 792])];

    // The page a mark lands on is the one it is written to, not the one its
    // own `pageIndex` names — which is what a reordered save relies on.
    writeAnnotationObjects(doc, pages[1], [at('fingering', '2')], font);

    const restored = readAnnotationObjects(
      await PDFDocument.load(await doc.save()),
    );
    expect(restored).toHaveLength(1);
    expect(restored[0].pageIndex).toBe(1);
  });

  it('writes nothing for a mark with no text', async () => {
    // A blank mark draws nothing flattened, and must not become an empty
    // annotation either.
    const { reopened, restored } = await roundTrip([at('note', '   ')]);

    expect(restored).toEqual([]);
    expect(annots(reopened)).toHaveLength(0);
  });

  it('survives being copied into another document', async () => {
    // `buildEditedPdf` rebuilds every save with `copyPages`.
    const { doc, page, font } = await blank();
    const written = [at('string', '3'), at('note', 'ponticello', 300, 400)];
    writeAnnotationObjects(doc, page, written, font);

    const output = await PDFDocument.create();
    const [copied] = await output.copyPages(
      await PDFDocument.load(await doc.save()),
      [0],
    );
    output.addPage(copied);

    const restored = readAnnotationObjects(
      await PDFDocument.load(await output.save()),
    );
    expect(restored).toEqual(written);
  });
});

describe('the page underneath', () => {
  it('leaves the page content alone', async () => {
    // The whole reason for annotation objects: the page is untouched, so taking
    // the marks off recovers the original exactly.
    const { doc, page, font } = await blank();
    writeAnnotationObjects(doc, page, [at('string', '3')], font);

    expect(page.node.get(PDFName.of('Contents'))).toBeUndefined();
  });

  it('strips its own marks and no others', async () => {
    const { doc, page, font } = await blank();
    // Deleting somebody else's annotation would corrupt their document.
    const link = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [0, 0, 10, 10],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com') },
    });
    page.node.addAnnot(doc.context.register(link));
    writeAnnotationObjects(doc, page, [at('string', '3'), at('note', 'x')], font);

    const reopened = await PDFDocument.load(await doc.save());
    expect(annots(reopened)).toHaveLength(3);

    expect(stripAnnotationObjects(reopened)).toBe(true);

    const survivors = annots(reopened);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].get(SUBTYPE)).toBe(PDFName.of('Link'));
    expect(readAnnotationObjects(reopened)).toEqual([]);
  });

  it('reports that a document with none of our marks was left alone', async () => {
    // The caller uses this to skip re-serializing a 100 MB score for nothing.
    const { doc, page } = await blank();
    page.node.addAnnot(
      doc.context.register(
        doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 1, 1] }),
      ),
    );

    expect(stripAnnotationObjects(doc)).toBe(false);
  });

  it('takes the appearance streams with it', async () => {
    // Left behind they would accumulate over every open-and-save cycle.
    const { doc, page, font } = await blank();
    writeAnnotationObjects(doc, page, [at('string', '3')], font);

    const reopened = await PDFDocument.load(await doc.save());
    const [appearance] = appearanceRefs(reopened);
    stripAnnotationObjects(reopened);

    const remaining = new Set(
      reopened.context
        .enumerateIndirectObjects()
        .map(([ref]) => String(ref)),
    );
    expect(remaining.has(appearance)).toBe(false);
  });
});

describe('appearance streams', () => {
  it('draws one form for marks that look the same', async () => {
    // A guitar score carries hundreds of identical fingerings.
    const same = Array.from({ length: 20 }, (_, index) =>
      at('fingering', '3', 100 + index * 10, 200),
    );

    const { reopened } = await roundTrip(same);

    expect(annots(reopened)).toHaveLength(20);
    expect(appearanceRefs(reopened).size).toBe(1);
  });

  it('draws a separate form for every distinct mark', async () => {
    const { reopened } = await roundTrip([
      at('fingering', '3'),
      at('string', '3'),
      at('fingering', '4'),
      { ...at('fingering', '3'), size: 12 },
    ]);

    expect(appearanceRefs(reopened).size).toBe(4);
  });

  it('draws a separate form for the same mark in another ink', async () => {
    // The colour is drawn into the stream, so sharing one form between two
    // inks would silently repaint one of them.
    const { reopened } = await roundTrip([
      at('fingering', '3'),
      { ...at('fingering', '3', 120, 200), color: 'red' },
    ]);

    expect(appearanceRefs(reopened).size).toBe(2);
  });

  it('still shares one form between marks of the same ink', async () => {
    const { reopened } = await roundTrip([
      { ...at('fingering', '3', 100, 200), color: 'green' },
      { ...at('fingering', '3', 120, 200), color: 'green' },
    ]);

    expect(appearanceRefs(reopened).size).toBe(1);
  });

  it('shares one form across pages', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = [doc.addPage([612, 792]), doc.addPage([612, 792])];
    const cache = appearanceCache();

    for (const page of pages) {
      writeAnnotationObjects(doc, page, [at('fingering', '3')], font, cache);
    }

    const reopened = await PDFDocument.load(await doc.save());
    const refs = new Set([
      ...appearanceRefs(reopened),
      ...appearanceRefs(reopened, 1),
    ]);
    expect(refs.size).toBe(1);
  });
});

describe('geometry agreement', () => {
  /** The box a built appearance claims, read back off the file. */
  async function box(annotation: ScoreAnnotation) {
    const { reopened } = await roundTrip([annotation]);
    const dict = annots(reopened)[0];
    // The appearance is a content stream; its box is on the stream's own dict.
    const form = reopened.context.lookup(
      reopened.context.lookupMaybe(dict.get(AP), PDFDict)?.get(N),
      PDFStream,
    );
    const bbox = reopened.context.lookup(form.dict.get(BBOX), PDFArray);
    const [left, bottom, right, top] = bbox
      .asArray()
      .map((value) => Number(String(value)));

    // Box and rect agreeing in size is what makes a viewer's appearance
    // transform a pure translation, so the mark lands where flattening put it.
    const rect = reopened.context
      .lookup(dict.get(PDFName.of('Rect')), PDFArray)
      .asArray()
      .map((value) => Number(String(value)));

    expect(rect[0]).toBeCloseTo(annotation.x + left);
    expect(rect[1]).toBeCloseTo(annotation.y + bottom);
    expect(rect[2] - rect[0]).toBeCloseTo(right - left);
    expect(rect[3] - rect[1]).toBeCloseTo(top - bottom);

    return { left, bottom, right, top };
  }

  function drawn(annotation: ScoreAnnotation) {
    const recording = recorder();
    stampAnnotation(
      recording.page,
      annotation,
      { x: 0, y: 0, size: annotation.size },
      HELVETICA,
    );
    return recording;
  }

  it.each<AnnotationKind>(['fingering', 'string', 'position', 'note'])(
    'covers everything a %s asks to have drawn',
    async (kind) => {
      const annotation = at(kind, kind === 'position' ? '7' : '12');
      const { texts, circles } = drawn(annotation);
      const bounds = await box(annotation);

      // The drift guard: a sink that dropped a call would produce a box that
      // does not reach it.
      for (const text of texts) {
        expect(bounds.left).toBeLessThanOrEqual(text.x);
        expect(bounds.right).toBeGreaterThanOrEqual(
          text.x + HELVETICA.widthOfTextAtSize(text.text, text.size),
        );
        expect(bounds.bottom).toBeLessThan(text.y);
        expect(bounds.top).toBeGreaterThan(text.y);
      }

      for (const circle of circles) {
        expect(bounds.left).toBeLessThanOrEqual(circle.x - circle.size);
        expect(bounds.right).toBeGreaterThanOrEqual(circle.x + circle.size);
        expect(bounds.bottom).toBeLessThanOrEqual(circle.y - circle.size);
        expect(bounds.top).toBeGreaterThanOrEqual(circle.y + circle.size);
      }
    },
  );

  it('gives a ringed mark room the bare one does not need', async () => {
    // If the circle were dropped, a string number would claim exactly the box
    // its digits do.
    const bare = await box(at('fingering', '12'));
    const ringed = await box(at('string', '12'));

    expect(ringed.left).toBeLessThan(bare.left);
    expect(ringed.right).toBeGreaterThan(bare.right);
    expect(ringed.bottom).toBeLessThan(bare.bottom);
  });
});

describe('reading a document that is not ours', () => {
  it('claims nothing from a foreign annotation', async () => {
    const { doc, page } = await blank();
    page.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: 'Annot',
          Subtype: 'Text',
          Rect: [0, 0, 20, 20],
          Contents: PDFString.of('a reviewer said something'),
        }),
      ),
    );

    expect(
      readAnnotationObjects(await PDFDocument.load(await doc.save())),
    ).toEqual([]);
  });

  it('drops one of ours that has been damaged rather than half-restoring it', async () => {
    const { doc, page, font } = await blank();
    writeAnnotationObjects(doc, page, [at('fingering', '3')], font);
    annots(doc)[0].delete(PDFName.of('PdfEditorY'));

    expect(
      readAnnotationObjects(await PDFDocument.load(await doc.save())),
    ).toEqual([]);
  });

  it('drops a kind this version does not know', async () => {
    const { doc, page, font } = await blank();
    writeAnnotationObjects(doc, page, [at('fingering', '3')], font);
    annots(doc)[0].set(PDFName.of('PdfEditorKind'), PDFName.of('bowing'));

    expect(
      readAnnotationObjects(await PDFDocument.load(await doc.save())),
    ).toEqual([]);
  });

  it('opens a mark written before this app had colours', async () => {
    const { doc, page, font } = await blank();
    writeAnnotationObjects(doc, page, [at('fingering', '3')], font);
    annots(doc)[0].delete(PDFName.of('PdfEditorColor'));

    const restored = readAnnotationObjects(
      await PDFDocument.load(await doc.save()),
    );
    expect(restored).toHaveLength(1);
    expect(restored[0].color).toBe(DEFAULT_COLOR);
  });

  it('keeps a mark whose colour this version does not know', async () => {
    // Unlike an unknown kind, which changes what the mark *means*, an unknown
    // ink only changes how it looks — so it opens in the default.
    const { doc, page, font } = await blank();
    writeAnnotationObjects(doc, page, [at('fingering', '3')], font);
    annots(doc)[0].set(PDFName.of('PdfEditorColor'), PDFName.of('chartreuse'));

    const restored = readAnnotationObjects(
      await PDFDocument.load(await doc.save()),
    );
    expect(restored).toHaveLength(1);
    expect(restored[0].color).toBe(DEFAULT_COLOR);
  });
});
