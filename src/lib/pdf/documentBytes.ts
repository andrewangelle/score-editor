/**
 * The uploaded bytes deliberately live outside Redux: up to 100 MB of
 * `Uint8Array` is not serializable, and walking it in RTK's dev-time checks on
 * every dispatch is a real cost. The store owns the document's identity and
 * edits; this owns the buffer those edits describe.
 *
 * The file handle lives here too — equally unserializable, and with the same
 * lifetime, being the way back to the file these bytes came from.
 *
 * One document is open at a time, so this is one slot rather than a cache. The
 * id is carried so a read after a close or swap returns null rather than the
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
