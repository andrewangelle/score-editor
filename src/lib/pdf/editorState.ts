/**
 * The session state that has no annotation to ride on.
 *
 * A mark can be a PDF annotation because it is a thing on a page. The rest of
 * what the performer set up describes the document as a whole, so it goes in a
 * versioned JSON attachment instead.
 *
 * Two things this deliberately does not hold. Staff detection's output is
 * derived and stale-prone — a detection improvement would make a stored analysis
 * a lie — so it is recomputed on every open and only the *decisions* taken
 * against it are kept. And page arrangement is not here either: a deleted page's
 * content is genuinely absent from the saved file, so no record of the deletion
 * could undo it.
 *
 * Reading is total. A blob that is corrupt, truncated, or written by a later
 * version of this app must never stop a document opening — the worst honest
 * outcome is that it opens unmarked.
 */

import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
} from 'pdf-lib';
import type { Region } from '#/lib/pdf/regions';

/** The attachment's name, and how it is found again. */
export const EDITOR_STATE_FILE = 'pdf-editor-state.json';

/**
 * Bumped only for a change this version could not read correctly. An older file
 * with a lower `v` would be migrated here; a higher one is refused, because
 * guessing at a format from the future is how state gets silently mangled.
 */
export const EDITOR_STATE_VERSION = 1;

export type EditorState = {
  v: number;
  regions: Region[] | null;
  keepMarkings: boolean;
  selectedOrdinals: number[];
  partNames: { ordinal: number; name: string }[];
};

const NAMES = PDFName.of('Names');
const EMBEDDED_FILES = PDFName.of('EmbeddedFiles');
const KIDS = PDFName.of('Kids');
const EF = PDFName.of('EF');
const F = PDFName.of('F');

export async function writeEditorState(
  doc: PDFDocument,
  state: EditorState,
): Promise<void> {
  await doc.attach(
    new TextEncoder().encode(JSON.stringify(state)),
    EDITOR_STATE_FILE,
    {
      mimeType: 'application/json',
      description: 'Editor state written by PDF Editor',
      modificationDate: new Date(),
    },
  );
}

function findEmbeddedFile(
  doc: PDFDocument,
  node: PDFDict,
  name: string,
): PDFDict | null {
  const names = doc.context.lookupMaybe(node.get(NAMES), PDFArray);
  if (names) {
    // A name tree's leaf is one flat array of alternating key, value, key, value.
    for (let index = 0; index + 1 < names.size(); index += 2) {
      const key = doc.context.lookupMaybe(
        names.get(index),
        PDFString,
        PDFHexString,
      );
      if (key?.decodeText() !== name) continue;

      const spec = doc.context.lookupMaybe(names.get(index + 1), PDFDict);
      if (spec) return spec;
    }
  }

  const kids = doc.context.lookupMaybe(node.get(KIDS), PDFArray);
  if (kids) {
    for (let index = 0; index < kids.size(); index += 1) {
      const kid = doc.context.lookupMaybe(kids.get(index), PDFDict);
      const found = kid && findEmbeddedFile(doc, kid, name);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Reads back the attachment, if it is there and this version understands it.
 *
 * There is no public pdf-lib API for this — attaching is one-way — so the name
 * tree is walked by hand: catalog → Names → EmbeddedFiles → the file
 * specification → its embedded stream.
 */
export function readEditorState(doc: PDFDocument): EditorState | null {
  try {
    const names = doc.context.lookupMaybe(doc.catalog.get(NAMES), PDFDict);
    const embedded =
      names && doc.context.lookupMaybe(names.get(EMBEDDED_FILES), PDFDict);
    if (!embedded) return null;

    const spec = findEmbeddedFile(doc, embedded, EDITOR_STATE_FILE);
    const streams = spec && doc.context.lookupMaybe(spec.get(EF), PDFDict);
    const stream =
      streams && doc.context.lookupMaybe(streams.get(F), PDFStream);

    if (!(stream instanceof PDFRawStream)) return null;

    const json = new TextDecoder().decode(decodePDFRawStream(stream).decode());
    return validate(JSON.parse(json));
  } catch {
    // Deliberately total: no shape of blob is a reason to refuse the document.
    return null;
  }
}

function isRegion(value: unknown): value is Region {
  if (typeof value !== 'object' || value === null) return false;
  const region = value as Partial<Region>;
  const rect = region.rect as Partial<Region['rect']> | undefined;

  return (
    typeof region.id === 'string' &&
    typeof region.pageIndex === 'number' &&
    typeof region.label === 'string' &&
    typeof region.groupKey === 'string' &&
    typeof rect?.left === 'number' &&
    typeof rect.right === 'number' &&
    typeof rect.top === 'number' &&
    typeof rect.bottom === 'number'
  );
}

/**
 * What came out of the JSON, if it is state this version can act on.
 */
function validate(parsed: unknown): EditorState | null {
  if (typeof parsed !== 'object' || parsed === null) return null;

  const state = parsed as Partial<EditorState>;
  if (state.v !== EDITOR_STATE_VERSION) return null;

  const regions = state.regions;
  if (regions !== null && regions !== undefined && !Array.isArray(regions)) {
    return null;
  }

  return {
    v: EDITOR_STATE_VERSION,
    regions: Array.isArray(regions) ? regions.filter(isRegion) : null,
    keepMarkings: state.keepMarkings !== false,
    selectedOrdinals: Array.isArray(state.selectedOrdinals)
      ? state.selectedOrdinals.filter(
          (ordinal): ordinal is number =>
            typeof ordinal === 'number' && Number.isInteger(ordinal),
        )
      : [],
    partNames: Array.isArray(state.partNames)
      ? state.partNames.filter(
          (entry): entry is { ordinal: number; name: string } =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as { ordinal?: unknown }).ordinal === 'number' &&
            typeof (entry as { name?: unknown }).name === 'string',
        )
      : [],
  };
}
