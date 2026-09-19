# Font size selector for annotations

## Goal

Add a dropdown to the toolbar (left of the existing toolbar buttons) that lets
the user pick a font size for annotations. The chosen size applies both to newly
placed annotations and to any annotation that is currently selected.

---

## Data model

### `ScoreAnnotation.size` — already exists

Each annotation already carries a `size: number` (PDF points). Today it is
assigned from `DEFAULT_SIZE[kind]` at creation time and never changed by the
user.

### Persistent size choices — `DEFAULT_SIZE` stays the fallback

When a new annotation is placed its size comes from:

1. The font-size the user last picked in the dropdown (tool state), or
2. `DEFAULT_SIZE[kind]` when no pick has been made yet.

The per-annotation `size` saved to the PDF is the source of truth for existing
annotations; the dropdown only controls the *next* placement and live-updates
any selected annotation.

---

## State changes

### 1. `tool.slice.ts` — add `fontSize`

Add a `fontSize: number | null` field to `ToolState` (initial `null`, meaning
"use the kind default").

Add a reducer `annotationFontSizePicked(state, action: PayloadAction<number>)`.

Add a selector `selectAnnotationFontSize`.

Mirror the existing `color` carry-over in the `documentOpened` / `documentClosed`
extra reducers: preserve `fontSize` across documents rather than resetting it,
the same way `color` is preserved today.

This field also changes the tool slice's overall state shape.
`tests/unit/store/toolSlice.test.ts:79-83` asserts the whole state via
`toEqual({ active, color, value })` and fails with a `+ "fontSize": null` diff
once this field lands. Add `fontSize: null` to that expected object as part of
this step.

### 2. `annotations.slice.ts` — add `annotationResized`

New reducer:

```ts
annotationResized(
  state,
  action: PayloadAction<{ id: string; size: number }>,
)
```

- Finds the annotation by `id`.
- Records an undo entry (new `type: 'resize'` variant).
- Sets `annotation.size = action.payload.size`.
- Bumps `revision`.

### 3. `AnnotationUndoEntry` — new `'resize'` variant

```ts
| { type: 'resize'; id: string; from: number; to: number }
```

Wire it into `applyInverse` and `applyForward` in `annotations.slice.ts`:
restore/apply `size` just like `retitle` does for `text`.

### 4. `annotationsUnchanged` — include `size`

`annotationsUnchanged` (`annotations.slice.ts:45-60`) compares fields of two
annotation arrays. Add `item.size === b[i].size` to the comparison so a
font-size edit marks the document dirty.

This only matters on the `savedRevision === null` branch of
`selectHasUnsavedAnnotations` (`annotations.slice.ts:297-300`) — before a first
save. After a save the dirty check runs off `revision`, which
`annotationResized` bumps anyway.

### 5. `annotationPlaced` / `annotationPasted` — accept optional `size`

The `prepare` callbacks in `annotationPlaced` and `annotationPasted` call
`createAnnotation`. Thread a `size` parameter through so the caller can pass the
current dropdown value. Inside `createAnnotation`, if `size` is provided, use it
instead of `DEFAULT_SIZE[kind]`.

### 6. Clipboard — include `size`

`AnnotationClipboard` already omits `size`. Add `size: number` to
`AnnotationClipboard` so a copy-paste preserves the original's font size.

This also changes what `annotationCopied` puts on the clipboard.
`tests/unit/store/annotationsSlice.test.ts:272-278` asserts the clipboard's
contents via an exact `toEqual` and fails with a `+ "size": 7.5` diff once
`size` is included. Add `size: DEFAULT_SIZE.note` (7.5) to that expected
object as part of this step.

---

## UI changes

### 7. New component: `FontSizeSelect`

Location: `src/components/FontSizeSelect/FontSizeSelect.tsx` (plus a
`.styles.ts`).

A `<select>` dropdown with a fixed set of point sizes:

```ts
const FONT_SIZES: readonly number[] = [
  5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 24,
];
```

Annotate the type rather than writing `as const`. Under `as const` the array
narrows to the literal tuple `readonly [5, 6, 7, ...]`, so `includes` only
accepts those twelve literals and the membership test below fails to compile
against a plain `number`:

```
error TS2345: Argument of type 'number' is not assignable to parameter of type
'8 | 16 | 5 | 6 | 9 | 10 | 7 | 12 | 14 | 18 | 20 | 24'.
```

