"""Shared, versioned story analysis. No model or platform dependencies.

Offsets are Python Unicode code-point offsets into chapter.source. Renderers
use the stored text, not JavaScript string slicing. Model replies reference
numbered source units; the model never retypes the author's narration.
"""
from __future__ import annotations
import copy
import hashlib
import json
import re
import uuid

SCENE_SYSTEM = """You are a story editor and director. Return only the requested JSON,
compact on one line with no indentation.
Read this scene for causality, dramatic turns and emotion, not equal coverage.
Use the supplied numbered source units, each exactly once, in order. Group
adjacent units into beats. Importance is 1 (context), 2 (quiet action), 3
(meaningful change), 4 (turn), 5 (climax/reveal). Preserve the ending.
Every visible.character_id and dialogue.speaker_id must EXACTLY match an id in
the character bible or in this reply's characters array. For a new character,
declare a unique short local id (c1, c2, c3), then reuse that exact ID in beats.
Never use an undeclared ID or the schema placeholder as a character reference.
Canonical characters have stable IDs. Reuse them for aliases; never create a
second person for a narrator already named. New characters must have a name
or noun phrase literally in this scene; never invent appearance or aliases.
List in characters only people new to the bible, or a known person with a new
literal alias; refer to everyone else by their bible id without repeating them.
Keep a speaking character offscreen when only heard. Dialogue holds only words
inside quotation marks, never narration. Attribute every quoted utterance; use
null speaker_id when uncertain rather than guessing. Dialogue text must be an
exact substring of the source. Do not paraphrase it.
Beats describe visible action, location, tension, mood, and each visible
character's expression and body language. Do not invent events. Distinguish
what happens from how the frame conveys its emotional meaning.
Character visual describes lasting identity only (face, hair, build, distinguishing
features), never clothing, accessories, injury or wetness. Those belong in each
visible actor's appearance: the COMPLETE current outfit and temporary condition,
not a delta. Carry it forward until the source changes it; a changed dress REPLACES
the old dress, never layers over it. Do not invent unspecified details.
location_id is a stable descriptive key for the actual room/place; reuse on return.
location_state describes current layout, important objects, lighting and weather.
Carry unchanged facts forward, but replace facts changed by the story.
"""


VOICE_SYSTEM = """You cast an audiobook. Return only the requested JSON, compact on one line.
Quoted speech in the passage is numbered like [3]“...”. For every number give the
speaker's character id, or null when the text does not make the speaker clear.
Use ids from the character bible. Declare only people new to the bible in
characters, with a short local id (c1, c2) and the name exactly as the source
gives it, then use that id. Never use a pronoun, a group, or a phrase describing
someone as a name. For unnamed first-person narration the name Narrator is
allowed. mood is the passage's emotional tone in a few words. voice is a short
direction for how a new person sounds.
"""


def voice_instruction(group, characters):
    """The passage with its quotes numbered, for speaker attribution only."""
    text, cursor, numbered = ''.join(u["text"] for u in group), 0, []
    for n, (at, quoted) in enumerate(quotes(text), 1):
        open_at = at - 1 if at and text[at - 1] in '“"「' else at
        numbered.append(text[cursor:open_at] + f"[{n}]")
        cursor = open_at
    numbered.append(text[cursor:])
    bible = [{k: c[k] for k in ("id", "name", "aliases", "voice")} for c in characters]
    schema = {"mood": "emotional tone", "characters": [{"id": "c1", "name": "literal source name",
              "aliases": [], "voice": "voice direction"}], "speakers": [{"quote": 1, "speaker_id": "c1"}]}
    return ("Character bible:\n" + json.dumps(bible, ensure_ascii=False)
            + "\nReturn this schema:\n" + json.dumps(schema, ensure_ascii=False)
            + "\nPassage:\n" + ''.join(numbered))


