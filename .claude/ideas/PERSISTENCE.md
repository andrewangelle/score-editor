# Persisting edits so a saved score can be re-edited later

Status: **idea / not started.** This is a design note, not a plan of record.

## The goal

Today fingerings, string numbers, positions, performance notes, manual regions
and page edits live only in Redux, and Redux only lives as long as the tab. Open
the same score tomorrow and everything you marked is gone — the marks are in the
saved PDF as ink, but nothing in the app can edit them again.

The wanted behaviour: open a PDF that this app has already marked up, and get
the marks back as editable objects.

## Verdict

Worth doing. The data model is already right for it, and the storage layer is
the easy part. The hard part is a design question the current save path has no
answer to, and it sits directly on top of the use case.

**Resolve "what is the canonical original?" before choosing a database.** That
decision determines the data model; no ORM choice makes it go away.

## What is already in our favour

The state worth keeping is pure, small, serializable, and — crucially — anchored
to the *original* document rather than to any output:

- `ScoreAnnotation` (`src/lib/pdf/annotations.ts:13`) is
  `{id, pageIndex, x, y, text, size, kind}`, anchored in source-page user space.
  The doc comment at the top of that file is effectively a persistence spec
  already.
- `PageEdit` (`src/lib/pdf/document.ts:21`) is `{id, sourceIndex, rotation}`.
- Manual `Region`s are absolute coordinates on source pages.
- The bytes are deliberately outside Redux (`src/lib/pdf/documentBytes.ts`), so
  there is no blob tangled into the state tree.

That is a few KB per document. There is no serialization work to invent; the
shapes are already correct.

## Problem 1 — saving flattens the marks, which breaks the round trip

This is the one that hits the use case squarely.

`stampAnnotation` (`src/lib/pdf/annotationStamp.ts:41-70`) draws each mark as
**page content** via `drawText`/`drawCircle` — flattened ink, not PDF annotation
objects. `handleSaveToFile` (`src/components/PDFEditor/PDFEditor.tsx:252-261`)
then overwrites the source file with that output. Consequences:

- The saved file's bytes differ from the upload, so a content hash taken on
  re-open will not match the record stored against the upload. `buildEditedPdf`
  sets a fresh modification date (`src/lib/pdf/document.ts:154`), so even a
  no-op save changes the bytes.
- If the record *were* matched and the annotations restored, saving again would
  stamp them a **second time** over the ink already there.
- The invariant documented at `PDFEditor.tsx:228-231` — "both build from the
  pristine upload rather than from whatever was last written, which is what lets
  the same file be saved over repeatedly without edits compounding" — holds
  *within a session only*. Once state is persisted across sessions, session 2's
  "pristine upload" is session 1's stamped output, and the invariant is silently
  false.
- Same failure for page edits: if the saved file had pages deleted or reordered,
  the stored `sourceIndex` values no longer name the same pages.

### The choice this forces

- **(a) The app owns the library.** The stored record is the truth; the
  flattened PDF is an export-only artifact. "Open later" means opening from the
  app, not from disk. Cleanest model, biggest product change.
- **(b) Keep the pre-stamp original.** Store the uploaded bytes alongside the
  state, keyed by both the original hash and the output hash. Re-opening a
  stamped file resolves to "this is the output of record X", loads the original
  bytes plus the edit state, and rebuilds from the original. Needs real blob
  storage — 100 MB per document (`MAX_PDF_BYTES`), so object storage, never
  Postgres `bytea`.
- **(c) Put the state in the PDF itself.** Custom metadata or an embedded file
  attachment; no database at all. The state travels with the bytes: survives
  being emailed, no identity problem, no server. Would want the marks as real
  PDF annotation objects rather than flattened content — pdf-lib supports this
  but not ergonomically, and the circled string numbers need custom appearance
  streams. Realistically a hybrid: state in metadata, flattened appearance for
  print.

## Problem 2 — document identity

`documentOpened` receives `id = crypto.randomUUID()`, minted fresh on every open
(`PDFEditor.tsx:117`). Nothing about it derives from the file, so it cannot find
anything tomorrow.

