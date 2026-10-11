"""The director turns an analysed chapter into a shot list worth drawing."""
import json
import unittest

import director
import story

SOURCE = ('The harbour lay grey under low cloud. Gulls wheeled over the empty pier.\n\n'
          'Agnes Thorne waited by the ticket hut. “You’re late,” Agnes said.\n\n'
          '“The ferry was early,” I said. “Never in forty years,” Agnes said, and laughed.\n\n'
          'Hours passed. The clock above the hut ticked on. Rain began.\n\n'
          'Agnes slammed the hut door and ran for the boat as the storm broke.')


def book():
    """A chapter analysed by a stand-in writer: three scenes, two people."""
    replies = iter([
        {"title": "The pier", "characters": [{"id": "a", "name": "Agnes Thorne", "aliases": ["Agnes"], "visual": "broad, grey hair", "voice": ""},
                                              {"id": "n", "name": "Narrator", "aliases": [], "visual": "", "voice": ""}],
         "looks": [], "places": [{"place": "pier", "state": "grey, empty"}],
         "beats": [{"units": [0, 1], "importance": 2, "action": "The empty harbour", "place": "pier", "mood": "bleak", "cast": []},
                   {"units": [2, 3], "importance": 3, "action": "Agnes waits", "place": "pier", "mood": "wry",
                    "cast": [{"id": "a", "feel": "arms folded"}]},
                   {"units": [4, 5, 6], "importance": 4, "action": "They argue about the ferry", "place": "pier", "mood": "wry",
                    "cast": [{"id": "a", "feel": "laughing"}, {"id": "n", "feel": "stung"}]}],
         "speakers": []},
        {"title": "Waiting", "characters": [], "looks": [], "places": [],
         "beats": [{"units": [0, 1, 2], "importance": 2, "action": "Time passes", "place": "pier", "mood": "slow", "cast": []}],
         "speakers": []},
        {"title": "The storm", "characters": [], "looks": [], "places": [],
         "beats": [{"units": [0], "importance": 5, "action": "Agnes runs for the boat", "place": "pier", "mood": "violent storm",
                    "cast": [{"id": "Agnes", "feel": "fierce"}]}],
         "speakers": []},
    ])
    def write(_, prompt):
        group = json.loads(prompt.split('Numbered source units:\n')[1].split('\nYour previous reply')[0])
        reply = next(replies)
        reply["beats"] = [dict(b, units=[u for u in b["units"] if u < len(group)]) for b in reply["beats"]]
        reply["beats"] = [b for b in reply["beats"] if b["units"]]
        return json.dumps(reply)
    return story.analyze(SOURCE.replace('\n\nHours', '\n\n* * *\n\nHours').replace('\n\nAgnes slammed', '\n\n* * *\n\nAgnes slammed'),
                         write, passage_words=999, passage_units=99)


