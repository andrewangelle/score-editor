# Export time signatures and tempo markings with measure numbers

## Goal

Add a feature that extracts every detected time signature and tempo marking from
the score, pairs each with its nearest measure number, and saves the result to a
new PDF whose name the user chooses before download. The markings are
vector-lifted from the source document — the same `embedPages`/`drawPage` clip
path that part extraction uses — so a metronome mark keeps its note glyph, a
boxed rehearsal letter keeps its box, and a time signature keeps whatever font
the engraver used.

The output is a compact reference PDF — one row per event, each showing the
measure number clip followed by the tempo or time-signature clip, flowing down
the page.

---

## Data already available — and what is missing

The detection pipeline (`markings.ts` → `scoreAnalysis.ts`) classifies every
marking as `'measure'` or `'tempo'`. `ScoreAnalysis` holds them via
`pages[].markings[]`, each with `kind`, `text`, `pageIndex`, `systemIndex`, and
`rect` (`markings.ts:16-23`). Each `Marking.rect` is padded and
enclosure-grown by `detectMarkings` (`markings.ts:257-272`).

### Measure numbers

Measure numbers (`kind === 'measure'`) carry their numeric value in
`Marking.text`, but that text may include brackets: `BARE_NUMBER` at
`markings.ts:353` accepts `"[9]"` and `"(9)"`, and `resolveMarkings`
(`markings.ts:344`) copies `candidate.text` verbatim — it does **not** store
`candidate.value`. `Number("[9]")` is `NaN`. The export must parse with the
same bracket-tolerant pattern, so export `numericValue` from `markings.ts`
(currently private at `:355`) and call it in `markingsExport.ts`.

### Tempo markings

`kind === 'tempo'` captures prose-like text above the top staff — metronome
marks, rehearsal letters, expression text. These are already detected.

### Time signatures — not currently detected

Time signatures are **not** in the `Marking[]` array. Three independent gates
exclude them:

1. **The strip test** (`pageCandidates`, `markings.ts:204-219`): candidates must
   sit in the space *outside* the staff lines. For `side === 'above'`, the strip
   starts at `near = staff.top` (`markings.ts:490`) and the containment test
   requires `mark.rect.bottom >= near` (`:213`). Time signatures are engraved
   *on* the staff — their bounding box bottom sits at or below the staff's
   middle line, so `rect.bottom < staff.top` and they are rejected before any
   later filter runs.

2. **The notation-font skip** (`markings.ts:222-225`): even if the strip test
   were relaxed, notation-font items with `value === null` are discarded. Time
   signatures are rendered in the notation font and `numericValue("4/4")` is
   `null`.

3. **The tempo prose filter** (`markings.ts:329-330`): requires
   `/[=\p{L}]/u` — a Unicode letter or `=`. `"4/4"` contains neither.

So time-signature detection requires a new candidate path in `pageCandidates`
and a new classification pass in `resolveMarkings`.

### Real engraver evidence — stacked form is universal

Dumping the text layer of the repo's own fixture PDF (a MuseScore export at
`tests/e2e/fixtures/fixture.pdf`) confirms that time signatures are rendered as
**stacked single-digit pairs** in the notation font, not slash-joined runs:

```
"4" font=g_d0_f1 x=111.3 y=759.6 w=5.1 h=12.8   (denominator)
"5" font=g_d0_f1 x=111.5 y=766.0 w=4.6 h=12.8   (numerator)
```

The numerator and denominator are separate text items on different baselines,
sharing the same horizontal position (x differs by 0.2pt) and font. Each pair
repeats on every staff of the system at the same horizontal position. No
engraver in this repo's fixture set emits `"4/4"` as a single run.

The vertical gap between the two items is ~6.4pt (half the item height of
12.8pt), and both sit on the staff body. The `textMarkings` join at
`markings.ts:58-113` groups by baseline with tolerance `max(height * 0.35,
0.5)` — about 4.5pt for these items — which is smaller than the 6.4pt gap, so
the two items stay separate. This is correct: `textMarkings` is designed to
join items on one baseline, not vertically stacked pairs.

---

## Part 1: Time-signature detection in `markings.ts`

### 1. New `MarkingKind` value

Extend the union at `markings.ts:15`:

```ts
export type MarkingKind = 'measure' | 'tempo' | 'time-signature';
```

### 2. `TIME_SIG_DIGIT` pattern and `Candidate.side` extension

Add at module scope, alongside `BARE_NUMBER`:

```ts
/** A lone digit, the numerator or denominator of a stacked time signature. */
const TIME_SIG_DIGIT = /^\d{1,2}$/;
```

Extend `Candidate.side` to accept `'on'`:

```ts
export type Candidate = {
  // ...existing fields...
  side: 'above' | 'below' | 'on';
  // ...
};
```

The `'on'` value means the item overlaps the staff body. This value must
**not** enter `byPlacement` grouping (`markings.ts:516-541`), which computes
`offset` as a signed distance from `staff.top` or `staff.bottom` — an on-staff
item produces a negative offset that would corrupt the measure-number grouping.
The time-signature classification (§4) filters directly on `side === 'on'` and
never passes through `byPlacement`.

### 3. Vertical pairing — `pairTimeSigs`

New function at module scope in `markings.ts`:

```ts
type TimeSigPair = {
  numerator: PageTextItem;
  denominator: PageTextItem;
  rect: Rect;
  text: string;
};
```

```ts
/**
 * Finds vertically stacked digit pairs that form time signatures. Two items
 * pair when they are single digits in the same font, overlap horizontally,
 * sit on different baselines within one item-height of each other, and both
 * overlap the same staff body on the top staff of a system.
 *
 * Operates on the raw `items` array, not the merged runs from `textMarkings`,
 * because merged runs absorb adjacent noteheads/rests and destroy the digit
 * isolation that pairing depends on.
 */
function pairTimeSigs(
  items: readonly PageTextItem[],
  staff: Staff,
  system: System,
  notation: Set<string>,
): TimeSigPair[] {
```

Steps:

1. Filter `items` to those that:
   - Are single or double digits (`TIME_SIG_DIGIT.test(str.trim())`)
   - Are in a notation font (`notation.has(item.fontName)`)
   - Overlap the top staff body vertically (`rect.bottom < staff.top &&
     rect.top > staff.bottom`)
   - Fall within the system's horizontal span

2. Sort by `rect.left`, then group items whose `rect.left` values are within
   a tight horizontal tolerance (half the item width — ~2.5pt in practice).

3. Within each horizontal group, look for exactly two items on different
   baselines (the baseline test from `textMarkings:73-78` will separate them).
   The higher item is the numerator, the lower the denominator.

4. Build a `TimeSigPair` with:
   - `text`: `"${numerator.str}/${denominator.str}"`
   - `rect`: the bounding box enclosing both items

5. Reject groups with more or fewer than two items at one horizontal position
   — three stacked digits are not a time signature.

Complexity note: groups of the same digit at the same x-position repeat on
every staff of the system. The `staffIndex === 0` gate in `pageCandidates`
(§3a) ensures only the top staff's pair is collected. `dedupeMarkings`
(`markings.ts:293-301`) then handles the case where multiple staves' pairs
leak through.

### 3a. On-staff candidate scan in `pageCandidates`

The existing above/below strip scan cannot see on-staff items. Add a separate
pass *after* the existing strip loop, **outside** the `system.staves.forEach`
(it runs once per system, not per staff):

```ts
// On-staff time-signature scan — top staff only.
const topStaff = system.staves[0];
if (topStaff) {
  const pairs = pairTimeSigs(items, topStaff, system, notation);
  for (const pair of pairs) {
    candidates.push({
      pageIndex: page.pageIndex,
      systemIndex,
      staffIndex: 0,
      side: 'on',
      text: pair.text,
      rect: pair.rect,
      offset: 0,
      rightGap: (system.right - pair.rect.right) / height,
      size: (pair.rect.top - pair.rect.bottom) / height,
      value: null,
    });
  }
}
```

Key decisions:

- **Runs on raw `items`**: `pairTimeSigs` receives the raw `PageTextItem[]`,
  not the merged `textMarkings(items)`. The merged runs absorb adjacent
  notation-font items on the same baseline (noteheads, rests) into runs like
  `"4 œ œ"`, destroying the digit isolation that pairing depends on. The
  existing strip scan uses `textMarkings` because it operates in empty margin
  space where merging rejoins split tempo marks; on-staff text has the opposite
  problem.
- **`staffIndex: 0` only**: time signatures apply to the whole system and are
  engraved on every staff, but only the top staff's instance matters.
- **`side: 'on'`**: distinguishes on-staff candidates from the above/below
  strips. `offset` is set to `0` — meaningless for on-staff items, must not
  enter `byPlacement`.
- **Builds the `Candidate` inline** rather than calling `against()`:
  `against()` at `markings.ts:410-436` requires `side: 'above' | 'below'` and
  computes `offset` as a signed distance that goes negative for on-staff items.
  Building inline avoids corrupting the existing measure-number grouping path.

