# Phase 6 — End Session + Partial Completion

## Mục tiêu
Khi session kết thúc, đọc trạng thái deck từ Redis, map `end_reason` từ session-level → deck-level, rồi truyền vào consolidation để LLM extract `session_insight` mở rộng (deck_completion, code_switch_pattern, recommended_next_mode). Closing message của AI branch theo deck status — completed thì chúc mừng, ended_early thì warm acknowledgement, abandoned/idle thì silent.

---

## Files đã sửa

### Orchestrator (NestJS)

**`BE/apps/orchestrator/src/session/session.service.ts`** *(update)*

- Thêm helper free function `mapSessionReasonToDeckEnd(reason)`:
  - `user_clicked` → `user_clicked_end`
  - `voice_intent` → `voice_end_intent`
  - `idle_timeout` / `tab_close` / `orphan` → `idle_timeout`

- `end(sessionId, userId, reason)`:
  - Sau khi update Postgres row, gọi `endDeck(sessionId, mappedReason)` để stamp `end_reason` vào deck blob ở Redis **trước khi** trigger consolidation
  - `mark_deck_ended` đã sẵn sàng map tiếp: `completed_deck` → `completed`, `idle_timeout` → `abandoned`, mọi cái khác → `ended_early`
  - Trigger consolidation chạy sau, đọc deck blob từ Redis trực tiếp (không cần plumb JSON qua HTTP body)

- `generateClosingMessage(userId, sessionId)`:
  - Parallel fetch thêm `getDeck(sessionId)` và `userService.findById(userId)`
  - Tính `done`, `skipped`, `total`, `deckStatus`, `endReason`, `firstName`
  - **Silent close**: nếu `deckStatus === 'abandoned'` hoặc `endReason === 'idle_timeout'` → return `{ text: '', audio_b64: null }` (FE skip overlay)
  - **Completed branch**: inject `deckBlock` với template "Nice work, {name}. Today you completed all {N} exercises..."
  - **Ended_early branch**: inject template "Ok {name}, we'll stop here. You still practiced..."
  - Thêm rule mới vào prompt: "Never say 'failed' or 'incomplete' — use 'paused', 'continue next time', 'still working on'"

---

### Memory-Service (Python)

**`BE/services/memory-service/workers/consolidation.py`** *(update)*

- Import `ExerciseDeckService`

- Helper mới `_build_deck_context(deck)` — distil deck blob xuống các fields consolidation LLM cần:
  ```python
  {
    "session_type", "mission", "deck_status", "end_reason",
    "completed_cards", "skipped_cards", "total_cards", "card_results"
  }
  ```
  Return `None` nếu không có deck (free-form turn session) — prompt branch skip deck-aware reasoning.

- `run_consolidation(user_id, session_id)`:
  - Step 3: gọi `ExerciseDeckService.get_deck(session_id)` → `_build_deck_context()` → log status/end_reason/cards
  - Pass `deck_context` vào `_extract_all_facts()`

- `_extract_all_facts(conversation, session_start_utc, user_turn_count, deck_context=None)`:
  - Schema mở rộng cho `session_insight`:
    ```
    "struggled_with":              string | null,
    "improved_vs_before":          string | null,
    "next_challenge":              string | null,
    "speaking_duration_estimate":  "short" | "medium" | "long" | null,
    "energy_level":                "low" | "medium" | "high" | null,
    "code_switch_pattern":         "none" | "low" | "medium" | "high" | null,
    "code_switch_trigger":         "vocabulary_gap" | "grammar_uncertainty" | "both" | "unknown" | null,
    "deck_completion":             object | null,
    "recommended_next_mode":       "new_deck" | "resume_deck" | "lighter_deck" | "quick_practice" | null
    ```
  - Khi `deck_context` có giá trị + session ≥ 4 user turns, inject `deck_block`:
    - Bảo LLM copy deck_completion trực tiếp từ context
    - Rules cho `recommended_next_mode`:
      - `end_reason == "low_energy_detected"` → `lighter_deck`
      - `deck_status == "ended_early"` + còn cards → `resume_deck`
      - `deck_status == "completed"` → `new_deck` + `next_challenge` advance skill
      - `end_reason == "idle_timeout"` → `quick_practice` + `energy_level=null`
    - "Don't treat early ending as failure"
    - "Extract from completed/attempted cards only"

