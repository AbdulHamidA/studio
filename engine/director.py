"""The director: from an analysed chapter to a shot list worth drawing.

Analysis says what happens. Direction decides how a reader lives through it:
which instants get a panel, where the camera stands, how close it is, who it
favours, where people stand, how large each panel is and what words go in it.
The old planner skipped all of that -- it cut a beat's prose into 36-word
pieces and gave every piece the beat's one summary, so a page was the same
picture redrawn with a new seed.

Structure comes from rules, taken from comics practice:
  * Cohn's visual narrative grammar: Establisher, Initial, Prolongation,
    Peak, Release -- one Peak per scene, and it gets the largest panel.
  * McCloud's transitions: action, subject, scene and aspect-to-aspect (the
    quiet panels that make time pass) chosen from what the beat is.
  * Coverage: establish a new place wide, introduce a person in full before
    closing in, cover dialogue as a two-shot then over-the-shoulder
    shot/reverse with silent reactions, keep everyone on one side of the
    180-degree line, pull back for the epilogue.
  * Variety: never the same shot, angle and subject twice running; no more
    than four close shots in ten.

Each panel shows its own instant -- the sentence it draws -- so panels differ
in content, not by seed. A writer model, when one is installed, then refines
each scene's visual direction within closed choices; the rules are applied
again to whatever it returns.
"""
from __future__ import annotations

import json
import re

import story

SHOTS = ("EWS", "WS", "MS", "MCU", "CU", "ECU", "INSERT")
ANGLES = ("eye", "high", "low", "bird", "worm", "dutch")
FRAMINGS = ("establishing", "single", "two", "group", "ots", "pov", "insert")
ROLES = ("E", "I", "L", "P", "R")
FORMATS = ("manga", "webtoon", "comic", "picture")

# How close each shot is, for "push in" and for the close-shot cap.
CLOSENESS = {"EWS": 0, "WS": 1, "MS": 2, "MCU": 3, "CU": 4, "ECU": 5, "INSERT": 5}
CLOSE = {"CU", "ECU", "INSERT"}
SLOTS = ("left third", "right third", "centre", "far left", "far right")

WAIT = re.compile(r"\b(wait(?:ed|ing)?|hours?|minutes?|later|long time|silence|silent|still|"
                  r"clock|night fell|morning came|days? passed|lingered|stayed)\b", re.I)
VULNERABLE = re.compile(r"\b(sad|grief|alone|lonely|afraid|fear|small|lost|tears?|weep|cry)\b", re.I)
VIOLENT = re.compile(r"\b(fight|strike|hit|slam|crash|run|chase|fall|scream|attack|shot|blood|storm)\b", re.I)
THOUGHT = re.compile(r"\bI\b[^.!?]*\b(thought|knew|wondered|felt|remembered|realised|realized|decided|"
                     r"had (?:already )?decided|hoped|feared)\b")
PERSON = re.compile(r"\b(he|she|they|I|we|him|her|them|me|us|his|hers|their|my)\b", re.I)
FIRST_PERSON = re.compile(r"\b(I|me|my|we|us|our)\b")
# What a sentence is about decides the shot, not where it falls in the beat.
PLACE = re.compile(r"\b(wind|sky|sea|rain|snow|fog|storm|sun|moon|light|dark|room|kitchen|hall|street|"
                   r"harbou?r|pier|shore|beach|window|walls?|house|town|city|forest|field|road|smell(?:ed|s)?|"
                   r"air|gulls?|birds?|waves?|breakwater|buoy|bell)\b", re.I)
DETAIL = re.compile(r"\b(hands?|fingers?|eyes?|cup|mug|glass|kettle|key|letter|note|net|knife|gun|ring|"
                    r"phone|book|bag|suitcase|coin|door ?handle|button|photograph|clock)\b", re.I)
FEELING = re.compile(r"\b(looked|stared|glanced|smiled|frowned|laughed|wept|cried|tears?|blushed|"
                     r"flinched|sighed|gasped|trembl\w*|nodded|shook (?:his|her|my) head)\b", re.I)