### 4. Time-signature classification in `resolveMarkings`

In `resolveMarkings` (`markings.ts:307-350`), add a time-signature pass
**between** the measure-number pass and the tempo pass:

```ts
// --- after measure numbers (line 318), before tempo marks (line 323) ---
const timeSigs = candidates.filter(
  (candidate) =>
    !kind.has(candidate) &&
    candidate.side === 'on' &&
    candidate.staffIndex === 0,
);
for (const candidate of timeSigs) {
  kind.set(candidate, 'time-signature');
}
```

The `side === 'on'` gate ensures only the on-staff scan's candidates reach
this classification — every `'on'` candidate is a paired time signature by
construction (§3a only emits `pairTimeSigs` results). The
`!kind.has(candidate)` guard is defensive.

### 5. Enclosure bypass for time signatures

`detectMarkings` at `markings.ts:261-271` pads every accepted marking and calls
`enclosure(padded, ink, room)` with `room = staffHeight(staff) * 0.5`. The
`enclosure` function (`:447-475`) absorbs nearby ink comparable in size to the
marking — which for an on-staff time signature means adjacent noteheads, stems,
and barlines, expanding the clip into the music.

This mechanism was designed for markings in empty margin space. On-staff time
signatures need the clip to cover only the stacked pair, not surrounding music.

**Fix:** bypass padding and enclosure for `kind === 'time-signature'`:

```ts
return markings.map((marking) => {
  if (marking.kind === 'time-signature') return marking;
  const staff = page?.systems[marking.systemIndex]?.staves[0];
  const padded = { /* ...existing... */ };
  const room = staff ? staffHeight(staff) * 0.5 : options.padding;
  return { ...marking, rect: enclosure(padded, ink, room) };
});
```

The `rect` on a time-signature marking is already the bounding box of the
paired numerator and denominator items (built by `pairTimeSigs`), which is
tight to the glyphs. No padding or enclosure growth is needed.

### 6. Export `numericValue`

Currently private at `markings.ts:355`. Add `export`:

```ts
export function numericValue(text: string): number | null {
```

No other change to the function.

### 7. Update `selectMarkingCounts` in `score.slice.ts`

`selectMarkingCounts` at `score.slice.ts:179-188` currently returns
`{measure, tempo}`. Add `timeSignature`:

```ts
selectMarkingCounts: createSelector(
  [(state: ScoreState) => state.analysis?.pages],
  (pages) => {
    const markings = pages?.flatMap((page) => page.markings) ?? [];
    return {
      measure: markings.filter((mark) => mark.kind === 'measure').length,
      tempo: markings.filter((mark) => mark.kind === 'tempo').length,
      timeSignature: markings.filter((mark) => mark.kind === 'time-signature').length,
    };
  },
),
```

### 8. Update `getDetectionDescription` in `EditScorePanel.utils.ts`

`getDetectionDescription` at `EditScorePanel.utils.ts:7-16` takes
`{measure, tempo}`. Widen to include `timeSignature`:

```ts
export function getDetectionDescription(markings: {
  measure: number;
  tempo: number;
  timeSignature: number;
}) {
  return `${markings.measure} measure ${
    markings.measure === 1 ? 'number' : 'numbers'
  } · ${markings.timeSignature} time ${
    markings.timeSignature === 1 ? 'signature' : 'signatures'
  } · ${markings.tempo} tempo ${
    markings.tempo === 1 ? 'mark' : 'marks'
  } found. …`;
}
```

### 9. Time signatures in extracted parts — deliberate exclusion

Although `dedupeMarkings`, `markingsFor`, and `markingKey` are kind-agnostic
and would handle `'time-signature'` markings automatically, stamping them onto
extracted parts introduces a silent behaviour change: every part would gain
time-signature clips above it, and the band layout would reserve extra height,
while the controlling checkbox still reads `"Keep measure numbers & tempo marks"`
(`DetectedInstruments.tsx:129`, `EditScorePanel.constants.ts:14,28`).

**Decision:** exclude `'time-signature'` from the part-extraction stamping path
for now. In `markingsFor` (`regions.ts:285-300`), filter them out:

```ts
export function markingsFor(
  rect: Rect,
  systemIndex: number,
  markings: readonly Marking[] = [],
): Marking[] {
  const system = markings.filter(
    (marking) =>
      marking.systemIndex === systemIndex &&
      marking.kind !== 'time-signature',
  );
  // ...rest unchanged
```

