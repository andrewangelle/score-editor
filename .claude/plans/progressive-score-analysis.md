# Progressive, viewport-first score analysis

## Goal

On a large score the overlay (staff hints, annotations, regions) stays blank
until staff detection has finished every page, because `analyzeScore` loops
over the whole document before it dispatches anything. Make detection
progressive: analyse the pages the reader can see first, put each page into the
store as soon as it is done, and keep going in the background until every page
is in. The store holds the copy the overlay displays; the runner tracks what is
finished from its own list of analysed pages, because the final pass needs the
`ink` and `text` that the store drops. No page is analysed twice in one run.

The win is time to the first overlay, which falls from "the whole document" to
"about one page". Total analysis time does not change.

## Non-goals

- Analysing only visible pages and never the rest. Markings, part names, the
  irregular-systems warning, detected regions and extraction all read the whole
  document (see "What cannot be lazy" below), so every page still gets analysed.
- Unlocking the edit panel before analysis completes (Follow-up A).
- Persisting analysis across sessions (Follow-up B).
- Moving detection off the main thread (Follow-up C).
- Any change to detection itself: `staffDetection.ts`, `markings.ts` and their
  thresholds are untouched, and results must be identical to today's.

## Current state

- `src/components/PDFPicker/PDFDropzone/PDFDropzone.tsx:155` calls `analyseScore(id, loaded.bytes)` after
  `documentOpened`/`documentRestored`. That awaits `analyzeScore` and dispatches
  one `scoreAnalysed` (or `scoreAnalysisFailed`).
- `analyzeScore` (`src/lib/pdf/scoreAnalysis.ts:49`) opens its own pdf.js
  document from `bytes.slice()`. For each page in order it calls
  `getOperatorList()` (in the pdf.js worker), checks `MAX_PAGE_OPERATORS`, then
  calls `detectPageStaves`, whose geometry work runs on the main thread. Then,
  over the whole document:
  - `detectMarkings(detected, texts)` uses each page's `ink` and `text`.
  - It strips `ink`, `frames` and `text` from every page.
  - It finds the first system with staves, or throws "No staves were found".
  - It runs `guessPartNames` on that system's page.
  - It computes `irregularSystems` against `parts.length`.
- `scoreAnalysed` (`score.slice.ts`) stores `analysis`, resets
  `selectedOrdinals` to every detected part and reconciles a restored
  `pendingOrdinals`.
- Page-addressed reads go through `selectSourcePageAt` → `selectOverlay` →
  `selectStaffHints` (`src/store/selectors.ts:78`). All of them read
  `analysis?.pages[sourceIndex]`, so every page's overlay is `null` until the
  whole analysis lands. Their consumers are `ScoreOverlay`, `Annotations`,
  `AnnotationCursorPreview`, `StaffHints`, `RegionLayer` and `Region`.
- `PDFEditor.tsx` shows `LoadingStaves` ("Looking for staves...") until
  `analysis` is set, then the whole `EditScorePanel`. Parts, annotation tools,
  region editing and extract sit inside that panel. The markings export does
  not: `SaveMarkingsPrompt` is mounted directly in `PDFEditor.tsx:29`, outside
  the panel, but it checks for a missing analysis itself
  (`SaveMarkingsPrompt.tsx:38`). So all of it is already gated on a complete
  analysis.
- `store/index.ts` exempts `score.analysis` and the `score/scoreAnalysed` action
  from RTK's dev-only state checks, because the tree is large.

### What cannot be lazy (and why the panel stays gated)

| Consumer | Needs every page because |
|---|---|
| `detectMarkings` → `resolveMarkings` | `byPlacement` groups candidates document-wide; measure numbers are the longest non-decreasing run through the whole score; `arePageNumbers` votes over all pages. Page 3's markings depend on page 40. |
| `irregularSystems` | The only guard against hidden empty staves (`CLAUDE.md`). A partial count reports "regular" for pages it has not seen. |
| "No staves were found" | Can only be decided after the last page. |
| `selectDetectedRegions` → `regionsFromParts` | Builds regions for every page; `DetectedParts` shows the count. |
| `regions.slice.ts:54` `editable()` | The first manual edit snapshots the detected regions into `manual`. Done early, pages not yet analysed would never get regions. |
| `useExtractWith`, `SaveMarkingsPrompt` → `extractRegions`, `extractMarkings` | `extractMarkings` walks every page (`markings.extract.ts:29,38,42,161`); `extractRegions` only needs `analysis.pages[0]` plus `selectRegions`, but the panel that calls it stays gated regardless. |

