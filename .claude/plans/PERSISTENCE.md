# Plan: performance marks that survive a reopen

Status: **built.** Phases 1–4 are in the working tree; Phase 5 was decided
against — see "Settled" below. Supersedes the option comparison in
`.claude/ideas/PERSISTENCE.md`, which explored a database and concluded against
one. This is the plan of record.

## Goal

Open a score this app has already marked up — tomorrow, next month, from disk —
and get every performance mark back as a **live, editable object**: retype it,
drag it, delete it, add more beside it, save again. No database, no account, no
server. The marks live in the PDF.

## Scope, stated precisely

This app is a **performance annotation aid**, not a composition or page-layout
tool. The durable thing is a performer's markings on music.

**Round-trips** — restored editable on reopen:

- fingerings, string numbers, left-hand positions, performance notes
- manual regions
- `keepMarkings`, selected part ordinals, part renames

**Session-local by design** — works exactly as today, simply does not survive a
reopen:

- page arrangement: deletion and reordering, and the ability to undo back to the
  uploaded arrangement

Page *rotation* is a special case that needs no work: `readPdfFile` reads
`page.getRotation().angle` back as the new baseline (`src/lib/pdf/document.ts:96`),
so a rotated score reopens rotated for free.

Nothing is being removed. `pageDeleted`, `pageMoved`, `documentReset` and the
strip buttons all stay. They are staging conveniences, and declaring them
session-local is what lets the file be the whole persistence layer. A deleted
page's content is genuinely absent from the saved file, so cross-session undo of
a destructive page operation is not recoverable by any design.

## Approach

Each mark becomes a real **PDF annotation** (`/Subtype /Stamp`) whose appearance
stream draws exactly what `stampAnnotation` draws today, and whose dictionary
carries the `ScoreAnnotation` fields in custom keys:

```js
doc.context.obj({
  Type: 'Annot', Subtype: 'Stamp',
  Rect: [x, y, x + w, y + h],
  F: 4,                                    // Print flag
  AP: { N: apRef },                        // Form XObject: the existing geometry
  PdfEditorKind: PDFName.of('string'),     // ← the ScoreAnnotation, riding along
  PdfEditorText: PDFHexString.fromText('12'),
  PdfEditorId:   PDFHexString.fromText('note-abc-123'),
  PdfEditorSize: PDFNumber.of(9.5),
  PdfEditorX: PDFNumber.of(x), PdfEditorY: PDFNumber.of(y),
})
```

Because the ink lives in the annotation's appearance stream rather than the page
content stream, **removing the annotation recovers the unstamped original.**
That is the property flattened ink can never have, and it is what makes this
work:

- No double-stamping. Every save draws each mark exactly once, from clean
  source.
- No content hash, no record lookup, no identity problem — the state is *in* the
  bytes.