Nothing here needs the literal types — the whole point of the next paragraph is
that the value may be a number outside the list.

`DEFAULT_SIZE` contains values not in this list (`position: 8.5`, `note: 7.5`),
and `annotations.objects.ts`'s `readNumber` accepts any finite number when
restoring from a PDF, so `value` can legitimately be anything — not just one of
`FONT_SIZES`. A `<select>` whose `value` matches no `<option>` renders blank
(`selectedIndex === -1`), which would silently lie about the current size. To
keep the control honest for any value, render a synthetic extra `<option>` for
`value` whenever it isn't already one of `FONT_SIZES`:

```ts
const options =
  value !== null && !FONT_SIZES.includes(value)
    ? [...FONT_SIZES, value].sort((a, b) => a - b)
    : FONT_SIZES;
```

This covers both the two off-list defaults and arbitrary values read back from
a PDF authored elsewhere, without having to special-case `DEFAULT_SIZE` in the
component.

Props:

```ts
type FontSizeSelectProps = {
  value: number | null;
  onChange: (size: number) => void;
  disabled?: boolean;
};
```

When `value` is `null`, the select shows a placeholder label like "Size" so the
user sees something meaningful before they have picked. Render that as a real
empty-valued option and coerce the `value` prop, rather than handing `null`
straight to the element:

```tsx
<select value={value ?? ''} onChange={...}>
  <option value="" disabled hidden>Size</option>
  {options.map((size) => (
    <option key={size} value={size}>{size}</option>
  ))}
</select>
```

Passing `value={null}` to a controlled `<select>` makes React treat it as
uncontrolled and log a warning, which would also defeat the point of §7's
synthetic option.

The placeholder option must be `disabled hidden`, not a plain selectable
option: an unguarded placeholder can be re-selected after a real size has been
picked, and `Number('') === 0`, so the `onChange` handler would fire with
`size: 0`. That is not caught downstream — §9's fallback is
`fontSize ?? DEFAULT_SIZE[placing]`, and `0 ?? x` evaluates to `0` because
nullish coalescing only substitutes on `null`/`undefined` — so an unguarded
placeholder would place marks at 0pt. Making the option `disabled hidden`
removes it from the reachable set once a size is chosen, so `onChange` never
sees an empty-string selection.

The component itself is a native `<select>` styled to match the toolbar's visual
language (small, compact, slate border, matching height of `ToolbarButton`).

### 8. Wire into `PDFEditor` header

In `PDFEditor.tsx`, render `<FontSizeSelect>` left of the first `<ToolbarButton>`
inside the `<header>`. It reads `selectAnnotationFontSize` and
`selectSelectedAnnotationId` from the store:

- **onChange:** dispatches `annotationFontSizePicked(size)` to update tool state.
  If an annotation is currently selected, also dispatches
  `annotationResized({ id: selectedId, size })` to live-update it.
- **value:** when an annotation is selected, shows *that annotation's* size
  (read from the items array via `selectSelectedAnnotationSize`, a new
  selector). Otherwise shows the tool state's `fontSize`.
- **disabled:** when no annotation tool is active (`placing === null`) and no
  annotation is selected.

`PDFEditor.tsx` does not currently import a `placing` selector — add
`selectPlacing` to its existing store-selector imports alongside
`selectAnnotationFontSize` and `selectSelectedAnnotationId` as part of this
step.

The header renders on every open document (`PDFEditor.tsx:329-398`), and eight
full-page `expect(page).toHaveScreenshot(...)` baselines under
`tests/e2e/__screenshots__/visual/` capture it — `annotations.spec.ts:49,65`,
`edited-regions.spec.ts:24,74`, `part-extraction.spec.ts:46`, and
`unsaved-changes.spec.ts:23,41,65`. Adding `FontSizeSelect` to the header will
fail all eight against their current baselines. Per this repo's policy, never
run `pnpm test:visual:update` (or any `--update-snapshots` variant) locally —
a baseline captured here encodes the local font stack, GPU and device pixel
ratio and will fail its first CI run in the `mcr.microsoft.com/playwright:*-noble`
container. Leave the 8 baselines failing and say so in the report, along with
the two ways to regenerate them in CI: put the `update-snapshots` label on the
PR, or run the CI workflow manually with `update_snapshots: true`.

### 9. Placement call sites — pass font size

