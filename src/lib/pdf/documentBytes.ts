/**
 * The uploaded bytes deliberately live outside Redux.
 *
 * A PDF here is up to 100 MB of `Uint8Array`: not a serializable value, and
 * walking it in RTK's dev-time serializability and immutability checks on every
 * dispatch would be a real cost. The store owns the document's identity and the
 * edits made to it; this owns the single buffer those edits describe.
 *
 * The file handle, where the browser gave one up, is kept here too: it is just
 * as unserializable, and it has exactly the same lifetime — it is the way back
 * to the file these bytes came from, so it must go when they do.
 *
 * One document is open at a time, so this is one slot rather than a cache. The
 * id is carried so a read after a close or a swap returns null instead of the
 * previous document's bytes.
 */

import type { PdfFileHandle } from '#/lib/pdf/fileAccess';

let held: {
  id: string;
  bytes: Uint8Array;
  handle: PdfFileHandle | null;
} | null = null;

export function holdDocumentBytes(
  id: string,
  bytes: Uint8Array,
  handle: PdfFileHandle | null = null,
): void {
  held = { id, bytes, handle };
}

/** Null once that document has been closed or replaced by another. */
export function documentBytes(id: string | null): Uint8Array | null {
  return id !== null && held?.id === id ? held.bytes : null;
}

/**
 * The open document's file handle, or null when it has none — a drop or an
 * `<input>` outside Chromium — in which case it can only be saved as a copy.
 */
export function documentFileHandle(id: string | null): PdfFileHandle | null {
  return id !== null && held?.id === id ? held.handle : null;
}

export function releaseDocumentBytes(): void {
  held = null;
}
