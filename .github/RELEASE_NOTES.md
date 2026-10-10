## Model Studio 0.3.0 preview 1

This preview adds shared story analysis, Board continuity controls, and local
neural Audiobook generation. Download the Apple Silicon DMG or app ZIP below.

## Changes

- Board and Audiobook share an encrypted book, chapter and character library.
- Story analysis preserves source coverage and dialogue, with more frames for
  important turns and an editable plan before drawing.
- Character identity is separate from current outfits and temporary conditions.
  Clothing changes replace the earlier state; compatible finished frames support
  continuity. Fixed place sheets are skipped for structured stories.
- Panel controls expose current outfit, expression, body language and location
  state. Previously analyzed chapters need reanalysis to populate the new fields.
- Audiobook offers narrator and character voice assignments, encrypted WAV
  recordings, playback and export through Vault.
- Models adds Qwen3 8B/14B story analysts and Qwen3-TTS 1.7B CustomVoice neural
  narration. Neural narration has nine voices, language selection and delivery
  directions; system speech remains a fallback.

## Preview limitations

- Real model inference, image continuity, neural voice listening quality and
  WebKit playback still need validation on Apple Silicon macOS. The release
  workflow checks and builds the native app, but does not run downloaded models.
- Neural reading pace is approximate. Voice cloning is not implemented.
- Model download sizes and peak memory for the new models are estimates.
- The app is ad-hoc signed; signing and notarisation are not complete.
- Wan still-image animation previously produced noisy output and remains unverified.

## Validation before tagging

201 frontend tests and the production frontend build passed. All 30 shared-story
and audio tests passed, with Rust formatting and diff checks clean. Native build
checks run in the macOS release workflow; they could not run in the Linux coding
workspace. The full Python suite on Linux retained 10 environment failures due to
missing macOS fonts and the system dictionary.

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
