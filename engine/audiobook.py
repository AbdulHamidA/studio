"""Offline macOS narration. Intermediates live only in private staging."""
import io
import os
import re
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path


def voices():
    if sys.platform != "darwin":
        return []
    out = subprocess.run(["/usr/bin/say", "-v", "?"], check=True,
                         capture_output=True, text=True, timeout=20).stdout
    result = []
    for line in out.splitlines():
        match = re.match(r'(.+?)\s+([a-z]{2,3}_[A-Za-z_]+)\s+#', line)
        if match:
            result.append({"id": match[1].strip(), "language": match[2]})
    return result


def run_process(args, check_cancel):
    with tempfile.TemporaryFile() as errors:
        proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=errors)
        try:
            while proc.poll() is None:
                check_cancel()
                time.sleep(0.05)
            check_cancel()
            if proc.returncode:
                raise RuntimeError(f"Local speech command failed (exit {proc.returncode}). Check the installed voice.")
        finally:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()


def render_segment(text, voice, rate, directory, check_cancel):
    text_path, aiff, wav = [os.path.join(directory, n) for n in ("speech.txt", "speech.aiff", "speech.wav")]
    Path(aiff).unlink(missing_ok=True)
    Path(wav).unlink(missing_ok=True)
    Path(text_path).write_text(text, encoding="utf-8")
    run_process(["/usr/bin/say", "-v", voice, "-r", str(rate), "-f", text_path, "-o", aiff], check_cancel)
    run_process(["/usr/bin/afconvert", "-f", "WAVE", "-d", "LEI16@24000", "-c", "1", aiff, wav], check_cancel)
    return Path(wav).read_bytes()


def synthesize(segments, narrator, assignments, rate, staging, check_cancel,
               progress=lambda *_: None, render=render_segment, available=None):
    available = {v["id"] for v in voices()} if available is None else set(available)
    if narrator not in available or any(v not in available for v in assignments.values()):
        raise ValueError("choose an installed macOS voice for narrator and characters")
    if type(rate) is not int or not 80 <= rate <= 300:
        raise ValueError("speech rate must be 80..300 words per minute")
    output, frames = io.BytesIO(), 0
    with tempfile.TemporaryDirectory(prefix="audiobook-", dir=staging) as directory:
        os.chmod(directory, 0o700)
        with wave.open(output, 'wb') as final:
            final.setnchannels(1)
            final.setsampwidth(2)
            final.setframerate(24000)
            for i, segment in enumerate(segments):
                check_cancel()
                progress(i, len(segments))
                for part in re.findall(r'[\s\S]{1,1800}(?:\s|$)|[\s\S]{1,1800}', segment["text"]):
                    if not part.strip() or not any(c.isalnum() for c in part):
                        continue
                    check_cancel()
                    data = render(part, assignments.get(segment["speaker_id"], narrator),
                                  rate, directory, check_cancel)
                    with wave.open(io.BytesIO(data), 'rb') as audio:
                        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 24000):
                            raise ValueError("voice output must be mono 24 kHz PCM")
                        count = audio.getnframes()
                        if count == 0:
                            raise ValueError("voice produced no audio")
                        final.writeframesraw(audio.readframes(count))
                        frames += count
    if not frames:
        raise ValueError("chapter produced no spoken audio")
    return output.getvalue(), frames / 24000


NEURAL_MODEL_ID = "qwen3-tts-1.7b-custom-6bit"
NEURAL_REPO = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-6bit"
NEURAL_SPEAKERS = ("ryan", "aiden", "vivian", "serena", "dylan", "eric", "uncle_fu", "ono_anna", "sohee")
NEURAL_LANGUAGES = ("auto", "english", "chinese", "japanese", "korean", "german", "french", "russian", "portuguese", "spanish", "italian")


def neural_voices():
    # Speaker identities are multilingual; language is selected separately.
    return [{"id": speaker, "language": "multilingual"} for speaker in NEURAL_SPEAKERS]


def speech_chunks(text, limit=350):
    """Bound inference without dropping, duplicating or rewriting source text."""
    while len(text) > limit:
        boundaries = [m.end() for m in re.finditer(r'[.!?。！？]\s+|\n+|\s+', text[:limit])]
        end = boundaries[-1] if boundaries else limit
        yield text[:end]
        text = text[end:]
    if text:
        yield text


