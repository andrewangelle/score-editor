/**
 * The uploaded bytes deliberately live outside Redux.
 *
 * A PDF here is up to 100 MB of `Uint8Array`: not a serializable value, and
 * walking it in RTK's dev-time serializability and immutability checks on every
 * dispatch would be a real cost. The store owns the document's identity and the
 * edits made to it; this owns the single buffer those edits describe.
 *
 * One document is open at a time, so this is one slot rather than a cache. The
 * id is carried so a read after a close or a swap returns null instead of the
 * previous document's bytes.
 */

let held: { id: string; bytes: Uint8Array } | null = null;

export function holdDocumentBytes(id: string, bytes: Uint8Array): void {
  held = { id, bytes };
}

/** Null once that document has been closed or replaced by another. */
export function documentBytes(id: string | null): Uint8Array | null {
  return id !== null && held?.id === id ? held.bytes : null;
}

export function releaseDocumentBytes(): void {
  held = null;
}
