"""The narration script: a story retold for one storyteller, never translated."""
import json
import unittest
from unittest.mock import patch

import narration

HINGLISH = "Yaar, main kal office gaya tha. Boss ne bola ki meeting cancel ho gayi 😅. Phir maine socha, chalo chai peete hain."


class Script(unittest.TestCase):
    def test_devanagari_script_is_accepted_and_latin_is_retried_then_kept_original(self):
        good = "यार, मैं कल ऑफिस गया था। बॉस ने बोला कि मीटिंग कैंसल हो गई, और मैं हँस पड़ा। फिर मैंने सोचा, चलो चाय पीते हैं।"
        text, stopped = narration.script(HINGLISH, lambda *_: good, devanagari=True)
        self.assertEqual((text, stopped), (good, False))
        calls = []
        def latin(*_):
            calls.append(1)
            return HINGLISH
        text, _ = narration.script(HINGLISH, latin, devanagari=True)
        self.assertEqual(len(calls), 2)          # retried once
        self.assertEqual(text, HINGLISH.strip())  # then the original, never nothing

    def test_a_reply_far_shorter_than_the_passage_is_not_a_retelling(self):
        text, _ = narration.script(HINGLISH, lambda *_: "Office.", devanagari=False)
        self.assertEqual(text, HINGLISH.strip())

    def test_stop_keeps_what_is_written_and_the_original_for_the_rest(self):
        source = "One. " * 200 + "Two. " * 200
        calls = []
        def write(system, prompt):
            calls.append(1)
            if len(calls) > 1:
                raise narration.Stop()
            return prompt.split("Passage:\n")[1].upper()
        text, stopped = narration.script(source, write, words=250)
        self.assertTrue(stopped)
        self.assertTrue(text.startswith("ONE."))
        self.assertIn("Two.", text)

    def test_a_script_is_narrated_by_one_voice_paragraph_by_paragraph(self):
        segs = narration.segments("पहला पैराग्राफ।\n\nदूसरा पैराग्राफ।")
        self.assertEqual([s["speaker_id"] for s in segs], [None, None])
        self.assertEqual(len(segs), 2)


class Speech(unittest.TestCase):
    def test_emoji_and_symbols_never_reach_the_voice(self):
        self.assertEqual(narration.speakable("Kahan ho?? 😤 *bas* 5 min 👍🏽").strip(), "Kahan ho?? bas 5 min")


class Worker(unittest.TestCase):
    def test_script_op_and_scripted_narration_use_one_voice(self):
        import worker
        with patch.object(worker, '_write', return_value="यार, मैं कल ऑफिस गया था। बॉस ने बोला कि मीटिंग कैंसल हो गई। फिर मैंने सोचा, चलो चाय पीते हैं।"):
            out = worker.op_narration_script("n", {"source": HINGLISH, "devanagari": True})
        self.assertIn("मीटिंग", out["script"])
        captured = {}
        import audiobook
        def fake(segments, narrator, assignments, rate, check, progress, **kw):
            captured.update(segments=segments, assignments=assignments)
            return b"RIFF", 1.0
        with patch.object(audiobook, "synthesize_kokoro", fake), patch("vaultcrypto.write_sealed", lambda *a: 4):
            result = worker.op_audiobook("a", {"book": {}, "chapter_id": "c", "script": out["script"], "narrator": "hf_alpha",
                                               "voices": {"x": "am_puck"}, "model_id": audiobook.KOKORO_MODEL_ID,
                                               "vault_slots": [{"id": "s", "path": "/tmp/x", "key": "00" * 32, "file_id": "00" * 16}]})
        self.assertTrue(result["sealed"])
        self.assertEqual(captured.get("assignments"), {})
        self.assertTrue(all(s["speaker_id"] is None for s in captured["segments"]))


if __name__ == "__main__":
    unittest.main()
