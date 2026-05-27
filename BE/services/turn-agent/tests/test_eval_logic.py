"""Unit tests for the pure turn-agent eval logic (no LLM / IO).

    python -m unittest tests.test_eval_logic   (from turn-agent/)
or  python tests/test_eval_logic.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nodes.eval_logic import (  # noqa: E402
    compute_card_update,
    normalize_next_action,
    select_recovery_candidate,
    is_meta_followup,
    is_confusion_text,
    is_substantial_attempt,
    last_substantial_user_answer,
    deterministic_fallback_eval,
)

LONG_ANSWER = (
    "In the morning I wake up at seven, then I drink coffee and eat breakfast. "
    "In the afternoon I work, and in the evening I watch some videos before bed."
)


class ComputeCardUpdateTests(unittest.TestCase):
    def test_final_boss_passed_finish_session(self):
        cu = compute_card_update(3, 4, "final_boss", 0, {"passed": True, "nextAction": "next_card"})
        self.assertEqual(cu["next_action"], "finish_session")  # normalized
        self.assertEqual(cu["result"], "passed")
        self.assertEqual(cu["status"], "completed")
        self.assertEqual(cu["attempts"], 1)

    def test_non_final_passed_next_card(self):
        cu = compute_card_update(1, 4, "real_situation", 0, {"passed": True, "nextAction": "finish_session"})
        self.assertEqual(cu["next_action"], "next_card")  # normalized away from finish
        self.assertEqual(cu["status"], "completed")

    def test_final_boss_partial_by_attempt_limit_finishes(self):
        # 3rd failed attempt → partial → finish_session on the final card.
        cu = compute_card_update(3, 4, "final_boss", 2, {"passed": False, "nextAction": "retry"})
        self.assertEqual(cu["attempts"], 3)
        self.assertEqual(cu["result"], "partial")
        self.assertEqual(cu["next_action"], "finish_session")
        self.assertEqual(cu["status"], "in_progress")

    def test_confusion_does_not_consume_attempt(self):
        cu = compute_card_update(0, 4, "real_situation", 0,
                                 {"passed": False, "nextAction": "retry", "detectedIssues": ["confusion"]})
        self.assertEqual(cu["attempts"], 0)
        self.assertEqual(cu["result"], "not_passed")
        self.assertEqual(cu["next_action"], "retry")

    def test_normalize_never_next_card_for_final_passed(self):
        self.assertEqual(normalize_next_action("next_card", "final_boss", 3, 4, True, "passed"), "finish_session")
        self.assertEqual(normalize_next_action("retry", "final_boss", 3, 4, False, "not_passed"), "retry")


class RecoverySelectionTests(unittest.TestCase):
    def test_substantial_current_transcript_recovers(self):
        c = select_recovery_candidate(LONG_ANSWER, 0, [], "final_boss")
        self.assertEqual(c, LONG_ANSWER)

    def test_what_next_with_prior_answer_recovers_prior(self):
        recent = [
            {"role": "assistant", "content": "Tell me about your day."},
            {"role": "user", "content": LONG_ANSWER},
            {"role": "assistant", "content": "Great job, that was wonderful!"},
        ]
        c = select_recovery_candidate("What next?", 0, recent, "final_boss")
        self.assertEqual(c, LONG_ANSWER)

    def test_meta_without_prior_answer_no_recovery(self):
        c = select_recovery_candidate("what next?", 0, [
            {"role": "assistant", "content": "Tell me about your day."},
        ], "final_boss")
        self.assertIsNone(c)

    def test_confusion_no_recovery(self):
        self.assertIsNone(select_recovery_candidate("I don't understand", 0, [], "real_situation"))

    def test_empty_transcript_no_recovery(self):
        self.assertIsNone(select_recovery_candidate("", 0, [], "real_situation"))

    def test_meta_after_an_attempt_no_recovery(self):
        # attempts != 0 → the card already advanced/recorded; nothing to recover.
        self.assertIsNone(select_recovery_candidate("what next", 1, [
            {"role": "user", "content": LONG_ANSWER},
        ], "final_boss"))

    def test_short_answer_not_substantial(self):
        self.assertFalse(is_substantial_attempt("ok", "real_situation"))
        self.assertFalse(is_substantial_attempt("yes I did three things", "final_boss"))  # <8 words
        self.assertTrue(is_substantial_attempt(LONG_ANSWER, "final_boss"))


class HelperTests(unittest.TestCase):
    def test_meta_detection(self):
        for s in ["what next?", "What's next", "next", "are we done?", "finish", "done"]:
            self.assertTrue(is_meta_followup(s), s)
        self.assertFalse(is_meta_followup(LONG_ANSWER))

    def test_confusion_detection(self):
        for s in ["I don't understand", "what does that mean?", "can you explain"]:
            self.assertTrue(is_confusion_text(s), s)
        self.assertFalse(is_confusion_text(LONG_ANSWER))

    def test_last_substantial_skips_meta_and_short(self):
        recent = [
            {"role": "user", "content": LONG_ANSWER},
            {"role": "assistant", "content": "nice"},
            {"role": "user", "content": "what next?"},
        ]
        self.assertEqual(last_substantial_user_answer(recent, "final_boss"), LONG_ANSWER)

    def test_deterministic_fallback_only_for_substantial(self):
        self.assertIsNone(deterministic_fallback_eval("final_boss", "ok", 1))
        fb = deterministic_fallback_eval("final_boss", LONG_ANSWER, 1)
        self.assertIsNotNone(fb)
        self.assertTrue(fb["passed"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
