# Phase 5 — Evaluator + Retry/Next

## Mục tiêu
Đóng vòng đánh giá: sau khi user trả lời 1 card, AI tự chấm điểm bằng JSON block `EVAL:{...}` ngay trong response. Turn-agent tách block đó khỏi TTS (user không nghe), parse → push event qua SSE để FE update buttons **tức thì** (~ms), đồng thời PUT card update vào memory-service. FE hiển thị Retry / Next / Finish dựa trên `card.next_action` + `card.result`. Không có LLM call thứ 2 cho evaluator.

---

## Files đã sửa

### Turn-Agent (Python)

**`BE/services/turn-agent/nodes/build_prompt_node.py`** *(update)*
- `_build_card_context_block(state)` (line 360–408): append block `AFTER RESPONDING, output a JSON evaluation block...` + 7 evaluation rules.
- Rules inject động theo state: `card_attempts` hiện tại (rule 4) và `card_type == "final_boss"` (rule 5).
- Chỉ thêm khi `deck_active=True` (gated bởi call site hiện có ở line 484 & 496 — không cần thay đổi).

**`BE/services/turn-agent/nodes/llm_tts_node.py`** *(update)*
- Thêm sentinel `_EVAL_MARKER = "EVAL:"` (line 23).
- `produce()` (line 109–182): refactor để split stream thành 2 destination:
  - `tts_buffer` — text nói (segment + TTS như cũ)
  - `eval_buffer` — mọi thứ từ `EVAL:` trở đi, **không** đẩy vào TTS
  - Xử lý boundary case khi `EVAL:` bị split giữa 2 chunks (vd `"EV"` + `"AL:{..."`): giữ lại `len(marker) - 1 = 4` ký tự cuối làm `holdback` trước khi flush vào TTS.
- Sau `await asyncio.gather(produce(), consume())` (line 195–256):
  - Parse `eval_buffer` qua helper `_parse_eval_block()` (line 281–317) — tolerant với code fence, prose, whitespace.
  - Emit `writer({"type": "eval", "data": parsed_eval, "card_index": card_index})` qua SSE.
  - Tính `card_update` (status, attempts, result, feedback, next_action).
  - `PUT {memory_service_url}/exercise-deck/{session_id}/card` với body là card_update dict.
- Strip `EVAL:` block khỏi `full_response` trước khi return (line 271–276) — tránh leak vào conversation history downstream.
- Log: `[llm_tts] eval parsed session=... card=... passed=... nextAction=... attempts=...` + `[llm_tts] card updated via memory-service ...`.

---

### Memory-Service (Python)

**`BE/services/memory-service/routers/exercise_deck_ops.py`** *(update)*
- `CardUpdateRequest` Pydantic model (line 11–17): thêm field `next_action: str | None = None`.
- Endpoint `PUT /exercise-deck/{session_id}/card` không đổi — đã sẵn sàng nhận field mới qua existing logic `{k: v for k, v in body.model_dump().items() if v is not None}`.
- `ExerciseDeckService.update_current_card` (Phase 1) tự động transition deck từ `not_started` → `in_progress` ngay lần update đầu — reuse nguyên.

---

### Frontend

**`FE/src/types/session.types.ts`** *(update)*
- Thêm interface `DeckEvalEvent`:
  ```typescript
  { type: 'eval'; card_index: number; data: {
      passed: boolean; feedback: string; retryRecommended: boolean;
      nextAction: 'retry' | 'next_card' | 'finish_session';
      detectedIssues: string[];
  }}
  ```
- Thêm `DeckEvalEvent` vào discriminated union `TurnEvent`.

**`FE/src/services/session.service.ts`** *(update)*
- `DeckCard` interface: thêm field optional `next_action?: 'retry' | 'next_card' | 'finish_session' | null`.
- Export thêm `DeckEvalData` interface để consumer downstream dùng.

**`FE/src/hooks/use-chat.ts`** *(update)*
- Trong SSE event loop của `streamTurnText` (sau branch `'segment'`): thêm handler `event.type === 'eval'`.
- Optimistic update: `setCurrentDeck` merge eval vào `cards[card_index]`:
  - `attempts` += 1
  - `status` = `completed` if passed else `in_progress`
  - `result` = `passed` / `partial` (attempts ≥ 3) / `not_passed`
  - `feedback` từ eval
  - `next_action` từ eval
- Guard: chỉ apply nếu `prev.current_card_index === event.card_index` (tránh race với poll/advance).
- 3s deck poll hiện có tiếp tục chạy như safety net — reconcile state từ Redis.

**`FE/src/app/(main)/chat/page.tsx`** *(update)*
- Import thêm `DeckCard` type.
- `DeckCardView`: thêm feedback line hiển thị `card.feedback` với màu theo `result`:
  - `passed` → `text-emerald-600`
  - `partial` → `text-amber-600`
  - `not_passed` → `text-rose-600`
