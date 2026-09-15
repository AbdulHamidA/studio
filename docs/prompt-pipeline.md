# Prompt pipeline contract

> This is the intended contract, not proof the current enhancer meets it.
> The [2026-09-16 code and live-writer audit](prompt-enhancer-audit.md) found
> conflicting scene-expansion instructions, blind-edit routing, literal-text
> deletion and intent-validation gaps. Work is organized in the
> [enhancer tracker](prompt-enhancer-tracker.md) and
> [acceptance plan](prompt-enhancer-test-plan.md). For Board-specific production
> guarantees, use the [Board tracker](board-production-tracker.md).

The prompt assistant is a local editor, not a prompt-lengthener. Its job is to
preserve the user's subject and intent, remove empty quality folklore, resolve
ambiguity only when the selected model needs it, and return an explanation of
what changed. It must never silently replace a failed request with a generic
prompt.

## Inputs and outputs

- Input: the user's prompt and the mode it was written in. The wire values are
  `generate`, `edit` and `video` — not `image`, which this file said for a
  while and no code has ever sent. The selected model's constraints are *not*
  passed today: the host sends the job id, the prompt, the mode and the staged
  images, and nothing else. A rewrite that depends on what the model supports
  cannot be written against the request as it stands.
- Output: one shape, stamped with a `version`, carrying every field on every
  reply — `prompt`, `original`, `outcome`, `changed`, `added`, `dropped`,
  `corrected`, `removed`, `attempt`, `rejected_because`, `saw_image`,
  `description`, `unclear` and `note`. There were five reply shapes with five
  different key sets before this, and a field's absence was something the
  interface had to interpret.
- `removed` is on rejections too. A rejected rewrite hands back the original
  prompt, and without it there was no sign that a cleaned version had ever been
  judged — which is the one fact explaining why a rewrite was attempted.
- `dropped` is diffed against the cleaned prompt, not the typed one, so it
  cannot name a word `removed` has already named. They are different facts and
  the interface draws them as the same red chip under different labels.
- If the request is too unclear to edit safely, it returns the original prompt
  with `outcome: "unclear"` and a reason.
- Empty modifiers such as “masterpiece”, “best quality”, resolution labels,
  and stock-art-site boilerplate are removed before the local writer runs.
- The interface shows whether the prompt changed and exactly which phrases
  were removed; the user remains free to edit the result.

## Board prompt stages

Board prompting is intentionally split because each result needs a different
kind of review:

1. **Read** extracts only character names found in the manuscript.
2. **Plan** divides the prose and must attach an exact source passage and the
   visible character names to every panel.
3. **Prepare** expands each accepted panel into a self-contained visual brief
   while preserving its source, action, shot, cast, place, and dialogue.
4. **Draw** deterministically combines the brief, style, cast/place references,
   and the user's per-panel correction. It does not reinterpret the whole story.
5. **Compose** lays completed panels out in story order and stores pages in the
   same Vault project as their panels and reference sheets.

Coverage, character membership, and source anchoring are validated in code;
they are not entrusted to model arithmetic. Editing the manuscript invalidates
every downstream stage.

Editing one panel invalidates what that change actually reaches, decided in one
place — `staleness` in [boardDoc.ts](../src/lib/boardDoc.ts). A picture is a
drawing of an action, in a place, of these people: changing one of those
retires the picture, and changing the caption or the dialogue does not. Every
edit retires the composed pages. A retired picture goes to the panel's history
rather than being abandoned in the vault, and a worked-up description is
cleared when the fields it was written from change, because the prompt prefers
it to those fields.

Panels carry ids and their work is stored against them, so a panel can be
moved, split, joined, inserted or removed without its picture and its notes
staying behind for whatever lands in that position.