So this plan makes the **overlay** progressive and leaves everything in that
table exactly where it is: computed once at completion and reached only through
the gated panel.

---

## Phase 0: measure first

Before building, confirm where the time goes, because the answer changes the
payoff.

1. On a throwaway branch, add `performance.mark`/`measure` around these four
   steps in `analyzeScore`, summed per step across pages:
   - `getOperatorList`
   - `detectPageStaves`, split into geometry and `readVisibleText` if it is
     cheap to do so
   - `detectMarkings`
   - `guessPartNames`
2. Run it in the app against the largest real score available (the author picks
   one; a 50+ page orchestral score is the case that matters). Record the
   numbers in this file under a "Baseline" heading.
3. Read the result:
   - If per-page work (operator lists plus detection) dominates, this plan pays
     off as described.
   - If `detectMarkings` alone is a large share, the overlay still arrives early
     but the panel does not. Consider Follow-up C or B first.

Don't commit the instrumentation.

## Phase 1: split `analyzeScore` into page-level and document-level steps (no behaviour change)

Refactor `src/lib/pdf/scoreAnalysis.ts` into composable pieces, keeping
`analyzeScore` as their composition so every caller and test is unchanged.

1. `openScoreDocument(bytes): Promise<ScoreDocument>`, where `ScoreDocument` is
   `{ numPages, getPage(i), ops, destroy() }`. It wraps `loadPdfjs` and
   `getDocument({ data: bytes.slice() })` — the slice is load-bearing, not
   incidental: `src/components/PDFPicker/PDFDropzone/PDFDropzone.tsx:143` holds the same array reference it passes to
   analysis, and that buffer is read again later by `useExtractWith.ts:30` and
   `PDFViewerContent.tsx` (which also slices before handing it to pdf.js).
   Handing pdf.js the held buffer unsliced lets the worker detach it, breaking
   extract and save. `openScoreDocument` must stay the only thing that calls
   `loadPdfjs`/`getDocument`; `analyzePage` and `finishAnalysis` take an
   already-open `ScoreDocument`. The listener in Phase 3 takes
   `openScoreDocument` as an injected dependency, so tests can pass a fake.
2. `analyzePage(doc, sourceIndex): Promise<PageStaves>` does `getPage`,
   `getOperatorList`, the `MAX_PAGE_OPERATORS` check (throwing
   `ScoreAnalysisError` as today) and `detectPageStaves`. It returns the full
   `PageStaves`, including `ink`, `frames` and `text`.
3. `toStoredPage(page: PageStaves): ScorePage` is the existing destructure that
   drops `ink`, `frames` and `text`, with `markings: []`.
4. `finishAnalysis(doc, detected: PageStaves[]): Promise<ScoreAnalysis>` is
   everything after the loop: markings, stripping, the first system with staves
   and the "no staves" error, `guessPartNames`, parts and `irregularSystems`.
   `detected` must be in **source order**. Assert `detected[i].pageIndex === i`,
   because Phase 3 fills the array out of order and markings resolution depends
   on reading order.
5. `analyzeScore` becomes: open, `analyzePage` for each page in order,
   `finishAnalysis`, then destroy in `finally`.

Check: `pnpm test`, `pnpm test:types`. No test edits. If `testScoreFixture.ts`
can build a multi-page PDF, add a unit test asserting that
`finishAnalysis(doc, pagesAnalysedInReverseThenSorted)` deep-equals
`finishAnalysis(doc, pagesAnalysedInOrder)`. It must **not** compare against
`analyzeScore(bytes)`: that goes through `loadPdfjs()` (`import('react-pdf')`),
which throws `DOMMatrix is not defined` under the unit suite's `node`
environment, exactly why no existing unit test calls `loadPdfjs` or
`analyzeScore`. Instead open the document the way the existing pdf.js tests do
— `import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'`,
`pdfjs.getDocument({ data: bytes.slice() })`, wrap it as a `ScoreDocument` with
`ops: pdfjs.OPS` — and feed that same open document to both `finishAnalysis`
calls. That is the whole point of this phase's order-independence proof.