class Plan(unittest.TestCase):
    def setUp(self):
        self.book = book()
        self.chapter = self.book['chapters'][0]
        self.panels = director.plan(self.book, self.chapter['id'], "manga")

    def test_no_shot_is_repeated_and_every_panel_shows_its_own_instant(self):
        for a, b in zip(self.panels, self.panels[1:]):
            if b["transition"] != "aspect":
                self.assertNotEqual((a["shot"], a["angle"], a["focus"]), (b["shot"], b["angle"], b["focus"]))
            self.assertNotEqual(a["moment"], b["moment"])

    def test_the_place_is_established_first_and_the_ending_pulls_back(self):
        self.assertEqual((self.panels[0]["role"], self.panels[0]["framing"]), ("E", "establishing"))
        self.assertIn(self.panels[0]["shot"], ("EWS", "WS"))
        self.assertEqual((self.panels[-1]["shot"], self.panels[-1]["angle"]), ("EWS", "bird"))

    def test_people_including_the_narrator_are_introduced_in_full_before_closer_shots(self):
        agnes = [p for p in self.panels if p["focus"] == "Agnes Thorne"]
        self.assertEqual((agnes[0]["shot"], agnes[0]["moment"].startswith("First sight")), ("WS", True))
        # A first-person narrator is a character in a comic, not an invisible camera.
        self.assertTrue(any(p["moment"].startswith("First sight of Narrator") for p in self.panels))

    def test_first_person_sentences_draw_the_narrator_and_looking_is_point_of_view(self):
        source = 'I carried my suitcase down the long pier. I saw the ferry leave without me.'
        def write(_, prompt):
            group = json.loads(prompt.split('Numbered source units:\n')[1].split('\nYour previous reply')[0])
            return json.dumps({"title": "t", "characters": [{"id": "n", "name": "Narrator", "aliases": [], "visual": "tall", "voice": ""}],
                               "looks": [], "places": [], "speakers": [],
                               "beats": [{"units": [u["id"] for u in group], "importance": 3, "action": "a",
                                          "place": "pier", "mood": "lonely", "cast": [{"id": "n", "feel": ""}]}]})
        b = story.analyze(source, write, passage_words=999, passage_units=99)
        panels = director.plan(b, b['chapters'][0]['id'], "manga")
        carry = next(p for p in panels if p["moment"].startswith("I carried"))
        self.assertIn("Narrator", carry["characters"])
        self.assertNotEqual(carry["framing"], "pov")
        saw = next(p for p in panels if p["moment"].startswith("I saw"))
        self.assertEqual(saw["framing"], "pov")

    def test_every_line_of_dialogue_is_placed_once_with_shot_reverse_coverage(self):
        said = [d["text"] for p in self.panels for d in p["dialogue"]]
        expected = [d["text"] for s in self.chapter["scenes"] for b in s["beats"] for d in b["dialogue"]]
        self.assertEqual(said, expected)
        # The exchange between two visible people opens on a two-shot, then
        # goes over the shoulder.
        talk = [p for p in self.panels if p["dialogue"] and len(p["cast"]) >= 2]
        self.assertEqual(talk[0]["framing"], "two")
        self.assertIn("ots", [p["framing"] for p in talk])

    def test_waiting_is_shown_as_quiet_aspect_panels(self):
        wait = [p for p in self.panels if p["transition"] == "aspect"]
        self.assertGreaterEqual(len(wait), 2)
        self.assertIn("INSERT", [p["shot"] for p in wait])

    def test_each_scene_has_one_peak_and_violence_gets_a_dramatic_angle(self):
        peaks = [p for p in self.panels if p["role"] == "P"]
        self.assertEqual(len({p["scene"] for p in peaks}), len(peaks))
        storm = next(p for p in peaks if "storm" in p["moment"] or "ran" in p["moment"])
        self.assertIn(storm["angle"], ("low", "dutch"))
        self.assertEqual(storm["weight"], 3)

    def test_people_keep_their_side_of_the_frame_and_face_each_other(self):
        sides = {}
        for p in self.panels:
            for name, pos in p["positions"].items():
                sides.setdefault(name, set()).add(pos)
                self.assertEqual(p["facing"][name], "right" if "left" in pos else "left" if "right" in pos else "the camera")
        self.assertTrue(all(len(s) == 1 for s in sides.values()), sides)

    def test_close_shots_are_capped(self):
        for i in range(len(self.panels)):
            window = self.panels[max(0, i - 9):i + 1]
            self.assertLessEqual(sum(p["shot"] in director.CLOSE for p in window), 5)

    def test_a_picture_book_is_one_spread_per_scene_with_the_whole_text(self):
        spreads = director.plan(self.book, self.chapter['id'], "picture")
        self.assertEqual(len(spreads), len(self.chapter['scenes']))
        self.assertEqual(''.join(p['source'] for p in spreads), self.chapter['source'])
        self.assertTrue(all(p['weight'] == 3 and not p['dialogue'] for p in spreads))


class SentencePicking(unittest.TestCase):
    def test_bare_speech_tags_are_not_moments(self):
        self.assertEqual(director._sentences('“Late,” she said. “Early,” I said. Agnes laughed, a short bark.'),
                         ['Agnes laughed, a short bark.'])


class Refinement(unittest.TestCase):
    def test_valid_choices_are_taken_invalid_ones_ignored_and_rules_reapplied(self):
        b = book()
        def write(system, prompt):
            rows = json.loads(prompt.split("Planned panels:\n")[1])
            return json.dumps({"panels": [
                {"id": 0, "shot": "ECU", "angle": "worm", "framing": "pov", "focus": "Nobody", "visual": "Rain on the pier boards"},
                {"id": 1, "shot": "GIANT", "angle": "sideways", "framing": "ots", "focus": "", "visual": ""},
            ] if rows else []})
        panels = director.direct(b, b['chapters'][0]['id'], "manga", write=write)
        first = panels[0]
        self.assertEqual((first["angle"], first["framing"]), ("worm", "pov"))
        self.assertEqual(first["description"], "Rain on the pier boards")
        self.assertNotEqual(first["focus"], "Nobody")
        self.assertIn(panels[1]["shot"], director.SHOTS)
        self.assertNotEqual(panels[1]["framing"], "ots")  # one person cannot be over-the-shoulder

    def test_a_failing_writer_keeps_the_plan_and_stop_keeps_what_is_done(self):
        b = book()
        planned = director.plan(b, b['chapters'][0]['id'], "manga")
        broken = director.direct(b, b['chapters'][0]['id'], "manga", write=lambda *_: (_ for _ in ()).throw(RuntimeError("x")))
        self.assertEqual(len(broken), len(planned))
        calls = []
        def stop_after_one(system, prompt):
            calls.append(1)
            if len(calls) > 1:
                raise director.Stop()
            return "{}"
        stopped = director.direct(b, b['chapters'][0]['id'], "manga", write=stop_after_one)
        self.assertEqual(len(stopped), len(planned))
        self.assertEqual(len(calls), 2)