- Tách button logic ra component mới `DeckCardActions(card, onNext)`:
  - Nếu `!card.result` → render nothing (mic là action duy nhất khi user chưa trả lời).
  - Derive visibility:
    - `showRetry` = `next_action === 'retry' && retry_allowed && attempts < 3`
    - `showFinish` = `next_action === 'finish_session' || (type === 'final_boss' && result === 'passed')`
    - `showNext` = `!showFinish && next_action !== 'retry'`
  - Finish button dùng style `bg-emerald-600` để phân biệt với Next.

---

## Event contract

### EVAL block format (LLM output)

LLM được instructed output dạng này ở cuối response khi `deck_active=True`:
```
<spoken response text — natural, ≤ 3 sentences>
EVAL:{"passed":true,"feedback":"Clear and simple, good.","retryRecommended":false,"nextAction":"next_card","detectedIssues":[]}
```

Parser tolerant với: leading whitespace, trailing prose, ```json fence.

### SSE event format (turn-agent → FE)

```json
{
  "type": "eval",
  "card_index": 0,
  "data": {
    "passed": true,
    "feedback": "Clear and simple, good.",
    "retryRecommended": false,
    "nextAction": "next_card",
    "detectedIssues": []
  }
}
```

### Card update PUT (turn-agent → memory-service)

`PUT /exercise-deck/{session_id}/card`
```json
{
  "status": "completed",
  "attempts": 1,
  "result": "passed",
  "feedback": "Clear and simple, good.",
  "next_action": "next_card"
}
```

---

## Logic Pass / Retry / Next / Finish

| Card state | Buttons hiển thị | Ghi chú |
|---|---|---|
| `result = null` (chưa evaluate) | None — chỉ mic | User chưa trả lời |
| `next_action = "retry"` && `attempts < 3` && `retry_allowed` | Retry + mic | User trả lời lại bằng cách hold mic |
| `next_action = "next_card"` | Next → | Advance sang card tiếp |
| `next_action = "finish_session"` | Finish ✓ | Click → advance qua last card → deck auto-complete |
| `type = "final_boss"` && `result = "passed"` | Finish ✓ | Fallback cho final boss đã passed |
| `result = "partial"` (attempts ≥ 3) | Next → | Auto-escalate, không trap user |

Mic button luôn hiện độc lập với deck state.

---

## Test plan (cần verify thủ công)

| # | Test case | Expected | Status |
|---|-----------|----------|--------|
| 1 | EVAL block stripped from TTS | Start session 2, trả lời card 1 rõ ràng. Audio AI không nói "EVAL passed true...". SSE stream có event `{"type":"eval", ...}`. Redis `card[0].result = "passed"`, attempts = 1. | ⏳ |
| 2 | Retry path | Trả lời tệ / sai chủ đề. Eval `passed:false, nextAction:"retry"`. FE hiện Retry button + feedback rosé. Hold mic trả lời lại → attempts = 2, result = "passed", Next hiện. | ⏳ |
| 3 | Max retries auto-advance | Fail card 3 lần. Lần 3 eval phải có `nextAction:"next_card"` (rule 4 ở prompt). `result = "partial"`, Next hiện. | ⏳ |
| 4 | Final boss → Finish | Advance đến card 4 (`final_boss`). Trả lời. Eval `nextAction:"finish_session"`. FE hiện Finish button. Click → `advanceDeckCard` → memory-service auto-marks deck `completed`. | ⏳ |
| 5 | Pure pass-through không break | Session 1 (`onboarding_diagnostic`) chạy bình thường với mini-deck. Turn không có deck (`deck_active=false`) → không inject EVAL instruction, không emit eval event, không PUT card. | ⏳ |
| 6 | Optimistic + poll reconcile | DevTools throttle network "Slow 3G" trên deck-poll. Trả lời card → buttons hiện trong ~500ms (từ SSE), trước khi poll 3s tiếp theo complete. | ⏳ |

### Logs to confirm

Backend logs cần xuất hiện sau mỗi turn có deck:
```
[llm_tts] eval parsed  session=...  card=0  passed=True  nextAction=next_card  attempts=1
[llm_tts] card updated via memory-service  session=...  idx=0
[exercise_deck] saved  session=...  type=personalized_training  status=in_progress  cards=4  idx=0
```

Nếu LLM emit EVAL block nhưng parse fail (sai JSON, missing `passed` key):
```
[llm_tts] EVAL block present but failed to parse  session=...  raw='...'
```
→ Card update bị skip, FE rơi vào safety net (3s poll vẫn lấy được old state) — UI vẫn ổn nhưng không có buttons mới cho turn đó. Cần monitor frequency nếu cao thì tune prompt.

---

## Out of scope (để dành cho Phase tiếp)

- **Phase 6**: end-session consolidation đọc deck state, map `end_reason` → deck status, extended `session_insight.deck_completion`.
- **Phase 7**: Skip button + skip handling, low-energy detection (repeated short answers), code-switch redirect, confusion handling, STT low-confidence re-ask.

Retry button hiện chưa wire action — user retry tự nhiên bằng cách hold mic (mỗi turn re-evaluate cùng card vì `current_card_index` chưa advance). Wiring click Retry để force re-attempt là polish optional, không blocking.