def _named(sentence, people):
    """Characters the sentence names (name or alias), in order of mention."""
    found = []
    for c in people:
        for n in [c["name"], *c["aliases"]]:
            m = re.search(r"(?<!\w)" + re.escape(n) + r"(?!\w)", sentence) if len(n) > 2 else None
            if m:
                found.append((m.start(), c))
                break
    return [c for _, c in sorted(found, key=lambda x: x[0])]


def _human(place):
    return re.sub(r"[_-]+", " ", place or "").strip()


TAG_ONLY = re.compile(r"^(?:and\s+)?(?:\w+\s+){0,2}(?:" + story.SPEECH_VERBS + r")(?:\s+\w+){0,2}[.!?]?$", re.I)


def _sentences(text):
    """Sentences of narration, quotes removed; empty pieces and bare speech
    tags ("she said.") dropped -- a tag is not a moment, and a writer given
    one invents something to draw."""
    out = []
    for unit in story.units(text):
        bare = story.QUOTE.sub(" ", unit["text"])
        bare = re.sub(r"\s+", " ", bare).strip(" ,;:—–-")
        if len(re.findall(r"\w+", bare)) >= 2 and not TAG_ONLY.match(bare):
            out.append(bare)
    return out


def _who(actor):
    return {"character_id": actor["character_id"], "name": actor["name"], "visual": actor.get("visual", ""),
            "expression": actor.get("expression", ""), "body_language": actor.get("body_language", ""),
            "appearance": actor.get("appearance", "")}


class _Blocking:
    """Where each person stands in each place, kept for the whole chapter.

    People keep their side of the frame and face each other across the
    180-degree line, so a conversation does not flip from panel to panel."""

    def __init__(self):
        self.places = {}

    def place(self, key, actors):
        spots = self.places.setdefault(key, {})
        for a in actors:
            if a["character_id"] not in spots:
                taken = set(spots.values())
                spots[a["character_id"]] = next((s for s in SLOTS if s not in taken), "centre")
        return {a["name"]: spots[a["character_id"]] for a in actors}

    @staticmethod
    def facing(position):
        return "right" if "left" in position else "left" if "right" in position else "the camera"


def _panel(beat, scene_no, scene, chapter_id, **kw):
    cast = kw.pop("cast", [])
    positions = kw.pop("positions", {})
    p = {
        "beat_id": beat["id"], "chapter_id": chapter_id, "scene": scene_no, "scene_title": scene["title"],
        "shot": "MS", "angle": "eye", "framing": "single", "camera_side": "A", "focus": "",
        "role": "I", "transition": "action", "weight": 2, "moment": "", "purpose": "action",
        "cast": cast, "characters": [a["name"] for a in cast], "character_in_frame": bool(cast),
        "positions": {n: positions[n] for n in (a["name"] for a in cast) if n in positions},
        "mood": beat["mood"], "tension": beat["tension"], "importance": beat["importance"],
        "setting": beat["setting"], "place": beat["setting"],
        "place_key": beat.get("location_id") or beat["setting"].casefold(),
        "location_state": beat.get("location_state", ""),
        "caption": "", "dialogue": [], "source": "", "description": "",
    }
    p.update(kw)
    p["facing"] = {n: _Blocking.facing(pos) for n, pos in p["positions"].items()}
    p["subject"] = p["focus"] or ", ".join(p["characters"])
    p["action"] = p["moment"]
    return p


def _lines(beat, people):
    """Dialogue as consecutive same-speaker groups, each line placed once.

    Off-screen is decided here, from who is visible: a speaker found from a
    speech tag after analysis kept the off-screen flag set while unknown."""
    groups = []
    seen = {a["character_id"] for a in beat["visible"]}
    for d in beat["dialogue"]:
        line = {"speaker": people[d["speaker_id"]]["name"] if d["speaker_id"] else "",
                "speaker_id": d["speaker_id"], "text": d["text"],
                "offscreen": d["speaker_id"] not in seen}
        if groups and groups[-1][0]["speaker_id"] == line["speaker_id"] and len(groups[-1]) < 2:
            groups[-1].append(line)
        else:
            groups.append([line])
    return groups


