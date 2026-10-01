# Virtualized continuous page scroll

## Goal

Replace the one-page-at-a-time viewer (`PDFViewerContent` + `useScrollEdgePaging`)
with a continuous, virtualized list of pages using `@tanstack/react-virtual`
(already a dependency). Scrolling should feel like a native PDF viewer: no
blank gap or layout shift when the next or previous page comes into view.

## Non-goals

- Zoom. Page width stays `usePageWidth(stage)`.
- Virtualizing the thumbnail strip (follow-up, see the end).
- Any change to staff detection, analysis, or save/export.

## Current state (what we are unwinding)

- `PDFViewerContent.tsx` renders a single `<Page>` for `selectSelectedPage`, plus
  one `ScoreOverlay` and one `RegionLayer`.
- `useScrollEdgePaging` turns a wheel push past the top or bottom edge into a
  `pageSelected` dispatch, then pins the scroll to the opposite edge.
- Every overlay selector is derived from the selected page:
  `selectSourcePage`, `selectOverlay` and `selectStaffHints` in
  `src/store/selectors.ts`. Consumers: `ScoreOverlay`, `Annotations`,
  `AnnotationCursorPreview`, `StaffHints`, `RegionLayer`, `Region`.
- `PDFPageStrip` smooth-scrolls the selected thumbnail into view on every
  selection change.

---

## Phase 1: make the overlays page-addressed (no visible change)

Make every overlay render for an explicit page instead of "the selected page".
After this phase the UI behaves the same and every test passes unchanged.

1. **Selectors** (`src/store/selectors.ts`)
   - Add `selectSourcePageAt(state, sourceIndex)` that reads
     `analysis?.pages[sourceIndex]`.
   - Change `selectOverlay` to take `(state, sourceIndex, pageWidth)` and
     derive from `selectSourcePageAt`. `pageIndex` becomes `sourceIndex`.
   - Change `selectStaffHints` to `(state, sourceIndex, pageWidth)`.
   - Keep `selectSelectedPage`; only the viewer and strip use it.
   - Memoization: RTK 2's `createSelector` defaults to `weakMapMemoize`, which
     caches per argument tuple, so several mounted pages won't evict each
     other. Add a unit test in `tests/unit/` showing that two interleaved calls
     with different `sourceIndex` each return a stable reference, so a
     regression to `lruMemoize` gets caught.
2. **Page context.** Add `src/components/PDFViewer/PageContext.tsx` exporting
   a `PageContext` of `{ sourceIndex: number; pageWidth: number }` plus a
   `usePageContext()` hook that throws outside a provider. This saves threading
   `sourceIndex` through `Annotations`, `StaffHints`, `AnnotationCursorPreview`
   and `Region`. Keep the explicit `pageWidth` prop only where the code already
   reads it from props, or replace those props with the context. Pick one way
   and use it everywhere.
3. **Consumers.** Switch `ScoreOverlay`, `Annotations`,
   `AnnotationCursorPreview`, `StaffHints`, `RegionLayer` and `Region` to read
   `sourceIndex` from context and pass it to the selectors.
4. **Viewer.** Wrap the single existing page in
   `<PageContext value={{ sourceIndex: selectedPage.sourceIndex, pageWidth }}>`.

Check: `pnpm test`, `pnpm test:types`, `pnpm test:e2e`, all green with no test
edits.

## Phase 2: page sizes before render

The virtualizer needs every page's exact height up front. Otherwise pages above
the viewport resize as they render, and the content jumps when scrolling up.

1. Add `src/hooks/usePageSizes.ts`. Given the pdf.js `PDFDocumentProxy` from
   `<Document onLoadSuccess>`, load every page with
   `sizes[i] = (await pdf.getPage(i + 1)).getViewport({ scale: 1 })`
   (`getPage` is 1-based and async; `i` stays the 0-based **source** index) and
   return `Array<{ width: number; height: number }>`, indexed by source index.
   Fetch in parallel with `Promise.all`; it reads only metadata, with no
   rasterization.
2. Hold the proxy in `PDFViewerContent` state (`onLoadSuccess={setPdf}`).
   Don't use `analysis.pages[i].width/height`: analysis arrives later, and the
   viewer has to lay out before it does (the `LoadingStaves` state).
