import json
import logging
from datetime import datetime, timezone
from db import redis_client

log = logging.getLogger("exercise_deck")

DECK_TTL = 72 * 3600  # 72 hours

VALID_DECK_STATUSES = {"not_started", "in_progress", "completed", "ended_early", "abandoned"}


class ExerciseDeckService:

    @staticmethod
    def _key(session_id: str) -> str:
        return f"session:{session_id}:exercise_deck"

    @staticmethod
    async def get_deck(session_id: str) -> dict | None:
        key = ExerciseDeckService._key(session_id)
        raw = await redis_client.client.get(key)
        if not raw:
            return None
        try:
            return json.loads(raw)
        except Exception:
            log.warning("[exercise_deck] malformed JSON for session=%s", session_id)
            return None

    @staticmethod
    async def save_deck(session_id: str, deck: dict) -> dict:
        key = ExerciseDeckService._key(session_id)
        deck["session_id"] = session_id
        deck["updated_at"] = datetime.now(timezone.utc).isoformat()
        if "created_at" not in deck:
            deck["created_at"] = deck["updated_at"]
        await redis_client.client.set(key, json.dumps(deck, default=str), ex=DECK_TTL)
        log.info(
            "[exercise_deck] saved  session=%s  type=%s  status=%s  cards=%d  idx=%d",
            session_id,
            deck.get("session_type", "?"),
            deck.get("status", "?"),
            len(deck.get("cards", [])),
            deck.get("current_card_index", 0),
        )
        return deck

    @staticmethod
    async def create_deck(session_id: str, deck_data: dict) -> dict:
        """Create or replace deck. deck_data should be the full deck object from generateDeck."""
        now = datetime.now(timezone.utc).isoformat()
        deck = {
            "id": deck_data.get("id") or f"deck-{session_id}",
            "session_id": session_id,
            "session_type": deck_data.get("session_type", "adaptive_training"),
            "mission": deck_data.get("mission", ""),
            "mission_source": deck_data.get("mission_source", "fallback"),
            "reason": deck_data.get("reason", ""),
            "status": deck_data.get("status", "not_started"),
            "current_card_index": int(deck_data.get("current_card_index", 0)),
            "cards": deck_data.get("cards", []),
            "end_reason": deck_data.get("end_reason"),
            "created_at": deck_data.get("created_at", now),
        }
        return await ExerciseDeckService.save_deck(session_id, deck)

    @staticmethod
    async def get_current_card(session_id: str) -> dict | None:
        deck = await ExerciseDeckService.get_deck(session_id)
        if not deck:
            return None
        cards = deck.get("cards", [])
        idx = deck.get("current_card_index", 0)
        return cards[idx] if 0 <= idx < len(cards) else None

    @staticmethod
    async def update_current_card(session_id: str, card_update: dict) -> dict | None:
        """Merge card_update into the current card. Transitions deck to in_progress on first update."""
        deck = await ExerciseDeckService.get_deck(session_id)
        if not deck:
            return None
        cards = deck.get("cards", [])
        idx = deck.get("current_card_index", 0)
        if 0 <= idx < len(cards):
            cards[idx] = {**cards[idx], **card_update}
            deck["cards"] = cards
        if deck.get("status") == "not_started":
            deck["status"] = "in_progress"
        return await ExerciseDeckService.save_deck(session_id, deck)

    @staticmethod
    async def move_to_next_card(session_id: str) -> dict | None:
        """Advance current_card_index by 1. Auto-completes deck when last card is passed."""
        deck = await ExerciseDeckService.get_deck(session_id)
        if not deck:
            return None
        if deck.get("status") == "not_started":
            deck["status"] = "in_progress"
        idx = deck.get("current_card_index", 0) + 1
        deck["current_card_index"] = idx
        if idx >= len(deck.get("cards", [])):
            deck["status"] = "completed"
            deck["end_reason"] = "completed_deck"
            log.info("[exercise_deck] deck completed  session=%s", session_id)
        return await ExerciseDeckService.save_deck(session_id, deck)

    @staticmethod
    async def update_deck_status(session_id: str, status: str) -> dict | None:
        if status not in VALID_DECK_STATUSES:
            log.warning("[exercise_deck] invalid status=%s  session=%s", status, session_id)
            return None
        deck = await ExerciseDeckService.get_deck(session_id)
        if not deck:
            return None
        deck["status"] = status
        return await ExerciseDeckService.save_deck(session_id, deck)

    @staticmethod
    async def mark_deck_ended(session_id: str, end_reason: str) -> dict | None:
        deck = await ExerciseDeckService.get_deck(session_id)
        if not deck:
            return None
        if end_reason == "completed_deck":
            deck["status"] = "completed"
        elif end_reason == "idle_timeout":
            deck["status"] = "abandoned"
        else:
            deck["status"] = "ended_early"
        deck["end_reason"] = end_reason
        log.info(
            "[exercise_deck] deck ended  session=%s  end_reason=%s  status=%s",
            session_id, end_reason, deck["status"],
        )
        return await ExerciseDeckService.save_deck(session_id, deck)