def voice_scene_reply(raw, group, number):
    """A voice reply restated as a scene reply, so `parse_scene` applies every
    identity and source rule to it unchanged. One beat per passage: the
    audiobook needs who speaks and the mood, not shots or appearances."""
    raw = raw.strip()
    if raw.startswith('```json') and raw.endswith('```'):
        raw = raw[7:-3].strip()
    reply = json.loads(raw)
    if not isinstance(reply, dict):
        raise ValueError("reply must be an object")
    said = {}
    for line in _array(reply.get("speakers", []), "speakers"):
        if isinstance(line, dict) and type(line.get("quote")) is int:
            who = line.get("speaker_id")
            said[line["quote"]] = who if isinstance(who, str) and who.strip() else None
    text = ''.join(u["text"] for u in group)
    characters = [{**c, "visual": ""} for c in _array(reply.get("characters", []), "characters")
                  if isinstance(c, dict)]
    mood = reply.get("mood") if isinstance(reply.get("mood"), str) else ""
    return json.dumps({
        "title": f"Passage {number}", "summary": "Voice casting", "characters": characters,
        "beats": [{"units": [u["id"] for u in group], "importance": 2, "tension": 2,
                   "action": "Narrated passage", "setting": "", "mood": mood[:200], "visible": [],
                   "dialogue": [{"speaker_id": said.get(n), "text": quoted, "offscreen": False}
                                for n, (_, quoted) in enumerate(quotes(text), 1)]}]})


def units(source):
    """Sentence units, keeping multi-sentence quoted dialogue intact."""
    result, start, quote = [], 0, None
    pairs = {'“': '”', '「': '」', '"': '"'}
    for i, ch in enumerate(source):
        closed_quote = False
        if quote:
            if ch == quote and (i == 0 or source[i - 1] != "\\"):
                quote = None
                closed_quote = True
        elif ch in pairs:
            quote = pairs[ch]
        if not quote and (((ch in ".!?。！？" or (closed_quote and i > 0 and source[i - 1] in ".!?。！？")) and (i + 1 == len(source) or source[i + 1].isspace()))
                          or (ch == "\n" and (i + 1 == len(source) or source[i + 1] != "\n"))):
            if source[start:i + 1].strip():
                result.append({"id": len(result), "start": start, "end": i + 1, "text": source[start:i + 1]})
                start = i + 1
    if start < len(source):
        if not source[start:].strip() and result:
            result[-1]["end"] = len(source)
            result[-1]["text"] += source[start:]
        else:
            result.append({"id": len(result), "start": start, "end": len(source), "text": source[start:]})
    return result


def passages(source, max_words=450, max_units=8):
    """Bound calls at source-unit boundaries; explicit scene breaks end a call."""
    groups, group, words = [], [], 0
    for unit in units(source):
        if len(unit["text"]) > 16000:
            raise ValueError("A single source passage is over 16,000 characters; split it at paragraph boundaries before analysis")
        n = len(unit["text"].split())
        if group and (len(group) >= max_units or words + n > max_words
                      or re.search(r'\n\s*(?:\*\s*\*\s*\*|---+)\s*\n', unit["text"])):
            groups.append(group)
            group, words = [], 0
        # A single enormous sentence still needs bounded input.
        if n > max_words and not re.search(r'[“"「]', unit["text"]):
            if group:
                groups.append(group)
                group, words = [], 0
            pieces = list(re.finditer(r'\S+\s*', unit["text"]))
            start = unit["start"]
            for at in range(0, len(pieces), max_words):
                end = unit["start"] + pieces[min(at + max_words, len(pieces)) - 1].end()
                groups.append([{"start": start, "end": end, "text": source[start:end]}])
                start = end
            continue
        # Paragraph breaks do not end a call. Dialogue puts nearly every line
        # in its own paragraph, so a 300-word exchange cost eleven writer
        # calls, each re-sending the whole instruction to analyse one line.
        group.append(unit)
        words += n
    if group:
        groups.append(group)
    for group in groups:
        for i, unit in enumerate(group):
            unit["id"] = i
    return groups