def plan(book, chapter_id, fmt="manga"):
    """The rule-based shot list for a chapter. Deterministic and instant."""
    if fmt not in FORMATS:
        raise ValueError("unknown book format")
    story.validate_book(book)
    chapter = next((c for c in book["chapters"] if c["id"] == chapter_id), None)
    if not chapter:
        raise ValueError("choose an analyzed chapter")
    chapter = story._with_tags(book, chapter)
    people = {c["id"]: c for c in book["characters"]}
    blocking, introduced, panels = _Blocking(), set(), []
    last_place = None
    picture = fmt == "picture"

    for scene_no, scene in enumerate(chapter["scenes"], 1):
        beats = scene["beats"]
        peak = max(beats, key=lambda b: (b["importance"], b["tension"])) if beats else None
        for beat in beats:
            actors = [{**a, "name": people[a["character_id"]]["name"],
                       "visual": people[a["character_id"]]["visual"][:story.VISUAL_LIMIT]} for a in beat["visible"]]
            key = beat.get("location_id") or beat["setting"].casefold()
            setting_seen = _human(beat["setting"]).casefold()
            positions = blocking.place(key, actors)
            narration = _sentences(beat["source"])
            groups = _lines(beat, people)
            first_of_beat = len(panels)
            mk = lambda **kw: _panel(beat, scene_no, scene, chapter_id, positions=positions, **kw)  # noqa: E731

            # A new place is shown before anything happens in it.
            if (key, setting_seen) != last_place and (key or setting_seen):
                opening = narration.pop(0) if narration and PLACE.search(narration[0]) and not PERSON.search(narration[0]) else ""
                panels.append(mk(shot="EWS" if last_place is None else "WS", angle="high", framing="establishing",
                                 role="E", transition="scene", weight=3, purpose="establishing",
                                 moment=opening or f"The {_human(beat['setting']) or 'place'}, seen whole",
                                 caption=opening if picture else ""))
                last_place = (key, setting_seen)

            # A person's first appearance is staged: full figure, then close.
            for a in actors:
                if a["character_id"] in introduced:
                    continue
                introduced.add(a["character_id"])
                # The reader is a first-person narrator; they are not shown
                # arriving, they are seen through.
                if a["name"] == "Narrator":
                    continue
                panels.append(mk(shot="WS", angle="low" if beat["importance"] >= 3 else "eye", framing="single",
                                 focus=a["name"], cast=[_who(a)], role="I", transition="subject", weight=2,
                                 moment=f"First sight of {a['name']}, seen in full: {a['visual'] or a['name']}"
                                        + (f", {a['appearance']}" if a.get("appearance") else "")))

            if groups:
                # Coverage: a two-shot to place them, then over-the-shoulder
                # shot/reverse on whoever speaks, silent reactions after the
                # lines that land.
                tags = list(narration)
                for n, group in enumerate(groups):
                    speaker = next((a for a in actors if a["character_id"] == group[0]["speaker_id"]), None)
                    listeners = [a for a in actors if a is not speaker]
                    tag = tags.pop(0) if tags else ""
                    if n == 0 and len(actors) >= 2:
                        p = mk(shot="MS", framing="two", cast=[_who(a) for a in actors], role="I",
                               transition="subject", moment=tag or f"{', '.join(a['name'] for a in actors)} face each other")
                    elif speaker and listeners and not group[0]["offscreen"]:
                        p = mk(shot="MCU", framing="ots", focus=speaker["name"],
                               cast=[_who(speaker), _who(listeners[0])], role="L", transition="subject",
                               moment=tag or f"{speaker['name']} speaks, seen over {listeners[0]['name']}'s shoulder")
                    elif speaker:
                        p = mk(shot="MCU", focus=speaker["name"], cast=[_who(speaker)], role="L",
                               transition="subject", moment=tag or f"{speaker['name']} speaks")
                    else:
                        # Heard, not seen: the listener carries the line.
                        target = listeners[0] if listeners else (actors[0] if actors else None)
                        p = mk(shot="MCU" if target else "INSERT", framing="single" if target else "insert",
                               focus=target["name"] if target else "", cast=[_who(target)] if target else [],
                               role="L", transition="subject",
                               moment=tag or (f"{target['name']} listens" if target else "A voice from off panel"))
                    p["dialogue"] = group
                    if picture and tag:
                        p["caption"] = tag
                    panels.append(p)
                    if beat is peak and n == len(groups) - 1 and listeners and beat["importance"] >= 4:
                        panels.append(mk(shot="CU", focus=listeners[0]["name"], cast=[_who(listeners[0])], role="R",
                                         transition="subject", purpose="reaction", weight=1,
                                         moment=f"{listeners[0]['name']} reacts, silent"))
                for rest in tags:
                    panels.append(mk(shot="MS", cast=[_who(a) for a in actors], role="L",
                                     moment=rest, caption=rest if picture else ""))
            elif WAIT.search(beat["source"]) and beat["importance"] <= 3:
                # Time passing is shown, not told: the same place from small
                # aspects, with the person only glimpsed.
                quiet = narration[:3] or [beat["action"]]
                if len(quiet) < 2:
                    quiet.append(f"The {_human(beat['setting']) or 'place'}, a little later")
                for n, sentence in enumerate(quiet):
                    panels.append(mk(shot="INSERT" if n % 2 == 0 else "WS", angle="eye" if n % 2 else "high",
                                     framing="insert" if n % 2 == 0 else "single",
                                     cast=[] if n % 2 == 0 else [_who(a) for a in actors[:1]],
                                     focus=actors[0]["name"] if actors and n % 2 else "",
                                     role="L", transition="aspect", purpose="detail", weight=1,
                                     moment=sentence, caption=sentence if picture or n == 0 else ""))
            else:
                budget = {1: 1, 2: 1, 3: 2, 4: 3, 5: 4}[beat["importance"]]
                picks = narration[:budget] if narration else [beat["action"]]
                by_id = {a["character_id"]: a for a in actors}
                for n, sentence in enumerate(picks):
                    named = _named(sentence, book["characters"])
                    # Someone the sentence names is in the panel, even if the
                    # analysis forgot to list them as visible.
                    subjects = [by_id.get(c["id"]) or {"character_id": c["id"], "name": c["name"],
                                "visual": c["visual"][:story.VISUAL_LIMIT], "expression": "", "body_language": ""}
                                for c in named]
                    narrator_pov = not subjects and FIRST_PERSON.search(sentence)
                    if not subjects and not narrator_pov and not PERSON.search(sentence):
                        shot, frame, cast = ("WS" if PLACE.search(sentence) else "INSERT"), "insert", []
                    # A detail shot is for a sentence about the object or the
                    # hands; a long sentence that only mentions one is a scene.
                    elif DETAIL.search(sentence) and not FEELING.search(sentence) and (
                            len(sentence.split()) <= 10 or re.search(r"\b(hands?|fingers?)\b", sentence, re.I)):
                        shot, frame, cast = "INSERT", "insert", subjects[:1] or [_who(a) for a in actors[:1]]
                    elif FEELING.search(sentence):
                        shot, frame, cast = "MCU" if n == 0 else "CU", "single", subjects[:1] or [_who(a) for a in actors[:1]]
                    elif narrator_pov:
                        shot, frame, cast = "MS", "pov", [_who(a) for a in actors if a["name"] != "Narrator"]
                    else:
                        cast = subjects or [_who(a) for a in actors]
                        shot, frame = ("MS" if len(cast) > 1 else "WS" if n == 0 else "MS"), ("two" if len(cast) == 2 else "group" if len(cast) > 2 else "single")
                    cast = [_who(c) if "character_id" in c else c for c in cast]
                    focus = cast[0]["name"] if cast and frame != "pov" else ""
                    positions.update(blocking.place(key, cast))
                    panels.append(mk(shot=shot, framing=frame, focus=focus, cast=cast, role="I" if n == 0 else "L",
                                     purpose="detail" if shot == "INSERT" else "action", moment=sentence,
                                     caption=sentence if picture else ""))
                rest = narration[budget:]
                if picture and rest:
                    panels[-1]["caption"] = " ".join([panels[-1]["caption"], *rest]).strip()

            # The Peak: one per scene, the largest panel, camera by feeling.
            if beat is peak and beat["importance"] >= 4 and len(panels) > first_of_beat:
                # The Peak is a person's moment where the beat has one.
                mine = [p for p in panels[first_of_beat:] if p["role"] != "R"]
                top = next((p for p in reversed(mine) if p["character_in_frame"]), mine[-1])
                feeling = f"{beat['mood']} {beat['action']}"
                top.update(role="P", weight=3, transition="moment")
                if top["shot"] == "INSERT":
                    feeling = ""  # an object's close-up has no power angle
                if VIOLENT.search(feeling):
                    top.update(angle="dutch" if beat["tension"] >= 5 else "low")
                elif VULNERABLE.search(feeling):
                    top.update(angle="high", shot="CU" if top["character_in_frame"] else top["shot"])
                elif feeling:
                    top.update(angle="low" if beat["tension"] >= 4 else "eye")

            # First-person interiority is the narrator's voice: a caption.
            for p in panels[first_of_beat:]:
                if not picture and not p["caption"] and THOUGHT.search(p["moment"]):
                    p["caption"] = p["moment"]
            if panels[first_of_beat:]:
                panels[first_of_beat]["source"] = beat["source"]

    # The ending pulls back, echoing the opening.
    if panels and chapter["scenes"]:
        last = chapter["scenes"][-1]["beats"][-1]
        panels.append(_panel(last, len(chapter["scenes"]), chapter["scenes"][-1], chapter_id,
                             shot="EWS", angle="bird", framing="establishing", role="R", transition="scene",
                             weight=3, purpose="establishing",
                             moment=f"Pulling far back from the {_human(last['setting']) or 'scene'}, the story's last image"))
    if picture:
        panels = _spreads(panels, chapter)
    return rules(panels)