In `ScoreOverlay.tsx`, the `annotationPlaced` dispatch already receives `kind`,
`color`, and `text`. Add `size: fontSize ?? DEFAULT_SIZE[placing]` (where
`fontSize` comes from `selectAnnotationFontSize`).

`ScoreOverlay.tsx` does not currently import `DEFAULT_SIZE` — its existing
import at `:13-18` covers only `ANNOTATION_COLORS`, `AnnotationKind`,
`DEFAULT_COLOR`, and `normalizeAnnotationText`. Add `DEFAULT_SIZE` to that
import as part of this step; it is also needed by the cursor-preview fallback
in the Rendering section below.

`useAnnotationKeyboard.ts` has **two** `annotationPasted` dispatch sites — the
pointer branch (`:49-58`), which pastes at the pointer's own position with no
offset, and the no-pointer fallback (`:60-69`), which pastes near the original
using `PASTE_OFFSET` — and both need the same treatment, or paste behaves
differently depending on where the cursor happened to be.

For paste, the dropdown pick must **not** take precedence: §6 adds `size` to
`AnnotationClipboard` specifically so a copy-paste preserves the *original*
annotation's font size, and `clipboard.size` is a required field once §6 lands
(populated whenever something is copied), so no fallback chain or
`DEFAULT_SIZE[clipboard.kind]` term is needed. Both dispatches should pass:

```ts
size: clipboard.size
```

The dropdown's `fontSize` governs fresh placement only (via `annotationPlaced`
above); it is not consulted on paste. This also means resizing an existing
annotation (§8) only affects future *placements*, not future *pastes* — the
two paths are independent, so there is no cross-contamination between them.

Both call sites already read `clipboard` via `selectClipboard` for the
existing `if (event.key === 'v' && clipboard)` narrowing, and `clipboard.size`
falls under that same narrowing (`AnnotationClipboard | null`), so no
additional null-check is needed. Because paste no longer consults the dropdown
value, `useAnnotationKeyboard.ts` does **not** need a new
`selectAnnotationFontSize` read from `tool.slice.ts` — it continues to read
only annotation-slice selectors, as it does today.

---

## New selector

### 10. `selectSelectedAnnotationSize`

In `selectors.ts` or `annotations.slice.ts`:

```ts
export const selectSelectedAnnotationSize = createSelector(
  [selectAnnotations, selectSelectedAnnotationId],
  (items, id) => {
    if (!id) return null;
    return items.find((a) => a.id === id)?.size ?? null;
  },
);
```

---

## Rendering — `ScoreOverlay.tsx`

Placed marks need no change: the overlay already reads `annotation.size` and
uses it as the CSS `fontSize`, so resizing an annotation in the store re-renders
it at the new size automatically.

The mark riding the cursor before it is placed does need a change. `cursorMarkInk`
is hardcoded to the kind default:

```ts
export function cursorMarkInk(kind, color, scale) {
  const fontSize = Math.max(7, DEFAULT_SIZE[kind] * scale);
  ...
}
```

and the call site at `ScoreOverlay.tsx:310` (`cursorMarkInk(carrying.kind, color, scale)`)
doesn't pass the dropdown's pick, so with a tool active and a non-default size
selected, the cursor preview stays at the kind default while the placed mark
lands at the selected size — defeating the preview's purpose (see the comment
at `ScoreOverlay.styles.ts:52-56`). Thread the effective size through:

```ts
export function cursorMarkInk(kind, color, scale, fontSize = DEFAULT_SIZE[kind]) {
  const size = Math.max(7, fontSize * scale);
  ...
}
```

and update the call site to
`cursorMarkInk(carrying.kind, color, scale, fontSize ?? DEFAULT_SIZE[carrying.kind])`,
reading `fontSize` from `selectAnnotationFontSize` (already read for §9). Add
this call-site change and the `cursorMarkInk` signature change to the file
change table.

