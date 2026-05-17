# Phase 7 — Edge Cases

## Mục tiêu
Handle các edge case quan trọng trong deck flow: user skip card, user bối rối (confusion), user code-switch, low-energy detection (3+ short answers hoặc 2+ fatigue cues → AI offer choice "one more or end"). Max-retry và code-switch trong EVAL đã được xử lý từ Phase 5; phase này thêm Skip button (end-to-end) + nâng cấp prompt với edge-case rules + heuristic low-energy detection ở build_prompt_node.

---

## Files đã sửa

### Memory-Service (Python)

**`BE/services/memory-service/routers/exercise_deck_ops.py`** *(update)*
- Endpoint mới `PUT /exercise-deck/{session_id}/skip`:
  - Gọi `update_current_card({"status": "skipped"})` để stamp current card
  - Sau đó `move_to_next_card()` để advance
  - `result` của card vẫn `null` — consolidation sẽ không treat skipped card như attempted

---

### Orchestrator (NestJS)

**`BE/apps/orchestrator/src/session/session.service.ts`** *(update)*
- Proxy method mới `skipDeckCard(sessionId)` → memory-service `PUT /exercise-deck/{sessionId}/skip`

**`BE/apps/orchestrator/src/session/session.controller.ts`** *(update)*
- Route mới `PUT /session/:id/deck/skip` → `sessionService.skipDeckCard(sessionId)`

---

### Turn-Agent (Python)

**`BE/services/turn-agent/nodes/build_prompt_node.py`** *(update)*

Helper mới `_detect_low_energy(state)`:
- Đọc `state.get("recent_messages")`
- Filter user messages, lấy last 3
- Đếm short answers (≤ 15 chars) và fatigue cues (`"i don't know"`, `"idk"`, `"i'm tired"`, `"i give up"`, `"no idea"`, `"skip"`, `"i can't"`, ...)
- Trigger low-energy khi: **3 short answers in a row OR 2+ fatigue cues trong 3 turns gần nhất**
- Conservative — chỉ trigger khi pattern rõ ràng, tránh false positive làm AI coddle user bình thường

`_build_card_context_block(state)` — append section EDGE CASES:
- **A. CONFUSION**: user nói "I don't understand" / "what does that mean" → AI explain 1 sentence + 1 example, re-state task. EVAL: `passed=false`, `nextAction="retry"`, `detectedIssues=["confusion"]` → llm_tts_node KHÔNG increment attempts
- **B. CODE-SWITCH**: user dùng tiếng Việt khi card requires English → redirect ONCE, EVAL: `passed=false`, `nextAction="retry"`, `detectedIssues=["code_switch", "vocabulary_gap"|"grammar_uncertainty"]`
- **C. SHORT ANSWER (2+ in a row)**: AI offer sentence frame "You can say: 'My app helps ___ to ___.'"
- **D. SKIP voice intent**: user nói "skip"/"next"/"pass" → acknowledge + EVAL: `nextAction="next_card"`, `detectedIssues=["user_skip"]`

Khi `low_energy=True`, inject thêm block LOW ENERGY DETECTED:
- AI offer choice 1 câu: "Want to do one more quick task, or end here?"
- Nếu user pick end → switch to CLOSING mode + EVAL: `detectedIssues=["low_energy"]`, `passed=true`, `nextAction="finish_session"`
- `passed=true` để session không end on a failure note

---

**`BE/services/turn-agent/nodes/llm_tts_node.py`** *(update)*

Trong block Phase 5 eval handling, thêm logic xử lý confusion-retry:
```python
detected = parsed_eval.get("detectedIssues") or []
detected_lower = [str(d).lower() for d in detected]
is_confusion_retry = (
    not passed and "confusion" in detected_lower
)
attempts = prior_attempts if is_confusion_retry else prior_attempts + 1
```

→ Khi `detectedIssues` chứa "confusion", attempts KHÔNG tăng. User hỏi clarification không bị tính là failed attempt → không bị burn 1/3 attempts → không bị auto-advance sớm.

---

### Frontend

**`FE/src/services/session.service.ts`** *(update)*
- Method mới `skipDeckCard(sessionId)` → `PUT /session/${sessionId}/deck/skip`

**`FE/src/hooks/use-chat.ts`** *(update)*
- Callback mới `skipDeckCard`:
  ```typescript
  const skipDeckCard = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    try {
      await sessionService.skipDeckCard(sessionId);
      const deck = await sessionService.getDeck(sessionId);
      setCurrentDeck(deck);
    } catch (err) { console.error('[skipDeckCard]', err); }
  }, []);
  ```
- Thêm `skipDeckCard: () => Promise<void>` vào `UseChatReturn` interface
- Export trong return object