def instruction(group, characters, continuity=None):
    schema = {
        "title": "scene title", "summary": "causal/emotional meaning",
        "characters": [{"id": "c1", "name": "literal source name",
                        "aliases": [], "visual": "lasting face/hair/build only, no outfit",
                        "voice": "voice direction"}],
        "beats": [{"units": [0], "importance": 3, "action": "visible action",
                   "setting": "location", "location_id": "stable room/place key",
                   "location_state": "current layout, objects, light and weather", "mood": "emotional tone", "tension": 3,
                   "visible": [{"character_id": "c1", "expression": "expression",
                                "body_language": "pose", "appearance": "complete current outfit and temporary condition"}],
                   "dialogue": [{"speaker_id": None, "text": "exact quoted words",
                                 "offscreen": True}]}],
    }
    return ("For unnamed first-person narration only, canonical name Narrator is allowed. "
            "Never use Narrator when a known character already narrates. "
            "Do not group multiple people by shared third-person pronouns.\nCharacter bible:\n"
            + json.dumps([{**c, "visual": c["visual"][:VISUAL_LIMIT]} for c in characters], ensure_ascii=False)
            + "\nPrior continuity state (apply only unchanged facts):\n" + json.dumps(continuity or {}, ensure_ascii=False)
            + "\nReturn this schema with one beat per meaningful moment:\n"
            + json.dumps(schema, ensure_ascii=False)
            + "\nNumbered source units:\n" + json.dumps(group, ensure_ascii=False))


def _text(value, field, empty=True):
    if not isinstance(value, str) or len(value) > 4000 or (not empty and not value.strip()):
        raise ValueError(f"{field} must be a {'nonempty ' if not empty else ''}string")
    return value.strip()


# Curly, straight and Japanese quotes. A quote never crosses a line break, so
# a paragraph left open by the continued-speech convention cannot swallow the
# narration that follows it.
# An opening quote that ends its paragraph unclosed, with the next paragraph
# reopening, is continued speech and still a complete utterance.
QUOTE = re.compile(r'[“"]([^”"\n]+)(?:[”"]|(?=\n[ \t]*\n\s*[“"]))|「([^」\n]+)」')


def quotes(text):
    """(offset, utterance) for each complete quoted utterance, outer space trimmed."""
    result = []
    for m in QUOTE.finditer(text):
        group = 1 if m.group(1) is not None else 2
        inner = m.group(group)
        if inner.strip():
            result.append((m.start(group) + len(inner) - len(inner.lstrip()), inner.strip()))
    return result


VISUAL_LIMIT = 600


def _merge_visual(known, new):
    """Add only facts not already known; identity text stays bounded.

    Every scene re-describes the cast. Appending each description grew the
    text without limit until the book failed validation and every panel
    prompt carried the whole history."""
    merged = known.strip()
    for fact in re.split(r'(?<=[.;])\s+|\s*;\s*', new.strip()):
        fact = fact.strip().rstrip('.;').strip()
        if not fact or _plain(fact) in _plain(merged):
            continue
        candidate = f"{merged}; {fact}" if merged else fact
        if len(candidate) > VISUAL_LIMIT:
            break
        merged = candidate
    return merged[:VISUAL_LIMIT]


def _plain(text):
    return re.sub(r'[\W_]+', ' ', text).strip().casefold()


def _array(value, field):
    if not isinstance(value, list):
        raise ValueError(f"{field} must be an array")
    return value


