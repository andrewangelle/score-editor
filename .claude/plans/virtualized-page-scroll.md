# Virtualized continuous page scroll

## Goal

Replace the one-page-at-a-time viewer (`PDFViewerContent` + `useScrollEdgePaging`)
with a continuous, virtualized list of pages using `@tanstack/react-virtual`
(already a dependency). Scrolling should feel like a native PDF viewer: no
blank gap or layout shift when the next or previous page comes into view.

## Non-goals

- Zoom. Page width stays `usePageWidth(stage)` (Follow-up B).
- Virtualizing the thumbnail strip (Follow-up A).
- Keyboard paging (Follow-up C).
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

## Follow-ups

Each of these ships on its own after Phases 1–6 have landed, in the order
A, B, C: B's tall pages are what make C's within-page stepping necessary, and
A is independent of both. They lean on pieces the main plan builds —
`usePageSizes`, `renderedHeight`, the scroll → selection sync and the
`activePageId` pin; the table at the end lists which.

### Follow-up A: virtualize `PDFPageStrip`

Today every thumbnail mounts a `<Page>` on load, so a 40-page score
rasterizes 40 canvases before the reader has scrolled anywhere.

1. **One scroll container.** `PAGE_NAV_CLASS` (the `<nav>`) and
   `PAGE_LIST_CLASS` (the `<ol>`, `h-full`) both set `overflow-y-auto`, so
   which one actually scrolls depends on the `<ol>`'s height resolving. Make the
   `<nav>` the only scroller: drop `overflow-y-auto` and `h-full` from
   `PAGE_LIST_CLASS`, and give the virtualizer the nav element
   (`getScrollElement: () => nav`). `PDFViewerContent` owns the `<nav>`, so
   either move the `<nav>` into `PDFPageStrip` or pass its element down via a
   `useState` ref setter, the same way `stage` is handled.