## Phase 2: the page cache in the score slice

All in `src/store/score.slice.ts` unless noted. Follow
`node_modules/@reduxjs/toolkit/skills/model-redux-state/build-slices-and-selectors/SKILL.md`.

1. **State.** Add these fields:
   - `pages: Record<number, ScorePage>`, keyed by **source index**. This is the
     copy the overlay displays, not the runner's record of what is finished (the
     runner keeps that itself, Phase 3.3). Pages carry no markings until
     completion; the overlay doesn't read them.
   - `pageCount: number | null`: the total, for progress.
   - `priority: number[]`: source indices the viewer wants first (Phase 4).
2. **Actions.**
   - `analysisStarted({ documentId, pageCount })` sets `pageCount`.
   - `scorePageAnalysed({ documentId, page: ScorePage })`: if the document
     matches and `pages[page.pageIndex]` is absent, store it. Ignore any other
     `documentId`, as `scoreAnalysed` already does.
   - `analysisPrioritised(sourceIndices: number[])` replaces `priority`. It is
     not tied to a document; it resets on open and close.
   - `scoreAnalysed` keeps its reducer as is. It also fills any `pages` entry
     that is missing from `analysis.pages`, so tests and callers that dispatch
     it directly (e.g. `pageAddressedSelectors.test.ts`) still get overlays.
   - `scoreAnalysisFailed` also clears `pages`. Failure today means no overlay,
     and that stays true.
   - `documentOpened` and `documentClosed` already reset to `initialState`;
     check that the new fields are part of it.
3. **Selectors.**
   - `selectSourcePageAt` (`selectors.ts:78`) reads `state.score.pages[sourceIndex]`
     instead of `analysis?.pages[sourceIndex]`. Immer keeps unchanged entries
     referentially stable. A newly cached page 5 therefore changes the `pages`
     record but not `pages[0]`, and `selectOverlay(state, 0, w)` hits its memo.
     Add exactly that case to `tests/unit/store/pageAddressedSelectors.test.ts`.
   - Add `selectAnalysisProgress`, built with `createSelector` over `pages` and
     `pageCount` so it returns a stable object between unrelated dispatches
     (a plain selector would build a new object per call, triggering react-redux
     9 dev-mode selector warnings and re-rendering `LoadingStaves` on every one
     of up to 300 page dispatches). It returns
     `{ analysed: Object.keys(pages).length, total: pageCount }`, or `null`
     before `analysisStarted`. Add a test that two calls on an unchanged state
     return the same reference.
   - Leave `selectAnalysis` and every whole-document selector (`selectParts`,
     `selectIrregularSystems`, `selectMarkingCounts`, `selectSystemCount` and
     `selectDetectedRegions`) reading `analysis`. They stay `null` or empty
     until completion, exactly as today.
4. **Store checks** (`src/store/index.ts`). Add `score.pages` to `ANALYSIS_PATH`
   and `score/scorePageAnalysed` to `ignoredActions`, for the same reason the
   existing exemption gives.

Unit tests in `tests/unit/store/scoreSlice.test.ts`:

- A page for another document is ignored.
- A page that is already cached is not replaced.
- `scoreAnalysed` fills only the missing pages.
- Failure clears the cache.
- Open and close reset it.
- Progress counts correctly.

Check: `pnpm test`, `pnpm test:types`. Still no UI change: nothing dispatches
the new actions yet.

## Phase 3: the analysis runner (listener middleware)

The runner reacts to `documentOpened` and keeps working over time, which is the
listener-middleware case in
`node_modules/@reduxjs/toolkit/skills/orchestrate-side-effects/handle-side-effects/SKILL.md`.

1. **Middleware setup** (in `makeStore`, `src/store/index.ts`). Create the
   middleware **inside** `makeStore(extraOverrides?)`, not at module level:
   `createListenerMiddleware({ extra: { openScoreDocument, analyzePage,
   finishAnalysis, documentBytes, ...extraOverrides } })`. `extra` is fixed when
   the middleware is created, so a module-level instance could never take test
   fakes, and it would be shared by every store (`StoreProvider` creates one per
   request via `useState(makeStore)`, and tests call `makeStore()` many times),
   sharing its listener registry and `cancelActiveListeners` state. `makeStore`
   `.prepend`s `listenerMiddleware.middleware` and then calls
   `registerAnalysisListeners(listenerMiddleware.startListening)` on that
   per-store instance. `src/store/analysis.listeners.ts` (Phase 3.3) exports
   `registerAnalysisListeners` and types its argument as
   `TypedStartListening<RootState, AppDispatch, AnalysisExtra>` (a type, imported
   with `import type`; `.withTypes` is a runtime method and cannot come from a
   type import). It imports nothing from `index.ts` at
   value level, so there is no import cycle. `AnalysisExtra` is exported from
   the listener module.
