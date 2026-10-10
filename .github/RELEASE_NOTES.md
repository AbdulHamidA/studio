## Model Studio 0.3.0 preview 3

Story analysis that finishes and keeps its work, fast narration with Hindi and
Indian English voices, a redesigned Vault, and an accessibility and visual
consistency pass across the app. Download the Apple Silicon DMG or app ZIP below.

## Story analysis (Board and Audiobook)

- Fixes the analysis failures reported in preview 2: "character narrator is not
  in this scene" and "dialogue must include every complete quoted utterance".
  Narrator variants are accepted and reused across scenes, and dialogue text and
  positions now come from the source, so a model can no longer drop or alter a
  quote; replies only attribute speakers.
- Much faster: replies are compact (quotes are numbered, outfits and rooms are
  stated once per passage) and passages are larger. On an M4 with the 4B
  analyst, a test chapter went from 527 s to about 100-150 s.
- Speech tags settle who speaks: "Agnes said", "I said" and lines continuing
  past a tag are attributed from the prose, even over the model. First-person
  stories get a Narrator. Untagged lines are never guessed.
- Stop keeps what is finished; Continue analysis picks up the rest with any
  analyst. One passage that cannot be validated no longer discards the chapter.
- Small-model slips (a curly or stray quote in JSON, an invented character,
  skipped sentences) are repaired instead of failing the passage.
- Progress shows "scene i of N" with time remaining.

## Audiobook

- New Kokoro 82M engine: about 14x real time on an M4 (Qwen3-TTS is about 1.8x),
  with Hindi voices that read Devanagari as Hindi and English with an Indian
  accent, plus US/UK English, Spanish, French, Italian and Portuguese. It
  installs its text packages with the model and works offline.
- A quick voice-only analysis for narration: speakers and mood only, in a
  fraction of the time of the full Board analysis.
- Preview any voice before choosing it; voices are grouped by language with
  Indian voices first and have readable names. macOS Indian voices (Rishi, Aman,
  Tara, Lekha and others) are listed too.
- A player with 0.5x-4x speed (pitch preserved) and scene markers, in a bar that
  keeps playing while you work in any other screen.
- Narration is split at sentences, not mid-sentence, and carries scene mood.
- Each speech engine remembers its own cast; typing in direction fields no
  longer drops letters.

## Board

- Five steps across the top; earlier steps can be revisited without losing work.
- Panels stay editable while others are drawing; drawing stops after an engine
  crash instead of retrying into the same failure.
- Character pills and every field are keyboard accessible and labelled.
- Faces drift less: panels use the character sheet together with the previous
  frame, and the chain re-anchors periodically.

## Vault

- Redesigned library: grouped grid with size control, filters, search, sort,
  multi-select, keyboard navigation, and media-specific viewers (images with
  zoom and pan, video, audio, PDFs, a comic reader).
- The viewer docks inside the Vault by default so other screens stay usable,
  with a toggle to full window; returning to the Vault keeps your place.
- Running jobs are listed in the sidebar on every screen with Stop.

## Reliability and security

- The vault index can no longer be lost by a crash mid-save.
- Out-of-memory crashes are reported as such with what to change; the memory
  guard is no longer bypassed with low-RAM mode off.
- Long recordings stream by range instead of decrypting the whole file per seek.

## Accessibility and design

- WCAG 2.2 AA pass: text and control contrast, one keyboard focus ring,
  labelled controls, announced status and errors, 24px targets, reduced motion
  and high-contrast support, Cmd +/- zoom.
- One design system: a single set of surfaces, type scale, corners, labels and
  headings across every screen. The sidebar is grouped and becomes an icon rail
  in narrow windows.

## Preview limitations

- Real-model checks were run on an M4 with 16 GB for story analysis, voice
  analysis and Kokoro narration on test chapters; long novels, image continuity
  and listening quality still need validation on more Macs.
- The 4B analyst still misattributes some untagged dialogue; the 8B story model
  is more accurate where memory allows.
- Model download sizes and peak memory for new models are estimates.
- The app is ad-hoc signed; signing and notarisation are not complete.
- Wan still-image animation remains unverified.

## Validation before tagging

312 frontend tests, the production build, 420 engine tests, Rust formatting,
clippy with warnings as errors, 75 Rust tests and the vault/storage example
probes all pass on Apple Silicon macOS.

## Installing

Download the `.dmg`, open it, and drag **Model Studio** to Applications.

**It will refuse to open the first time.** macOS says the app "is damaged and
can't be opened" for anything not signed by a paid Apple Developer account.
It is not damaged; it is unsigned. Clear the quarantine flag once:

```sh
xattr -dr com.apple.quarantine "/Applications/Model Studio.app"
```

Then open it normally. You only need to do this once per install.

## What happens on first run

The app has no models and no Python inside it. On first launch it sets up a
private runtime under `~/Library/Application Support/com.melp.modelstudio`,
which is about **3 GB** and takes a few minutes. Nothing is installed
system-wide and nothing else on your Mac is touched.

It then offers to install the models that make it work — around **9 GB** for
the starter set. You can pick your own instead.

Budget roughly **12 GB of disk and twenty minutes** before you can make a
picture, most of it downloading.

## Requirements

- **Apple Silicon.** M1 or later. There is no Intel build and there cannot be
  one: MLX has no other backend.
- **macOS 13** or later.
- **16 GB of memory** to run the models in the catalog comfortably. 8 GB will
  run the smallest ones only, and the app tells you which before you download
  anything.
- **Disk.** 12 GB to get started; more for each additional model. Sizes are
  listed before you commit to a download.

## Nothing leaves the machine

No account, no API key, no telemetry, no cloud inference. The only network
traffic is downloading models from Hugging Face, which you initiate.
Everything the app produces is encrypted at rest before it touches disk.

## Verifying the download

`SHA256SUMS.txt` is attached. Check it with:

```sh
shasum -a 256 -c SHA256SUMS.txt
```