2. **Sizes.** Pass `sizes` (from Phase 2's `usePageSizes`) into
   `PDFPageStrip` as a prop. Thumbnail canvas height is
   `renderedHeight(sizes[page.sourceIndex], THUMBNAIL_WIDTH)`. Move
   `THUMBNAIL_WIDTH` to a `PDFPageStrip.constants.ts`.
3. **Fixed-size canvas slot.** `<Page loading="">` has zero height until it
   renders. Give the `<span>` around it an explicit
   `style={{ width: THUMBNAIL_WIDTH, height: thumbHeight }}` so an unrendered
   thumbnail is a blank card of the final size — the same rule as Phase 3.4's
   `ViewerPage` frame.
4. **Virtualizer.** Unlike the main view, the strip item also contains the
   label and the ↑ ↓ ✕ controls, whose height depends on CSS and font
   metrics. So here *do* use `measureElement`, with
   `estimateSize: (i) => thumbHeight(i) + THUMB_CHROME` as the starting guess.
   Measure `THUMB_CHROME` once by eye and put it in the constants file;
   because the canvas slot is fixed (step 3), the measured height equals the
   estimate in practice and items never jump. Options:
   `{ count: pages.length, getItemKey: (i) => pages[i].id, gap: 12,
   paddingStart: 12, paddingEnd: 12, overscan: 6 }` (`gap`/padding replace the
   `gap-3 p-3` in `PAGE_LIST_CLASS`; keep `px-3`). Thumbnails are ~250 KB of
   canvas each at a device pixel ratio of 2, so the larger overscan is cheap.
5. **Markup.** Keep `<ol>` / `<li>` for list semantics. The `<ol>` becomes the
   `getTotalSize()`-tall, `position: relative` inner box; each `<li>` is
   absolutely positioned with `translateY(item.start)`, carries
   `ref={virtualizer.measureElement}` and `data-index={item.index}`, and gets
   `aria-setsize={pages.length}` and `aria-posinset={index + 1}`, since screen
   readers now only see the mounted subset.
6. **Keep the selected thumbnail in view.** The current `scrollIntoView` on
   `selectedItem` breaks once the selected `<li>` may not be mounted (the ref
   is `null`). Replace it with
   `virtualizer.scrollToIndex(selectedIndex, { align: 'auto', behavior })`,
   where `behavior` is `'auto'` when the selection came from the main view's
   scroll and `'smooth'` otherwise (the Phase 4.3 rule, carried over). Drop the
   `selectedItem` ref.
7. **Don't drop focus.** A keyboard user tabbing through the ↑ ↓ ✕ buttons can
   move focus onto an item, then scroll the strip so it leaves the overscan;
   the item unmounts and focus falls to `<body>`. Track the focused page id
   with `onFocus`/`onBlur` on the `<ol>` (they bubble in React) and pin it with
   a `rangeExtractor`, same shape as Phase 5.1: resolve id → index with
   `findIndex`, merge into the default range, dedupe, sort ascending. Also pin
   the selected index, so `aria-current` always exists in the DOM for tests
   and assistive tech.
8. **Move/delete.** Items are keyed by `page.id`, so `pageMoved` and
   `pageDeleted` reuse the right measured size. No extra `measure()` call
   needed, unlike the main view, because thumbnail width never changes.

Tests:
- Unit: none new beyond `renderedHeight` (already covered in Phase 6).
- E2E, added to `page-scroll.spec.ts` (no existing spec touches the strip):
  - Scroll the main view to the last page: the strip's last thumbnail is
    mounted, visible within the `<nav>`, and has `aria-current="true"`.
  - Fewer `<li>` than pages are mounted at the default viewport, with a
    fixture that has enough pages to overflow the strip. If the 6-page
    fixture doesn't overflow at 720px, add a longer fixture rather than
    shrinking the viewport.
  - Focus "Move page 1 down", scroll the strip to the bottom with the mouse
    wheel, press Enter: page 1 moves (focus was not lost).

### Follow-up B: zoom, anchored to the current page

1. **State.** Zoom controls live in the header (`PDFEditorActions`) while the
   page width is computed in `PDFViewerContent`, two separate subtrees. Add
   `src/store/viewer.slice.ts` with `zoom: number` (default `1`) and actions
   `zoomIn`, `zoomOut`, `zoomReset`, stepping through
   `ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]`. Reset to `1` on
   `documentOpened` and `documentClosed`, matching how `tool.slice.ts` handles
   them. Not part of undo, not saved.
2. **Width.** Change `usePageWidth(stage, zoom)` to
   `Math.round(fitWidth * zoom)` where
   `fitWidth = Math.min(stageWidth - 32, MAX_PAGE_WIDTH)` is today's value.
   `MAX_PAGE_WIDTH` caps the zoom-1 width only, so zooming in can go past it.
   Everything downstream (`renderedHeight`, `selectOverlay`'s `scale`,
   `selectStaffHints`) already takes `pageWidth` as an input, so overlays
   follow without changes.
3. **Horizontal overflow.** Once `pageWidth` exceeds the stage's content
   width, absolutely positioned items can't use `mx-auto` to centre. Give
   `PageList`'s inner box `width: max(100%, pageWidth)` and position items at
   `left: max(0, (innerWidth - pageWidth) / 2)`, so the stage's existing
   `overflow-auto` produces a horizontal scrollbar instead of clipping the
   page's left edge.
4. **Anchoring.** When `pageWidth` changes, every item start moves. Keep the
   point under the viewport centre fixed:
   - Add pure helpers to `PDFViewer.utils.ts`:
     `captureAnchor(items, scrollTop, scrollLeft, viewport, pageWidth)` →
     `{ pageId, fy, fx }`, where `fy` is the fraction down the page at the
     viewport's vertical centre and `fx` the fraction across it at the
     horizontal centre; and `restoreAnchor(anchor, items, viewport, pageWidth)`
     → `{ top, left }`. Anchor by **page id**, not list index, for the same
     reason as Phase 5.1.
   - Phase 4.1's scroll handler already finds the page covering the vertical
     centre on every frame. Have it also write `captureAnchor(...)` into an
     `anchorRef`, tagged with the `pageWidth` it was measured at.
   - In `PageList`, a `useLayoutEffect` on `[pageWidth]` runs after Phase
     3.3's `virtualizer.measure()`: if `anchorRef.current.pageWidth !==
     pageWidth`, set `stage.scrollTop`/`scrollLeft` from `restoreAnchor(...)`
     (or `virtualizer.scrollToOffset(top)` plus a direct `scrollLeft`). Doing it
     in a layout effect means the reader never sees the unanchored frame.
   - The browser may clamp `scrollTop` and fire `scroll` between the width
     change and the layout effect. Ignore scroll events in the handler while
     `anchorRef.current.pageWidth !== pageWidth`, otherwise the clamped
     position overwrites the anchor.
   - The same path fixes a jump that exists today: resizing the window changes
     `pageWidth` too, and is now anchored as well.
5. **Inputs.**
   - Header: `−`, a percentage readout that resets on click, `+`, as
     `ToolbarButton`s with `data-testid="ToolbarButton-ZOOM_OUT"` etc.
   - Keyboard: Ctrl/Cmd + `=`/`+`, `-`, `0`, in a new `useZoomKeyboard` hook
     called next to `useAnnotationKeyboard` in `PDFViewer.tsx`. Always
     `preventDefault()` so the browser's page zoom doesn't also fire. Pull the
     `INPUT`/`TEXTAREA`/`isContentEditable` guard out of
     `useAnnotationKeyboard` into a shared `isTypingTarget(target)` helper and
     use it in both.
   - Ctrl + wheel (also what a trackpad pinch emits): a non-passive `wheel`
     listener on the stage that calls `preventDefault()` and steps zoom. For
     this input, anchor at the pointer position instead of the viewport centre
     (`captureAnchor` takes the anchor point as a parameter for this reason).
     Accumulate `deltaY` and step once per ~100px so a pinch doesn't skip
     through every level in one gesture.
6. **Canvas memory.** At zoom 3 on a 900px page with a device pixel ratio of 2
   a canvas is ~5400 × 7000 px, which is ~150 MB and beyond iOS Safari's
   16.7-megapixel-per-canvas limit, so the page renders blank. Pass react-pdf's
   `devicePixelRatio` prop on the main-view `<Page>`, capped so
   `(pageWidth * dpr) * (height * dpr) <= MAX_CANVAS_PIXELS` (16_000_000), and
   scale overscan down with zoom (`overscan: zoom > 1.5 ? 1 : 2`). Update the
   Risks entry on canvas memory to match.
7. **Pinned pages.** A zoom during an annotation drag changes the scale under
   the pointer. Disable zoom while `activePageId` (Phase 5.1) is set rather
   than trying to rescale an in-flight drag.

Tests:
- Unit: `captureAnchor`/`restoreAnchor` round-trip at several widths, with an
  anchor on a middle page, on the last page and in a gap between pages; zoom
  stepping clamps at both ends of `ZOOM_LEVELS`; the DPR cap.
- E2E (`page-zoom.spec.ts`):
  - Scroll so page 3 covers the viewport centre, zoom in twice: page 3 still
    covers the centre and remains the selected thumbnail.
  - Zoom to 200%: the stage scrolls horizontally, and an annotation clicked at
    a known point on the page lands at the same page-relative position as at
    100% (run `clickOnPage` at both zooms and compare stored coordinates).
  - Ctrl/Cmd + `0` returns to 100%.
  - Visual assertion, guarded on the `visual` project, at 200%:
    `page-zoom-200.png`. Baseline generated in CI as with the other screenshots.

### Follow-up C: PageUp/PageDown snapping to page starts

Native PageDown scrolls the stage by roughly one viewport, which lands
mid-page. With page-sized steps, a reader at a music stand turns exactly one
page per press.

1. **Step function.** Add `pageStepTarget(items, scrollTop, viewportHeight,
   direction, gap)` to `PDFViewer.utils.ts`, pure and unit-tested. `items` is
   the virtualizer's `measurementsCache` (start and size for *every* page, not
   only the mounted ones). Rules:
   - **Down:** the target is the next page start below the current top
     (`item.start - gap`, so the gap shows above the page). If the current
     page's remaining height below the viewport is more than one viewport —
     only possible once Follow-up B allows tall pages — step by
     `viewportHeight - OVERLAP` (`OVERLAP = 48`) within the page instead, so
     no music is skipped.
   - **Up:** if the current page's start is above the viewport top by more
     than `gap`, go to that page's start first (as PDF viewers do); otherwise
     go to the previous page's start. The same within-page rule applies for
     tall pages in reverse.
   - **Home / End:** the first page's start, the last page's start.
   - Clamp to `[0, totalSize - viewportHeight]`.
2. **Key handling.** A new `usePageKeyboard(virtualizer, stage)` hook called
   from `PageList` (which owns the virtualizer). Listen on `document`, because
   the stage is a plain `div` that never holds focus, and act only when:
   - the key is PageDown, PageUp, Space, Shift+Space, Home or End, with no
     Ctrl/Cmd/Alt;
   - `isTypingTarget(event.target)` is false (the helper from Follow-up B; if C
     lands first, introduce it here);
   - the target is `<body>` or inside the stage — not inside the strip's
     `<nav>` (where Space activates the focused button), the header, or an
     open `AnnotationValueMenu`;
   - no drag is in progress (`activePageId === null`).

   Then `preventDefault()` and `virtualizer.scrollToOffset(target, {
   behavior })`.
3. **Repeated presses.** With `behavior: 'smooth'`, a second press arrives
   while the first scroll is still moving, and computing from the live
   `scrollTop` lands short. Keep a `pendingTarget` ref: base the next step on
   it if set, and clear it when the virtualizer's `isScrolling` goes false.
   Use `'auto'` when `prefers-reduced-motion: reduce` matches.
4. **Selection.** Don't dispatch `pageSelected` from the key handler. The
   Phase 4.1 scroll → selection sync updates the strip as the scroll lands; a
   `pageSelected({ source: 'user' })` here would trigger the Phase 4.2
   selection → scroll effect and scroll a second time.
5. **Focusable stage (accessibility).** Add `tabIndex={0}`, `role="region"`
   and `aria-label="Score"` to the stage, so keyboard-only users can put focus
   there and the keys are discoverable. Native arrow-key scrolling inside the
   stage is left alone.
6. **Paged-mode interaction.** If the Risks product question ends with a paged
   view mode that keeps `useScrollEdgePaging`, the hook should map PageDown /
   PageUp to `turnPage(±1)` in that mode instead. Note it here so the two don't
   fight over the same keys.

Tests:
- Unit (`tests/unit/pageStep.test.ts`): `pageStepTarget` for a page start
  aligned at the top, mid-page, inside the gap between pages, on the first and
  last pages (no-ops at the ends), and a page taller than two viewports
  (within-page steps both ways). Name it `*.test.ts` (see Phase 3.1).
- E2E (in `page-scroll.spec.ts`):
  - From the top, PageDown: `[data-page-index="1"]`'s top is `PAGE_GAP` below
    the stage's top (±1px), and the strip's `aria-current` moves to Page 2.
  - End, then PageUp twice: page N−2 at the top.
  - With focus in the strip, Space activates the focused button and does not
    scroll the stage.
  - With a text annotation's input focused, PageDown does nothing to the
    stage.

### Order and checks

| Follow-up | Depends on | Check |
|-----------|------------|-------|
| A Virtualized strip | Phases 2, 4 | unit + e2e strip cases |
| B Zoom | Phases 3–5 | unit anchor round-trip, e2e zoom, CI visual |
| C Page keys | Phases 3–5 (tall-page rule needs B) | unit step function, e2e keys |

As with the main phases, run `pnpm test:types`, `pnpm check`, `pnpm test` and
`pnpm test:e2e` after each. B adds a new visual assertion: after pushing, put
the **`update-snapshots`** label on the PR so CI generates `page-zoom-200.png`.