def _spreads(panels, chapter):
    """A picture book shows one moment per scene, as a spread, with the
    author's whole text for that scene beside it; the opening keeps its
    establishing spread when the scene has no stronger image."""
    out = []
    for scene_no, scene in enumerate(chapter["scenes"], 1):
        mine = [p for p in panels if p["scene"] == scene_no and not (p["role"] == "R" and p["framing"] == "establishing")]
        if not mine:
            continue
        key = next((p for p in mine if p["role"] == "P"), None) \
            or next((p for p in mine if p["character_in_frame"]), mine[0])
        spread = dict(key, weight=3, dialogue=[],
                      caption=chapter["source"][scene["start"]:scene["end"]].strip(),
                      source=chapter["source"][scene["start"]:scene["end"]])
        if spread["shot"] in ("ECU", "INSERT"):
            spread["shot"] = "MS"
        out.append(spread)
    return out


def rules(panels):
    """Hard rules, applied after any planner -- the rules or a writer model."""
    out = []
    for p in panels:
        p = dict(p)
        # Establishing a place and pulling back at the end are calm by nature.
        if p["framing"] == "establishing" and p["angle"] in ("dutch", "worm", "low"):
            p["angle"] = "bird" if p["role"] == "R" else "high"
        if p["shot"] not in SHOTS:
            p["shot"] = "MS"
        if p["angle"] not in ANGLES:
            p["angle"] = "eye"
        if p["framing"] not in FRAMINGS:
            p["framing"] = "single"
        prev = out[-1] if out else None
        # Never the same shot twice running, unless it is a deliberate wait.
        if prev and (prev["shot"], prev["angle"], prev["focus"]) == (p["shot"], p["angle"], p["focus"]) \
                and p["transition"] != "aspect":
            if p["shot"] in ("MS", "MCU", "CU") and p["character_in_frame"]:
                p["shot"] = {"MS": "MCU", "MCU": "CU", "CU": "MS"}[p["shot"]]
            else:
                p["angle"] = "high" if p["angle"] == "eye" else "eye"
        out.append(p)
    # No more than four close shots in any ten.
    for i, p in enumerate(out):
        window = out[max(0, i - 9):i + 1]
        if p["shot"] in CLOSE and sum(q["shot"] in CLOSE for q in window) > 4 and p["role"] != "P":
            p["shot"] = "MCU" if p["character_in_frame"] else "MS"
    for p in out:
        p["subject"] = p["focus"] or ", ".join(p["characters"])
        p["action"] = p["moment"]
        p["purpose"] = {"E": "establishing", "R": p.get("purpose", "reaction")}.get(p["role"], p["purpose"])
    return out


