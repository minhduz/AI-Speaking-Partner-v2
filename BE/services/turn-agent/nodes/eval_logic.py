"""Pure deck-eval logic for the turn-agent — no IO, no LLM, no deps.

Kept separate from llm_tts_node so it can be unit-tested with stdlib only.
Covers: turning a parsed EVAL block into a card_update, normalizing nextAction
(esp. forcing finish_session on the last/final_boss card), and deciding what
text to (re)evaluate when the LLM omits/truncates the EVAL block.
"""
import re

ATTEMPT_LIMIT = 3

# Short meta follow-ups that are NOT a card attempt (the user is asking what to
# do next, not answering the task).
_META_PATTERNS = (
    "what next", "what's next", "whats next", "what now", "so what now",
    "what do i do", "are we done", "is that it", "finish", "done", "next",
)
# Confusion / clarification — must not be auto-evaluated or counted as an attempt.
_CONFUSION_PATTERNS = (
    "i don't understand", "i dont understand", "don't understand", "dont understand",
    "what does that mean", "what do you mean", "can you explain", "explain that",
    "i'm confused", "im confused", "i don't get", "i dont get", "huh",
)


def word_count(text: str) -> int:
    return len(re.findall(r"[\w']+", text or ""))


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9'\s]", "", (text or "").lower()).strip()


def is_meta_followup(text: str) -> bool:
    """True for short 'what next / done / finish' style messages."""
    n = _norm(text)
    if not n:
        return False
    if word_count(n) > 6:
        return False
    return any(p in n for p in _META_PATTERNS)


def is_confusion_text(text: str) -> bool:
    """True for short clarification requests."""
    n = _norm(text)
    if not n:
        return False
    if word_count(n) > 8:
        return False
    return any(p in n for p in _CONFUSION_PATTERNS)


def is_substantial_attempt(text: str, card_type: str) -> bool:
    """Whether `text` is a real attempt worth evaluating. final_boss expects a
    longer answer (a ~45s monologue), so require more words there."""
    if is_confusion_text(text) or is_meta_followup(text):
        return False
    wc = word_count(text)
    min_words = 8 if card_type == "final_boss" else 4
    return wc >= min_words


def last_substantial_user_answer(recent_messages, card_type: str = "") -> str | None:
    """Most recent user message in the window that looks like a real attempt.
    Used to recover an evaluation when the user already answered but then sent a
    meta follow-up like 'what next?' (and the original EVAL was never persisted)."""
    for m in reversed(recent_messages or []):
        if (m or {}).get("role") != "user":
            continue
        content = (m.get("content") or "").strip()
        if is_substantial_attempt(content, card_type):
            return content
    return None


def select_recovery_candidate(transcript, card_attempts, recent_messages, card_type):
    """Decide which text to evaluate when no valid EVAL was applied this turn.

    Returns the candidate answer string, or None when there's nothing to
    recover (UI-driven turn, confusion-only, or meta with no prior answer).
    """
    t = (transcript or "").strip()
    if not t:
        return None  # UI-driven turn (advance/intro) — no attempt, no EVAL expected.
    # Meta is checked before confusion: "what next?" is a follow-up, not confusion.
    if (not is_meta_followup(t)) and is_confusion_text(t):
        return None  # never auto-evaluate confusion.
    if is_meta_followup(t):
        # A meta follow-up only triggers recovery for a still-stuck card (no
        # attempt recorded). Pull the previous substantial answer to evaluate.
        if int(card_attempts or 0) != 0:
            return None
        prev = last_substantial_user_answer(recent_messages, card_type)
        return prev
    # A normal, substantial attempt evaluates itself.
    if is_substantial_attempt(t, card_type):
        return t
    return None


def normalize_next_action(raw, card_type, card_index, card_total, passed, result):
    """Force a coherent nextAction regardless of what the LLM/repair returned.

    - final/last card: advancing (passed or partial-by-limit) => finish_session;
      otherwise retry. Never 'next_card' for a final card.
    - non-final card: advancing => next_card; otherwise retry.
    """
    is_final = card_type == "final_boss" or (card_total > 0 and card_index + 1 >= card_total)
    advancing = bool(passed) or result == "partial"
    if is_final:
        return "finish_session" if advancing else "retry"
    return "next_card" if advancing else "retry"


def compute_card_update(card_index, card_total, card_type, prior_attempts, parsed_eval):
    """Turn a parsed EVAL dict into the card_update persisted to memory-service.

    - confusion retries do NOT consume an attempt.
    - result: passed | partial (failed but hit attempt limit) | not_passed.
    - status: completed only when passed.
    - next_action normalized (see normalize_next_action).
    """
    passed = bool(parsed_eval.get("passed"))
    detected = [str(d).lower() for d in (parsed_eval.get("detectedIssues") or [])]
    is_confusion_retry = (not passed) and ("confusion" in detected)
    attempts = int(prior_attempts or 0) if is_confusion_retry else int(prior_attempts or 0) + 1

    if passed:
        result = "passed"
    elif attempts >= ATTEMPT_LIMIT:
        result = "partial"
    else:
        result = "not_passed"

    next_action = normalize_next_action(
        parsed_eval.get("nextAction"), card_type, int(card_index or 0), int(card_total or 0),
        passed, result,
    )

    return {
        "status": "completed" if passed else "in_progress",
        "attempts": attempts,
        "result": result,
        "feedback": parsed_eval.get("feedback", "") or "",
        "next_action": next_action,
    }


def deterministic_fallback_eval(card_type, candidate, attempts_after):
    """Last-resort eval when the repair LLM is unavailable. Only fires for a
    clearly substantial attempt; forgiving (passed=true) so a real attempt is
    never trapped. Returns a parsed-eval-shaped dict, or None to stay safe."""
    if not is_substantial_attempt(candidate, card_type):
        return None
    return {
        "passed": True,
        "feedback": "Nice work — that completes this exercise.",
        "retryRecommended": False,
        # normalize_next_action will fix this per card position.
        "nextAction": "next_card",
        "detectedIssues": ["auto_recovered"],
    }