def parse_scene(raw, group, bible, scene_id):
    """Strict JSON and source/identity validation. No partial JSON salvage."""
    raw = raw.strip()
    if raw.startswith('```json') and raw.endswith('```'):
        raw = raw[7:-3].strip()
    reply = json.loads(raw)
    if not isinstance(reply, dict):
        raise ValueError("scene must be an object")
    title = _text(reply.get("title"), "title", False)
    summary = _text(reply.get("summary"), "summary", False)
    characters = copy.deepcopy(bible)
    lookup = {c["id"]: c["id"] for c in characters}
    source = ''.join(u["text"] for u in group)
    local_ids, dropped = set(), set()
    narrative = QUOTE.sub("", source)
    first_person = bool(re.search(r'\b(?:I|me|my|myself|we|us|our)\b', narrative, re.I))
    for person in _array(reply.get("characters"), "characters"):
        name = _text(person.get("name"), "name", False)
        local_id = _text(person.get("id"), "character id", False)
        if local_id in local_ids:
            raise ValueError("each local character ID must be unique")
        local_ids.add(local_id)
        if re.fullmatch(r'(?:the\s+)?narrator', name, re.I):
            name = "Narrator"
            known = [c for c in characters if c["name"] == "Narrator"
                     or set(c["aliases"]).intersection({"I", "my", "me"})]
            if len(known) == 1:
                # Models re-declare the narrator per passage; bind to the known one.
                lookup[local_id] = known[0]["id"]
                continue
            if len(known) > 1:
                raise ValueError("ambiguous narrator; use the narrator's exact character ID")
            if not first_person:
                # A third-person narrating voice is not a person in the scene.
                dropped.add(local_id)
                continue
        aliases = [_text(a, "alias", False) for a in _array(person.get("aliases", []), "aliases")]
        aliases = [a for a in aliases if a.casefold() not in {"he", "she", "they", "him", "her", "his", "their", "we", "you"}]
        identity = {name.casefold(), *(a.casefold() for a in aliases)}
        matches = [c for c in characters if c["id"] == local_id or identity.intersection(
            {c["name"].casefold(), *(a.casefold() for a in c["aliases"])})]
        if len(matches) > 1:
            raise ValueError(f"ambiguous character identity: {name}")
        existing = matches[0] if matches else None
        # Only literal aliases can be added to the persistent bible.
        aliases = [a for a in aliases if re.search(r'(?<!\w)' + re.escape(a) + r'(?!\w)', source, re.I)]
        anonymous_narrator = name == "Narrator"
        if not existing and not anonymous_narrator and not re.search(r'(?<!\w)' + re.escape(name) + r'(?!\w)', source, re.I):
            raise ValueError(f"character {name} is not in this scene")
        if name.casefold() in {"i", "me", "my", "he", "she", "they", "him", "her", "we", "you"}:
            raise ValueError("use a canonical name, not a pronoun")
        visual = _text(person.get("visual", ""), "visual")
        voice = _text(person.get("voice", ""), "voice")
        if existing:
            existing["aliases"] = list(dict.fromkeys([*existing["aliases"], *aliases, name]))
            # First chapter's identity stays stable; later facts are additive.
            existing["visual"] = _merge_visual(existing["visual"], visual)
            if not existing["voice"]:
                existing["voice"] = voice
        else:
            existing = {"id": str(uuid.uuid4()), "name": name, "aliases": aliases,
                        "visual": _merge_visual("", visual), "voice": voice}
            characters.append(existing)
        lookup[local_id] = existing["id"]
    # The model may use a canonical name or alias instead of the requested ID.
    # Resolve only exact, unique bindings to validated characters; no fuzzy
    # matching or character invention. Generated UUIDs also remain valid.
    names = {}
    for character in characters:
        lookup.setdefault(character["id"], character["id"])
        for name in [character["name"], *character["aliases"]]:
            names.setdefault(name.strip().casefold(), set()).add(character["id"])

    def resolve(reference, field):
        if not isinstance(reference, str) or not reference.strip():
            raise ValueError(f"{field} must name a declared character ID")
        reference = reference.strip()
        if reference in dropped:
            return None
        if reference in lookup:
            return lookup[reference]
        matches = names.get(reference.casefold(), set())
        if len(matches) == 1:
            return next(iter(matches))
        if len(matches) > 1:
            raise ValueError(f"{field} is ambiguous: {reference!r}; use its exact character ID")
        if re.fullmatch(r'(?:the\s+)?narrator', reference, re.I):
            return None
        valid = ', '.join(f"{local}={next(c['name'] for c in characters if c['id'] == cid)}"
                          for local, cid in lookup.items())
        raise ValueError(f"{field} {reference!r} is not declared. Valid IDs: {valid or '(none)'}. "
                         "Declare new people in characters before referencing them in beats.")

    beats, consumed = [], []
    for i, beat in enumerate(_array(reply.get("beats"), "beats")):
        ids = _array(beat.get("units"), "units")
        if not ids or any(type(n) is not int or n < 0 or n >= len(group) for n in ids):
            raise ValueError("beat units must be valid source-unit numbers")
        consumed.extend(ids)
        start, end = group[ids[0]]["start"], group[ids[-1]]["end"]
        excerpt = ''.join(group[n]["text"] for n in ids)
        importance, tension = beat.get("importance"), beat.get("tension")
        if type(importance) is not int or not 1 <= importance <= 5:
            raise ValueError("importance must be 1..5")
        if type(tension) is not int or not 1 <= tension <= 5:
            raise ValueError("tension must be 1..5")
        visible = []
        for actor in _array(beat.get("visible"), "visible"):
            cid = resolve(actor.get("character_id"), "visible character")
            if cid is None:
                continue
            if cid in [a["character_id"] for a in visible]:
                raise ValueError("duplicate visible character")
            visible.append({"character_id": cid,
                            "expression": _text(actor.get("expression"), "expression"),
                            "body_language": _text(actor.get("body_language"), "body language"),
                            "appearance": _text(actor.get("appearance", ""), "appearance")})
        # The source, not the reply, decides what was said and where: every
        # quoted utterance becomes a line with its exact span. Model lines only
        # attribute speakers, so a retyped, trimmed, merged or skipped quote
        # cannot drop or alter the author's words.
        dialogue = [{"speaker_id": None, "text": text, "offscreen": True,
                     "start": start + a, "end": start + a + len(text)} for a, text in quotes(excerpt)]
        cursor = 0
        for line in _array(beat.get("dialogue"), "dialogue"):
            if not isinstance(line, dict) or not isinstance(line.get("text"), str):
                continue
            said = _plain(line["text"])
            at = next((n for n in range(cursor, len(dialogue)) if said and (
                said == _plain(dialogue[n]["text"]) or said in _plain(dialogue[n]["text"])
                or _plain(dialogue[n]["text"]) in said)), None)
            if at is None:
                continue
            # One reply line may join an utterance the narration interrupts.
            last = at
            while last + 1 < len(dialogue) and _plain(dialogue[last + 1]["text"]) in said:
                last += 1
            for n in range(at, last + 1):
                if line.get("speaker_id") is not None:
                    dialogue[n]["speaker_id"] = resolve(line["speaker_id"], "dialogue speaker")
                if type(line.get("offscreen")) is bool:
                    dialogue[n]["offscreen"] = line["offscreen"]
            cursor = last + 1
        beats.append({"id": f"{scene_id}-b{i + 1}", "start": start, "end": end,
                      "source": excerpt, "importance": importance, "tension": tension,
                      "action": _text(beat.get("action"), "action", False),
                      "setting": _text(beat.get("setting"), "setting"),
                      "location_id": _text(beat.get("location_id", ""), "location id"),
                      "location_state": _text(beat.get("location_state", ""), "location state"),
                      "mood": _text(beat.get("mood"), "mood"),
                      "visible": visible, "dialogue": dialogue})
    if consumed != list(range(len(group))):
        raise ValueError("beats must cover every source unit exactly once, in order")
    return {"id": scene_id, "title": title, "summary": summary,
            "start": group[0]["start"], "end": group[-1]["end"], "beats": beats}, characters


