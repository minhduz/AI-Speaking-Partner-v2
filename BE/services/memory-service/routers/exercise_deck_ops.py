import logging
from typing import Dict, Any
from fastapi import APIRouter
from pydantic import BaseModel
from layers.exercise_deck import ExerciseDeckService

log = logging.getLogger("exercise_deck_ops")
router = APIRouter()


class CardUpdateRequest(BaseModel):
    status: str | None = None
    attempts: int | None = None
    result: str | None = None
    feedback: str | None = None
    ui_hint: str | None = None
    next_action: str | None = None


class DeckStatusRequest(BaseModel):
    status: str


class DeckEndRequest(BaseModel):
    end_reason: str = "user_clicked_end"


# POST /exercise-deck/{session_id} — create or replace full deck (called by orchestrator generateDeck)
@router.post("/exercise-deck/{session_id}")
async def create_deck(session_id: str, body: Dict[str, Any]):
    deck = await ExerciseDeckService.create_deck(session_id, body)
    return deck


# GET /exercise-deck/{session_id} — get current deck state
@router.get("/exercise-deck/{session_id}")
async def get_deck(session_id: str):
    deck = await ExerciseDeckService.get_deck(session_id)
    if not deck:
        return {"status": "none", "session_id": session_id}
    return deck


# GET /exercise-deck/{session_id}/card — get current card
@router.get("/exercise-deck/{session_id}/card")
async def get_current_card(session_id: str):
    card = await ExerciseDeckService.get_current_card(session_id)
    if not card:
        return {"status": "none", "session_id": session_id}
    return card


# PUT /exercise-deck/{session_id}/card — update current card after evaluation
@router.put("/exercise-deck/{session_id}/card")
async def update_current_card(session_id: str, body: CardUpdateRequest):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    deck = await ExerciseDeckService.update_current_card(session_id, update)
    if not deck:
        return {"status": "none", "session_id": session_id}
    return deck


# PUT /exercise-deck/{session_id}/next — advance to next card
@router.put("/exercise-deck/{session_id}/next")
async def move_to_next_card(session_id: str):
    deck = await ExerciseDeckService.move_to_next_card(session_id)
    if not deck:
        return {"status": "none", "session_id": session_id}
    return deck


# PUT /exercise-deck/{session_id}/skip — mark current card as skipped + advance.
# Phase 7 edge case: user explicitly opts out of the current card. Not a failure
# state — `result` stays null so consolidation doesn't treat it as attempted.
@router.put("/exercise-deck/{session_id}/skip")
async def skip_current_card(session_id: str):
    skip_update = {"status": "skipped"}
    updated = await ExerciseDeckService.update_current_card(session_id, skip_update)
    if not updated:
        return {"status": "none", "session_id": session_id}
    # After marking skipped, advance to the next card (or auto-complete the deck).
    deck = await ExerciseDeckService.move_to_next_card(session_id)
    return deck or {"status": "none", "session_id": session_id}


# PUT /exercise-deck/{session_id}/advance — alias for /next (backward compat)
@router.put("/exercise-deck/{session_id}/advance")
async def advance_deck(session_id: str):
    deck = await ExerciseDeckService.move_to_next_card(session_id)
    if not deck:
        return {"status": "none", "session_id": session_id}
    return deck


# PUT /exercise-deck/{session_id}/status — update deck status
@router.put("/exercise-deck/{session_id}/status")
async def update_deck_status(session_id: str, body: DeckStatusRequest):
    deck = await ExerciseDeckService.update_deck_status(session_id, body.status)
    if not deck:
        return {"status": "none", "session_id": session_id}
    return deck


# PUT /exercise-deck/{session_id}/end — mark deck ended with reason
@router.put("/exercise-deck/{session_id}/end")
async def end_deck(session_id: str, body: DeckEndRequest):
    deck = await ExerciseDeckService.mark_deck_ended(session_id, body.end_reason)
    if not deck:
        return {"status": "none", "session_id": session_id}
    return deck
