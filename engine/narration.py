"""A narration script: the story as one storyteller would tell it aloud.

Much of what people write is not written to be read aloud -- chat-style
lines, emoji, abbreviations, texting spellings -- and Hinglish written in the
Latin alphabet cannot be pronounced by any local voice: an M4 test of one
sentence through Kokoro's Hindi voice, transcribed back by Whisper, came out
22% wrong in Latin script ("main" as में, "ki" as काई, "peete hain" as
"पी थेन") and 7% wrong once the same words were written in Devanagari. So the
story model prepares a script: the same story, retold for the ear, never
translated, and -- for Hindi voices -- written in Devanagari, with English
words spelled the way an Indian speaker says them.

The script is a separate text the person reads and can edit before anything
is narrated; the chapter itself is never changed.
"""
from __future__ import annotations

import re

import story

DEVANAGARI = re.compile(r"[ऀ-ॿ]")
LATIN = re.compile(r"[A-Za-z]")

SCRIPT_SYSTEM = """You prepare a story for one storyteller to read aloud, the way an audiobook
narrator tells it. Retell the passage as natural spoken narration in the same
language mix the author uses: keep Hindi as Hindi and English as English, never
translate. Keep every event, every line of dialogue and its meaning, in order;
introduce speech naturally so a listener knows who is talking. Turn chat-style
lines, emoji, symbols, abbreviations, numbers and texting spellings into the
words a storyteller would say. Do not add events, opinions or a summary.
Return only the narration text, as paragraphs.
"""

DEVANAGARI_RULE = """Write the whole narration in Devanagari script: Hindi words in their normal
Hindi spelling, and English words spelled in Devanagari as an Indian speaker
says them (meeting as मीटिंग, but as बट, office as ऑफिस). No Latin letters.
"""


class Stop(Exception):
    """Raised by a writer or progress callback: keep what is written so far."""


def _ok(text, source, devanagari):
    """Whether a reply is a plausible retelling of the passage."""
    if not text.strip():
        return False
    ratio = len(text) / max(1, len(source))
    if not 0.4 <= ratio <= 3.0:
        return False
    if devanagari:
        letters = len(DEVANAGARI.findall(text)) + len(LATIN.findall(text))
        return letters and len(DEVANAGARI.findall(text)) / letters >= 0.85
    return True


def _clean(text):
    text = re.sub(r"^```\w*\s*|\s*```$", "", text.strip())
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def script(source, write, devanagari=False, progress=lambda *_: None, words=350):
    """The narration script for a chapter, passage by passage.

    A passage the writer cannot retell acceptably after one retry keeps its
    original text; Stop keeps the passages done and the original for the rest.
    Returns (script, stopped)."""
    if not isinstance(source, str) or not source.strip():
        raise ValueError("there is no text to prepare")
    groups = story.passages(source, max_words=words, max_units=40)
    system = SCRIPT_SYSTEM + (DEVANAGARI_RULE if devanagari else "")
    parts, stopped = [], False
    for i, group in enumerate(groups):
        text = "".join(u["text"] for u in group)
        if stopped:
            parts.append(text.strip())
            continue
        try:
            progress(i, len(groups))
            told = ""
            for attempt in range(2):
                reply = _clean(write(system, ("Passage:\n" + text) if not attempt else
                                     ("Passage:\n" + text + "\nYour previous version did not follow the rules: "
                                      "keep every event, do not translate"
                                      + (", and use only Devanagari letters." if devanagari else "."))))
                if _ok(reply, text, devanagari):
                    told = reply
                    break
            parts.append(told or text.strip())
        except Stop:
            stopped = True
            parts.append(text.strip())
    return "\n\n".join(p for p in parts if p), stopped


def segments(script_text):
    """The script as narration segments: one storyteller, paragraph by paragraph."""
    return [{"speaker_id": None, "text": p.strip() + "\n\n", "mood": ""}
            for p in re.split(r"\n\s*\n", script_text) if p.strip()]
