# Contributing
Notes for development

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
    PDFViewer/      page rendering
    PDFPageStrip/   page thumbnails: rotate, reorder, delete
    RegionLayer/    drawing and editing extraction rectangles
    ScoreOverlay/   placing and editing markings
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
