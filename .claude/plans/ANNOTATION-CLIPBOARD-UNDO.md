# Plan: annotation copy/paste and undo/redo

Status: **completed**

## Goal

Two editing conveniences that annotations currently lack:

1. **Copy/paste** — select an existing annotation, copy it, and paste it at a new
   location. The pasted mark inherits the source's kind, text, color and size.
2. **Undo/redo** — reverse or replay the last 3 annotation edits (place, move,
   retitle, remove). Independent of the page-arrangement undo already in
   `document.slice.ts`.

## Scope

**In scope:**

- A clipboard that holds one `ScoreAnnotation` snapshot (kind, text, color, and
  source pageIndex — not id, x/y, or size, since size is always
  `DEFAULT_SIZE[kind]`).
- Paste places a new annotation at the pointer position on whichever page the
  pointer is over (cross-page paste). Fallback when the pointer is off the score
  surface: offset from the source position on the source page.
- An annotation-specific undo/redo stack, capped at 3 entries, covering the four
  mutation actions: `annotationPlaced`, `annotationRetitled`, `annotationMoved`,
  `annotationRemoved`.
- Keyboard shortcuts: Cmd/Ctrl+C (copy), Cmd/Ctrl+V (paste), Cmd/Ctrl+Z (undo),
  Cmd/Ctrl+Shift+Z (redo).
- Toolbar buttons for undo and redo with disabled states.

**Out of scope:**

- Multi-select / batch copy.
- Persisting the undo stack or clipboard across saves or reopens.
- Changes to the existing page-arrangement undo in `document.slice.ts`.

## Design decisions

### Why a separate undo stack

The document slice already has undo for page arrangement (`document.slice.ts:96-101`,
`undone` at line 196). Annotation state lives in a different slice
(`annotations.slice.ts`), and the two concern types are independent — undoing a
fingering placement should not undo a page rotation.

A dedicated 3-deep stack in the annotations slice keeps the two orthogonal and
avoids retrofitting a unified undo across the store (which would require
redux-undo or an action-level middleware — heavier than what is needed here).

### Clipboard is store state, not system clipboard

Using the browser's system clipboard for structured annotation data would require
serialization/deserialization and is fragile across focus changes. A Redux-held
clipboard value (`ScoreAnnotation | null`) is simpler, always available, and
matches how the rest of the tool state works. It also avoids surprising the user
by overwriting their system clipboard when they copy a fingering.

### Undo entry shape

Each undo entry is a reversible description of what happened, not a full state
snapshot:

```ts
type AnnotationUndoEntry =
  | { type: 'place'; annotation: ScoreAnnotation }
  | { type: 'remove'; annotation: ScoreAnnotation }
  | { type: 'move'; id: string; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: 'retitle'; id: string; from: string; to: string };
```

Undoing a `place` removes the annotation. Undoing a `remove` re-inserts it.
Undoing a `move` restores the previous position. Undoing a `retitle` restores
the previous text. Redo replays the forward direction.

This is smaller than snapshotting the full annotations array on every edit, and
it scales without concern at 3 entries.

## Implementation

### Phase 1 — undo/redo in `annotations.slice.ts`

Add to the slice state:

```ts
type AnnotationsState = {
  items: ScoreAnnotation[];
  undoStack: AnnotationUndoEntry[];  // max 3, most recent last
  redoStack: AnnotationUndoEntry[];  // cleared on any new mutation
  clipboard: Pick<ScoreAnnotation, 'kind' | 'text' | 'color' | 'pageIndex' | 'x' | 'y'> | null;
};
```

This changes the slice's shape from a plain array to an object. Every selector
and `extraReducer` that currently reads annotations as the top-level state will
update to read `state.items` instead. The selectors `selectAnnotations` and
`selectAnnotationCount` absorb this internally so consuming components are
unchanged.

Modify each existing reducer to push an undo entry before mutating:

- **`annotationPlaced`** — push `{ type: 'place', annotation: payload }`, clear
  redo. Mutate via `state.items.push(action.payload)` (already mutation-style).
- **`annotationRemoved`** — find the annotation about to be removed, push
  `{ type: 'remove', annotation }`, clear redo. **Must change from
  `return removeAnnotation(state, ...)` to
  `state.items = removeAnnotation(state.items, ...)`** — the current `return`
  replaces the entire slice state, which after reshape would overwrite the
  `{ items, undoStack, ... }` object with a plain array.
- **`annotationMoved`** — find the annotation in `state.items`, push
  `{ type: 'move', id, from: { x: old, y: old }, to: { x: new, y: new } }`,
  clear redo.
- **`annotationRetitled`** — find the annotation in `state.items`, push
  `{ type: 'retitle', id, from: oldText, to: newText }`, clear redo.

Cap `undoStack` at 3 after each push (shift from the front).

Add two new reducers:

- **`annotationUndone`** — pop the last undo entry, apply its inverse to
  `state.items`, push the entry onto `redoStack`.
- **`annotationRedone`** — pop the last redo entry, apply its forward effect to
  `state.items`, push the entry back onto `undoStack`.

Add new selectors:

- `selectCanUndoAnnotation` — `undoStack.length > 0`
- `selectCanRedoAnnotation` — `redoStack.length > 0`

The `documentOpened` and `documentClosed` extra-reducers reset the full state
including stacks and clipboard. `documentRestored` **must change from returning
a mapped array to mutating `state.items`** — the current implementation
(`return action.payload.annotations.map(...)`) replaces the entire slice state,
which after reshape would overwrite `{ items, undoStack, ... }` with a plain
array. Rewrite as:

```ts
.addCase(documentRestored, (state, action) => {
  state.items = action.payload.annotations.map((annotation) => ({
    ...annotation,
    size: DEFAULT_SIZE[annotation.kind],
  }));
})
```

Since `documentRestored` is always dispatched right after `documentOpened` (which
resets stacks/clipboard), the stacks need no separate handling here.

### Phase 2 — clipboard in `annotations.slice.ts`

Add two reducers:

- **`annotationCopied`** — takes an annotation `id`, finds it in `state.items`,
  snapshots `{ kind, text, color, pageIndex, x, y }` into `state.clipboard`.
  The position fields (`pageIndex`, `x`, `y`) are stored so the fallback paste
  (pointer not over any page) can place the copy near the source on its original
  page. Does not touch the undo stack (copy is not a mutation).
- **`annotationPasted`** — reads `state.clipboard`, mints a new annotation in
  the `prepare` callback (same pattern as `annotationPlaced`), using the
  clipboard's kind/text/color and the provided `pageIndex`/`x`/`y`. Pushes an
  undo entry like any placement.

  **Note:** `createAnnotation` does not accept a `size` parameter — it hardcodes
  `DEFAULT_SIZE[kind]`. Since size is never user-configurable and always equals
  `DEFAULT_SIZE[kind]`, storing size in the clipboard is redundant. Two options:
  **(a)** drop `size` from the clipboard snapshot and use `createAnnotation`
  as-is, or **(b)** add an optional `size` parameter to `createAnnotation`.
  **(a)** is simpler and correct today.

`annotationPasted` uses the same `prepare` pattern as `annotationPlaced` so that
the random id is generated outside the reducer.

Add selector:

- `selectClipboard` — `state.clipboard`

### Phase 3 — keyboard shortcuts

Add a `useAnnotationKeyboard` hook (new file
`src/hooks/useAnnotationKeyboard.ts`) that registers a `keydown` listener on
`document`:

| Shortcut              | Condition                            | Dispatch                                      |
|-----------------------|--------------------------------------|-----------------------------------------------|
| Cmd/Ctrl+C            | An annotation is selected            | `annotationCopied(selectedId)`                |
| Cmd/Ctrl+V            | Clipboard is non-null                | `annotationPasted({ pageIndex, x, y, ... })` |
| Cmd/Ctrl+Z            | `canUndoAnnotation`                  | `annotationUndone()`                          |
| Cmd/Ctrl+Shift+Z      | `canRedoAnnotation`                  | `annotationRedone()`                          |

The hook calls `event.preventDefault()` only when it handles the event, so
native browser undo in text inputs is not blocked.

Guard: when an `<input>` or `<textarea>` is focused (the draft editor in
`ScoreOverlay`), the hook does nothing — keyboard events belong to the text
field.

#### Cmd+Z ordering caveat

Cmd+Z dispatches `annotationUndone()`, not the document's `undone()`. If the
user rotates a page and then places a fingering, Cmd+Z undoes the fingering —
which is correct — but if they then press Cmd+Z again while the annotation
stack is still non-empty, it undoes an *older* annotation edit rather than the
page rotation. Users expect "undo my last action" globally.