3. Height of a page at the rendered width:
   `pageWidth * size.height / size.width`. Put this in
   `PDFViewer.utils.ts` as `renderedHeight(size, pageWidth)`, with a unit
   test.
4. If a pdf.js page reports `rotate`, use the rotated viewport. pdf.js
   `getViewport` already applies `/Rotate`, so this is only worth a test case,
   not extra code.

## Phase 3: the virtualized list

1. Delete `src/hooks/useScrollEdgePaging/` (both files). Remove the import and
   the `turnPage` function from `PDFViewerContent`. Also delete
   `tests/unit/lib/scrollEdgePaging.ts`: it is a `.ts` file, so
   `vitest.config.ts`'s `include: ['tests/**/*.test.ts']` never runs it and
   `pnpm test` stays green either way, but it imports
   `#/hooks/useScrollEdgePaging/useScrollEdgePaging.utils`, which `tsconfig.json`
   covers, so `pnpm test:types` fails with TS2307 the moment the hook is gone.
   (If the "paged view mode" option under Risks is taken instead, keep both
   files and rename the test to `scrollEdgePaging.test.ts` so it actually runs.)
   While here, double-check Phase 6's new unit tests are named `*.test.ts` —
   the sibling `stampRecorder.ts` naming invites the same silent-skip mistake.
2. **E2E fixture scoping (prerequisite for this phase landing green).** The
   shared locator `.isolate .react-pdf__Page__canvas` isn't only in
   `annotations.spec.ts:242` — it's in `tests/e2e/fixtures/AppPage.ts` inside
   `waitForCanvas` (`:44`, `toBeVisible()` then `.evaluate()`) and `clickOnPage`
   (`:229`, `.boundingBox()`), with 30 call sites across six specs
   (`unsaved-changes`, `annotations`, `part-extraction`, `load-pdf`,
   `markings-export`, `edited-regions`). Once several `<Page className="isolate">`
   are mounted (Phase 3.4 keeps that class, and the fixture PDF is 6 pages),
   that locator resolves to ≥3 elements with overscan 2, and `toBeVisible()`,
   `boundingBox()` and `evaluate()` are all strict-mode single-element calls —
   every one of those 30 call sites throws. Fix `AppPage.waitForCanvas` and
   `AppPage.clickOnPage` to scope to one page (`[data-page-index="0"]`, or a
   parameterized `viewerPage(n)` helper), and make `clickOnPage` target the
   currently selected page. Do this as part of landing Phase 3, not deferred to
   Phase 6 — Phase 6 only needs to extend the same helper to cover
   `getTestId('ScoreOverlay')`/region locators if any new ones are added (none
   exist in e2e today).
3. New component `src/components/PDFViewer/PageList.tsx`:
   - Gate rendering on `sizes.length === pdf.numPages && pageWidth` (both
     `usePageSizes` and `usePageWidth` are async/measured, so `pageWidth` is
     `number | undefined` and `sizes` starts empty) — keep showing the
     `RENDERING` message until both are ready, same as the current
     `pageWidth &&` guard in `PDFViewerContent.tsx:83`.
   - `useVirtualizer({ count: pages.length, getScrollElement: () => stage,
     estimateSize: (i) => renderedHeight(sizes[pages[i].sourceIndex], pageWidth),
     getItemKey: (i) => pages[i].id, gap: PAGE_GAP, paddingStart: PAGE_GAP,
     paddingEnd: PAGE_GAP, overscan: 2 })`.
   - Sizes are exact, so do **not** use `measureElement`.
   - When `pageWidth` or `pages` changes, call `virtualizer.measure()` so cached
     sizes are thrown away. Pages are keyed by `page.id`, so reorder and delete
     carry the right size.
   - Render an outer `div` sized to `getTotalSize()`, with each virtual item
     absolutely positioned (`translateY(item.start)`) and horizontally centred
     (keep `mx-auto w-fit` from `PAGE_FRAME_CLASS`).
4. New component `src/components/PDFViewer/ViewerPage.tsx` (one item):
   - `data-page-index={index}`, `data-source-index={page.sourceIndex}` and
     `aria-label={`Page ${index + 1}`}`, for tests and accessibility.
   - A fixed-size frame (`width: pageWidth`, `height: renderedHeight`) with a
     white background and the existing shadow, so a page that hasn't rendered
     yet is a blank sheet of the right size, never a collapsed box.
   - Inside: the existing `<Page … className="isolate" loading={null}>`, then
     `ScoreOverlay` and `RegionLayer`, all wrapped in `PageContext`.
   - Wrap in `memo`. Scrolling re-renders the list on every frame, and pages
     whose props haven't changed must not re-render.