This keeps the checkbox label accurate. A future enhancement can add time
signatures to part extraction by updating the label and the `AppPage.ts:116`
e2e helper that pins the checkbox text.

### 10. Detection tests — `tests/unit/lib/markings.test.ts`

Add tests using the existing `staff()`, `page()`, and `text()` helpers. The
notation-font threshold requires ≥4 items with ≥50% on-staff
(`markings.ts:145-151`), so fixtures must include enough notation-font items
to register the font. Model on the existing test at `markings.test.ts:210-224`.

**Important:** `pairTimeSigs` receives the raw `items` array. But
`pageCandidates` currently receives `items` and only builds
`textMarkings(items)` for the strip scan. To pass raw items to `pairTimeSigs`,
the raw `items` array must be available inside `pageCandidates`. The function
signature already accepts `items: readonly PageTextItem[]` — the raw array.
`pairTimeSigs` uses this directly; the strip scan continues to use
`textMarkings(items)`.

Tests:

- **Stacked time signature on the top staff** — build a page with two staves.
  Place two notation-font items at the same x: `"5"` at `staff.top - 2` and
  `"4"` at `staff.top - 2 - height` (stacked pair). Include ≥2 more notation-
  font items with on-staff bounding boxes (e.g. noteheads `"œ"`) so
  `notationFonts` classifies the font. Verify `detectMarkings` returns a
  marking with `kind: 'time-signature'` and `text: '5/4'`.
- **Stacked pair not on inner staff** — same setup but place the pair on
  `staffIndex: 1`. Verify it is not detected (the on-staff scan uses only
  the top staff).
- **Three items at one x are not a time signature** — three digit items stacked
  vertically at one x. Verify no `'time-signature'` marking is produced.
- **Non-digit notation text still skipped** — a notation-font `"mf"` item above
  the top staff (in the above-strip region). With the font registered as
  notation (≥4 items, majority on-staff), verify `"mf"` is not in the results.
- **Time signature does not interfere with measure numbers** — a page with a
  stacked `"4"/"4"` pair on-staff and `"1"` above the top staff. Verify both
  appear with correct kinds.
- **Notation-font single digit on staff without a pair** — a lone `"3"` on the
  staff (no matching item at the same x). Verify it is not classified as a
  time signature.

---

## Part 2: PDF export module

### 11. `src/lib/pdf/markingsExport.ts`

A module that produces a PDF from the detected markings, using the same
`pdf-lib` `embedPages`/`drawPage` clip path that `extractRegions`
(`partExtraction.ts:103-245`) uses. No React or Redux dependency.

#### Types

```ts
export type MarkingsRow = {
  measure: number | null;
  measureMarking: Marking | null;
  eventMarkings: Marking[];
};

export type MarkingsExportResult = {
  rows: MarkingsRow[];
  measuresInferred: boolean;
};
```

Each `MarkingsRow` groups a measure number with the tempo and/or time-signature
markings that occur at that measure. `measureMarking` is the `Marking` object
itself (carrying `rect` and `pageIndex` for clipping), or `null` when
`measuresInferred` is `true` (no measure-number markings detected) — in that
case the measure number is rendered as typeset text using an embedded font.

#### `collectMarkingsRows(analysis: ScoreAnalysis): MarkingsExportResult`

Walks `analysis.pages` in page order.

**System identity:** `systemIndex` is page-local — `markings.ts:172` restarts
at 0 on each page. System identity must be keyed on the tuple
`(pageIndex, systemIndex)`, and the document-wide ordinal must be derived by
accumulating `page.systems.length` across pages in order.

Steps:

1. Flatten all markings from all pages, preserving page/system order.
2. Build a flat list of measure-number markings (`kind === 'measure'`). Parse
   their text using `numericValue` (exported from `markings.ts`), not
   `Number()`, to handle bracketed numbers like `"[9]"`. Key each by
   `(pageIndex, systemIndex)` and `rect.left`.
3. If no measure-number markings exist, set `measuresInferred = true` and assign
   sequential numbers starting from 1, one per `(pageIndex, systemIndex)` tuple,
   derived by iterating `analysis.pages` and accumulating `page.systems.length`.
4. For every `'tempo'` or `'time-signature'` marking, find the nearest measure
   number to its left on the same `(pageIndex, systemIndex)`. If the marking
   sits at or before the first measure number of its system, it shares that
   system's first measure number. If the marking is on a system with no measure
   number at all (and `measuresInferred` is false), look back to the last
   measure number from the previous system (across page boundaries, using the
   ordered flat list).
