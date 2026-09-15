# Board milestones

Updated: 2026-09-16. Code baseline: `f5bf928`.

The [production tracker](board-production-tracker.md) describes the whole
manga-production target: eight phases, seven gates, thirty tasks. It is the
right description of the destination and the wrong unit of work. Several of its
gates cannot be attempted at all yet — they require named human reviewers,
three independent readers and three pilot creators — so left as `TODO` they
make every gate look merely unstarted rather than unattemptable.

This file is the execution order. Each milestone is small enough to land and
verify, ordered by what actually goes wrong today rather than by phase number,
and every one of them names the BP tasks it advances so the two documents do
not drift apart.

## Corrections to the gap register

Three entries in the tracker's §2 register were written from a reading of the
code that the code does not support. They are corrected here rather than
silently; the tracker's effort ratings and its §12 ordering both depend on them.

| Tracker claim | What the code shows | Consequence |
| --- | --- | --- |
| "Correction still regenerates a whole image … `drawOne` uses no mask" — BP-503, High/L | Masked regeneration exists end to end. The engine takes a `mask`, [MaskCanvas](../src/components/MaskCanvas.tsx) paints one, and [Studio](../src/components/Studio.tsx) drives the whole path. Board passes `mask: null` at three call sites in [Storyboard](../src/components/Storyboard.tsx) | The first useful slice is S, not L. It is the largest quality-per-effort item on the board, and it does not wait on the document schema |
| "Export revision membership needs validation … reproduce before claiming an observed export failure" — BP-601/BP-603 | Confirmed by reading. [Gallery](../src/components/Gallery.tsx) groups pages by `model === "composed"` across the whole project, while the Board already keeps its own ordered `pages` list in the draft. `recastSheet` and `rebuildPlace` clear that list without removing the old pages from the vault | A known defect with a known fix anchor, not an open question. Still worth reproducing at runtime, but not as a precondition for fixing it |
| "Lettering can discard approved content … `_cell_text_plan` may shrink, clip, or drop text" — BP-402 | True, and narrower than it reads. Script detection, non-Latin font fallback, RTL detection and display shaping already exist in `worker.py`. There are exactly two places text is lost: `_clean_dialogue` caps the list at two entries and each line at ninety characters, and `_cell_text_plan` returns a bubble count below what it was given | A closeable task with two named sites, rather than an open-ended one covering "lettering" |

Two further observations the register does not carry:

- **The draft is one blob, overwritten whole.** [boardDraft](../src/lib/boardDraft.ts)
  serialises the entire board into a single string and writes it through one
  call. There is no prior copy. A failed or interrupted write does not lose a
  field, it loses the board. BP-104 asks for save failures to be exposed; it
  should also require the previous blob to survive the next one.
- **The honesty signals for a long story already exist.** `op_shotlist`
  returns `too_long`, `truncated_from` and `out_of_range`. BP-201's real gap is
  continuation, not reporting.

## Status discipline

`DONE` means the acceptance line below it is satisfied by a test that runs in
CI, or by a recorded manual result where no automated oracle exists. `DEFERRED`
carries its reason. Nothing here is marked from inspection alone.

| Milestone | Goal | Advances | Status |
| --- | --- | --- | --- |
| M1 | No approved text is lost between the writer and the page | BP-402, DR-04 | ACTIVE |
| M2 | A correction can correct one region instead of rerolling the panel | BP-503, SP-05 | TODO |
| M3 | A composed chapter is exactly one composition | BP-601, BP-603 | TODO |
| M4 | The board survives its own save | BP-104 | TODO |
| M5 | FX-01 exists as a machine-readable fixture with its oracle | BP-002 | TODO |
| M6 | Versioned board document with stable IDs | BP-101, BP-102, BP-103 | TODO |

Gates G2, G5 and G7 are `DEFERRED — no pilot cohort`. They require readers and
pilot creators who have not been recruited. Recording that is more useful than
leaving them to look unstarted.

## M1 — No approved text is lost

**Why first.** DR-04 says text loss is the one failure that can never be
waived, and it is the cheapest of these to fix. Two functions.

Today a panel with three spoken lines keeps two, and a line of a hundred
characters is stored at ninety. Neither loss is reported. Downstream,
`_cell_text_plan` can return a bubble count lower than the dialogue it was
handed, and clips the caption before it drops a balloon. A board can therefore
be composed, look finished, and be missing speech that the user approved.

- Keep every line and every character the writer returned. The cap on what can
  be *drawn* belongs to the composer, which knows the cell size; the parser
  does not and must not guess.
- When the composer cannot fit the text at the smallest readable face, it
  reports what did not fit — panel index, which lines, how much — instead of
  quietly setting fewer of them.
- The Board surfaces that report as a blocker on the composed page.

**Acceptance.** Engine tests: text longer than the old caps survives parsing
intact; a cell too small for its dialogue returns a structured overflow rather
than a reduced count. Frontend test: the overflow report reaches the Board.

## M2 — A correction can be a correction

**Why second.** The work is already built and shipped elsewhere in the app.
Board is the only surface that does not use it.

A note on a panel today changes the brief and the seed and redraws the whole
image, so a correct face is rerolled in order to fix a wrong hand. Studio has
painted-region regeneration; Board sends `mask: null`.

- Redraw offers a painted region where the model supports masking, and says so
  plainly where it does not. Capability is asked, not assumed.
- The note path stays. They are different repairs: a note changes what was
  asked for, a mask changes where it applies.
- The previous image is kept, not replaced, so a worse result can be rejected.

**Acceptance.** Board can regenerate a painted region of a drawn panel; the
prior image remains reachable; a model without mask support produces an
explanation rather than a silently unmasked redraw.

## M3 — A composed chapter is exactly one composition

**Why third.** It is the only confirmed wrong-output defect: the exported
chapter can contain pages from two different compositions.

The Board knows which pages it composed and keeps them in order. The Gallery
does not ask, and instead treats every composed image in the project as a page
of the current chapter. Recasting the sheet clears the Board's list and leaves
the old pages in the vault, where the Gallery still finds them.

- Each composition gets an identity, and every page it produces carries it.
- The Gallery binds and exports the pages of one composition, in its order.
- Pages from an earlier composition remain in the vault and remain openable.
  They are history, not members.

**Acceptance.** Composing twice over a changed board yields two separately
bindable sets; the exported PDF contains the pages of the selected one, in
order, and none of the other.

## M4 — The board survives its own save

BP-104, reduced to the part that can be done before the schema changes: keep
the previous serialised draft until the new one is written, and surface a
failed write instead of leaving the user believing their board is saved.

## M5 — FX-01 as a real fixture

BP-002, narrowed from twelve fixtures to the one whose oracle is already
written. Mira, Jonas and the brass key are the de facto fixture across
`board.test.ts`, `test_worker.py` and the comments in `worker.py` and
`board.ts` — this milestone formalises what is already being tested against,
with exact spans and expected records. The other eleven fixtures are authored
by the phase that needs them, not up front.

## M6 — Versioned board document

BP-101 through BP-103: stable IDs, revisioned artifacts, dependency
invalidation, structural editing. The large one. It is last of these six
deliberately — M1 to M4 are all independent of it, and a schema migration
landing before any user-visible improvement is how a plan like this stalls.

## Change log

- 2026-09-16: Created. Corrected three gap-register entries against the code,
  recorded the whole-blob save risk, deferred the gates that have no cohort,
  and set the execution order.
