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
| M1 | No approved text is lost between the writer and the page | BP-402, DR-04 | DONE — `8b02cd1` |
| M2 | A correction can correct one region instead of rerolling the panel | BP-503, SP-05 | DONE — `fb34483` |
| M3 | A composed chapter is exactly one composition | BP-601, BP-603 | DONE — `0e68ac5` |
| M4 | The board survives its own save | BP-104 | DONE — `20e9845` |
| M5 | FX-01 exists as a machine-readable fixture with its oracle | BP-002 | DONE — `ba0026d` |
| M6 | Versioned board document with stable IDs | BP-101, BP-102, BP-103 | DONE — `1094075` |

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

**Acceptance.** Met at `8b02cd1`. `TextThatDoesNotFitIsReported` and the two
parser cases in `test_worker.py` cover it: every spoken line survives parsing
at full length, a cell too small for its dialogue returns a record naming the
panel, the ordinary page reports nothing, and the scroll — which capped at two
balloons and measured nothing at all — measures against the panel it draws
over. The report travels through `compose_board` and the Board shows it as a
blocker before binding.

**Left open deliberately.** The writer's own caption is still bounded at 120
characters when it is parsed, and that slice is silent. It is a bound on
generated narration rather than on approved text — the user edits the caption
afterwards and that edit is not bounded anywhere — but it is the same shape of
defect and belongs in M6's invalidation work, not here.

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

**Acceptance.** Met at `fb34483`, with a caveat worth stating plainly. The
guards in `boardRepair.test.ts` are source-level, in the manner of
`hookOrder.test.ts`: they assert the repair sends its mask, repairs the panel's
own picture rather than the cast sheet, removes the mask from the vault
afterwards, and files the previous picture before overwriting it. That is not
the same as having run it. **There is no harness in this project that renders a
component**, so the behaviour itself — that the painted region changes and the
rest of the panel does not — is unverified by any test and needs a real run on
a real model before M2 can be called proven rather than built. That run is
SP-05's, and it has not happened.

A model that cannot mask fails with the engine's own words. There is no mask
capability in the catalogue to check against — Studio has always worked the
same way — so this is the honest behaviour available, not a capability query.
Adding one belongs with the model catalogue, not here.

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

**Acceptance.** Met at `0e68ac5` for the grouping, which is now `compositions`
in `board.ts` and tested against the case that produced the defect: two runs
stay apart, the newest is last, each run keeps reading order, a shorter later
run does not absorb the longer one's third page, and pages predating the
records are grouped without being claimed as current.

One more defect surfaced while fixing it. The bound PDF is stamped
`model: "composed"` and given `project_index: u32::MAX` so it sorts after every
page — so it *was* a page: shown in the strip, exported alongside them as a
PNG, and handed to the next bind as a page to bind. A comic ending with a PDF
of itself. A page is a picture, and the PDF now carries the composition it was
bound from.

**Still to verify at runtime:** the exported PDF opened outside the app, which
is BT-063's requirement and cannot be met by a unit test.

## M4 — The board survives its own save

Done at `20e9845`. The index write was already atomic — temp file, rename, with
the previous index kept as a backup — so a crash mid-write could not corrupt
it. The risk was the other one: a correct write of wrong content, where
whatever the board holds in memory becomes the only copy 350ms later. That has
happened here once already.

So the previous state is kept before the new one replaces it, under a key
outside the `board-` namespace — inside it, `board_state_list` would have
offered it as a second comic named "draft-prev" holding a copy of the
manuscript. A board that opens empty while an earlier version exists is offered
that version with its first line and panel count; putting it back is the user's
decision, because which of two versions of a manuscript is the right one is not
a question this can answer.

A failed save now stays on screen instead of raising a toast that is gone in
seconds while the board goes on looking exactly as it did.

**Not done:** one step back, not a history. A second bad save overwrites the
good copy. That is the shape BP-101's revisioned artifacts want and this is not
that.

## M5 — FX-01 as a real fixture

Done at `ba0026d`: `engine/fixtures/fx01.json`, with the contract in
`engine/fixtures/README.md`.

It carries what a correct adaptation must **not** claim, with reasons,
alongside what it should — a key made only of expected content passes on output
that invents things beside it. Every sentence resolves to a beat or to declared
context, so a coverage assertion against it is unambiguous.

Pointed at the deterministic pipeline it makes BT-024 a test rather than a
paragraph: a board quoting every sentence verbatim while saying Jonas handed
Mira the key scores 100% coverage with nothing missing.

One correction to the story's own division came out of writing it — the reveal
is both final sentences, so the beat runs to the end of the source.

The other eleven fixtures are authored by the milestone that needs them.

## M6 — Versioned board document

Done at `1094075`, in the parts that were blocking work; see below for what was
not.

Panels carry ids and their work is stored against them. The board rendered from
five arrays lined up by position, and position is not identity: moving two
panels swapped their pictures and notes while each kept its own text, inserting
one at the top shifted every note down, deleting one moved the whole board up —
with the arrays still the right length, so nothing looked wrong until the pages
were read. That is why reorder, insert, delete, split and join did not exist:
every one of them was unsafe to offer. They exist now, as pure functions in
`boardDoc.ts` with 31 tests, and the rail offers them.

Dependency invalidation is one tested rule. Every edit used to retire the
picture, so fixing a comma cost a five-minute render and a different face.

The arrays the interface renders from are derived, so every read site was
unchanged — the diff is in the writes.

**The draft is still version 1, deliberately.** Panels gained an `id` an older
build ignores, and the arrays are still written beside them, derived at save
time. A draft opens in either build. A migration that cannot be opened by
yesterday's build must be right the first time, and this one holds every
manuscript the user has written.

**Not done, and named rather than implied:**

- **No undo.** BP-103 asks for it. A structural operation is currently final.
- **No revisioned artifacts or approval records.** BP-101's `Approval` table and
  BP-105 are untouched; nothing carries an input hash, so nothing can go stale
  against one. The invalidation above is eager rather than recorded.
- **No Rust or Python validation of the document.** The contract lives in
  TypeScript. BP-101 asks for shared validation at the boundary.
- **Untested in a browser.** `boardDoc` is covered; `Storyboard` is guarded at
  source level and by type-checking. No test renders it — see N7 for the
  harness that now makes that possible, and it has not been used here.

## Change log

- 2026-09-16: Created. Corrected three gap-register entries against the code,
  recorded the whole-blob save risk, deferred the gates that have no cohort,
  and set the execution order.
- 2026-09-16: M4, M5 and M6 landed (`20e9845`, `ba0026d`, `1094075`), with
  `scripts/preflight.sh` clean at each. M6 is partial by intent: the structural
  and invalidation work is done and the revision/approval half is not. Two more
  defects surfaced while doing them and are fixed: the overflow report named a
  position captured at compose time, which stops being true the moment anything
  moves, and the panel list was keyed by position, so React reused the wrong
  row for the panel now standing there.
- 2026-09-16: M1, M2 and M3 landed (`8b02cd1`, `fb34483`, `0e68ac5`), each with
  `scripts/preflight.sh` clean. Two defects were found while fixing them that
  the gap register did not carry: the vertical scroll measured its lettering
  against nothing at all, and the bound PDF counted as a page of the comic it
  was bound from. Both are fixed. What is *not* established: no real model has
  been run against any of this, so M2's painted repair is built and guarded but
  not demonstrated, and no exported PDF has been opened outside the app.
