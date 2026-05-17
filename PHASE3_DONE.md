# Phase 3 — Voice Room UI

## Mục tiêu
Hiển thị Deck UI trong Voice Room khi deck đang active. Thay thế message bubbles bằng card exercise UI. User có thể bấm Next để chuyển card.

---

## Files đã sửa

### Frontend

**`FE/src/services/session.service.ts`** *(update)*

Types mới:
- `DeckCard` — full schema của 1 card (id, type, title, task, success_criteria, retry_allowed, attempts, status, result, feedback, ui_hint)
- `ExerciseDeck` — full deck schema (id, session_id, session_type, mission, mission_source, reason, status, current_card_index, cards[], end_reason)

Methods mới trong `sessionService`:
- `getDeck(sessionId)` → `GET /session/:id/deck` — fetch current deck state, trả về `null` nếu status là `none`
- `advanceDeckCard(sessionId)` → `PUT /session/:id/deck/next` — advance sang card tiếp theo

---

**`FE/src/hooks/use-chat.ts`** *(update)*

State mới:
- `currentDeck: ExerciseDeck | null` — deck state hiện tại của session

Effect mới:
- Poll `getDeck(sessionId)` mỗi **3 giây** khi `currentSessionId` tồn tại
- Tự động clear deck (`setCurrentDeck(null)`) trong cleanup khi session kết thúc

Callback mới:
- `advanceDeckCard()` — gọi `sessionService.advanceDeckCard`, sau đó re-fetch deck ngay lập tức để UI cập nhật ngay

`UseChatReturn` interface:
```typescript
currentDeck: ExerciseDeck | null;
advanceDeckCard: () => Promise<void>;
```

---

**`FE/src/app/(main)/chat/page.tsx`** *(update)*

Computed:
```typescript
const deckVisible =
  currentDeck !== null &&
  (currentDeck.status === 'not_started' || currentDeck.status === 'in_progress') &&
  currentDeck.cards.length > 0;
```

Conditional rendering trong focused-session layout:
- `deckVisible = true` → hiện `<DeckCardView>` thay thế scrollable message bubbles
- `deckVisible = false` → hiện message bubbles như cũ (greeting, messages, error banner)

Component mới `DeckCardView`:
- **Mission block** (bg violet-50): label "MISSION", mission text, reason text (nếu có)
- **Card label**:
  - Session type `onboarding_diagnostic` → `"Mini check 1 / 2"`
  - Các session khác → `"Exercise 1 / 4"`
  - Hiện thêm `"· Attempt 2"` nếu `card.attempts > 0`
- **Card content**: title (text-2xl font-semibold), task (text-base text-gray-600)
- **Success criteria**: list với ✓ màu violet, mỗi criterion 1 dòng
- **Action buttons**:
  - Button **Retry** — chỉ hiện nếu `card.retry_allowed = true`
  - Button **Next →** — gọi `advanceDeckCard()`, deck advance sang card tiếp

---

## Logic hiển thị

| Deck status | Hiển thị |
|-------------|----------|
| `null` / `none` | Message bubbles (bình thường) |
| `not_started` | DeckCardView (deck mới generate, chưa bắt đầu) |
| `in_progress` | DeckCardView |
| `completed` | Message bubbles (bình thường) |
| `ended_early` / `abandoned` | Message bubbles (bình thường) |

Mic button luôn hiện ở dưới cùng dù đang ở mode nào.

---

## Test kết quả

| Case | Kết quả |
|------|---------|
| Session start → poll deck sau 3s → DeckCardView hiện | ✅ |
| Session 1 → label "Mini check 1 / 2" | ✅ |
| Session 2+ → label "Exercise 1 / 4" | ✅ |
| Bấm Next → deck advance → card mới hiện | ✅ |
| Deck completed → fallback message bubbles | ✅ |
| Session end → deck state cleared | ✅ |