**`FE/src/app/(main)/chat/page.tsx`** *(update)*
- Destructure thêm `skipDeckCard` từ `useChat()`
- Pass vào `DeckCardView` qua prop `onSkip`
- `DeckCardView` signature: thêm `onSkip: () => void`, forward xuống `DeckCardActions`
- `DeckCardActions` — Skip button **luôn hiện** (per spec PART 5: "Show Skip button: always visible"):
  - Style: ghost button `text-gray-400 hover:text-gray-600` (subtle, không cạnh tranh với Next/Finish)
  - Đặt ở leftmost của action group
  - Bấm Skip → memory-service stamp `status="skipped"` + advance → poll re-fetch → card mới hiện

---

## Logic Skip vs Retry vs Next vs Finish (post-Phase 7)

| Card state | Buttons hiển thị |
|---|---|
| `result = null` (chưa eval) | **Skip** (always) + mic |
| `next_action = "retry"` && `attempts < 3` && `retry_allowed` | Skip + Retry + mic |
| `next_action = "next_card"` | Skip + Next → |
| `next_action = "finish_session"` OR (final_boss && passed) | Skip + Finish ✓ |
| `result = "partial"` (attempts ≥ 3) | Skip + Next → |

Mic button luôn độc lập với deck state.

---

## Edge case detection table

| Trigger | Source | Action | Impact on attempts |
|---|---|---|---|
| User says "I don't understand" | EVAL `detectedIssues=["confusion"]` | AI explain + re-state task | **Not incremented** |
| User uses Vietnamese on English card | EVAL `detectedIssues=["code_switch", ...]` | AI redirect once | Incremented (retry) |
| 2+ short answers in a row | Prompt rule C | AI offers sentence frame | Incremented (retry) |
| User says "skip" / "next" | EVAL `detectedIssues=["user_skip"]` | AI acknowledges, advance | N/A (advance) |
| Clicks Skip button | FE → `skipDeckCard` endpoint | Stamp `status=skipped`, advance | N/A (not attempted) |
| 3 short answers OR 2+ fatigue cues | `_detect_low_energy(state)` heuristic in build_prompt_node | LOW ENERGY block injected, AI offers end | N/A until user picks |
| User picks "end" after low-energy offer | EVAL `passed=true, nextAction="finish_session", detectedIssues=["low_energy"]` | Session ends with `end_reason=low_energy_detected` mapped via voice_intent | N/A |

---

## Test plan (cần verify thủ công)

| # | Test case | Expected | Status |
|---|-----------|----------|--------|
| 1 | Bấm Skip button khi chưa trả lời | Card status → `skipped`, `current_card_index` tăng, card 2 hiển thị. `attempts` của card 1 vẫn 0. | ⏳ |
| 2 | Bấm Skip giữa chừng (sau 1 attempt) | Card status → `skipped`. `result` vẫn `null` (không bị tính là attempted). | ⏳ |
| 3 | User nói "I don't understand" | AI giải thích 1 câu + example. Card `attempts` KHÔNG tăng. EVAL có `detectedIssues=["confusion"]`. | ⏳ |
| 4 | User code-switch sang tiếng Việt | AI redirect once: "Try simpler English". EVAL có `detectedIssues=["code_switch", ...]`. `attempts` tăng. | ⏳ |
| 5 | Trả lời 3 câu ngắn (≤15 chars) liên tiếp | Log: prompt có block "LOW ENERGY DETECTED". AI hỏi "Want to do one more quick task, or end here?" | ⏳ |
| 6 | Nói "I'm tired" / "idk" / "I give up" 2+ lần | Low-energy trigger. AI offer end. | ⏳ |
| 7 | User nói "end" sau low-energy offer | Voice intent end → consolidation sees `end_reason=low_energy_detected` (via Phase 6 mapping) → next session insight `recommended_next_mode=lighter_deck` | ⏳ |
| 8 | User nói "skip" voice (không bấm button) | AI acknowledge "Sure, let's move on" + EVAL `nextAction=next_card`. Card advance. | ⏳ |

### Logs to confirm

```powershell
docker compose logs -f speaking_turn_agent | Select-String "LOW ENERGY|confusion|code_switch|user_skip"
```

Expected:
- `[llm_tts] eval parsed  session=...  card=0  passed=False  nextAction=retry  attempts=0` (attempts unchanged on confusion!)
- Prompt log (verbose): `EDGE CASES: ... LOW ENERGY DETECTED` block hiện khi heuristic trigger

---

## Out of scope (intentionally not implemented)

- **STT low confidence**: spec mention "Ask: 'I didn't catch that clearly — could you say it again?'" nhưng cần STT trả về confidence score. Hiện tại STT pipeline không expose confidence ra ngoài. Để dành phase sau khi tích hợp deeper với STT.
- **Skip button khi deck completed**: hiện tại Skip luôn hiện cả khi card cuối đã passed. Có thể tinh chỉnh hide trong final_boss completed state nhưng không blocking.
- **Retry button action**: vẫn placeholder (no-op). User retry tự nhiên bằng cách hold mic — mỗi turn re-evaluate cùng card vì `current_card_index` chưa advance. Wiring explicit retry click → force re-attempt là polish optional.
