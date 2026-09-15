# Board: what the first real run showed

2026-09-16. Code baseline `d3da43e`. Machine: Apple Silicon Mac, models as
installed. Writer: `mlx-community/Qwen3-4B-Instruct-2507-4bit`. **No vision
reader installed**, so every rewrite on this machine takes the blind path.

This is the M-lane the [test plan](board-production-test-plan.md) describes, run
for the first time. Everything below is a recorded result, not an inference
from reading the code. Fixture is [FX-01](../engine/fixtures/fx01.json), whose
answer key is committed, so the output could be checked rather than admired.

The engine was driven over its real JSONL protocol with real sealed vault
blobs — the same contract the Rust host speaks — not through mocks.

## What the run cost

| Stage | Time | Notes |
| --- | --- | --- |
| cast | 13.4s | includes the writer's cold load |
| shotlist | 45–58s | five runs, 4B writer, 74-word source |
| enrich | 35.4s | four panels, one place |

## Finding 1 — the panel bound was cutting the end off the story

**Fixed at `d3da43e`.** The headline result, and the reason the run was worth
doing.

FX-01 is 74 words. `_panel_bounds` derives a range of 2–4 from a ratio of one
panel to thirty words. The answer key requires **five** essential beats, so a
correct board was arithmetically impossible before the writer was asked
anything.

The writer returned eight sensible beats. Four were kept — the division was
sliced to the top of the range. The slice takes the front, and the back of a
scene is where its reveal is:

```
MISSING: 'When he opened it, he found the platform empty.'
MISSING: 'The train had gone.'
no panel anchors essential beat b4  (Jonas unlocks the door)
no panel anchors essential beat b5  (the empty platform, the train gone)
coverage 67%
```

Every honesty layer worked. Coverage reported 67% and named the two missing
sentences. `truncated_from` was 8. The interface warned that four beats were
not there and said to split the story if its ending mattered. The board still
could not contain the story.

Controlled: same story, same writer, same settings, the bound the only
variable.

| Panels | truncated_from | Coverage | Essential beats with no panel |
| --- | --- | --- | --- |
| derived (2–4) | 8 | 67% | b4, b5 — the unlocking and the reveal |
| asked for 6 | — | 67% | b3, b4 |
| asked for 8 | — | 83% | none |
| **derived, after the fix** | — | **100%** | **none** |

At eight the single unanchored sentence was "My name is Mira Vale, though Jonas
calls me Mi" — which the key declares `context_only`, a sentence no panel has
to depict. After the fix the derived path returned seven and eight panels on
two runs, 100% both times, every essential beat anchored.

`_panel_bounds` had said what it was for in its own docstring all along: *"Not
a target. It exists so a writer that returns three panels for three thousand
words, or ninety for three hundred, is recognised as having failed rather than
believed."* It was a check being enforced. The range is still computed and
still reported through `out_of_range`; sixty panels is still the bound, because
that is a real limit on what a board holds.

## Finding 2 — a cast description that is not an appearance

**Open.** `CAST_SYSTEM` rule 2 states it plainly: *"A description is what
someone LOOKS LIKE, and nothing else… Not what they do."* The writer returned:

| | Key says | Writer returned |
| --- | --- | --- |
| Mira Vale | `red coat` | `red coat` ✓ |
| Jonas | *(nothing stated)* | `open hand` |
| the guard | *(nothing stated)* | `` ✓ |

"Jonas's open hand" is the phrase in the source, and it is an action. The rule
is stated in the prompt and the model broke it anyway on one of three people.

This is consequential rather than cosmetic: `personBrief` in `Storyboard.tsx`
puts the description into **every panel prompt** as drawing instructions, so
every frame Jonas appears in would be asked for "Jonas: open hand".

Nothing in the pipeline checks that a description describes an appearance.
There is precedent for a deterministic guard here — `_clean_panel` already
refuses invented character names against the source — and no such guard exists
for descriptions. Not attempted, because whether to fix it in the prompt or in
a validator is exactly the kind of question SP-01 is supposed to decide with
more than one fixture.

## Finding 3 — the first-person protagonist is not the lead

**Open.** Mention counts, and the tiers and lead derived from them:

```
Jonas       tier=1  mentions=3
Mira Vale   tier=1  mentions=1
the guard   tier=1  mentions=1
```

Mira narrates. She is in every sentence, as "I", "my" and "me". `_mentions`
deliberately does not count pronouns, for a stated and good reason — *"they
cannot be attributed without resolving them, and a wrong attribution here
changes who the story is about"* — so she scores 1 against Jonas's 3.

`people.sort(key=lambda p: -p["mentions"])` then puts Jonas first, and
`Storyboard.tsx` takes the lead as the first `tier === 1` person. **The lead is
Jonas.** The lead fills the shared cast sheet and the per-panel cast brief, so
the character the board is anchored on is the wrong one.

The engine already detects the condition: `first_person` came back `True`. In
first person there is no attribution ambiguity for "I" — there is exactly one
first-person speaker. What is missing is the link from that speaker to the
named person, which FX-01 states outright in its first sentence and which other
stories will not.

The UI's existing remedy does not fire here: it asks for a narrator name only
when `first_person && !people.some(p => p.tier === 1)`, and there *is* a tier-1
person — the wrong one.

## Finding 4 — the installed runtime cannot run the installed image models

**Open, and not a Board defect.** The HF cache holds
`FLUX.1-schnell-mflux-4bit` and `FLUX.1-Kontext-dev-mflux-4bit`, ~9 GiB each.
The installed mflux refuses both:

```
Could not infer a supported backend from model 'dhairyashil/FLUX.1-schnell-mflux-4bit'.
Pass family='qwen', 'flux2', 'fibo', 'z-image', 'ernie-image', 'wan',
'bonsai', 'minimax-h3', 'seedvr2', or 'swiftvr'.
```

Plain `flux` is not in that list. `catalog.rs` still declares
`family: Some("flux")` for all three FLUX.1 entries, so against this runtime
they are dead entries that a user can install and then fail to use. Worth a
capability probe at catalog load rather than at generation time.

## What this run does not establish

One fixture, one writer, one machine. Two runs of the fixed path is not a
measurement of variance — the two differed from each other (seven panels and
eight), and the two runs before the fix differed too (eight beats and seven).
Finding 1 is strong because the failure was structural and reproduced under a
controlled comparison; findings 2 and 3 are single observations of model
behaviour and need the rest of the fixture set before anything is changed on
their account.

No claim is made here about picture quality. That is the image lane, and it is
recorded separately.
