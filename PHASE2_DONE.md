# Phase 2 — Deck Generation

## Mục tiêu

Tự động generate exercise deck sau khi greeting kết thúc, dựa theo session type. Không có UI, không có prompt injection.

---

## Session Types

| Session             | Type                    | Cards                                      |
| ------------------- | ----------------------- | ------------------------------------------ |
| Session 1 (lần đầu) | `onboarding_diagnostic` | 2 cards hardcoded                          |
| Session 2           | `personalized_training` | 4 cards LLM-generated                      |
| Session 3+          | `adaptive_training`     | 3-4 cards LLM-generated (3 nếu low energy) |

---

## Files đã sửa

### Memory-service (Python)

**`BE/services/memory-service/layers/exercise_deck.py`** _(update)_

- Schema đầy đủ theo spec: `id`, `session_type`, `mission`, `mission_source`, `reason`, `status`, `end_reason`
- Đổi tên methods theo spec:
  - `create` → `create_deck` (nhận full deck object)
  - `get` → `get_deck`
  - `_save` → `save_deck`
  - `advance` → `move_to_next_card` (auto-complete khi hết cards)
  - `end` → `mark_deck_ended` (map end_reason → deck status)
- Methods mới: `get_current_card`, `update_current_card`, `update_deck_status`
- `update_current_card` tự chuyển deck từ `not_started` → `in_progress` khi được gọi lần đầu

**`BE/services/memory-service/routers/exercise_deck_ops.py`** _(update)_

- `POST /exercise-deck/{session_id}` — nhận `Dict[str, Any]` thay vì Pydantic model cố định (để nhận full deck từ orchestrator)
- Endpoints mới:
  - `GET /exercise-deck/{session_id}/card` — get current card
  - `PUT /exercise-deck/{session_id}/card` — update current card
  - `PUT /exercise-deck/{session_id}/next` — move to next card
  - `PUT /exercise-deck/{session_id}/status` — update deck status
  - `PUT /exercise-deck/{session_id}/end` — nhận `end_reason` trong body
- Giữ `PUT /exercise-deck/{session_id}/advance` làm alias backward compat

---

### Orchestrator (NestJS)

**`BE/apps/orchestrator/src/session/session.service.ts`** _(sửa)_

Method `getSessionType(userId, isOnboarding)`:

- Query DB đếm số session đã completed/abandoned
- `isOnboarding = true` → `onboarding_diagnostic`
- `completedCount <= 1` → `personalized_training`
- `completedCount >= 2` → `adaptive_training`

Method `generateDeck(userId, sessionId, user, insight, activeMission, isOnboarding)`:

- Mission priority: `active_mission` > `session_insight.next_challenge` > `fallback`
- Log `missionSource` mỗi lần generate
- Onboarding: hardcode 2 cards (`baseline_answer` + `mini_challenge`)
- Session 2+: gọi LLM với fixed card types, validate output, fallback nếu LLM fail
- Adaptive (session 3+): 3 cards nếu `energy_signal=low` hoặc `recommended_next_mode=lighter_deck`, ngược lại 4 cards

Method `generateCardsWithLLM(...)` (private):

- Card types cho session 2+: `simple_explanation` → `weakness_drill` → `real_situation` → `final_boss`
- Prompt inject: mission, level, targetLanguage, struggled_with, energy_signal
- Parse JSON từ LLM response (regex extract + validate)
- Normalize field names (camelCase ↔ snake_case)

Method `buildFallbackCards(mission, cardTypes)` (private):

- Fallback hardcoded nếu LLM fail hoặc trả về invalid JSON

Proxy methods mới: `updateDeckCard`, `updateDeckStatus`, `endDeck(sessionId, endReason)`

**`BE/apps/orchestrator/src/session/session.controller.ts`** _(sửa)_

Trigger `generateDeck` trong `streamGreetingForUser`:

- Fire-and-forget sau khi greeting LLM stream kết thúc (`llmRes.data.on('end', ...)`)
- Chỉ chạy khi có `sessionId` (session-tied greeting route)

Routes mới:

- `PUT /session/:id/deck/card` — update current card
- `PUT /session/:id/deck/next` — advance (alias /next)
- `PUT /session/:id/deck/status` — update deck status
- `PUT /session/:id/deck/end` — nhận `end_reason` trong body

**`BE/apps/orchestrator/src/turn/turn.service.ts`** _(sửa)_

`getDeckInfo(sessionId)` trả về đầy đủ:

- `active`: true khi status là `not_started` hoặc `in_progress`
- `total_cards`: số lượng cards
- `current_card`: full card object tại index hiện tại

**`BE/apps/orchestrator/src/turn/turn.controller.ts`** _(sửa)_

Headers đúng spec Part 6 (cả 2 stream endpoints):

```
X-Deck-Active:        "true" | "false"
X-Card-Index:         "0"
X-Card-Total:         "4"
X-Card-Type:          "simple_explanation"
X-Card-Title:         "<encoded>"
X-Card-Task:          "<encoded>"
X-Card-Attempts:      "0"
X-Card-Retry-Allowed: "true"
```

---

## Data model (full schema)

```json
{
  "id": "deck-{sessionId}",
  "session_id": "uuid",
  "session_type": "onboarding_diagnostic | personalized_training | adaptive_training",
  "mission": "string",
  "mission_source": "active_mission | session_insight | fallback",
  "reason": "string",
  "status": "not_started | in_progress | completed | ended_early | abandoned",
  "current_card_index": 0,
  "cards": [
    {
      "id": "card-1",
      "type": "baseline_answer | mini_challenge | simple_explanation | weakness_drill | real_situation | final_boss",
      "title": "string",
      "task": "string",
      "success_criteria": ["string"],
      "expected_duration_seconds": 60,
      "retry_allowed": true,
      "status": "not_started | in_progress | completed | skipped | failed",
      "attempts": 0,
      "result": "passed | partial | not_passed | null",
      "feedback": "string | null",
      "ui_hint": "string | null"
    }
  ],
  "end_reason": "completed_deck | user_clicked_end | voice_end_intent | low_energy_detected | idle_timeout | null",
  "created_at": "ISO UTC",
  "updated_at": "ISO UTC"
}
```

---

## Test kết quả

| Case                                                     | Kết quả |
| -------------------------------------------------------- | ------- |
| Greeting stream kết thúc → deck tự generate              |         |
| Session 1 → `session_type: "onboarding_diagnostic"`      |         |
| Session 1 → 2 cards đúng type                            |         |
| `mission_source: "fallback"` khi không có active_mission |         |
| `status: "not_started"` sau khi generate                 |         |
| `GET /session/:id/deck` trả về deck đúng                 |         |