def _remember_state(state, beat):
    for actor in beat["visible"]:
        if actor.get("appearance"):
            state["characters"][actor["character_id"]] = actor["appearance"]
    key = beat.get("location_id") or beat["setting"].casefold()
    if beat.get("location_state"):
        state["locations"][key] = beat["location_state"]


def _unanalysed_scene(group, scene_id, number):
    """Exact source and quotes for a passage the writer could not analyse.

    One stubborn passage used to discard every scene already analysed. The
    passage keeps its words, its quoted speech (unattributed) and the board
    still gets a frame for it; nothing about who or where is guessed."""
    beats = []
    for i, unit in enumerate(group):
        beats.append({"id": f"{scene_id}-b{i + 1}", "start": unit["start"], "end": unit["end"],
                      "source": unit["text"], "importance": 2, "tension": 2,
                      "action": unit["text"].strip()[:300], "setting": "", "location_id": "",
                      "location_state": "", "mood": "", "visible": [],
                      "dialogue": [{"speaker_id": None, "text": text, "offscreen": True,
                                    "start": unit["start"] + a, "end": unit["start"] + a + len(text)}
                                   for a, text in quotes(unit["text"])]})
    return {"id": scene_id, "title": f"Passage {number} (not analysed)", "summary": "",
            "start": group[0]["start"], "end": group[-1]["end"], "beats": beats, "unanalysed": True}


