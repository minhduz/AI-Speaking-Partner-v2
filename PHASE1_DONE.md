# Phase 1 — Exercise Deck: Data Model + Storage

## Mục tiêu

Tạo nền tảng lưu trữ Exercise Deck trong Redis. Không có UI, không có prompt injection, không có AI generation.

---

## Files đã tạo / sửa

### Memory-service (Python)

**`BE/services/memory-service/layers/exercise_deck.py`** _(mới)_

- Class `ExerciseDeckService` với các static method:
  - `create(session_id, mission_source, cards)` — tạo deck mới
  - `get(session_id)` — đọc deck từ Redis
  - `mark_card_done(session_id, card_index, user_response)` — đánh dấu card hoàn thành
  - `advance(session_id)` — tăng `current_card_index` lên 1, tự set `status: "completed"` khi hết cards
  - `end(session_id)` — force complete deck
- Redis key: `session:{session_id}:exercise_deck`
- TTL: 72 giờ

**`BE/services/memory-service/routers/exercise_deck_ops.py`** _(mới)_

- 5 endpoints:
  - `POST /exercise-deck/{session_id}` — tạo/thay thế deck
  - `GET /exercise-deck/{session_id}` — đọc deck
  - `PUT /exercise-deck/{session_id}/card/{card_index}/done` — mark card done
  - `PUT /exercise-deck/{session_id}/advance` — advance sang card tiếp
  - `PUT /exercise-deck/{session_id}/end` — kết thúc deck

**`BE/services/memory-service/main.py`** _(sửa)_

- Đăng ký `deck_router` vào app

---

### Orchestrator (NestJS)

**`BE/apps/orchestrator/src/session/session.service.ts`** _(sửa)_

- 4 method proxy tới memory-service:
  - `getDeck(sessionId)`
  - `createDeck(sessionId, body)`
  - `advanceDeck(sessionId)`
  - `endDeck(sessionId)`

**`BE/apps/orchestrator/src/session/session.controller.ts`** _(sửa)_

- 4 route expose ra ngoài:
  - `GET /session/:id/deck`
  - `POST /session/:id/deck`
  - `PUT /session/:id/deck/advance`
  - `PUT /session/:id/deck/end`

**`BE/apps/orchestrator/src/turn/turn.service.ts`** _(sửa)_

- Method `getDeckInfo(sessionId)` — fetch deck state từ memory-service, trả về `{ status, current_card_index, cards }`

**`BE/apps/orchestrator/src/turn/turn.controller.ts`** _(sửa)_

- Thêm 3 header vào cả 2 stream endpoint (`/turn/:id/stream` và `/turn/:id/stream-text`):
  - `X-Deck-Status` — trạng thái deck (`active` / `completed` / `none`)
  - `X-Deck-Card-Index` — index card hiện tại
  - `X-Deck-Current-Card` — JSON của card hiện tại (URL-encoded)

---

## Data model

```json
{
  "session_id": "uuid",
  "mission_source": "manual | today_challenge | session_insight",
  "cards": [
    {
      "exercise_type": "vocabulary | grammar | pronunciation | conversation",
      "prompt": "nội dung bài tập",
      "status": "pending | done | skipped",
      "user_response": "câu trả lời của user (optional)"
    }
  ],
  "current_card_index": 0,
  "status": "active | completed",
  "created_at": "ISO UTC",
  "updated_at": "ISO UTC"
}
```

---

## Test kết quả

| Endpoint                                           | Kết quả                              |
| -------------------------------------------------- | ------------------------------------ |
| POST `/session/:id/deck`                           | Tạo deck, trả về JSON đúng           |
| GET `/session/:id/deck`                            | Đọc lại đúng data                    |
| PUT `/session/:id/deck/advance`                    | `current_card_index` tăng đúng       |
| PUT `/session/:id/deck/advance` (lần 2, hết cards) | `status` tự chuyển thành `completed` |
