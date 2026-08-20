import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import {
  EDITOR_STATE_FILE,
  EDITOR_STATE_VERSION,
  type EditorState,
  readEditorState,
  writeEditorState,
} from '#/lib/pdf/editorState';
import type { Region } from '#/lib/pdf/regions';

const REGION: Region = {
  id: 'region-1',
  pageIndex: 2,
  rect: { left: 0, right: 612, bottom: 100, top: 240 },
  label: 'Guitar I',
  groupKey: '2:0',
};

const STATE: EditorState = {
  v: EDITOR_STATE_VERSION,
  regions: [REGION],
  keepMarkings: false,
  selectedOrdinals: [1, 3],
  partNames: [{ ordinal: 1, name: 'Guitar I' }],
};

/** pdf-lib only builds the name tree at save time, so a round trip is required. */
async function attach(state: EditorState): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await writeEditorState(doc, state);
  return PDFDocument.load(await doc.save());
}

/** Attaches arbitrary bytes under the state file's name. */
async function attachRaw(contents: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await doc.attach(new TextEncoder().encode(contents), EDITOR_STATE_FILE, {
    mimeType: 'application/json',
  });
  return PDFDocument.load(await doc.save());
}

describe('round trip', () => {
  it('gives back what was written', async () => {
    expect(readEditorState(await attach(STATE))).toEqual(STATE);
  });

  it('keeps a null region list null', async () => {
    // Null is detection still being in charge — not the user having deleted
    // every rectangle.
    const state = { ...STATE, regions: null };

    expect(readEditorState(await attach(state))?.regions).toBeNull();
  });

  it('keeps an empty region list empty', async () => {
    const state = { ...STATE, regions: [] };

    expect(readEditorState(await attach(state))?.regions).toEqual([]);
  });

  it('survives a save it was not written into', async () => {
    // Every build starts from a fresh document, so it cannot ride along.
    const carried = await attach(STATE);
    const copy = await PDFDocument.create();
    const [page] = await copy.copyPages(carried, [0]);
    copy.addPage(page);

    expect(readEditorState(await PDFDocument.load(await copy.save()))).toBeNull();
  });
});

describe('nothing to read', () => {
  it('returns null for a document with no attachments at all', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);

    expect(readEditorState(doc)).toBeNull();
  });

  it('returns null for a document carrying somebody else`s attachment', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    await doc.attach(new Uint8Array([1, 2, 3]), 'parts.zip');

    expect(readEditorState(await PDFDocument.load(await doc.save()))).toBeNull();
  });
});

describe('a blob that cannot be trusted', () => {
  it('refuses a version it does not know', async () => {
    // Guessing at a format from the future is how state gets silently mangled.
    expect(readEditorState(await attachRaw('{"v":99,"keepMarkings":true}'))).toBeNull();
  });

  it('refuses state with no version at all', async () => {
    expect(readEditorState(await attachRaw('{"keepMarkings":true}'))).toBeNull();
  });

  it('does not throw on bytes that are not JSON', async () => {
    expect(readEditorState(await attachRaw('not json at all'))).toBeNull();
  });

  it('does not throw on truncated JSON', async () => {
    expect(readEditorState(await attachRaw('{"v":1,"regions":['))).toBeNull();
  });

  it('does not throw on JSON that is not an object', async () => {
    expect(readEditorState(await attachRaw('[1,2,3]'))).toBeNull();
    expect(readEditorState(await attachRaw('null'))).toBeNull();
    expect(readEditorState(await attachRaw('"v"'))).toBeNull();
  });

  it('does not throw on a name tree with nothing under the name', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.catalog.set(
      PDFName.of('Names'),
      doc.context.obj({
        EmbeddedFiles: {
          Names: [PDFHexString.fromText(EDITOR_STATE_FILE), 42],
        },
      }),
    );

    expect(readEditorState(doc)).toBeNull();
  });
});

describe('fields that arrive wrong', () => {
  it('drops regions that are not regions, keeping the ones that are', async () => {
    const blob = JSON.stringify({
      ...STATE,
      regions: [REGION, { id: 'no-rect' }, null, 7],
    });

    expect(readEditorState(await attachRaw(blob))?.regions).toEqual([REGION]);
  });

  it('drops ordinals that are not whole numbers', async () => {
    const blob = JSON.stringify({
      ...STATE,
      selectedOrdinals: [0, '1', 2.5, null, 3],
    });

    expect(readEditorState(await attachRaw(blob))?.selectedOrdinals).toEqual([
      0, 3,
    ]);
  });

  it('drops renames missing an ordinal or a name', async () => {
    const blob = JSON.stringify({
      ...STATE,
      partNames: [{ ordinal: 1, name: 'Guitar I' }, { ordinal: 2 }, 'Cello'],
    });

    expect(readEditorState(await attachRaw(blob))?.partNames).toEqual([
      { ordinal: 1, name: 'Guitar I' },
    ]);
  });

  it('falls back to the defaults for fields that are missing', async () => {
    // Enough of the blob is there to act on.
    const restored = readEditorState(await attachRaw('{"v":1}'));

    expect(restored).toEqual({
      v: EDITOR_STATE_VERSION,
      regions: null,
      keepMarkings: true,
      selectedOrdinals: [],
      partNames: [],
    });
  });
});