2. **Queue order**, as a pure function in `src/lib/pdf/analysisOrder.ts`:
   `nextPage(cached: ReadonlySet<number>, priority: readonly number[],
   total: number): number | null` returns, in order of preference:
   1. the first uncached index in `priority`;
   2. otherwise, the uncached index nearest to any priority index, with ties
      going forward (the reader is more likely to scroll down);
   3. otherwise, the lowest uncached index.

   Page 0 needs no special case: it is visible on open. Unit-test it in
   `tests/unit/lib/analysisOrder.test.ts`.
3. **The listener** (`registerAnalysisListeners` in
   `src/store/analysis.listeners.ts`), on `documentOpened`:
   - `listenerApi.cancelActiveListeners()`. A second open stops the first run.
   - Immediately after, read the bytes with `documentBytes(action.payload.id)`
     and bail out if they are absent: `const bytes = documentBytes(id); if
     (!bytes) return;` — dispatching **nothing**, before `openScoreDocument` or
     anything else in `extra` is touched. In the app the bytes are always held
     before the dispatch (`src/components/PDFPicker/PDFDropzone/PDFDropzone.tsx:143`), but
     `tests/unit/store/documentRestored.test.ts` dispatches `documentOpened`
     against a real `makeStore()` with no bytes ever held, so the listener must
     stay inert for that store rather than reach `loadPdfjs()` (which throws
     `DOMMatrix is not defined` under the unit suite's `node` environment) or
     dereference `null` bytes. A store with no document bytes held must never
     reach the real `extra`.
   - Fork a child that also races `take(documentClosed)` and cancels on close.
   - Open the document and dispatch `analysisStarted`.
   - Keep `detected: (PageStaves | undefined)[]` (length `numPages`, with `ink`
     and `text`) in the effect's closure, the same memory the current loop
     holds. This array, not `getState().score.pages`, is the record of what is
     finished: the store's pages have lost `ink`, `frames` and `text`, so a page
     present in the store but absent from `detected` could not feed
     `finishAnalysis`. Loop:
     1. Pick the next page: `nextPage(new Set(indices i where detected[i] !==
        undefined), getState().score.priority, numPages)`.
     2. Run `analyzePage`, store the result in `detected[i]`, then
        `dispatch(scorePageAnalysed(...toStoredPage))`.
     3. `await listenerApi.delay(0)`. This yields so the canvas renders and
        scroll events land, and a new `priority` is read on the next turn. It
        also throws on cancellation.
   - When `nextPage` returns `null` (every `detected[i]` is defined), dispatch
     `scoreAnalysed({ documentId, analysis: await finishAnalysis(doc,
     detected) })`.
   - On a `ScoreAnalysisError` or any other error, dispatch
     `scoreAnalysisFailed` with `getAnalyseScoreError(cause)`. Move that helper
     out of `src/components/PDFPicker/PDFDropzone/PDFDropzone.utils.ts` into
     `src/lib/pdf/`, and move the `COULD_NOT_ANALYZE` constant it depends on
     (from `src/components/PDFPicker/PDFDropzone/PDFDropzone.constants.ts`)
     there too, next to `ScoreAnalysisError`. Otherwise the listener would still
     reach into a component through that import. Update or delete the old
     imports in those two files. On cancellation (`TaskAbortError`), dispatch
     nothing.
   - Call `doc.destroy()` in `finally`.
4. **Remove the old trigger.** Delete `analyseScore` and its call in
   `src/components/PDFPicker/PDFDropzone/PDFDropzone.tsx`, and the imports that become unused. The restore ordering
   still holds: `documentRestored` is dispatched synchronously right after
   `documentOpened`, before the first `await` in the listener can complete, so
   `pendingOrdinals` is in place well before `scoreAnalysed`.

Tests in `tests/unit/store/analysisListener.test.ts`, using `makeStore` with a
fake `ScoreDocument` whose `analyzePage` resolves when the test lets it:

- Pages are dispatched in priority order.
- No page is analysed twice in one run, even when the priority changes
  mid-run.
- A page already in the store that this run did not analyse (e.g. seeded by a
  direct `scorePageAnalysed`) is still analysed by the run, so `finishAnalysis`
  gets a complete `detected` and `scoreAnalysed` fires instead of
  `scoreAnalysisFailed`.
- `scoreAnalysed` fires once, after the last page.
- A second `documentOpened` mid-run stops the first; no stale page lands.
- `documentClosed` mid-run stops it.
- An `analyzePage` error produces `scoreAnalysisFailed` and clears the cache.
- No bytes held for the opened document ⇒ the listener is inert: no
  `analysisStarted`, `scorePageAnalysed`, `scoreAnalysed` or
  `scoreAnalysisFailed` is dispatched. This is also what keeps
  `documentRestored.test.ts` passing unchanged, since it dispatches
  `documentOpened` on a real store with no bytes held.

Check: `pnpm test`, `pnpm test:types`, `pnpm test:e2e`. The overlay now fills
in page by page in document order. The e2e suite should pass unchanged, because
the panel still appears only on completion.

## Phase 4: feed the viewport into the priority

1. In `PageList.tsx`, the virtualizer's `onChange` already batches into one
   `requestAnimationFrame` (`syncFrame`). In the same frame, build the priority
   list from every **mounted** page, not just the one in view.
   `instance.getVirtualItems()` is the visible range widened by `overscan: 2`
   on each side (`defaultRangeExtractor`), plus the pinned page from
   `withPinned`. That is exactly the set of pages whose `ScoreOverlay` and
   `RegionLayer` are mounted and waiting on `selectOverlay`.
   - **Order matters.** `getVirtualItems()` comes back in index order, so the
     two overscan pages *above* the viewport would come before the page the
     reader is looking at, and `nextPage` takes the first uncached index.
     Order the list as follows instead:
     1. the visible pages, `instance.range.startIndex` to `endIndex`
        (`range` is the un-overscanned window; it can be `null` before the
        first measure, so fall back to the selected page);
     2. the overscan pages, nearest to the visible range first, with ties going
        forward (below before above);
     3. the pinned page, if it is not already in the list.
   - Map each index to `pages[index].sourceIndex`, dropping duplicates (a
     duplicated page shares a source index, and so shares its cache entry).
   - Put the ordering in `PDFViewer.utils.ts` as
     `analysisPriority(range, items, pinnedIndex)` and unit-test it, including
     a range at the top and bottom of the list where overscan is clipped.
   - Dispatch `analysisPrioritised` **only when the list differs** from the
     last one sent: keep the last list in a ref and compare element by element.
     Scrolling within a page must not dispatch.
   - **Reset the ref when the document changes.** `analysisPrioritised`'s state
     resets on `documentOpened`, but `PDFViewer` and `PageList` are not keyed
     and can stay mounted across documents. Read `selectDocumentId` in
     `PageList` and clear the ref when it changes (or key `PageList` on
     `documentId`), so an identical first list for the new document is still
     sent rather than treated as unchanged.
2. Stop dispatching once analysis is complete
   (`selectAnalysis(state) !== null`). Nothing reads the priority after that.
3. Keep this out of `selectPageInView`. That function is about selection and
   has its own echo-suppression rules. Write a sibling function called from the
   same frame callback.

Check: open the largest fixture, scroll straight to the last page, and watch
its overlay appear before the middle pages' do. Add an e2e test to
`tests/e2e/load-pdf.spec.ts`: open the multi-page fixture, scroll to the last
page right away, and assert `ScoreOverlay` (or a staff hint) is visible on
`[data-page-index="<last>"]`. It holds either way on a small fixture, but it
guards the wiring. No visual assertion: the state is transient, so a screenshot
would only capture timing.

## Phase 5: progress in the loading state

1. `LoadingStaves` (`src/components/PDFEditor/Messages.tsx`) reads
   `selectAnalysisProgress`. When the total is known, append the progress, as in
   "Looking for staves... 12 of 80 pages". Put the format function in
   `PDFEditor.constants.ts`/`.utils.ts`, following the component-file-layout
   convention.
2. When every page is cached but `analysis` is still null, the document-level
   pass is running. Show "Reading markings..." so the panel doesn't seem stuck
   at "80 of 80".

Check: unit-test the formatter. Look for existing e2e assertions on
`LOADING_STAVES` text (there are none today, but check for new ones). Use a
substring match so the progress suffix doesn't break them.

---

## Order of work and checks

| Phase | Shippable alone? | Check |
|-------|------------------|-------|
| 0 Measure | not committed | numbers recorded here |
| 1 Split `analyzeScore` | yes, no change | unit, types; no test edits |
| 2 Page cache | yes, unused until 3 | unit |
| 3 Listener runner | yes, overlay fills in document order | unit, e2e green unchanged |
| 4 Viewport priority | with or after 3 | manual + new e2e |
| 5 Progress text | yes | unit |

Run `pnpm test:types`, `pnpm check`, `pnpm test` and `pnpm test:e2e` after each
phase.

## Risks and open questions

- **Annotations become interactive before analysis completes.** `ScoreOverlay`
  is interactive whenever region editing is off, so restored annotations on an
  analysed page can be dragged or retitled before the panel appears. That is
  safe: the annotations slice doesn't depend on analysis, and placing new ones
  still needs the panel's tools. It is still a behaviour change. Check that
  keyboard shortcuts (copy, paste, delete, undo) behave with no panel mounted.
- **Overlay pop-in.** Staff hints appear page by page, and their part names stay
  blank until completion (`selectStaffHints` reads `selectParts`, which still
  comes from `analysis`). Acceptable for v1; Follow-up A resolves names early.
- **Failure arrives late.** A page over `MAX_PAGE_OPERATORS` used to fail before
  anything showed. Now it can fail after the overlay has appeared on other
  pages, and the overlay disappears. **Decision for the author:** keep
  "fail the whole document" (this plan), or skip that page and warn (Follow-up
  E).
- **Main-thread time is unchanged.** `detectPageStaves` still runs on the main
  thread, one page per macrotask. The `delay(0)` yield keeps scrolling
  responsive between pages, but not during a heavy page.
- **The PDF is parsed twice**, once by react-pdf and once by the runner, as
  today. Sharing react-pdf's `PDFDocumentProxy` is Follow-up D. It needs the
  runner to start from `PDFViewerContent`'s `onLoadSuccess`, not from
  `documentOpened`.
- **Dispatch volume.** A 300-page score means 300 `scorePageAnalysed`
  dispatches. Each one re-runs `selectSourcePageAt` (a lookup) for every
  mounted page, and the downstream memos hit. `selectDetectedRegions` doesn't
  depend on `pages`. The dev-only checks are exempted in Phase 2.4.

## Follow-ups

### Follow-up A: unlock per-page tools before completion

- Resolve parts once a **contiguous prefix** of pages is cached and contains a
  system with staves. That prefix is usually page 0, sometimes after a title
  page. Have `nextPage` favour the prefix until then.
- Move the `pendingOrdinals` reconciliation into a new `scorePartsDetected`.
- Show `EditScorePanel` early with annotation tools enabled. Disable region
  editing, extract and the markings export until complete, with a "Finishing
  analysis" hint.
- Make `regions.slice.ts:54` `editable()` safe regardless: either refuse edits
  until complete, or merge in detected regions for pages that arrive later.
  Without this, an early region edit drops regions from unanalysed pages.

### Follow-up B: persistent cache

Store the finished `ScoreAnalysis` in IndexedDB, keyed by a SHA-256 of the
bytes plus an `ANALYSIS_VERSION` constant. Bump that constant on any change to
detection or markings. On open, a hit dispatches `scoreAnalysed` straight away
and the runner skips. This makes reopening a large score instant and composes
with the page cache.

### Follow-up C: detection in a Web Worker

Run `analyzePage` in a dedicated worker (`collectGeometry` onward is pure data)
so a heavy page can't drop frames. Post back the stripped page plus `ink` and
`text` for the final pass.

### Follow-up D: one pdf.js document

Run analysis against react-pdf's `PDFDocumentProxy` and pipeline
`getOperatorList` for page *n+1* while page *n* is being detected.

### Follow-up E: per-page failure

Treat a page over `MAX_PAGE_OPERATORS` as "no staves on this page" and report it
next to the irregular systems, instead of failing the document.