class WorkerDirection(unittest.TestCase):
    def test_analysis_returns_the_directors_plan_in_the_chosen_format(self):
        import worker
        from unittest.mock import patch
        b = book()
        with patch.object(worker, '_write', side_effect=AssertionError("no writer without one named")):
            out = worker.op_direct_story('d', {'book': b, 'chapter_id': b['chapters'][0]['id'], 'format': 'picture'})
        self.assertEqual(len(out['panels']), len(b['chapters'][0]['scenes']))


if __name__ == "__main__":
    unittest.main()


class PlaceMoves(unittest.TestCase):
    def test_a_scene_moved_into_a_named_room_is_drawn_there(self):
        self.assertEqual(director._named_place(["Her kitchen smelled of tar."], "pier"), "kitchen")
        self.assertEqual(director._named_place(["We went into the hall."], "street"), "hall")
        self.assertIsNone(director._named_place(["The harbour lay grey."], "pier"))
        self.assertIsNone(director._named_place(["Her kitchen was warm."], "the kitchen"))

    def test_the_move_lasts_while_the_analysis_repeats_the_old_place(self):
        source = 'Agnes stood on the pier.\n\n* * *\n\nHer kitchen smelled of tar.\n\n* * *\n\nAgnes poured the tea.'
        def write(_, prompt):
            group = json.loads(prompt.split('Numbered source units:\n')[1].split('\nYour previous reply')[0])
            return json.dumps({"title": "t", "characters": [{"id": "a", "name": "Agnes", "aliases": [], "visual": "", "voice": ""}],
                               "looks": [], "places": [], "speakers": [],
                               "beats": [{"units": [u["id"] for u in group], "importance": 2, "action": "a",
                                          "place": "pier", "mood": "calm", "cast": [{"id": "Agnes", "feel": ""}]}]})
        b = story.analyze(source, write, passage_words=999, passage_units=99)
        panels = director.plan(b, b['chapters'][0]['id'], "manga")
        last_scene = max(p["scene"] for p in panels if p["framing"] != "establishing" or p["role"] != "R")
        self.assertEqual({p["setting"] for p in panels if p["scene"] == last_scene and p["role"] != "R"}, {"kitchen"})


class HinglishNarrator(unittest.TestCase):
    SOURCE = ('Main subah office ke liye nikla. Maine Riya ko station par dekha.\n\n'
              'Mujhe laga wo naraz thi. Maine uska haath pakda aur hum chal pade.')

    def analysed(self):
        def write(_, prompt):
            group = json.loads(prompt.split('Numbered source units:\n')[1].split('\nYour previous reply')[0])
            return json.dumps({"title": "t", "characters": [{"id": "r", "name": "Riya", "aliases": [], "visual": "", "voice": ""}],
                               "looks": [], "places": [], "speakers": [],
                               "beats": [{"units": [u["id"] for u in group], "importance": 4, "action": "a",
                                          "place": "station", "mood": "tense", "cast": [{"id": "r", "feel": ""}]}]})
        return story.analyze(self.SOURCE, write, passage_words=999, passage_units=99)

    def test_a_story_told_with_main_and_maine_has_a_narrator_who_is_drawn(self):
        b = self.analysed()
        self.assertIn("Narrator", [c["name"] for c in b["characters"]])
        panels = director.plan(b, b['chapters'][0]['id'], "manga")
        held = next(p for p in panels if p["moment"].startswith("Main subah"))
        self.assertIn("Narrator", held["characters"])
        saw = next(p for p in panels if p["moment"].startswith("Maine Riya ko"))
        self.assertIn("Riya", saw["characters"])

    def test_a_book_analysed_without_its_narrator_gains_one_when_planned_again(self):
        import worker
        b = self.analysed()
        old = {**b, "characters": [c for c in b["characters"] if c["name"] != "Narrator"]}
        out = worker.op_direct_story('d', {'book': old, 'chapter_id': b['chapters'][0]['id'], 'format': 'manga'})
        self.assertIn("Narrator", [c["name"] for c in out["book"]["characters"]])
        again = worker.op_direct_story('d', {'book': out["book"], 'chapter_id': b['chapters'][0]['id'], 'format': 'manga'})
        self.assertNotIn("book", again)

    def test_a_third_person_story_has_no_narrator(self):
        self.assertEqual(story._ensure_narrator([], 'Riya ne kaha, "main aa rahi hoon." Wo chali gayi.'), [])