5. Styles (`PDFViewer.styles.ts`): `STAGE_CLASS` loses only its **vertical**
   padding (the virtualizer's `paddingStart`/`paddingEnd`/`gap` apply along the
   scroll axis only, i.e. vertically). Keep the horizontal half as `px-4`:
   `usePageWidth` computes `Math.min(stageWidth - 32, MAX_PAGE_WIDTH)` over
   `useElementWidth`'s `contentRect.width`, which already excludes padding, so
   dropping `p-4` entirely would widen `contentRect` by 32px, render every page
   below the 900px cap 32px wider than today, and shift `overlay.scale` with
   it — a page-width change, not just a padding change, and it's what
   `annotation-placement-precision.png` would actually be measuring. Add a
   `PAGE_GAP = 16` constant in `PDFViewer.constants.ts`.
6. Overscan of 2 means each page is rasterized off-screen before it scrolls
   into view, which is what removes the gap. Leave a comment saying so, since
   that is the non-obvious reason the number matters.

## Phase 4: syncing the selection with the scroll

`selectedPageId` now means "the page the reader is on". It drives the strip
highlight, which page `useAnnotationKeyboard` falls back to, and any logic that
picks a page after a delete.

1. **Scroll → selection.** In `PageList`, after each scroll (the virtualizer's
   `onChange`, throttled to an animation frame), choose the visible page that
   covers the viewport's vertical centre. If it differs from the selection,
   dispatch `pageSelected(id, { source: 'scroll' })`.
   - Add the `source` to the action through a `prepare` callback in
     `document.slice.ts`. Store it as `selectionSource: 'scroll' | 'user'`.
     The reducer ignores it otherwise.
2. **Selection → scroll.** In `PageList`, react to `selectedPageId` changes only
   when `selectionSource !== 'scroll'`, and call
   `virtualizer.scrollToIndex(index, { align: 'start' })`. This is meant to
   cover thumbnail clicks, the selection fix after delete, undo and reset — but
   `pageDeleted`, `documentReset` and `undone` in `document.slice.ts` all
   re-point the selection through `keepSelectionValid`, which assigns
   `state.selectedPageId` directly rather than going through `pageSelected`'s
   `prepare`, and `documentOpened` does the same. Left alone, `selectionSource`
   stays `'scroll'` after any scroll (the normal resting state in a continuous
   viewer) and the effect above never fires for delete, undo, reset or load.
   Fix it one of two ways:
   - Set `selectionSource = 'user'` inside `keepSelectionValid` and
     `documentOpened` as well, so every non-scroll re-point is covered; or
   - drop `selectionSource` from the store entirely and guard the effect with a
     ref in `PageList` holding the index the scroll handler itself last
     dispatched — comparing `selectedPageId` against that ref tells you whether
     the change originated here, without persisting "where did this come from"
     in the document slice. Prefer this if it turns out simpler in practice.
3. **Strip.** Keep `scrollIntoView` in `PDFPageStrip` but use
   `behavior: 'auto'` when `selectionSource === 'scroll'`. Stacked smooth
   scrolls while the main view is moving look broken.
4. **Loop check.** Write a unit test for the reducer: selecting from scroll and
   then from the user flips `selectionSource`. Test the "no scroll-back" rule
   with an e2e test (Phase 6).

## Phase 5: page lifetime during interactions

