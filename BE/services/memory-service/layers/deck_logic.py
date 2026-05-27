"""Pure exercise-deck transition logic — no IO, no external deps.

Kept separate from exercise_deck.py (which imports redis/asyncpg via db) so it
can be unit-tested with stdlib only.
"""


def is_terminal_card(card: dict) -> bool:
    """A card is 'done' (safe to advance past) when the user has cleared it:
    completed/skipped, or the evaluator told us to move on / finish."""
    if not isinstance(card, dict):
        return False
    if card.get("status") in ("completed", "skipped"):
        return True
    if card.get("next_action") in ("next_card", "finish_session"):
        return True
    return False


def is_attempted_terminal_card(card: dict) -> bool:
    """Terminal AND the user actually attempted it (i.e. not a skip). Covers
    passed cards and failed/partial cards the evaluator escalated past — so a
    deck where every card was attempted but none passed still counts as done."""
    return is_terminal_card(card) and (card or {}).get("status") != "skipped"


def advance_deck_state(deck: dict) -> dict:
    """Advance the deck by one card, in place, and return it.

    Idempotency / safety rules (fixes premature finalization on rapid /next):
      - Never advance while the current card is NOT terminal. A repeated /next on
        a card with no result is a no-op (deck returned unchanged).
      - Never mark the deck 'completed' just because *some* card is done.
        Completion requires advancing past the final card AND every card being
        terminal.
      - If we'd run past the end while unfinished cards remain, clamp the index
        back to the first unfinished card and stay 'in_progress'.
    """
    # An already-finished deck is never re-advanced.
    if deck.get("status") in ("completed", "ended_early", "abandoned"):
        return deck

    cards = deck.get("cards", [])
    idx = int(deck.get("current_card_index", 0))
    current = cards[idx] if 0 <= idx < len(cards) else None

    # Guard: current card must be terminal before we move on.
    if current is not None and not is_terminal_card(current):
        if deck.get("status") == "not_started":
            deck["status"] = "in_progress"
        return deck

    if deck.get("status") == "not_started":
        deck["status"] = "in_progress"

    new_idx = idx + 1

    # Still cards left → advance exactly one, stay in progress.
    if new_idx < len(cards):
        deck["current_card_index"] = new_idx
        deck["status"] = "in_progress"
        return deck

    # We were on the final card. Decide completion only from the full deck.
    #   1. every card skipped            -> ended_early (user opted out)
    #   2. every card terminal AND at    -> completed (incl. all-failed/partial:
    #      least one was attempted          a weak learner still finished)
    #   3. otherwise (a card is still    -> clamp to first unfinished, stay
    #      not terminal)                    in_progress (never complete partial)
    all_terminal = bool(cards) and all(is_terminal_card(c) for c in cards)
    all_skipped = bool(cards) and all(c.get("status") == "skipped" for c in cards)
    any_attempted = any(is_attempted_terminal_card(c) for c in cards)

    if all_skipped:
        deck["current_card_index"] = len(cards)
        deck["status"] = "ended_early"
        deck["end_reason"] = "user_skipped_all"
    elif all_terminal and any_attempted:
        deck["current_card_index"] = len(cards)
        deck["status"] = "completed"
        deck["end_reason"] = "completed_deck"
    else:
        # A card is still not terminal — never complete a partial deck. Clamp to
        # the first unfinished card and keep going.
        first_unfinished = next(
            (i for i, c in enumerate(cards) if not is_terminal_card(c)),
            max(0, len(cards) - 1),
        )
        deck["current_card_index"] = first_unfinished
        deck["status"] = "in_progress"
    return deck