This is a known limitation of having two independent stacks. Acceptable for v1
because the intersection is rare (page edits are infrequent once the score is
open), and a unified stack would require `redux-undo` or action-level
middleware. Document the behavior in button tooltips ("Undo last annotation
edit"), and consider unifying later.

#### Copy trigger — tap-to-select

The overlay does not currently track a "selected" annotation. Two options:

- **(A) Tap-to-select, then Cmd+C.** Add a `selectedAnnotationId` to the
  annotations or tool slice. Tapping an annotation selects it; the existing
  double-click-to-edit and pointer-down-to-drag stay. Visual feedback: a subtle
  outline or highlight on the selected mark.
- **(B) Copy on right-click context menu.** A custom context menu on each
  annotation mark offering "Copy" and "Delete". No selection state needed.

**Recommended: (A).** It composes naturally with Cmd+C/V and needs no custom
context menu. The selection state is a single `string | null` in the slice,
cheap to add, and useful for future features (e.g. delete-selected via
Backspace).

**Tap vs. drag disambiguation.** `onPointerDown` on an annotation currently
starts a drag immediately (`setDrag`). To support tap-to-select:

- On `pointerdown`, record the start position but do *not* start dragging yet.
- On `pointermove`, if the pointer has moved more than a small threshold (e.g.
  3px), promote to a drag.
- On `pointerup`, if the pointer has *not* exceeded the threshold, treat it as a
  tap → set `selectedAnnotationId`. The existing double-click handler stays.

This changes the existing drag initiation from eager to lazy, so test that
dragging still feels responsive with the threshold.

#### Paste position and cross-page paste

**Problem:** A `document`-level `keydown` handler does not know which page the
pointer is over or the pointer's PDF coordinates. The `ScoreOverlay` tracks
`cursor` locally, but only while carrying a menu value.

**Solution:** The hook needs two pieces of state from the score surface: the
hovered `pageIndex` and the pointer's PDF-space `{ x, y }`. Two approaches:

- **(A) Lift pointer-tracking into shared state.** Add a `hoverPosition` ref or
  lightweight context (`{ pageIndex, x, y } | null`) that each `ScoreOverlay`
  writes on `pointermove` and clears on `pointerleave`. The keyboard hook reads
  it on Cmd+V. A ref avoids re-renders.
- **(B) Mount the keyboard handler per-page inside `ScoreOverlay`.** Each
  instance registers `keydown` on `document`. On Cmd+V, only the instance whose
  surface contains the pointer acts (checked via `document.elementFromPoint`).
  Guard against double-firing with `event.defaultPrevented`.

**Recommended: (A).** A shared ref is simpler than N listeners fighting over one
keypress. Provide it via a `ScorePointerContext` or a ref passed down from
`PDFEditor`.

**Cross-page paste** works naturally with approach (A): each `ScoreOverlay`
writes its own `pageIndex` into the shared ref, so when the pointer is over
page 5 and the user presses Cmd+V, the annotation lands on page 5 regardless of
where the source lived. The `pageIndex` dispatched to `annotationPasted` comes
from the ref, not from the clipboard.

**Fallback** when the pointer is not over any page (the ref is null): use the
clipboard's stored `pageIndex`, `x`, and `y` to place the copy near the source
on its original page, offset by (+5pt, −5pt) so it's visible beside the
original.

Mount the hook in `PDFEditor` so it is active only while a document is open.

### Phase 4 — toolbar undo/redo buttons

The existing `Undo` button in `PDFEditor.tsx:334` dispatches `undone()` for page
arrangement. Rename it to clarify scope (e.g. "Undo page edit"), and add
alongside it:

- **Undo annotation** button — dispatches `annotationUndone()`, disabled when
  `!canUndoAnnotation`.
- **Redo annotation** button — dispatches `annotationRedone()`, disabled when
  `!canRedoAnnotation`.

These sit in the toolbar near the existing undo/reset cluster. Their labels
should distinguish them from the page undo: short text like "Undo mark" / "Redo
mark", or icons with tooltips.

## File changes

| File | Change |
|------|--------|
| `src/store/annotations.slice.ts` | Reshape state to `{ items, undoStack, redoStack, clipboard, selectedId }`; convert `annotationRemoved` from `return` to mutation; add undo/redo/clipboard/selection reducers, selectors |
| `src/lib/pdf/annotations/annotations.ts` | Add `AnnotationUndoEntry` type export |
| `src/components/ScoreOverlay/ScoreOverlay.tsx` | Tap-vs-drag disambiguation (lazy drag start); tap-to-select dispatch; pointer-tracking ref/context for paste coordinates; visual selected state |
| `src/components/ScoreOverlay/ScoreOverlay.styles.ts` | Selected annotation highlight style |
| `src/hooks/useAnnotationKeyboard.ts` | New — keyboard shortcut hook; reads pointer-tracking ref for paste position |
| `src/components/PDFEditor/PDFEditor.tsx` | Mount keyboard hook; provide pointer-tracking ref/context; add undo/redo mark buttons |
| `src/components/PDFEditor/PDFEditor.constants.ts` | Button label strings for undo/redo mark |
| `src/store/selectors.ts` | No change expected — annotation selectors are slice-local |
| `tests/unit/store/annotationsSlice.test.ts` | **Must update:** `run()` returns the reshaped object, not an array. Every assertion that destructures as `const [note] = run(...)` or indexes `run(...)[0]` must access `.items` first |
| `tests/unit/store/documentRestored.test.ts` | **Must update:** assertions on `store.getState().annotations` (e.g. `.toEqual([MARK])`) must change to `store.getState().annotations.items` |

## Testing

Follow the existing vitest layout (`tests/unit/store/`, `tests/unit/lib/`).

### Phase 0 — fix existing tests after reshape

Before adding any new test cases, update the existing tests to work with the
reshaped state:

- **`tests/unit/store/annotationsSlice.test.ts`** — the `run()` helper returns
  the reducer's output, which is now `{ items, undoStack, redoStack, clipboard }`.
  Every assertion that destructures as `const [note] = run(...)` must change to
  `const [note] = run(...).items`. Same for index access like `run(...)[0]` →
  `run(...).items[0]`. The `EMPTY` constant becomes the initial object, not `[]`.

- **`tests/unit/store/documentRestored.test.ts`** — every assertion on
  `store.getState().annotations` (e.g. `.toEqual([MARK])`) must change to
  `store.getState().annotations.items`.

Run the full test suite after this step, before writing any new code.

### Phase 1 — undo/redo tests

- **`tests/unit/store/annotationsSlice.test.ts`** (extended)
  - Place → undo removes it; redo re-places it with the same id.
  - Move → undo restores original position; redo re-applies.
  - Retitle → undo restores old text.
  - Remove → undo re-inserts the annotation.
  - Stack cap: 4 mutations leave only 3 undo entries; the oldest is dropped.
  - Any new mutation clears the redo stack.
  - `documentOpened` resets stacks and clipboard.

### Phase 2 — clipboard tests

  - Copy → paste creates a new annotation with a different id but same
    kind/text/color.
  - Paste with no clipboard is a no-op.
  - Paste pushes an undo entry; undoing it removes the pasted annotation.
  - Copy from page 0 → paste while hovering page 2 → annotation lands on page 2
    with the hovered coordinates.
  - Copy from page 0 → paste with pointer off the score surface → annotation
    lands on page 0 at an offset from the source position.

### Manual checks

- Open a score, place several fingerings, undo/redo with keyboard and buttons,
  copy one and paste it, confirm the pasted mark is independent of the original.
- Copy a fingering on page 1, scroll to page 3, hover over it, paste — confirm
  the mark lands on page 3 at the pointer position.
- Copy a fingering, move the pointer off the score surface entirely, paste —
  confirm the mark lands on the source's page near the original.
- Verify drag still feels responsive after the lazy-drag-start change.
- Verify Cmd+Z does not interfere with typing in the annotation draft input.

## Risks

- **State shape migration — reducers that `return`.** Changing the slice from a
  plain array to an object breaks every reducer or extraReducer that returns a
  new value instead of mutating the draft. Two exist today:
  - `annotationRemoved`: `return removeAnnotation(state, action.payload)` —
    after reshape, replaces `{ items, undoStack, ... }` with a filtered array.
  - `documentRestored` extraReducer: `return action.payload.annotations.map(...)`
    — same problem.
  Both must be rewritten as mutations (`state.items = ...`). This is the
  highest-risk mechanical change: miss one and the slice silently corrupts.
- **Test breakage.** `annotationsSlice.test.ts` destructures reducer output as
  arrays (`const [note] = run(place())`); `documentRestored.test.ts` asserts
  `store.getState().annotations` equals an array. Both break after reshape. Run
  the full test suite immediately after the state-shape change — before adding
  any new feature code — to catch regressions.
- **Undo after undo-then-edit.** If the user undoes, then makes a new edit, the
  redo stack is correctly cleared — but the old undo entries still reference
  annotations that may have been re-created with different ids. Each undo entry
  stores the annotation's id at the time of the action, and undo/redo operate by
  id lookup, so a stale id simply finds nothing and the undo is a no-op. This is
  acceptable for a 3-deep stack; document it in a code comment.
- **Undo of `remove` changes render order.** Undoing a removal re-inserts the
  annotation via `push()`, placing it at the end of `state.items` regardless of
  its original position. If two annotations overlap, the one re-inserted last
  renders on top. Acceptable for v1; a position-preserving splice would add
  complexity for a rare visual edge case.
- **Keyboard conflict.** Cmd+Z is also the browser's native undo. The hook must
  only preventDefault when it actually handles the event (annotations are on
  screen, not typing in an input). If an annotation undo fires while a text
  input is focused, the input loses its native undo. The focus guard handles
  this.
- **Drag initiation feels different.** Switching from eager drag (`pointerdown`
  starts drag immediately) to lazy drag (drag only after a movement threshold)
  may feel slightly less responsive. Test with real use to calibrate the
  threshold (3px is a starting point, not a commitment).

## Explicitly not doing

- Full-state snapshots for undo (wasteful at the annotation-array scale, and the
  entry-based approach is straightforward for 4 action types).
- Unified cross-slice undo (page arrangement + annotations in one stack). The
  two are independent concerns with different lifetimes.
- Persisting undo history or clipboard in the PDF. These are session conveniences.
- Multi-annotation selection or batch operations.