def analyze(source, write, previous=None, title="Chapter", progress=lambda *_: None,
            passage_words=450, passage_units=8, warn=lambda _: None, mode="full"):
    """`mode="voice"` asks only who speaks each quote and the mood: enough for
    the audiobook at a fraction of the writing, but nothing to draw from."""
    if mode not in ("full", "voice"):
        raise ValueError("unknown analysis mode")
    if not isinstance(source, str) or not source.strip():
        raise ValueError("paste a chapter first")
    if len(source) > 200000:
        raise ValueError("a chapter must be under 200,000 characters; add chapters separately")
    book = copy.deepcopy(previous) if previous else {
        "version": 1, "id": str(uuid.uuid4()), "characters": [], "chapters": []}
    validate_book(book)
    chapter_id = str(uuid.uuid4())
    groups = passages(source, max_words=passage_words, max_units=passage_units)
    scenes = []
    continuity = {"characters": {}, "locations": {}}
    for old_chapter in book["chapters"]:
        for old_scene in old_chapter["scenes"]:
            for old_beat in old_scene["beats"]:
                _remember_state(continuity, old_beat)
    for i, group in enumerate(groups):
        progress(i, len(groups))
        voice = mode == "voice"
        prompt = voice_instruction(group, book["characters"]) if voice else instruction(group, book["characters"], continuity)
        for attempt in range(2):
            raw = write(VOICE_SYSTEM if voice else SCENE_SYSTEM, prompt)
            try:
                reply = voice_scene_reply(raw, group, i + 1) if voice else raw
                scene, characters = parse_scene(reply, group, book["characters"], f"{chapter_id}-s{i + 1}")
                break
            except (ValueError, TypeError, KeyError, AttributeError) as exc:
                if attempt:
                    # A writer that cannot produce any valid scene is broken or
                    # unsuitable; refuse rather than return a chapter of stubs.
                    if not any(not s.get("unanalysed") for s in scenes) and i >= min(2, len(groups) - 1):
                        raise ValueError(f"Scene {i + 1} could not be validated: {exc}") from exc
                    warn(f"Scene {i + 1} could not be validated ({exc}); kept its text unanalysed")
                    scene, characters = _unanalysed_scene(group, f"{chapter_id}-s{i + 1}", i + 1), book["characters"]
                    break
                prompt += (f"\nYour previous reply failed validation: {exc}."
                           "\nPrevious reply to repair:\n" + raw[:20000]
                           + "\nReturn corrected complete JSON, preserving the full source coverage. "
                           "Every visible character and speaker must refer to an ID declared in "
                           "the character bible or your characters array. Use null for uncertain speakers.")
        scenes.append(scene)
        for beat in scene["beats"]:
            _remember_state(continuity, beat)
        book["characters"] = characters
    chapter = {"id": chapter_id, "title": title.strip() or "Chapter",
               "source": source, "source_hash": hashlib.sha256(source.encode()).hexdigest(),
               "scenes": scenes, **({"analysis": "voice"} if mode == "voice" else {})}
    book["chapters"].append(chapter)
    validate_book(book)
    return book


def validate_book(book):
    if not isinstance(book, dict) or book.get("version") != 1:
        raise ValueError("unsupported story model version")
    _text(book.get("id"), "book id", False)
    characters = _array(book.get("characters"), "characters")
    known = set()
    for c in characters:
        cid = _text(c.get("id"), "character id", False)
        if cid in known:
            raise ValueError("duplicate character id")
        known.add(cid)
        _text(c.get("name"), "name", False)
        _array(c.get("aliases"), "aliases")
        # Books saved before visuals were bounded may hold longer text; it is
        # trimmed where it is used, so it must not make a saved book unreadable.
        if not isinstance(c.get("visual"), str):
            raise ValueError("visual must be a string")
        _text(c.get("voice"), "voice")
    for chapter in _array(book.get("chapters"), "chapters"):
        source = chapter.get("source")
        if not isinstance(source, str) or not source.strip():
            raise ValueError("chapter source is missing")
        if chapter.get("source_hash") != hashlib.sha256(source.encode()).hexdigest():
            raise ValueError("chapter source changed after analysis")
        cursor = 0
        for scene in _array(chapter.get("scenes"), "scenes"):
            for beat in _array(scene.get("beats"), "beats"):
                start, end = beat.get("start"), beat.get("end")
                if type(start) is not int or type(end) is not int or start != cursor or not start < end <= len(source):
                    raise ValueError("beat spans must partition the chapter")
                if beat.get("source") != source[start:end]:
                    raise ValueError("beat source is not exact")
                cursor = end
                last = start
                for line in _array(beat.get("dialogue"), "dialogue"):
                    a, b = line.get("start"), line.get("end")
                    if type(a) is not int or type(b) is not int or not last <= a < b <= end or source[a:b] != line.get("text"):
                        raise ValueError("dialogue spans must match source and not overlap")
                    last = b
                    if line.get("speaker_id") is not None and line["speaker_id"] not in known:
                        raise ValueError("unknown speaker")
                for actor in _array(beat.get("visible"), "visible"):
                    if actor.get("character_id") not in known:
                        raise ValueError("unknown visible character")
                if type(beat.get("importance")) is not int or not 1 <= beat["importance"] <= 5:
                    raise ValueError("invalid beat importance")
        if cursor != len(source):
            raise ValueError("chapter analysis is incomplete")
    return book