- `insight_payload_keys` — thêm 4 keys mới vào tuple được persist vào `SESSION_INSIGHT:` short-term fact:
  - `code_switch_pattern`, `code_switch_trigger`, `deck_completion`, `recommended_next_mode`

---

## Data flow on session end

```
User clicks End
  → POST /session/:id/close       (orchestrator)
      → generateClosingMessage()
          → parallel: getSessionInsight + getGreetingContext + getDeck + userService.findById
          → branch on deckStatus → build deckBlock template
          → LLM /complete → text + TTS
      ← return { text, audio_b64 }
  ← FE plays closing audio

User finalize end (or auto after closing audio plays)
  → POST /session/end             (orchestrator)
      → session.end(sessionId, userId, reason)
          → repo.update Postgres status='ended'|'abandoned'
          → endDeck(sessionId, mapSessionReasonToDeckEnd(reason))
              → memory-service PUT /exercise-deck/:id/end
                  → ExerciseDeckService.mark_deck_ended()
                      → maps end_reason → status (completed | ended_early | abandoned)
                      → save_deck (stamps updated_at)
          → triggerConsolidation(userId, sessionId)
              → memory-service POST /consolidate/:user_id
                  → run_consolidation(user_id, session_id)
                      → ExerciseDeckService.get_deck(session_id)
                      → _build_deck_context(deck)
                      → _extract_all_facts(..., deck_context=...)
                          → LLM extracts session_insight WITH deck_completion + recommended_next_mode
                      → persist as SESSION_INSIGHT: short-term fact
                      → promote next_challenge to today_challenge
```

---

## Test plan (cần verify thủ công)

| # | Test case | Expected | Status |
|---|-----------|----------|--------|
| 1 | Complete all 4 cards then click End | Deck status `completed`, `end_reason=completed_deck`. Closing message: "Nice work, Đức. Today you completed all 4 exercises. You practiced ..." | ⏳ |
| 2 | Complete 1 of 4 cards then click End | Deck status `ended_early`, `end_reason=user_clicked_end`. Closing message: "Ok Đức, we'll stop here. You still practiced the first part..." No "failed"/"incomplete" wording. | ⏳ |
| 3 | Idle 15+ min (idle_timeout) | Deck status `abandoned`, `end_reason=idle_timeout`. Closing message empty — overlay closes silently. | ⏳ |
| 4 | Voice intent end ("I'm done") | Deck status `ended_early`, `end_reason=voice_end_intent`. Closing message uses ended_early template. | ⏳ |
| 5 | Consolidation extracts deck_completion | After session 2 ends, check `SESSION_INSIGHT:` short-term fact for keys: `deck_completion`, `recommended_next_mode`, `code_switch_pattern`. | ⏳ |
| 6 | recommended_next_mode mapping | End early → `resume_deck`. Complete deck → `new_deck`. Idle timeout → `quick_practice`. Low energy → `lighter_deck`. | ⏳ |
| 7 | Free-form session (no deck) | Consolidation runs without deck context — `deck_completion=null`, no deck-aware reasoning in prompt. No regression on existing flow. | ⏳ |

### Logs to confirm

```powershell
docker compose logs -f speaking_orchestrator | Select-String "Session\]\[closing\]|deck ended"
docker compose logs -f speaking_memory_service | Select-String "deck_context|SESSION_INSIGHT"
```

Expected lines:
- `[Session][closing] silent close session=...  reason=idle_timeout` (for idle)
- `[exercise_deck] deck ended  session=...  end_reason=user_clicked_end  status=ended_early`
- `[consolidation] step 3 — deck_context  status=ended_early  end_reason=user_clicked_end  cards=1/4  skipped=0`
- `[memory_ops]   [st-new][SESSION_INSIGHT] "SESSION_INSIGHT:{\"struggled_with\": ..., \"deck_completion\": {...}, \"recommended_next_mode\": \"resume_deck\"}"`
