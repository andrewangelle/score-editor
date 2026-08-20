# Score Editor

A browser PDF editor for engraved sheet music. Open a score, cut a single
instrument out of it, and write the things a player writes on a part —
fingerings, string numbers, left-hand positions, performance notes — then save
it back.

Everything runs in the tab. The PDF is never uploaded; there is no backend, no
account, and no copy of your music on anyone's server.

## What it does

**Page editing, for any PDF.** Rotate the whole document or a single page,
reorder pages, delete them, undo, or reset back to the file as opened. A score
is not required for this part.

**Staff detection.** An engraved PDF draws its staff lines as vector rules, so
they can be read back out. The app groups those rules into staves, staves into
systems, and reports how many instruments the score has, guessing part names off
the labels on the first system. Scanned or photographed music has no vector
staff lines and is rejected with a message saying so — the plain page editor
still works.

**Part extraction.** Each detected staff becomes a region: a rectangle on a
source page. Tick the instruments you want and extraction lifts those rectangles
into a new PDF as vector content, so the output stays crisp and selectable
rather than being a render-and-crop. Regions are editable — drag to move, drag
an edge to resize, drag empty space to add — so a badly detected staff can be
fixed by hand, and a PDF with no staves at all can still be cut up by drawing
boxes.

**Measure numbers and tempo marks are carried across.** A score engraves those
once per system, above the top staff. A horizontal slice through the second
instrument would come out unnumbered and with no tempo, so they are detected and
stamped back above every band cut from that system. This is on by default and
can be turned off.

**Performance markings.** Four kinds, each with its own engraving conventions:
fingerings, circled string numbers, positions (type `7`, get `VII`), and free
performance notes. A marking is anchored in the *original* page's coordinate
space, not in any output. Mark up the full score, extract the guitar staves,
extract them again differently — every marking stays welded to the music it
describes, because extraction only asks which ones fall inside a band.

**Saving, and reopening what you saved.** Save downloads an edited copy; in
Chromium, opening through the file picker also allows saving over the original
in place. Markings go out as real PDF annotation objects and the rest of the
session — regions, part names, selections — goes out as a versioned JSON
attachment inside the PDF. Reopen that file here and your work comes back
editable. Extraction still flattens, because a part is a print artifact handed
to a player.

Documents are limited to 100 MB.

## Running it

Requires Node and pnpm.

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Other scripts:

```bash
pnpm test         # vitest, single run
pnpm test:watch
pnpm test:types   # tsc --noEmit
pnpm lint:check   # biome
pnpm lint:fix     # biome, writing fixes
pnpm build
```

## How it is put together

TanStack Start (React 19) serves a single route. `react-pdf` and `pdf.js` render
and read pages; `pdf-lib` writes them. Redux Toolkit holds the state. Tailwind 4
for styling, Biome for lint and format, Vitest for tests.

The document bytes deliberately live *outside* Redux, in a module-level holder
keyed by document id (`src/lib/pdf/documentBytes.ts`). The store holds identity
and edits only, which are a few KB; the bytes are far too large to belong in a
state tree that gets structurally shared on every dispatch.

```
src/
  components/
    PDFEditor/         toolbar, save/extract orchestration, error and status banners
    PDFDropzone/       file input, drag and drop, File System Access handles
    ScorePartsPanel/   part list, region and marking tools, extraction controls
    PDFViewer.tsx      page rendering
    PDFPageStrip.tsx   page thumbnails: rotate, reorder, delete
    RegionLayer.tsx    drawing and editing extraction rectangles
    ScoreOverlay.tsx   placing and editing markings
  lib/pdf/
    staffDetection.ts  vector rules -> staves -> systems
    scoreAnalysis.ts   whole-document detection -> part list
    markings.ts        measure numbers and tempo marks
    regions.ts         the rectangles extraction operates on
    partExtraction.ts  regions -> a new PDF
    annotations.ts     the performer's marks
    annotationObjects.ts / annotationStamp.ts   marks as PDF objects / as flat ink
    editorState.ts     session state embedded in the saved PDF
    document.ts        loading, page edits, building the saved file
    fileAccess.ts      save-in-place handles where the browser supports them
  store/               document, score, regions, annotations, tool slices
tests/                 unit tests for lib/ and store/
```

## Browser support

Chromium gets the File System Access API, and with it saving over the original
file and dropping a file that stays writable. Everywhere else the app falls back
to a file input and downloads, which loses nothing except in-place saving.

## Notes for contributors

Staff detection is the part of this codebase most likely to fail quietly: a
system that detects one staff too many silently re-points every part below it,
and the symptom — an extracted part containing the neighbouring instrument —
looks nothing like the cause. `CLAUDE.md` documents the three assumptions
detection rests on, how each can still break, and how to debug it. Read that
before changing anything under `staffDetection.ts`.

`.claude/ideas/` holds design notes written before the work they discuss. They
are records of thinking rather than plans of record, and some describe code that
has since been built — check the source before trusting one.
