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