1. **Pin the page being worked on.** Give the virtualizer a custom
   `rangeExtractor` that adds to the default range:
   - the page that owns the annotation being edited or dragged, and
   - the page with an in-progress region drag.

   `rangeExtractor` returns *virtual list* indices, but the only page identity
   `ScoreOverlay`/`RegionLayer` has is `overlay.pageIndex`
   (`selectedPage.sourceIndex`). `PageEdit` is `{ id, sourceIndex }` with both
   minted once at load, and `movePage`/`removePage` reorder and filter the page
   array without renumbering `sourceIndex` — so after one move or delete, list
   index ≠ source index, and pinning by source index would silently keep the
   wrong page mounted. Expose the pin by moving the "active interaction page"
   into the store as a small `tool.slice` field holding the page **id**
   (`activePageId: string | null`), not an index. `ScoreOverlay` and
   `RegionLayer` set it on drag or edit start and clear it on end or cancel.
   `PageList` resolves it to a list index with `pages.findIndex(p => p.id ===
   activePageId)` before adding it to the range. Without this, scrolling away
   mid-edit unmounts `ScoreOverlay` and its local `draft` state is lost. Return
   the extra indices deduped and in ascending order — `virtual-core` assumes a
   sorted range.
2. **Stale rectangle during a drag.** `ScoreOverlay` and `RegionLayer` cache
   `surfaceBox` at pointer-down. Remove the cache and call
   `getBoundingClientRect()` on each `pointermove`. It is cheap, and a wheel
   scroll during a drag moves the surface. Keep the existing comment's point
   about clearing stale state, but the cache itself goes.
3. **Pointer and paste.** `useScorePointer` already records `pageIndex`, so
   paste lands on the hovered page. Clear it in `onPointerLeave`, as today.
   No change needed beyond checking it with several pages mounted.

## Phase 6: tests

Unit (`tests/unit/`):
- Page-addressed selectors stay stable across interleaved `sourceIndex` calls.
- `renderedHeight`.
- `selectionSource` in the document slice.

E2E (`tests/e2e/`):
- The shared-fixture scoping fix (`AppPage.waitForCanvas` / `clickOnPage`) is a
  prerequisite handled in Phase 3.2, not here. This phase only needs to extend
  the same `viewerPage(n)` helper to any new `ScoreOverlay`/region locators the
  new spec below introduces — there are none pre-existing in e2e today.
- New `tests/e2e/page-scroll.spec.ts` with a multi-page fixture:
  - Scrolling the stage selects the page in view (strip `aria-current`
    follows).
  - Clicking thumbnail N scrolls page N to the top.
  - An annotation placed on page 2 stays on page 2 after scrolling to page 4
    and back.
  - Start editing an annotation, scroll it out of view and back: the draft is
    still there (covers the Phase 5 pin).
  - Delete the selected page: the view lands on the new selection.
  - Visual assertion, guarded on the `visual` project, after the first scroll:
    `page-scroll-continuous.png`.

Visual baselines: every existing screenshot changes, because the stage padding
and layout change and several pages are now visible. Don't regenerate locally.
After pushing, put the **`update-snapshots`** label on the PR so CI regenerates
and commits them. Review the regenerated images in the PR diff.

## Order of work and checks

| Phase | Shippable alone? | Check |
|-------|------------------|-------|
| 1 Page-addressed overlays | yes, no UI change | unit + e2e green, no test edits |
| 2 Page sizes | yes, unused until 3 | unit |
| 3 Virtualized list | no, ship with 4 | manual scroll, unit, test:types |
| 4 Selection sync | with 3 | e2e page-scroll |
| 5 Interaction pinning | yes, but needed before release | e2e draft survives |
| 6 Test updates | with 3–5 | full e2e, then CI visual |

Run `pnpm test:types`, `pnpm check`, `pnpm test` and `pnpm test:e2e` after each
phase.

## Risks and open questions

- **Product question:** was paged, one-page-at-a-time viewing deliberate
  (turning pages at a music stand)? If so, make continuous scroll a view mode
  and keep `useScrollEdgePaging` for paged mode instead of deleting it.
- **Canvas memory:** about 17 MB per page at 900px and a device pixel ratio of
  2. Visible pages plus an overscan of 2 come to about 6 canvases. Don't raise
  overscan without checking iOS Safari.
- **Fast scrollbar drags** still show blank pages briefly, as native viewers
  do. Accepted.
- **Mixed page sizes** are handled by per-page `estimateSize`. A
  landscape page in a portrait score is capped by `MAX_PAGE_WIDTH`, so it's
  shorter. That's fine, but worth testing by eye with such a file.

## Follow-ups (not in this plan)

- Virtualize `PDFPageStrip`. It currently rasterizes every thumbnail on load.
- Zoom, anchoring the scroll to the current page when `pageWidth` changes.
- Keyboard PageUp/PageDown snapping to page starts.