Needs a content fingerprint — SHA-256 of the uploaded bytes via
`crypto.subtle.digest`. Simple on its own; entangled with problem 1, because
which bytes you hash depends on which option above you pick.

## Problem 3 — do not persist the whole store

Taken literally, "persist the Redux store" would include `score.analysis`: the
detection output, a staff for every system on every page. It is already exempt
from RTK's dev-time immutability and serializability checks because walking it
costs tens of milliseconds per dispatch (`src/store/index.ts:8-18`).

It should not be persisted, for a reason beyond size: it is **derived from the
bytes and recomputable**, and detection logic changes over time. A persisted
analysis would go stale against improved detection and silently re-point
extracted parts — the exact failure mode described in the staff-detection
section of `CLAUDE.md`.

**Persist:** `annotations`, `regions.manual`, `document.pages`,
`score.selectedOrdinals`, `score.keepMarkings`.

**Skip:** `score.analysis`, `tool`, `document.history`, `document.original`, and
the held bytes.

### Two catches

- **Part names are user data hiding inside the derived subtree.** `partRenamed`
  (`src/store/score.slice.ts:94-102`) mutates `analysis.parts[].name` in place.
  Dropping the analysis therefore drops the user's renames with it. Persist the
  renames separately — keyed by ordinal, re-applied after re-analysis — rather
  than persisting the analysis to keep them.
- **`selectedOrdinals` only means something against a particular analysis.**
  Store it, but reconcile against the freshly computed analysis on load: if
  detection now finds 11 staves where it previously found 12, those ordinals
  name different parts.

### Ordering

Every slice resets itself on `documentOpened` — `annotations.slice.ts:82-86`,
`regions.slice.ts:102-106`, `tool.slice.ts:30-34`, and `score.slice.ts:104-111`
(which resets to `initialState` while keeping the new `documentId`). Any restore
must therefore dispatch *after* the open, never before.

## Prisma + Postgres, specifically

Defensible, but the heavyweight answer to the question actually being asked.

**IndexedDB gets ~90% of the value at ~5% of the cost.** Same-browser restore,
no server, no auth, no hosting, works offline — and it can hold the original
bytes too, which solves option (b) for free. 100 MB is workable under a
`navigator.storage.persist()` grant, though quotas are ultimately origin- and
disk-dependent. If the requirement is "I marked up this score on my laptop and
want to keep editing it on my laptop", that is the whole feature.

**Postgres earns its keep only** for cross-device edits, sharing marked-up parts
with a teacher or another player, or a server-side score library. All legitimate
goals for a music app — but they are a larger, different feature than "restore
my edits", and they drag auth (whose edits are these?) and blob storage in with
them. The app is currently client-only and zero-backend; TanStack Start is
already present, deployed as a Netlify function, so server functions are
low-friction, but the surface-area growth is real.

If Postgres does happen:

- Annotations deserve a real table (`id, documentId, pageIndex, x, y, text,
  size, kind`) — they are queried by page and rect in `annotationsWithin`, which
  is a natural relational shape.
- Page edits, manual regions and score preferences are read whole; JSON columns
  are fine.
- PDF bytes go to object storage keyed by hash. Not into the database.

## Suggested first step

Put a small storage interface between the slices and whatever backs them:

```ts
saveDocumentEdits(fingerprint: string, state: PersistedEdits): Promise<void>
loadDocumentEdits(fingerprint: string): Promise<PersistedEdits | null>
```

Drive it from a debounced `createListenerMiddleware` (already available in the
installed RTK) watching the annotation, region and page actions. A
`redux-persist`-style whole-store subscribe is the wrong shape here — the
persistence is per-document-keyed and selective about slices.

That interface is roughly 50 lines and is **the same interface either way**.
Start on IndexedDB; swapping in Prisma later touches no slice.

## Verified against

Read, not run — this note describes code as of the working tree on 2026-08-19,
with no changes made:

- flattening: `src/lib/pdf/annotationStamp.ts:41-70`
- save path: `src/components/PDFEditor/PDFEditor.tsx:232-261`
- random per-open id: `src/components/PDFEditor/PDFEditor.tsx:117`
- analysis-size exemption: `src/store/index.ts:8-18`
- part renames inside analysis: `src/store/score.slice.ts:94-102`