5. Group the tempo/time-signature markings by their associated measure number
   into `MarkingsRow` objects, sorted by measure number ascending, time
   signatures before tempo marks within each row.

#### `extractMarkings(sourceBytes, analysis, options?): Promise<Uint8Array>`

Produces the output PDF. Follows the `extractRegions` pattern:

```ts
export type MarkingsExportOptions = {
  pageSize?: { width: number; height: number };
  margin?: number;
  rowGap?: number;
};

export async function extractMarkings(
  sourceBytes: Uint8Array,
  analysis: ScoreAnalysis,
  options?: MarkingsExportOptions,
): Promise<Uint8Array>
```

Steps:

1. Call `collectMarkingsRows(analysis)` to get the rows and whether measures
   were inferred.
2. Load the source PDF with `PDFDocument.load(sourceBytes,
   { updateMetadata: false })` — matching `partExtraction.ts:118`.
3. Create the output PDF with `PDFDocument.create()`.
4. Embed a font (`StandardFonts.Helvetica`) for typeset measure labels when
   `measuresInferred` is `true`, and for the optional header line.
5. Collect all unique `(pageIndex, rect)` clips needed — every
   `row.measureMarking.rect` and every `row.eventMarkings[].rect`. Deduplicate
   using the same `clipKey` pattern from `extractRegions`
   (`partExtraction.ts:132-133`).
6. Call `output.embedPages()` once with all clips, exactly as
   `partExtraction.ts:152-159` does.