def load_neural_model():
    from huggingface_hub import snapshot_download
    from mlx_audio.tts.utils import load_model
    try:
        local = Path(snapshot_download(NEURAL_REPO, local_files_only=True))
    except Exception as exc:
        raise ValueError("Download Audiobook voices (Qwen3-TTS 1.7B) in Models first") from exc
    if not (local / "speech_tokenizer" / "config.json").is_file():
        raise ValueError("The audiobook model download is incomplete; download it again in Models")
    # Use the local snapshot, never a repo ID, during synthesis.
    model = load_model(local)
    if model.tokenizer is None or model.speech_tokenizer is None:
        raise ValueError("The audiobook model tokenizer could not be loaded; check its installation")
    return model


def synthesize_neural(segments, narrator, assignments, rate, check_cancel,
                      progress=lambda *_: None, language="auto", delivery="",
                      directions=None, character_directions=None, load=load_neural_model):
    if narrator not in NEURAL_SPEAKERS or any(v not in NEURAL_SPEAKERS for v in assignments.values()):
        raise ValueError("choose a neural narrator and neural character voices")
    if language not in NEURAL_LANGUAGES:
        raise ValueError("unsupported narration language")
    if type(rate) is not int or not 80 <= rate <= 300:
        raise ValueError("reading pace must be 80..300")
    directions, character_directions = directions or {}, character_directions or {}
    if not isinstance(delivery, str) or len(delivery) > 1500 or any(
            not isinstance(v, str) or len(v) > 1500 for v in directions.values()):
        raise ValueError("voice directions must be text under 1,500 characters")
    check_cancel()
    model = load()
    output, frames = io.BytesIO(), 0
    try:
        import numpy as np
        supported = {s.lower() for s in model.get_supported_speakers()}
        if narrator not in supported or any(v not in supported for v in assignments.values()):
            raise ValueError("a selected voice is not supported by the downloaded model")
        with wave.open(output, 'wb') as final:
            final.setnchannels(1)
            final.setsampwidth(2)
            final.setframerate(24000)
            for i, segment in enumerate(segments):
                check_cancel()
                progress(i, len(segments))
                speaker_id = segment["speaker_id"]
                voice = assignments.get(speaker_id, narrator)
                direction = directions.get(speaker_id, character_directions.get(speaker_id, ""))
                pace = "Read slowly with measured pauses." if rate < 140 else "Read briskly but clearly." if rate > 190 else "Read at a natural conversational pace."
                instruct = " ".join(filter(None, ["Read the supplied text verbatim. Do not add words.", delivery, direction, f"Scene mood: {segment.get('mood')}." if segment.get("mood") else "", pace]))
                for part in speech_chunks(segment["text"]):
                    if not any(c.isalnum() for c in part):
                        continue
                    count, token_count = 0, 0
                    check_cancel()
                    results = model.generate_custom_voice(text=part, speaker=voice,
                        language=language, instruct=instruct, stream=True,
                        streaming_interval=0.5, max_tokens=2048, verbose=False)
                    try:
                        for result in results:
                            check_cancel()
                            token_count += getattr(result, "token_count", 0)
                            if token_count >= 2048:
                                raise ValueError("neural narration reached its token limit; no incomplete chapter was saved")
                            if result.sample_rate != 24000:
                                raise ValueError("neural voice output must be 24 kHz")
                            samples = np.asarray(result.audio, dtype=np.float32).reshape(-1)
                            if not np.isfinite(samples).all():
                                raise ValueError("neural voice produced invalid audio samples")
                            pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
                            final.writeframesraw(pcm)
                            frames += len(samples)
                            count += len(samples)
                    finally:
                        if hasattr(results, "close"):
                            results.close()
                    if not count:
                        raise ValueError("neural voice produced no audio for a passage")
        if not frames:
            raise ValueError("chapter produced no spoken audio")
        check_cancel()
        return output.getvalue(), frames / 24000
    finally:
        # No neural model stays resident beside the next story/image model.
        del model
        import gc
        gc.collect()
        try:
            import mlx.core as mx
            mx.clear_cache()
        except ImportError:
            pass