def narration_segments(book, chapter_id):
    validate_book(book)
    chapter = next((c for c in book["chapters"] if c["id"] == chapter_id), None)
    if not chapter:
        raise ValueError("choose an analyzed chapter")
    # Narration is split at beats so it carries the beat's mood like dialogue
    # does; it is most of a chapter and was always read without one.
    source, segments = chapter["source"], []
    for scene in chapter["scenes"]:
        for beat in scene["beats"]:
            cursor = beat["start"]
            for line in beat["dialogue"]:
                if line["start"] > cursor:
                    segments.append({"speaker_id": None, "text": source[cursor:line["start"]], "mood": beat["mood"]})
                segments.append({"speaker_id": line["speaker_id"], "text": line["text"], "mood": beat["mood"]})
                cursor = line["end"]
            if beat["end"] > cursor:
                segments.append({"speaker_id": None, "text": source[cursor:beat["end"]], "mood": beat["mood"]})
    return segments


def _chunks(text, words=36):
    tokens = list(re.finditer(r'\S+\s*', text))
    return [text[tokens[i].start():tokens[min(i + words, len(tokens)) - 1].end()].strip()
            for i in range(0, len(tokens), words)]


def direct(book, chapter_id):
    """Deterministic director: more frames at turns, never rewrite lettering."""
    validate_book(book)
    chapter = next((c for c in book["chapters"] if c["id"] == chapter_id), None)
    if not chapter:
        raise ValueError("choose an analyzed chapter")
    people = {c["id"]: c for c in book["characters"]}
    panels = []
    for scene_no, scene in enumerate(chapter["scenes"], 1):
        for beat_no, beat in enumerate(scene["beats"]):
            narration, cursor = [], 0
            for line in beat["dialogue"]:
                a, b = line["start"] - beat["start"], line["end"] - beat["start"]
                narration.append(beat["source"][cursor:a])
                cursor = b
            narration.append(beat["source"][cursor:])
            narrative = re.sub(r'[“"]\s*[”"]|「\s*」', '', ''.join(narration))
            captions = _chunks(narrative)
            dialogue = [{"speaker": people[d["speaker_id"]]["name"] if d["speaker_id"] else "",
                         "speaker_id": d["speaker_id"], "text": text, "offscreen": d["offscreen"]}
                        for d in beat["dialogue"] for text in _chunks(d["text"], 28)]
            frames = max(len(captions), len(dialogue), 3 if beat["importance"] == 5 else 2 if beat["importance"] == 4 else 1)
            actors = [{**a, "name": people[a["character_id"]]["name"],
                       "visual": people[a["character_id"]]["visual"][:VISUAL_LIMIT]} for a in beat["visible"]]
            for frame in range(frames):
                reaction = frame > 0 and frame == frames - 1 and bool(actors) and beat["importance"] >= 4
                panels.append({"beat_id": beat["id"], "chapter_id": chapter_id,
                    "shot": "close-up" if reaction else "wide" if beat_no == 0 and frame == 0 else "medium",
                    "purpose": "reaction" if reaction else "establishing" if beat_no == 0 else "action",
                    "subject": ', '.join(a["name"] for a in actors), "action": beat["action"],
                    "setting": beat["setting"], "character_in_frame": bool(actors),
                    "characters": [a["name"] for a in actors], "cast": actors,
                    "mood": beat["mood"], "tension": beat["tension"], "importance": beat["importance"],
                    "source": beat["source"] if frame == 0 else "",
                    "caption": captions[frame] if frame < len(captions) else "",
                    "dialogue": [dialogue[frame]] if frame < len(dialogue) else [],
                    "scene": scene_no, "scene_title": scene["title"],
                    "place": beat["setting"], "place_key": beat.get("location_id") or beat["setting"].casefold(),
                    "location_state": beat.get("location_state", ""),
                    "description": ""})
    return panels