# ---- the writer's refinement -------------------------------------------------

DIRECTOR_SYSTEM = """You are a comics director. Return only compact JSON on one line.
You get one scene's planned panels. For each panel keep its id and improve its
visual direction so the reader feels the scene: choose shot (EWS, WS, MS, MCU,
CU, ECU, INSERT), angle (eye, high, low, bird, worm, dutch), framing
(establishing, single, two, group, ots, pov, insert) and focus (a name from the
cast, or empty), and write visual: what exactly is in frame in at most 30
words -- subject, pose, gesture, foreground and background, light. Every panel
must look different from the one before it. Low angles give power, high angles
vulnerability, dutch unease; close shots carry feeling, wide shots place and
isolate. Do not invent events, people or objects the panel's text lacks. Do not
add or remove panels. In first-person text, "I", "me" and "my" are the Narrator.
"""


def refine_prompt(scene_panels, cast):
    rows = [{"id": i, "role": p["role"], "shot": p["shot"], "angle": p["angle"], "framing": p["framing"],
             "focus": p["focus"], "text": p["moment"][:240], "mood": p["mood"]} for i, p in enumerate(scene_panels)]
    people = [{"name": c["name"], "look": c["visual"][:160]} for c in cast]
    schema = {"panels": [{"id": 0, "shot": "MS", "angle": "eye", "framing": "single", "focus": "",
                          "visual": "what is in frame"}]}
    return ("Cast:\n" + json.dumps(people, ensure_ascii=False) + "\nReturn this schema:\n"
            + json.dumps(schema) + "\nPlanned panels:\n" + json.dumps(rows, ensure_ascii=False))


