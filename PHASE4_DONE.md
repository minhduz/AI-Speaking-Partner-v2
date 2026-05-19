# Phase 4 — Turn-Agent Card Injection

## Mục tiêu

Khi deck đang active, inject card context vào system prompt của turn-agent. Thay thế generic SESSION_MODE (WARM_UP / CHALLENGE / REFLECTION) bằng card-focused instructions để AI stay on task.

---

## Files đã sửa

### Turn-Agent (Python)

**`BE/services/turn-agent/agent.py`** _(update)_

Thêm 8 fields vào `TurnState` TypedDict:

```python
deck_active: bool
card_index: int
card_total: int
card_type: str
card_title: str
card_task: str
card_attempts: int
card_retry_allowed: bool
```

---

**`BE/services/turn-agent/main.py`** _(update)_

Cả 2 endpoints (`/turn/stream` và `/turn/stream-text`) đều đọc thêm X-Deck-\* headers và map vào `initial_state`:

```python
"deck_active":        h.get("x-deck-active", "false").lower() == "true",
"card_index":         int(h.get("x-card-index", "0")),
"card_total":         int(h.get("x-card-total", "0")),
"card_type":          h.get("x-card-type", ""),
"card_title":         _decode_header(h.get("x-card-title")),
"card_task":          _decode_header(h.get("x-card-task")),
"card_attempts":      int(h.get("x-card-attempts", "0")),
"card_retry_allowed": h.get("x-card-retry-allowed", "false").lower() == "true",
```

Headers đã được orchestrator gửi từ Phase 2 (`turn.controller.ts`), nay turn-agent mới đọc.

---

**`BE/services/turn-agent/nodes/build_prompt_node.py`** _(update)_

Helper function mới `_build_card_context_block(state)`:

- Tạo block `CURRENT EXERCISE CARD` theo đúng spec Part 6
- Gồm: Exercise index/total, Type, Title, Task, Retry allowed, Attempts
- Kèm 9 CARD INSTRUCTIONS cho AI: stay on task, under 3 sentences, give feedback, redirect if drift, không tạo mission mới,...

Logic inject trong `build_prompt_node`:

| Trường hợp                           | Behavior                                                 |
| ------------------------------------ | -------------------------------------------------------- |
| Non-onboarding + `deck_active=True`  | Inject card context **thay thế** SESSION_MODE            |
| Non-onboarding + `deck_active=False` | Giữ SESSION_MODE + active_mission như cũ                 |
| Onboarding + `deck_active=True`      | Inject card context **sau** onboarding block (mini-deck) |
| Onboarding + `deck_active=False`     | Chỉ onboarding block, không inject card                  |

Fallback path (khi memory-service fail) cũng xử lý đúng theo logic trên.

Log khi deck active:

```
── build_prompt ✓  chunks_used=0  estimated_tokens=0  DECK card=1/4  type=simple_explanation
```

---

## Test kết quả

| Turn   | Log                                                        | Kết quả     |
| ------ | ---------------------------------------------------------- | ----------- |
| Turn 1 | `ONBOARDING phase=DISCOVERY  deck_active=True`             |             |
| Turn 2 | `ONBOARDING phase=DISCOVERY  deck_active=True`             |             |
| Turn 3 | `ONBOARDING phase=DISCOVERY  deck_active=True`             |             |
| Turn 4 | `deck_active=False` (deck completed sau khi user bấm Next) | bình thường |

Card context được inject đúng khi `deck_active=True`. AI nhận card task trong system prompt và stay focused thay vì nói chuyện general.