7. Lay out rows onto output pages:

   **Layout model:** each row is one horizontal line containing:
   - The measure-number clip (or a typeset number when inferred), left-aligned.
   - The event marking clips, placed to the right of the measure number,
     separated by a small horizontal gap.

   Rows flow top-to-bottom. When a row would exceed the page's usable height
   (`pageHeight - 2 * margin`), start a new page. Each clip is drawn at its
   natural height (no scaling unless wider than the printable area, matching
   `extractRegions`'s `Math.min(1, printableWidth / embed.width)` approach).

   If `measuresInferred` is `true`, draw a header line at the top of the first
   page using the embedded font:
   `"(Measure numbers are approximate — no bar numbers were detected)"`

8. Set title and metadata, return `output.save()`.

#### `markingsExportFileName(documentName: string): string`

```ts
export function markingsExportFileName(name: string): string {
  const base = name.replace(/\.pdf$/i, '') || 'score';
  return `${base}-markings.pdf`;
}
```

---

## Part 3: UI changes

### 12. Generalise `SaveCopyPrompt` for reuse

`SaveCopyPrompt` (`PDFEditor/SaveCopyPrompt.tsx`) hardcodes
`id="save-copy-name"` / `htmlFor="save-copy-name"` (`:63`, `:70`) and the label
`SAVE_COPY_AS` (`'Save a copy as'`). It is always mounted —
`getSaveCopyRevealStyles(open)` toggles `invisible`/`grid-rows-[0fr]` but never
unmounts. A second instance creates duplicate `#save-copy-name` elements,
breaking the e2e helper at `AppPage.ts:160`
(`page.locator('#save-copy-name')`) and `:166`
(`page.locator('form').getByRole('button', { name: 'Save' })`) — both are
strict-mode locators that throw on 2 matches.

**Fix:** add `inputId` and `label` props with defaults preserving the existing
call site:

```ts
type SaveCopyPromptProps = {
  open: boolean;
  suggestion: string;
  onSave: (typed: string) => void;
  onCancel: () => void;
  inputId?: string;
  label?: string;
};
```

- Default `inputId` to `'save-copy-name'` and `label` to `SAVE_COPY_AS`.
- Use `inputId` in the `id` and `htmlFor` attributes.
- Use `label` in the `<label>` text.

The existing call site in `PDFEditor.tsx` passes no `inputId` or `label`, so
its behaviour is unchanged. The new markings-export instance passes:

```tsx
<SaveCopyPrompt
  open={isNamingMarkingsExport}
  suggestion={markingsExportFileName(name)}
  onSave={handleExportMarkings}
  onCancel={() => setNamingMarkingsExport(false)}
  inputId="export-markings-name"
  label="Export markings as"
/>
```

Also tighten the e2e helper at `AppPage.ts:166` — the `form` locator is too
broad when two forms are on the page:

```ts
// AppPage.ts:166 — before:
this.page.locator('form').getByRole('button', { name: 'Save' }).click();

// after:
this.page.locator('form:has(#save-copy-name)').getByRole('button', { name: 'Save' }).click();
```

### 13. Export button in `DetectedInstruments`

Add an "Export markings" button in `DetectedInstruments.tsx`, below the existing
extract button. Enabled when
`markings.tempo > 0 || markings.timeSignature > 0`.

Add `EXPORT_MARKINGS = 'Export markings'` to
`EditScorePanel/EditScorePanel.constants.ts`.

Add the button style to `EditScorePanel.styles.ts` — secondary style, matching
the existing extract button but visually subordinate (outline variant).

### 14. Wire `onExportMarkings` through `EditScorePanel`

`EditScorePanelProps` (`EditScorePanel.tsx:6-10`) gains `onExportMarkings`:

```ts
export type EditScorePanelProps = {
  replaceTarget: { name: string; onReplace: () => void } | null;
  isBusy: boolean;
  onExtract: () => void;
  onExportMarkings: () => void;
};
```

Thread it to `DetectedInstruments`, which renders the button.

### 15. `handleExportMarkings` and prompt state in `PDFEditor.tsx`

Add `isNamingMarkingsExport` local state, mirroring `isNamingCopy`:

```ts
const [isNamingMarkingsExport, setNamingMarkingsExport] = useState(false);
```

The handler follows the `extractWith` pattern — async, with `isBusy` guarding
and error reporting:

```ts
async function handleExportMarkings(typed: string) {
  setNamingMarkingsExport(false);
  if (!bytes || !analysis) return;

  setIsBusy(true);
  setError(null);
  try {
    const exported = await extractMarkings(bytes, analysis);
    const fileName = typed.endsWith('.pdf') ? typed : `${typed}.pdf`;
    downloadBytes(exported, fileName, 'application/pdf');
    reportSaved(`Saved ${fileName}`);
  } catch (cause) {
    setError(getExportMarkingsError(cause));
  } finally {
    setIsBusy(false);
  }
}
```

Add `getExportMarkingsError` to `PDFEditor.utils.ts` alongside the existing
`getExtractError`/`getSaveError`:

```ts
export function getExportMarkingsError(cause: unknown) {
  if (cause instanceof Error) return cause.message;
  return 'Could not export markings';
}
```

Wire `() => setNamingMarkingsExport(true)` to `EditScorePanel`'s
`onExportMarkings` prop.

Render the second `SaveCopyPrompt` after the existing one, with the distinct
`inputId` and `label` from §12.

**Reset in `handleClose`**: add `setNamingMarkingsExport(false)` alongside the
existing `setNamingCopy(false)` at `PDFEditor.tsx:325`:

```ts
function handleClose() {
  dispatch(documentClosed());
  releaseDocumentBytes();
  setStatus(null);
  setError(null);
  setNamingCopy(false);
  setNamingMarkingsExport(false);  // ← new
}
```

---

## Part 4: Tests

### 16. `tests/unit/lib/markingsExport.test.ts`

Test `collectMarkingsRows` in isolation, building `ScoreAnalysis` fixtures from
types. The PDF-building function (`extractMarkings`) uses `pdf-lib` and is
integration-level; the unit tests focus on the row-collection logic:

- **Basic case**: a score with measure-number markings at 1, 5, 9 and a tempo
  marking `"Allegro"` near measure 1 and `"Andante"` near measure 5. Verify
  the returned rows have the correct `measure` values, `measureMarking`
  references, and `eventMarkings`.
- **Time-signature event**: a marking with `kind: 'time-signature'` and text
  `"3/4"` appears in the correct row's `eventMarkings`.
- **Same-measure grouping**: a time signature and tempo at the same measure
  both appear in one row's `eventMarkings`, time signature first.
- **Bracketed measure numbers**: a marking with text `"[9]"` parses to
  measure 9 via `numericValue`, not `NaN`. The row's `measure` is `9` and its
  `measureMarking` references the correct `Marking`.
- **No measure numbers**: `measuresInferred` is `true`, rows use sequential
  system numbering (accumulated across pages, not restarting per page), and
  `measureMarking` is `null` on every row.
- **Cross-page system numbering**: a two-page score with 3 systems per page.
  Verify the sequential fallback numbers systems 1-6, not 1-3 then 1-3.
- **No tempo or time-signature markings**: returns an empty rows array.
- **Measure association by horizontal position**: a tempo marking whose
  `rect.left` is between measure 5 and measure 9 is associated with measure 5.

### 17. Detection tests in `tests/unit/lib/markings.test.ts`

As described in §10 above. Each fixture must populate the notation font
properly (≥4 items, majority on-staff) to exercise the real detection path.

### 18. End-to-end test

Add an `exportMarkings(name: string)` helper to `AppPage.ts`, mirroring
`saveCopy` (`:155-169`):

```ts
async exportMarkings(name: string): Promise<Download> {
  await this.page
    .getByRole('button', { name: 'Export markings' })
    .click();

  const nameInput = this.page.locator('#export-markings-name');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(name);

  const [download] = await Promise.all([
    this.page.waitForEvent('download'),
    this.page
      .locator('form:has(#export-markings-name)')
      .getByRole('button', { name: 'Save' })
      .click(),
  ]);
  return download;
}
```

Widen `getMarkingCounts` in `AppPage.ts` to return
`{measure, tempo, timeSignature}`.

Add a spec in `part-extraction.spec.ts` (or a new
`markings-export.spec.ts`) that:
1. Opens the fixture PDF.
2. Waits for detection to complete.
3. Calls `exportMarkings('test-markings.pdf')`.
4. Asserts the download's `suggestedFilename()` is `'test-markings.pdf'`.
5. Asserts the downloaded file is non-empty and is a valid PDF (starts with
   `%PDF`).

---

## Visual regression

The "Export markings" button appears in the `EditScorePanel` sidebar. This
invalidates every full-page baseline that captures the panel: not just
`part-extraction.spec.ts:45-46`, but also `edited-regions.spec.ts`,
`annotations.spec.ts`, and `unsaved-changes.spec.ts` — any test whose
`visual`-gated `toHaveScreenshot` captures the sidebar with the
`DetectedInstruments` section visible. The changed description string from §8
compounds this.

Per this repo's policy, do not run `pnpm test:visual:update` locally. Leave
the baselines failing and note in the report that they must be regenerated in
CI — either by putting the `update-snapshots` label on the PR, or by running
the CI workflow manually with `update_snapshots: true`.

---

## Known limitations

1. **Stacked time signatures only**: only the stacked numerator/denominator
   form (two single-digit text items at the same x on different baselines) is
   detected. This is the universal form in MuseScore, LilyPond, Dorico, and
   Finale exports. A hypothetical engraver emitting `"4/4"` as a single
   slash-joined text run would need a separate scan path.

2. **Time signatures rendered as pure paths (no text layer)**: some engravers
   draw time signatures entirely as vector paths with no text-layer entry. These
   are invisible to the text-based detection pipeline and would require shape
   recognition on the ink layer.

3. **Compound time signatures** (e.g. `3+2/8`): not in scope. Only signatures
   whose numerator and denominator are each one or two digits are detected.

---

## File change summary

| File | Change |
|------|--------|
| `src/lib/pdf/markings.ts` | Add `'time-signature'` to `MarkingKind`; add `TIME_SIG_DIGIT` regex; extend `Candidate.side` to `'on'`; add `pairTimeSigs` function; add on-staff candidate scan in `pageCandidates` (after strip loop, uses raw `items` not `textMarkings`); add time-signature classification pass in `resolveMarkings` (filtering on `side === 'on'`); bypass enclosure for `'time-signature'` in `detectMarkings`; export `numericValue` |
| `src/lib/pdf/markingsExport.ts` | New module: `MarkingsRow`, `MarkingsExportResult`, `collectMarkingsRows` (keys system identity on `(pageIndex, systemIndex)`, uses exported `numericValue`), `extractMarkings` (embeds source-page clips via `pdf-lib` with `{ updateMetadata: false }`, lays out rows onto output pages), `markingsExportFileName` |
| `src/lib/pdf/regions.ts` | Filter `'time-signature'` out of `markingsFor` to exclude from part-extraction stamping |
| `src/store/score.slice.ts` | Add `timeSignature` to `selectMarkingCounts` return |
| `src/components/EditScorePanel/EditScorePanel.tsx` | Add `onExportMarkings` prop to `EditScorePanelProps`, pass to `DetectedInstruments` |
| `src/components/EditScorePanel/EditScorePanel.constants.ts` | Add `EXPORT_MARKINGS` constant |
| `src/components/EditScorePanel/EditScorePanel.styles.ts` | Add export-markings button style |
| `src/components/EditScorePanel/EditScorePanel.utils.ts` | Widen `getDetectionDescription` param to include `timeSignature`; update description string |
| `src/components/EditScorePanel/DetectedInstruments.tsx` | Add "Export markings" button, enabled when `tempo > 0 \|\| timeSignature > 0` |
| `src/components/PDFEditor/SaveCopyPrompt.tsx` | Add `inputId` and `label` props (with backward-compatible defaults `'save-copy-name'` and `SAVE_COPY_AS`) |
| `src/components/PDFEditor/PDFEditor.tsx` | Add `isNamingMarkingsExport` state; second `SaveCopyPrompt` instance (with distinct `inputId="export-markings-name"` and `label="Export markings as"`); async `handleExportMarkings` handler using `extractMarkings` and `downloadBytes`; wire `onExportMarkings` through `EditScorePanel`; add `setNamingMarkingsExport(false)` to `handleClose` |
| `src/components/PDFEditor/PDFEditor.utils.ts` | Add `getExportMarkingsError` alongside existing error helpers |
| `tests/e2e/fixtures/AppPage.ts` | Add `exportMarkings(name)` helper; tighten `saveCopy` form locator to `form:has(#save-copy-name)` at `:166`; widen `getMarkingCounts` to include `timeSignature` |
| `tests/e2e/markings-export.spec.ts` | New: e2e test for the export flow (button → prompt → download) |
| `tests/unit/lib/markings.test.ts` | Add time-signature detection tests (§10) with properly populated notation-font fixtures (≥4 items, majority on-staff), testing stacked pairing |
| `tests/unit/lib/markingsExport.test.ts` | New: unit tests for `collectMarkingsRows` (§16), including cross-page system numbering and bracketed measure numbers |

---

## Order of implementation

1. **Detection types** — `markings.ts`: add `'time-signature'` to
   `MarkingKind`, add `TIME_SIG_DIGIT` regex, extend `Candidate.side` to `'on'`
2. **Vertical pairing** — `markings.ts`: add `pairTimeSigs` function operating
   on raw `PageTextItem[]`
3. **On-staff scan** — `markings.ts` `pageCandidates`: add on-staff candidate
   scan after the strip loop, using `pairTimeSigs` on raw `items`, building
   `Candidate` inline with `side: 'on'` and `offset: 0`
4. **Classification** — `markings.ts` `resolveMarkings`: add time-signature
   pass filtering on `side === 'on'` and `staffIndex === 0`, between measure
   numbers and tempo marks
5. **Enclosure bypass** — `markings.ts` `detectMarkings`: skip padding and
   enclosure for `kind === 'time-signature'`
6. **Export `numericValue`** — `markings.ts`: make the function public
7. **Part-extraction exclusion** — `regions.ts` `markingsFor`: filter out
   `'time-signature'` markings
8. **Detection tests** — `markings.test.ts`: stacked-pair fixtures with
   properly populated notation fonts (§10)
9. **Store** — `score.slice.ts`: add `timeSignature` to `selectMarkingCounts`
10. **Detection description** — `EditScorePanel.utils.ts`: widen
    `getDetectionDescription` param and string
11. **Row collection** — `markingsExport.ts`: types, `collectMarkingsRows`
    (keying on `(pageIndex, systemIndex)`, using exported `numericValue`),
    `markingsExportFileName`
12. **PDF export** — `markingsExport.ts`: `extractMarkings` using `pdf-lib`
    `embedPages`/`drawPage` clip path with `{ updateMetadata: false }`, row
    layout with page breaks, optional typeset measure numbers when
    `measuresInferred`, header line
13. **Export tests** — `markingsExport.test.ts`: verify `collectMarkingsRows`
    against fixture data including bracketed measure numbers, cross-page system
    numbering, and the `measuresInferred` path
14. **Error helper** — `PDFEditor.utils.ts`: add `getExportMarkingsError`
15. **SaveCopyPrompt generalisation** — add `inputId`/`label` props
16. **e2e locator fix** — `AppPage.ts:166`: scope form locator to
    `form:has(#save-copy-name)`; add `exportMarkings` helper; widen
    `getMarkingCounts`
17. **Prop threading** — `EditScorePanel.tsx`: add `onExportMarkings` prop
18. **Button** — `DetectedInstruments.tsx`: render "Export markings", gate on
    `markings.tempo > 0 || markings.timeSignature > 0`; add constant and style
19. **Integration** — `PDFEditor.tsx`: local state for the prompt, second
    `SaveCopyPrompt` with distinct `inputId`, async handler calling
    `extractMarkings` and `downloadBytes`, `getExportMarkingsError`, reset in
    `handleClose`
20. **E2e test** — `markings-export.spec.ts`: button → prompt → download
21. **Validate** — `pnpm test` and `pnpm test:types`. Note visual baselines
    that need CI regeneration across all sidebar-visible specs.