def apply_refinement(scene_panels, raw):
    """Take the writer's choices where they are valid; keep the plan elsewhere."""
    try:
        reply = story._loads(raw)
    except ValueError:
        return scene_panels
    names = {n for p in scene_panels for n in p["characters"]}
    out = [dict(p) for p in scene_panels]
    for row in reply.get("panels", []) if isinstance(reply, dict) else []:
        if not isinstance(row, dict) or type(row.get("id")) is not int or not 0 <= row["id"] < len(out):
            continue
        p = out[row["id"]]
        if row.get("shot") in SHOTS:
            p["shot"] = row["shot"]
        if row.get("angle") in ANGLES:
            p["angle"] = row["angle"]
        if row.get("framing") in FRAMINGS and (row["framing"] != "ots" or len(p["cast"]) >= 2):
            p["framing"] = row["framing"]
        if isinstance(row.get("focus"), str) and (row["focus"] in names or not row["focus"]):
            p["focus"] = row["focus"]
        visual = row.get("visual")
        if isinstance(visual, str) and visual.strip():
            p["description"] = " ".join(visual.split())[:300]
    return out


class Stop(Exception):
    """Raised by a writer or progress callback: keep what is refined so far."""


def direct(book, chapter_id, fmt="manga", write=None, progress=lambda *_: None):
    """The shot list, refined scene by scene by a writer when one is given.

    A scene whose refinement fails keeps its planned panels; Stop keeps the
    scenes refined so far and the plan for the rest."""
    panels = plan(book, chapter_id, fmt)
    if write is None:
        return panels
    cast = book["characters"]
    scenes = list(dict.fromkeys(p["scene"] for p in panels))
    out, stopped = [], False
    for i, scene in enumerate(scenes):
        part = [p for p in panels if p["scene"] == scene]
        if not stopped:
            try:
                progress(i, len(scenes))
                part = apply_refinement(part, write(DIRECTOR_SYSTEM, refine_prompt(part, cast)))
            except Stop:
                stopped = True
            except Exception:  # a writer failure leaves the plan, never no panels
                pass
        out.extend(part)
    return rules(out)
