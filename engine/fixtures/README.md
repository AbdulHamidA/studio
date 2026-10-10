# Fixtures

Source material with a human-authored answer key, so a test can assert what a
board should contain rather than what it currently produces.

Everything here is written for this project and is redistributable with it. No
manuscript belonging to anyone else goes in this directory, and neither does
anything from a user's vault: a fixture is committed, and a story is private.

## The contract

Each fixture is one JSON file carrying, at minimum:

- `id`, `version`, `language`, `rights`
- `source` — the exact text, and the only place it is written down
- `entities` — canonical id, aliases, whether it narrates, and what the source
  actually says about its appearance. An empty `appearance_stated` is a fact,
  not a gap to fill
- `beats` — id, the event in a sentence, which entities act in it, whether it
  is essential, a `span` into `source`, and `depends_on` where one beat is only
  possible because of another
- `state_transitions` — what changes hands or condition, and at which beat
- `speech` — who says it, and whether they are visible when they do
- `must_not` — claims a correct adaptation cannot make, each with the reason.
  This is the half that catches a plausible wrong answer; a test built only
  from what *should* be present passes on output that also invents things
- `comprehension` — questions a reader of the finished pages should be able to
  answer, with the answers

`span` is a `[start, end]` pair of Python string indices into `source`, and
`source[start:end]` must be exactly the quoted text. The offsets are over
Python's string indexing, which is by code point. Anything reading these from
JavaScript or Rust has to agree on that before adding a fixture with characters
outside the basic plane.

## What is here

| Fixture | Covers |
| --- | --- |
| FX-01 | Same-person aliases, an unnamed first-person narrator, offscreen speech, a key changing hands, and a reveal that depends on it |

The other eleven fixtures named in the [test plan](../../docs/board-production-test-plan.md)
are written by the milestone that needs them, not up front. FX-01 exists first
because its oracle was already written out in full, and because Mira, Jonas and
the brass key are already the de facto fixture across `test_worker.py`,
`board.test.ts` and the comments in `worker.py` and `board.ts` -- this makes
the thing they are all informally testing against into something a test can
actually read.

FX-01 version 2 scores importance and mood as well as essential-beat recall.
`fx01.analysis.json` is a scripted, schema-valid scene response used to check
the shared director and audio segmentation. It is an answer key, not evidence
of a real model run. `test_story.py` checks that every essential source span
and the final reveal survive, aliases retain one ID, and the guard's exact
warning is kept without putting him in frame.
