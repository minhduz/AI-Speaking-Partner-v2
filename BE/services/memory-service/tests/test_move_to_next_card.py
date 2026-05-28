"""Unit tests for the pure deck-advancement transition.

No redis / pytest needed — runs on stdlib unittest:
    python -m unittest tests.test_move_to_next_card   (from memory-service/)
or  python tests/test_move_to_next_card.py
"""
import os
import sys
import unittest

# Make `layers` importable when run directly from the tests/ dir.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import the pure module only — no redis/asyncpg deps needed to run these.
from layers.deck_logic import advance_deck_state as advance  # noqa: E402


def card(status="not_started", result=None, next_action=None):
    return {"status": status, "result": result, "next_action": next_action}


def deck(cards, idx, status="in_progress"):
    return {"cards": cards, "current_card_index": idx, "status": status}


class MoveToNextCardTests(unittest.TestCase):
    def test_advances_one_from_completed_card(self):
        # 4-card deck, cards 0 & 1 completed, currently on card 1 (idx=1).
        cards = [card("completed", "passed", "next_card"),
                 card("completed", "passed", "next_card"),
                 card(), card()]
        d = advance(deck(cards, 1))
        self.assertEqual(d["current_card_index"], 2)
        self.assertEqual(d["status"], "in_progress")

    def test_repeated_next_on_unfinished_card_is_noop(self):
        # Now on card 2 (idx=2) which has no result → /next must not move.
        cards = [card("completed", "passed", "next_card"),
                 card("completed", "passed", "next_card"),
                 card(), card()]
        d = deck(cards, 2)
        d = advance(d)
        self.assertEqual(d["current_card_index"], 2)
        self.assertEqual(d["status"], "in_progress")
        # And again — still idempotent.
        d = advance(d)
        self.assertEqual(d["current_card_index"], 2)
        self.assertEqual(d["status"], "in_progress")

    def test_cannot_complete_sitting_on_unstarted_final_card(self):
        # On the final card but it's not_started → the terminal guard makes /next
        # a no-op; the deck must never flip to completed.
        cards = [card("completed", "passed", "next_card"),
                 card("completed", "passed", "next_card"),
                 card(), card()]
        d = advance(deck(cards, 3))
        self.assertEqual(d["status"], "in_progress")
        self.assertNotEqual(d["status"], "completed")
        self.assertEqual(d["current_card_index"], 3)  # unchanged — no advance

    def test_advancing_past_end_with_unfinished_card_clamps(self):
        # Current (final) card is terminal, but an EARLIER card was never done.
        # We must not complete — clamp back to the first unfinished card.
        cards = [card(),  # never finished
                 card("completed", "passed", "finish_session")]
        d = advance(deck(cards, 1))
        self.assertEqual(d["status"], "in_progress")
        self.assertEqual(d["current_card_index"], 0)

    def test_final_card_passed_completes(self):
        cards = [card("completed", "passed", "next_card"),
                 card("completed", "passed", "next_card"),
                 card("completed", "passed", "next_card"),
                 card("completed", "passed", "finish_session")]
        d = advance(deck(cards, 3))
        self.assertEqual(d["status"], "completed")
        self.assertEqual(d["end_reason"], "completed_deck")
        self.assertEqual(d["current_card_index"], 4)

    def test_all_skipped_ends_early(self):
        cards = [card("skipped"), card("skipped")]
        d = advance(deck(cards, 1))
        self.assertEqual(d["status"], "ended_early")
        self.assertEqual(d["end_reason"], "user_skipped_all")

    def test_all_failed_but_escalated_completes(self):
        # Weak learner: every card attempted, none passed, but the evaluator
        # escalated past each (next_card / finish_session). Deck must COMPLETE,
        # not get stuck clamped on the final card.
        cards = [card("in_progress", "failed", "next_card"),
                 card("in_progress", "failed", "next_card"),
                 card("in_progress", "failed", "finish_session")]
        d = advance(deck(cards, 2))
        self.assertEqual(d["status"], "completed")
        self.assertEqual(d["end_reason"], "completed_deck")
        self.assertEqual(d["current_card_index"], 3)

    def test_mixed_skipped_and_failed_completes_not_ended_early(self):
        # Some skipped, some attempted-failed → at least one attempt exists, so
        # it's a completion, not an all-skipped ended_early.
        cards = [card("skipped"),
                 card("in_progress", "failed", "next_card")]
        d = advance(deck(cards, 1))
        self.assertEqual(d["status"], "completed")
        self.assertEqual(d["end_reason"], "completed_deck")

    def test_unfinished_card_still_blocks_completion(self):
        # Final card terminal-failed, but an earlier card is still not_started →
        # never complete; clamp back to the unfinished card.
        cards = [card(),  # not_started
                 card("in_progress", "failed", "finish_session")]
        d = advance(deck(cards, 1))
        self.assertEqual(d["status"], "in_progress")
        self.assertEqual(d["current_card_index"], 0)

    def test_failed_but_escalated_card_can_advance(self):
        # result=failed but evaluator forced next_card (3rd-attempt escalation).
        cards = [card("in_progress", "failed", "next_card"), card()]
        d = advance(deck(cards, 0))
        self.assertEqual(d["current_card_index"], 1)
        self.assertEqual(d["status"], "in_progress")

    def test_already_completed_deck_is_untouched(self):
        cards = [card("completed", "passed", "next_card")]
        d = advance(deck(cards, 1, status="completed"))
        self.assertEqual(d["status"], "completed")
        self.assertEqual(d["current_card_index"], 1)

    def test_not_started_deck_becomes_in_progress_without_skipping(self):
        # First card not answered yet; a stray /next just flips to in_progress.
        cards = [card(), card()]
        d = advance(deck(cards, 0, status="not_started"))
        self.assertEqual(d["status"], "in_progress")
        self.assertEqual(d["current_card_index"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