- The invariant at `PDFEditor.tsx:228-231` ("both build from the pristine upload
  … which is what lets the same file be saved over repeatedly without edits
  compounding") is **preserved across sessions** rather than silently broken.

Document-level state that has no annotation to ride on — manual regions,
`keepMarkings`, selected ordinals, part renames — goes in a versioned JSON
attachment named `pdf-editor-state.json`.

## Verified before planning

Prototyped against the installed `pdf-lib@1.17.1`; all confirmed working:

- Write → save → reload → read `kind/text/id/x/y/size` back off the annotation
  dicts.
- Ghostscript render of the annotation appearance is **visually identical** to
  today's flattened stamp (circled string number, correct cap-height centring).
- `removeAnnot` → re-save leaves the engraved music untouched with no trace of
  the mark.
- Annotations **and their custom keys survive `copyPages`**, which
  `buildEditedPdf` relies on.
- Info-dict custom keys do **not** survive, because `buildEditedPdf` starts from
  `PDFDocument.create()`. Attachments must likewise be re-added on each build.
  Hence the attachment, written explicitly alongside the existing metadata calls
  at `document.ts:150-154`.
- Attachment read-back has no public pdf-lib API: walk
  `catalog → Names → EmbeddedFiles`, then `decodePDFRawStream`. ~10 lines.
- `pdf-lib` exports `drawText`/`drawEllipse` — the same operator helpers
  `page.drawText`/`page.drawCircle` use — so the existing geometry transfers to
  an appearance stream without being rewritten.

## Settled: the score is the durable artifact

**Decided 2026-08-20 — score-durable. Phase 5 is not being built.**

One source of truth, and less risk of drift. A fingering lives in the score and
nowhere else, so there is never a question of which file is right. Part-durable
was built and then removed: it splits the truth, because fixing a fingering in a
part leaves the score disagreeing with it and nothing reconciles the two, and
re-extracting that part silently discards whatever was done to the old one.

Note what this does *not* cost: a part opened in this app can still take new
marks, and those persist, because saving always writes objects. Only the marks
carried across at extraction time are flattened.

The reasoning that led here is kept below.

**Is the durable artifact the score, or the extracted part?**

- *Score:* the performer keeps the marked-up full score and re-extracts parts as
  needed. Annotation objects go on the working save only; extraction stays
  flattened, because a part is a print artifact handed to a player.
- *Part:* the player keeps *their* part and tweaks fingerings next week. The
  part then needs annotation objects too.

The second is achievable and not much extra: extraction places each mark at
`placed.x + (annotation.x - placed.region.rect.left) * scale`
(`src/lib/pdf/partExtraction.ts:241-260`), an invertible affine transform per
region. Emit the annotation with its appearance in *part* space while keeping
the original `pageIndex/x/y` in the custom keys — reopening a part restores the
marks in the right place with provenance intact, no inversion arithmetic.

Side benefit if the part is durable: the performer never re-extracts, which
contains the risk `CLAUDE.md` warns about — a detection change silently
re-pointing part ordinals between sessions.

**The plan below assumes score-durable (Phase 1–4) and treats part-durable as
Phase 5.** Phases 1–4 are unaffected by the decision.

Phase 5 was built against this and then removed. If it is ever reconsidered, the
removal touched `partExtraction.ts` (a `marks` option and part-space rewriting),
a `source` field on `ScoreAnnotation`, `PdfEditorSource*` keys, an
`editableMarks` flag through the score slice and editor state, and a checkbox in
the parts panel. The mechanism worked; the reason against it is not technical.

## Implementation

### Phase 1 — share the geometry

Today `stampAnnotation` (`src/lib/pdf/annotationStamp.ts:41-70`) calls
`page.drawText` / `page.drawCircle` directly. The appearance-stream path needs
the same geometry emitting into a Form XObject instead.

Widen the first parameter to a structural sink rather than refactoring the
drawing:

```ts
type DrawSink = {
  drawText(text: string, opts: { x; y; size; font; color }): void;
  drawCircle(opts: { x; y; size; borderColor; borderWidth }): void;
};
```

`PDFPage` already satisfies this structurally, so `stampAnnotation`'s body is
unchanged — only the type widens. `tests/lib/annotationStamp.test.ts` already
builds exactly such a duck-typed recorder and casts it
`as unknown as PDFPage`; that cast becomes unnecessary and the test keeps
passing verbatim.

This guarantees the flattened path and the appearance path cannot drift apart,
because there is one implementation.

### Phase 2 — `src/lib/pdf/annotationObjects.ts` (new)

- `annotationAppearance(doc, annotation, font)` → `PDFRef` of a Form XObject.
  Provides a `DrawSink` that accumulates pdf-lib operators, runs
  `stampAnnotation` against it, wraps the result in a content stream with
  `BBox` and a font resource.
- `writeAnnotationObjects(doc, page, annotations, font)` → builds and
  `addAnnot`s the dicts.
- `readAnnotationObjects(doc)` → `ScoreAnnotation[]`, walking each page's
  `/Annots` and keeping only dicts carrying `PdfEditorId`.
- `stripAnnotationObjects(doc)` → `removeAnnot` for ours only.

**Filter strictly on the `PdfEditor*` namespace in both read and strip.** A
source PDF may legitimately carry links, outline targets or form fields;
deleting those would corrupt someone's score.

Dedupe appearance streams across marks sharing `kind + text + size` — a score
with 400 fingerings should not carry 400 near-identical Form XObjects.

### Phase 3 — `src/lib/pdf/editorState.ts` (new)

Versioned JSON attachment, `pdf-editor-state.json`:

```ts
type EditorState = {
  v: 1;
  regions: Region[] | null;        // regions.manual
  keepMarkings: boolean;
  selectedOrdinals: number[];
  partNames: { ordinal: number; name: string }[];
};
```

- `writeEditorState(doc, state)` via `doc.attach(...)`.
- `readEditorState(doc)` via the `Names → EmbeddedFiles` walk; returns `null`
  when absent or when `v` is unrecognised. **An unreadable or future-versioned
  blob must never fail the open** — the document still opens, unmarked.

Part renames are stored here rather than by persisting `score.analysis`, which
stays derived and recomputed. This is the fix for renames being trapped inside
the analysis subtree by `partRenamed` (`src/store/score.slice.ts:94-102`).

### Phase 4 — wire it into open and save

**Save** — `buildEditedPdf` (`src/lib/pdf/document.ts:110-157`) takes a mode:

- `marks: 'objects'` — the working save. Replaces the `stampAnnotation` loop at
  `document.ts:139-147` with `writeAnnotationObjects`, plus
  `writeEditorState`.
- `marks: 'flattened'` — unchanged behaviour, for print artifacts.

`handleSaveToFile` and `handleSaveCopy` (`PDFEditor.tsx:252-275`) pass
`'objects'`. Extraction keeps flattening (pending the Phase 5 decision).

**Open** — `handleFile` (`PDFEditor.tsx:111-132`) gains a restore step between
reading and announcing:

1. `readPdfFile(file)` as today.
2. Load with pdf-lib; `readAnnotationObjects` + `readEditorState`.
3. `stripAnnotationObjects`, re-serialize → **these stripped bytes become the
   session's pristine source** held by `holdDocumentBytes`.
4. `dispatch(documentOpened(...))` as today.
5. `dispatch(documentRestored({ annotations, ...editorState }))`.
6. `analyseScore(id, strippedBytes)`.

Step 3 also disposes of a rendering snag: `renderAnnotationLayer={false}`
(`src/components/PDFViewer.tsx:92`) only suppresses the HTML layer — react-pdf
hardcodes canvas `annotationMode` to `ENABLE`
(`node_modules/react-pdf/dist/Page/Canvas.js:63`) with no prop to disable it. If
the marks were still in the document, pdf.js would paint them *and*
`ScoreOverlay` would draw them again. Handing react-pdf the stripped bytes means
this never arises. It also means staff detection runs over clean music rather
than over the performer's own ink.

**`documentRestored` action.** A single action consumed by several slices via
`extraReducers`, mirroring the existing cross-slice `documentOpened` pattern.

Ordering is mandatory: every slice resets itself on `documentOpened` —
`annotations.slice.ts:82-86`, `regions.slice.ts:102-106`, `tool.slice.ts:30-34`,
`score.slice.ts:104-111`. Restore must dispatch **after** it.

**The async wrinkle.** `selectedOrdinals` and `partNames` are meaningless until
analysis lands, and analysis is async and slow. So `documentRestored` parks
them in the score slice as `pendingRestore`, and the `scoreAnalysed` reducer
applies them against the freshly detected parts, then clears it. Reconcile
rather than trust: if detection now finds 11 staves where it previously found
12, stored ordinals name different parts — drop ordinals with no matching part,
and apply renames only where the ordinal still exists.

### Phase 5 — re-editable extracted parts (decided against; see above)

Emit annotation objects from `extractRegions` in part space, keeping source
`pageIndex/x/y` in the custom keys. Add a flatten-on-export path so a part can
still be produced as pure ink for printing.

## Testing

Existing suite is vitest, node environment, pure logic (`vitest.config.ts`), with
`tests/lib/` and `tests/store/` mirroring `src/`. New tests follow that layout.

- `tests/lib/annotationObjects.test.ts`
  - Round-trip every `AnnotationKind` through write → save → load → read;
    assert field equality including the normalized text forms.
  - Strip removes ours and **leaves a foreign annotation untouched** — construct
    a link annotation and assert it survives.
  - Appearance dedupe: N identical marks yield one Form XObject.
  - Geometry agreement: run `stampAnnotation` against the recorder from
    `annotationStamp.test.ts` and against the appearance sink, assert identical
    draw calls. This is the guard that the two paths never drift.
- `tests/lib/editorState.test.ts`
  - Round-trip; absent attachment → `null`; corrupt and future-`v` blobs →
    `null` without throwing.
- `tests/store/documentRestored.test.ts`
  - Restore after `documentOpened` populates annotations and regions.
  - `pendingRestore` applies on `scoreAnalysed` and is cleared.
  - Ordinal reconciliation: fewer parts than stored drops the stale ones;
    renames apply only to surviving ordinals.
- Manual check on a real score before calling it done: mark up
  `TempoMorto` (the 239-page corpus), save, reopen, confirm marks return in the
  right places and a second save does not double-stamp.

## Risks

- **Other apps can delete the stamps.** Preview and Acrobat will happily select
  and remove a `/Stamp`. Arguably a feature; but a user can silently destroy
  state and the app cannot detect the difference from "never had any."
- **Minimal viewers may ignore annotations when printing**, despite the Print
  flag. Ghostscript honoured it, but a phone PDF viewer might not. Mitigation is
  the flattened export path — keep it, and prefer it for anything handed to a
  player.
- **File size.** One Form XObject per distinct `kind + text + size`; dedupe
  keeps this small, but verify on a heavily marked score.
- **Page arrangement is genuinely lossy across sessions.** Accepted, and
  in scope-scoped above — but the UI should not imply otherwise. Consider
  whether the header's unsaved-changes wording needs to distinguish "marks
  saved" from "arrangement not preserved."

## Explicitly not doing

- No database, no Prisma, no Postgres, no IndexedDB, no content fingerprinting,
  no auth, no server, no blob storage. The file is the persistence layer.
- Not persisting `score.analysis` — derived, large, and stale-prone against
  detection changes (`src/store/index.ts:8-18`, and the staff-detection section
  of `CLAUDE.md`).
- Not persisting `document.history` or `document.original`.
- Not making the marks editable in Acrobat. They need to be re-editable in *this
  app*; `/Stamp` with a custom appearance achieves that without fighting
  `/FreeText` appearance rules.

A database becomes worth revisiting only for cross-device sync or sharing —
a different feature, justified separately.