**The rendering floor collapses small sizes.** Both the placed-mark render
path and `cursorMarkInk` floor at `Math.max(7, size * scale)`, where
`scale = pageWidth / sourcePage.width` (`selectors.ts:78`), and
`usePageWidth` caps `pageWidth` at `min(stageWidth - 32, 900)`
(`hooks/usePageWidth.ts:3-8`). At the 900px cap on a 612pt letter page,
`scale ≈ 1.47`, which keeps every `FONT_SIZES` option — including 5pt at
7.35px — above the floor. But the floor alters 5pt whenever `scale < 1.4`
(stage width < 889px, roughly viewport < 1305px with both side panels
present), 6pt below `scale 1.167` (stage width < 746px), and 7pt
(`DEFAULT_SIZE.string`, a listed option) below `scale 1` (stage width
< 644px) — three options affected, not two, over a ~245px band of ordinary
laptop widths, not a narrow edge case. At a 1152px viewport (stage 736px,
scale ≈ 1.15), 5pt and 6pt both render at the floor's 7.00px and become
visually indistinguishable — the exact collapse this control exists to
prevent. Lower the floor (`Math.max(3, size * scale)`) so those two stay
visually distinct at narrow stage widths — 5pt only floors again below
`scale 0.6` (stage width < 399px) — rather than silently collapsing to 7pt
on common displays; the PDF-written value is unaffected either way.

---

## PDF persistence

`annotations.objects.ts` already reads and writes `size` via the `PdfEditorSize`
key, so the write path needs no changes.

### Reverse the `documentRestored` size override — a deliberate behaviour change, not a bug fix

The `documentRestored` extra reducer in `annotations.slice.ts` currently
**overwrites** every annotation's `size` with `DEFAULT_SIZE[annotation.kind]`
on load, discarding whatever was read from the PDF. This is not an oversight:
it is deliberate, tested "re-engraving" behaviour — a mark placed under an
older default size comes back looking like one placed under today's default,
per `tests/unit/store/documentRestored.test.ts:76-85`. Adding a user-facing
font-size control invalidates the premise that test encodes ("size is inherited
… never chosen"): once a user can choose a size, that choice must survive a
save/reopen round trip, so this plan *intentionally reverses* that migration
behaviour rather than fixing a defect.

Change the reducer to carry the stored value through with no fallback — every
annotation on a payload from this app's own writer already has a finite
`size` (`annotations.objects.ts:266` returns `null` from `toAnnotation`, not an
annotation, when `size` is missing, so a `?? DEFAULT_SIZE[...]` fallback here
is dead code for that path):

```ts
const restored = action.payload.annotations.map((annotation) => ({
  ...annotation,
  size: annotation.size,
}));
```

(equivalently, drop the `size` override entirely and let `...annotation` carry
it through unchanged).

Once this override is gone, `DEFAULT_SIZE` is no longer read anywhere in
`annotations.slice.ts` — it was imported at the top of that file solely for
this override, and none of this plan's other changes to that file (the
`annotationResized` reducer, the `'resize'` undo variant, `annotationsUnchanged`,
the clipboard/prepare changes) reintroduce a use of it. Remove the now-unused
`DEFAULT_SIZE` import from `annotations.slice.ts` as part of this change, or
`tsconfig.json`'s `noUnusedLocals: true` (and Biome's `noUnusedImports`) will
fail `pnpm test:types`.

This requires a corresponding test change, which is part of this plan, not
incidental cleanup. Exactly **one** test asserts the old behaviour and fails
when the override goes — verified by making the change and running the suite:

```
❯ tests/unit/store/documentRestored.test.ts (18 tests | 1 failed)
    × re-engraves marks written under an older default size
-     "size": 7      +     "size": 9.5
Tests  1 failed | 342 passed (343)
```

Rewrite `tests/unit/store/documentRestored.test.ts:76-85`
(`'re-engraves marks written under an older default size'`) to assert the new
contract instead: a restored annotation keeps the `size` it was saved with,
even when that differs from the current `DEFAULT_SIZE[kind]`.

**Keep** its neighbour at `:87-99`
(`'leaves everything but the size of a stale mark alone'`). Despite the name,
its body asserts only `id`, `x`, `y`, `text`, `kind` and `pageIndex` via
`toMatchObject` — it never asserts `size`, so it is neutral to this change and
passes untouched. It is the guard that restore does not disturb the *other*
fields, which is worth keeping. Rename it (e.g. `'leaves the rest of a restored
mark alone'`) so the title stops implying a size migration, but leave the
assertions alone.

Without this fix a user who changes an annotation's font size, saves, and
reopens will see all annotations revert to their default sizes.

---

## Undo / redo

The new `'resize'` undo entry follows the same pattern as `'retitle'`:

- `applyInverse`: restore `annotation.size = entry.from`.
- `applyForward`: set `annotation.size = entry.to`.

Changing the size of a selected annotation is one undoable action. Changing the
dropdown without a selection is just a tool-state change — nothing to undo.

