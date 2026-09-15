# Prompt enhancer milestones

Updated: 2026-09-16. Code baseline: `0e68ac5`.

The [audit](prompt-enhancer-audit.md), [tracker](prompt-enhancer-tracker.md)
and [test plan](prompt-enhancer-test-plan.md) describe the enhancer's problems
and a twenty-task programme for them. This file is the execution order, written
after verifying every code-derived claim in those three documents against the
code. It follows the same rule as [the Board's](board-milestones.md): the
corrections first, then work small enough to land.

## Corrections to the audit

Most of it holds. Every PD observation in `scripts/audit_prompt_enhancer.py`
reproduces, and the routing, cleaning, validation, cancellation and UI findings
are accurate as written. Five things are not.

| Claim | What the code shows |
| --- | --- |
| AF-04: `_keeps_intent`'s "name and comment promise more than it proves" | The weakness is already documented in the code and *asserted as fact by a test*. `_keeps_intent` is weak, but it does not misrepresent itself. The real defect is different and larger — see M2 below |
| AF-10: "the one-helper-resident policy is not enforced" | Enforced in three directions of four. `_helpers_resident` and `_unload_assistant` → `_unload_writer` mean the generator loader, the video route and the idle path all free both helpers. The single unguarded transition is reader ↔ writer, and it is two calls, not a policy to build |
| `prompt-pipeline.md`: "Output: `prompt`, `changed`, `removed`" | The success reply carries eleven fields, and `removed` is absent from **every** rejection reply. On rejection the user gets their untouched prompt back, folklore included, with no record that anything was stripped |
| Tracker and pipeline doc: tasks are `image \| edit \| video` | The wire value is `"generate"`, not `"image"`. Schema work written from the docs will mismatch it |
| Audit §2: "282 tests passed in 7.123 s", quoted as the frozen E0 baseline | 283 with 6 skipped here. Interpreter-dependent, and it will not reproduce as written |

Also: the host string calls the writer "a 2.3 GiB download"; the catalogue
declares 2.12 and the UI says 2.1 GB. Three numbers for one model, and PE-503
owns only the tooltip.

## Capability the tracker prices as new

Four things the documents do not name at all, each of which changes an estimate.

- **`_carries`** — an all-content-words, inflection-tolerant preservation check,
  documented in the code as "deliberately not `_keeps_intent`", already wired
  into the Board's brief validator and already tested. PE-202 ("extract explicit
  constraints with source spans and bindings", Critical/L) is priced as though
  the repo has no per-constraint preservation primitive. It has one that already
  survives paraphrase.
- **`_enrich_edit_instruction` / `_compose_edit_instruction`** — a deterministic,
  zero-inference edit composer with pronoun resolution and preservation-clause
  conflict detection, tested across roughly fifteen cases. Handed no facts it
  returns the user's words plus "keeping everything else in the picture
  unchanged", which *is* the conservative edit policy PE-102 and PE-103 propose
  to build. PE-103 is about eight lines, not an S blocked behind an M.
- **Bounded repair** — `_repair_dropped` with a homophone guard and a
  two-missing-word cap, plus a lower-temperature retry and two semantic
  adjudication points. PE-204 is a redesign of an existing loop.
- **Accept/keep/undo, token streaming into Studio, and temp-file ownership** are
  all shipped and tested. PE-403 is snapshot binding only; PE-404 is half-built;
  PE-402's genuine remainder is one filename edge case.

## Gaps no document mentions

1. **Prefix matching accepts subject substitution.** `_dropped_words` matches
   `k.startswith(stem) or stem.startswith(k)` with no length bound, and
   `_keeps_intent` does the same on four-character prefixes. Run against the
   real code: `a cat on a chair` → `a catalogue on a chair` is accepted `ok`.
   So are `a red car` → `a red cardigan`, `a man on a boat` → `a mango on a
   boat`, and `2 red cars` → `three red carts`. This is the failure
   `_misspelling_of` exists to stop, reopened from the other side, and no PD
   case covers it.
2. **`/usr/share/dict/words` holds no inflected forms.** `cars`, `trees`,
   `hands`, `holds`, `wears` are all absent, and `_corrections` only skips words
   that are *in* the dictionary — so every plural noun and third-person verb in
   a prompt is eligible to be reported to the user as a typo. The audit reports
   the `wears → warm` symptom and attributes it to vocabulary matching; the
   cause is the word list, and no task touches it.
3. **`removed` and `dropped` report the same word twice, as two different red
   chips.** `_dropped_words` diffs against the *uncleaned* prompt while
   validation used the cleaned one, so `a masterpiece 8k cat` yields
   `removed: [masterpiece, 8k]` *and* `dropped: [masterpiece]`, both rendered
   identically. The user is told the rewrite no longer says a word and that the
   word was removed on purpose.
4. **Helper loaders skip the MLX cache ceiling.** `_apply_policy_once` is never
   called from `_load_writer` or `_load_assistant`, and the policy test
   hard-codes three route names, so the writer load is the one allocating route
   with no bound on it.
5. **`mlx_vlm` is imported unconditionally at the top of `op_assist`**, even for
   text-only requests that never call `ask()`.
6. **Video has no streaming draft.** It registers the progress listener and
   discards `p.text`, so its assist button is still the spinner that `dbff986`
   removed from Studio.
7. **The UI acceptance lane has no harness.** Seven test-plan cases are UI-lane;
   `package.json` has no jsdom, no happy-dom and no testing-library. That work
   is unpriced and sits under four Critical tasks.

## Ordering

Everything in the tracker routes through PE-101, a three-layer schema version
that itself waits on a fixture freeze and a contract ratification. Nothing ships
for three gated steps. PE-202 alone then gates the whole E2–E5 chain, and no
image is looked at until E5, which is the failure the audit's own §6.5 warns
about.

The milestones below are ordered by what is wrong now, and none of the first
three needs a schema field.

| Milestone | Goal | Advances | Status |
| --- | --- | --- | --- |
| N1 | An edit is routed as an edit, with or without a reader | PE-103, AF-02 | DONE — `1d24b43` |
| N2 | A rewrite cannot swap the subject for a longer word | — (gap 1) | DONE — `1d24b43`, partial |
| N3 | The proposal shows what it knows and says each thing once | PE-404, AF-12 | DONE — `1d24b43` |
| N4 | Cancel cancels; both helpers release each other | PE-402, AF-09/10 | DONE — `42d589f` |
| N5 | A rejection says what was stripped | — (gap 3, pipeline doc) | DONE — `1d24b43` |
| N6 | The typo list stops flagging plurals | — (gap 2) | DONE — `42d589f` |
| N7 | A UI harness, before the tasks that assume one | PE-401 | DONE — `0473710` |
| N8 | Versioned request/result schema | PE-101 | DONE — `e39929a`, partial |

### N1 — an edit is routed as an edit

`editing = mode == "edit" and bool(staged) and can_read`. With no reader
installed, or no image staged, an edit request is handed the scene-direction
system prompt and treated as a fresh generation — the one case where the user
has explicitly said what they want changed about a picture that already exists.

`_clarify_edit` already returns the composed instruction with zero inference
when it has no facts, and that path is already tested. The change is to route on
mode alone and make the vision call conditional inside the branch.

### N2 — bound the prefix match

Done in `_dropped_words`: stems must agree to within one letter. `cat →
catalogue`, `car → cardigan`, `man → mango` and `bell → bellows` are now
reported as losses, and `_carries` refuses them.

**Partial, and the residue is named.** The bound is one letter and not zero
because zero fails two of the file's own inflection tests — `a man runs`
against `running`, and the `RepairDroppedWords` cases. That leaves `cars →
carts` accepted, since the stems `car` and `cart` agree to within a letter. One
letter of slack is the price of not calling every English verb a dropped word.

`_keeps_intent` is **deliberately unchanged**, against the audit's framing. It
is an `any` over content words — one survivor passes, which is what a floor is
for — so `a catalogue on a chair` passes on `chair` alone, and correctly. Its
prefix match also cannot be bounded by length: `red → reddish` grows four
letters legitimately while `man → mango` grows two and does not, so no
threshold separates them. The place to catch a swapped subject is the stem
comparison, and that is where the bound went. The deeper fix the audit points
at — routing the enhancer through `_carries`, which already exists and already
checks every content word — is still open and belongs with N8.

### N3 — the proposal tells the truth about itself

`result.note` is built by the engine, typed in TS, styled, and rendered in only
two of the three branches — so the blind-mode warning is constructed and thrown
away. One line. It becomes load-bearing the moment N1 lands, because N1 makes
blind mode the common edit path. Deduplicating `removed` against `dropped`
(gap 3) belongs here too.

### N4 — cancellation and helper residency

Done at `42d589f`. Cancellation propagates rather than becoming an ordinary
negative result — caught by the bare handler it became a DIFFERENT verdict or a
directly composed instruction, and the request carried on building a reply
about a rewrite the user had stopped waiting for.

The helper guard was missing in the one direction that always happens: reading
a picture then writing about it is every assisted edit, and it held both the 2B
reader and the 4B writer. The writer's loader releases the reader alone, since
`_unload_assistant` would release the writer on its way to loading it.

Neither helper loader bounded the process, so the 3.2 GiB writer was the one
allocating route in the engine with no MLX cache ceiling — reached first, from
a text box, while the machine already holds whatever the user was working on.
The test enumerating those routes now names all five.

Two further things from the gap list came with it: `mlx_vlm` was imported at
the top of `op_assist`, so every text-only rewrite loaded the vision stack
before writing a word; and the video assist button was still the spinner
`dbff986` removed from Studio, registering the progress listener and discarding
`p.text`.

### N5 — a rejection is not silent about cleaning

Done alongside N3: all three rejection replies carry `removed`. A rejected
rewrite no longer hands back the original prompt with its folklore intact and
no indication that a cleaned version was ever judged.

### N6 — the dictionary

Done at `42d589f`. An inflection of a word is a word. Stemming covers most of
it; two shapes it misses are handled beside it — the doubled final consonant,
and the plain `-s` plural on a word already ending in `e`, where the suffix
table matches `es` first and stems `trees` to `tre`. That last one is why
`trees → tree` survived the first attempt.

Real typos are untouched: `hous`, `tabel` and `pictuer` still correct, and a
real word is still never a misspelling of another real word.

### N7 — the harness

Done at `0473710`. jsdom plus testing-library, with the default environment
still `node`: a component test opts in with `@vitest-environment jsdom` in its
own docblock, so the file that needs a DOM is the file that says so.

The Tauri host stub throws by default. A test reaching an undeclared command
fails naming it, rather than receiving `undefined` and asserting something
about a screen the real app cannot reach — the particular way a mocked test
lies.

Seven cases on `PromptProposal`, verified by deleting the note line and
watching exactly one of them fail.

**Not used yet on the screens that most need it.** `Storyboard` has no
component test; M6 rebuilt its state model and is guarded only at source level
and by the type checker.

### N8 — the schema

Done at `e39929a`, and narrower than PE-101 as written.

What shipped is the half that was causing defects: one constructor for every
assist reply, every field present every time, stamped with a version, and a
mistyped field name raising rather than becoming a field the interface silently
never sees. There were five reply shapes with five key sets, and two omitted
`outcome` — which is how the user came to be shown their own untouched prompt
headed "Suggested prompt".

`prompt-pipeline.md` is corrected: the wire mode is `generate`, not `image`.

**Not done:**

- **The request is still not versioned or validated.** The host sends job id,
  prompt, mode and images. A rewrite that depends on the model's capabilities
  still cannot be written, which is PE-101's actual motivation.
- **No Rust or Python validation of the reply.** The shape is enforced by one
  Python constructor and described in a TypeScript interface. Nothing checks
  that they agree; the test asserts the Python side only.
- **`version` is a stamp, not a negotiation.** Nothing reads it. It is there so
  a log says which contract it was written against.

## What is not claimed

No image has been compared. Every finding above is from reading the code and
running the deterministic paths; none of it establishes that a longer or
better-formed prompt produces a better picture. A paired-image probe on the
current build, before any of this, would cost far less than PE-501 and would
say whether the writer is worth the scaffolding.

## What N1–N3 and N5 do not establish

No image has been generated or compared. The routing change means an edit with
no reader installed now takes the edit path, and the composed instruction is the
one that was already tested — but whether the resulting picture is better is
unmeasured, and this is exactly the claim §6.5 of the audit warns against
making. The paired-image probe below is still the right next thing.

## Change log

- 2026-09-16: Created. Verified the three enhancer documents against the code,
  corrected five claims, named four already-shipped capabilities the tracker
  prices as new and seven gaps it does not mention, and set an execution order
  that does not begin with a schema.
- 2026-09-16: N4, N6, N7 and N8 landed (`42d589f`, `0473710`, `e39929a`),
  preflight clean at each. N8 is partial and its remainder is named above.
  **A correction to the entry below:** the `dropped` fix claimed for `1d24b43`
  did not land in the code. A later assertion in the same edit aborted before
  the file was written, and the test added with it called `_dropped_words`
  directly rather than through `op_assist`, so it passed against a call site
  that was never changed. Fixed at `e39929a` and now asserted at the call site,
  because a test of a pure function cannot see which argument production hands
  it.
- 2026-09-16: N1, N3 and N5 landed at `1d24b43`; N2 landed partially, with its
  residue named above. `scripts/preflight.sh` clean. One correction to this
  file's own first draft: hardening `_keeps_intent` was attempted, broke
  existing inflection tests, and was reverted — the audit's AF-04 reading of
  that function was right that it is weak and wrong about where to fix it.