---

## File change summary

| File | Change |
|------|--------|
| `lib/pdf/annotations/annotations.ts` | Add `size?` param to `createAnnotation`; add `size` to `AnnotationClipboard` |
| `store/tool.slice.ts` | Add `fontSize` field, `annotationFontSizePicked` reducer, `selectAnnotationFontSize` selector; preserve `fontSize` across documents (mirror `color`) |
| `store/annotations.slice.ts` | Add `annotationResized` reducer, `'resize'` undo variant, `size` to `annotationsUnchanged`, `size` to clipboard copy, `size` param in `annotationPlaced`/`annotationPasted` prepare, reverse `documentRestored`'s size override so it preserves the stored value, remove the now-unused `DEFAULT_SIZE` import |
| `store/selectors.ts` | Add `selectSelectedAnnotationSize` |
| `components/FontSizeSelect/FontSizeSelect.tsx` | New component; `FONT_SIZES` typed `readonly number[]` (not `as const`, which breaks `includes`); renders a synthetic extra `<option>` when `value` isn't in `FONT_SIZES`; `value={value ?? ''}` with a `disabled hidden` empty-valued placeholder option |
| `components/FontSizeSelect/FontSizeSelect.styles.ts` | New styles |
| `components/PDFEditor/PDFEditor.tsx` | Render `FontSizeSelect` in header, wire dispatch; add `selectPlacing` to its store-selector imports (not currently imported) for the `disabled` condition |
| `components/ScoreOverlay/ScoreOverlay.tsx` | Pass `size` to `annotationPlaced`; update the `cursorMarkInk` call site (`:310`) to pass `fontSize`; lower the placed-mark render floor at `:230`; add `DEFAULT_SIZE` to its existing import (`:13-18`, not currently imported) |
| `components/ScoreOverlay/ScoreOverlay.styles.ts` | Add a `fontSize` param to `cursorMarkInk` (`:70`); lower its render floor (`:75`) |
| `hooks/useAnnotationKeyboard.ts` | Pass `size: clipboard.size` to **both** `annotationPasted` dispatches |
| `tests/unit/store/documentRestored.test.ts` | Rewrite the one test asserting the old re-engraving override (`:76-85`) to assert saved sizes survive restore; keep `:87-99` (rename only — it asserts no size) |
| `tests/unit/store/annotationsSlice.test.ts` | Add `size: DEFAULT_SIZE.note` (7.5) to the clipboard `toEqual` expectation (`:272-278`) |
| `tests/unit/store/toolSlice.test.ts` | Add `fontSize: null` to the whole-state `toEqual` expectation (`:79-83`) |


---

## Order of implementation

1. Data layer: `annotations.ts` (`createAnnotation` size param, clipboard type)
2. Store: `tool.slice.ts` (`fontSize` state, preserved across documents);
   update `toolSlice.test.ts:79-83`'s whole-state `toEqual` to include
   `fontSize: null`
3. Store: `annotations.slice.ts` (`annotationResized`, undo variant, dirty
   check, clipboard, prepare callbacks, reverse `documentRestored` size
   override, remove the now-unused `DEFAULT_SIZE` import); update
   `annotationsSlice.test.ts:272-278`'s clipboard `toEqual` to include
   `size: DEFAULT_SIZE.note` (7.5)
4. Tests: rewrite `documentRestored.test.ts:76-85` for the new restore
   contract; rename (do not delete) `:87-99`
5. Selector: `selectSelectedAnnotationSize`
6. Component: `FontSizeSelect` (with the out-of-list-value `<option>` and the
   `disabled hidden` placeholder)
7. Integration: `PDFEditor.tsx` (render dropdown, wire actions; add the
   missing `selectPlacing` import for the `disabled` condition)
8. Callers: `ScoreOverlay.tsx` (`annotationPlaced` size, plus the missing
   `DEFAULT_SIZE` import), `ScoreOverlay.styles.ts` (`cursorMarkInk`
   threading, render floor), `useAnnotationKeyboard.ts` (`clipboard.size` on
   both `annotationPasted` dispatches)
9. Validate: `pnpm test` and `pnpm test:types`. Do not run
   `pnpm test:visual` or `pnpm test:visual:update` locally — the 8 header
   baselines are expected to fail "snapshot doesn't exist"/mismatch until
   regenerated in CI (see §8).
