# MISSION: Evolve SpeakUp into a Structured Exercise Deck Coaching System

## Critical Rules Before You Start

Do NOT rewrite the whole system.
Build ON TOP of existing functionality:
- onboarding conversation flow
- memory / session_insight / st_facts / long-term
- active_mission / today_challenge / mission priority chain
- session start/end/consolidation pipeline
- AI coach personality and coaching notes
- voice STT/TTS pipeline
- onboarding panel / mission card UI

Do NOT break any existing behavior.
Every change must be additive or a targeted replacement.

Core product principle:
Conversation is the outer layer.
Exercise Deck is the backbone.
Memory is the reason why the deck is personalized.

---

## PART 1 — Session Type Rules

Implement clear session type behavior. There are 3 session types.

### Session Type 1: FIRST SESSION AFTER REGISTRATION (onboarding_diagnostic)

Goal:
- Introduce the AI coach
- Confirm user's registered goal
- Let user speak naturally for 2-4 turns
- Observe real speaking behavior (code-switching, filler words, hesitation, confidence)
- Extract motivation, confidence, weakness
- Give only 1-2 mini exercises — NOT a full 4-card deck
- Create the first session_insight via consolidation

First session greeting must say:
"Hi {name}, I'm your AI speaking coach.
I saw your goal is {goal}, right?
Before we train seriously, I'll talk with you for a few minutes to understand how you speak.
Then we'll do one small speaking task."

After 2-4 adaptive turns, generate mini deck:

Card 1:
type: baseline_answer
title: "Say it simply"
task: "Tell me why you want to improve your English in 1-2 sentences."
successCriteria:
- user gives understandable answer
- user speaks in target language
retryAllowed: true

Card 2:
type: mini_challenge
title: "Tiny speaking test"
task: "Describe one simple idea or recent plan in 2 sentences."
successCriteria:
- meaning is clear
- user attempts simple English
- grammar does not need to be perfect
retryAllowed: true

End of session 1: short recap, no heavy correction, consolidation runs.

### Session Type 2: SECOND SESSION (personalized_training)

This is the first real personalized training. Use session_insight from session 1.

Greeting MUST:
- Welcome user back
- Reference ONE specific behavioral observation from session 1 (not generic)
- State today's mission
- Explain there will be 4 small exercises
- Start with the FIRST CARD immediately

GOOD greeting example:
"Hi Duc, welcome back.
Last time, I noticed you had good ideas but sometimes paused when searching for specific words.
Today we'll practice explaining ideas clearly using simple English.
We'll do 4 small exercises. First: describe one web app idea in just 2 sentences."

BAD greeting (do NOT use):
"Last time, I got a good feel for your speaking style."
"What would you like to practice today?"
"Describe your app in as much detail as you can."

Generate full 4-card deck based on session_insight.

### Session Type 3: THIRD SESSION AND LATER (adaptive_training)

Generate adaptive deck based on:
- active_mission / today_challenge (highest priority)
- latest session_insight
- previous deck status and end_reason
- user energy signals

If previous deck completed → generate next related deck, increase difficulty slightly
If previous deck ended_early → offer continue or lighter practice
If previous deck abandoned by idle_timeout → mention gently, do not claim completion
If previous end_reason = low_energy_detected → generate lighter deck, fewer cards, no final boss early

---

## PART 2 — Mission Priority (Fix Single Source of Truth)

Priority order — strictly enforced:

1. active_mission / today_challenge (Redis key: user:{userId}:today_challenge)
2. Resume unfinished deck mission (if user chooses)
3. session_insight.next_challenge
4. Generic speaking confidence fallback

SESSION_INSIGHT.next_challenge is FALLBACK ONLY.
Old memory must NEVER override today's active_mission.

If frontend shows "Today's challenge: Emerald Buddha" → greeting uses Emerald Buddha → turn-agent uses Emerald Buddha → evaluator uses Emerald Buddha.
Never continue an old "delayed flight" challenge unless it IS the active_mission.

Log mission source in every session start:
- "active_mission"
- "resumed_deck"
- "session_insight"
- "fallback"

---

## PART 3 — Exercise Deck Data Model

### Storage

Store deck state in Redis:
Key: session:{sessionId}:exercise_deck
TTL: 72 hours

Use JSON blob. Do NOT create a new Postgres table.

### ExerciseDeck Schema

```json
{
  "id": "string",
  "sessionId": "string",
  "sessionType": "onboarding_diagnostic | personalized_training | adaptive_training",
  "mission": "string",
  "missionSource": "active_mission | resumed_deck | session_insight | fallback",
  "reason": "string (why this mission, from memory)",
  "status": "not_started | in_progress | completed | ended_early | abandoned",
  "currentCardIndex": 0,
  "cards": [],
  "endReason": "completed_deck | user_clicked_end | voice_end_intent | low_energy_detected | idle_timeout | null",
  "createdAt": "ISO string",
  "updatedAt": "ISO string"
}
```

### ExerciseCard Schema

```json
{
  "id": "string",
  "type": "baseline_answer | mini_challenge | simple_explanation | target_user | feature_explanation | final_boss | warm_up | weakness_drill | real_situation",
  "title": "string",
  "task": "string",
  "successCriteria": ["string"],
  "expectedDurationSeconds": 60,
  "retryAllowed": true,
  "status": "not_started | in_progress | completed | skipped | failed",
  "attempts": 0,
  "result": "passed | partial | not_passed | null",
  "feedback": "string | null",
  "uiHint": "string | null"
}
```

### Required Service Methods

Create `ExerciseDeckService` in memory-service:

```python
async def get_deck(session_id: str) -> dict | None
async def save_deck(session_id: str, deck: dict) -> None
async def get_current_card(session_id: str) -> dict | None
async def update_current_card(session_id: str, card_update: dict) -> None
async def move_to_next_card(session_id: str) -> dict | None
async def update_deck_status(session_id: str, status: str) -> None
async def mark_deck_ended(session_id: str, end_reason: str) -> None
```

Expose as endpoints in memory_ops.py:
- GET /exercise-deck/{session_id}
- POST /exercise-deck/{session_id}
- PUT /exercise-deck/{session_id}/card
- PUT /exercise-deck/{session_id}/next
- PUT /exercise-deck/{session_id}/status
- PUT /exercise-deck/{session_id}/end

Proxy through NestJS orchestrator:
- GET /session/{session_id}/deck
- POST /session/{session_id}/deck
- PUT /session/{session_id}/deck/card
- PUT /session/{session_id}/deck/next
- PUT /session/{session_id}/deck/end

Log every deck create/update:
- sessionId, mission, missionSource, deckStatus, currentCardIndex, currentCardType

---

## PART 4 — Deck Generation Rules

Generate deck when session starts, AFTER greeting is complete (not before).

### Deck generation location

Add to `session.service.ts`: `generateDeck(userId, sessionId, sessionType, sessionInsight, activeMission)`

This calls memory-service to create and save the deck.

### Normal Full Deck Structure (Session 2+)

4 cards in order:
1. Warm-up (simple_explanation) — small, achievable, builds momentum
2. Targeted weakness drill (weakness_drill) — targets struggled_with from session_insight
3. Real situation card (real_situation) — applies skill in real context
4. Final boss (final_boss) — 60-second extended response

### Example: Mission = "Explain a web app idea clearly"

Card 1:
type: simple_explanation
title: "Start simple"
task: "Describe one web app idea in 2 sentences."
successCriteria: ["meaning is clear", "uses simple English", "no long pause"]

Card 2:
type: weakness_drill
title: "Who is it for?"
task: "Explain who would use this app and why."
successCriteria: ["mentions target user", "gives one clear reason"]

Card 3:
type: real_situation
title: "Main feature"
task: "Explain one main feature of your app."
successCriteria: ["explains what feature does", "uses simple English"]

Card 4:
type: final_boss
title: "Final boss"
task: "Describe the full app idea for 60 seconds."
successCriteria: ["explains app idea", "mentions target user", "mentions problem solved", "mentions main feature"]

### Important

Use fixed card type templates. The AI fills the content inside the schema.
The AI does NOT generate arbitrary card structures.
The deck planner (not the turn-agent LLM) generates the deck using session_insight.

Deck generation should use a separate LLM call with a structured prompt.
Output must be validated against the ExerciseCard schema before saving.

---

## PART 5 — Voice Room UI

Update the chat page to render Exercise Deck when a deck exists.

### When to show deck UI vs normal UI

```
if deck exists AND deck.status = "in_progress" → show deck UI
if deck not exists OR deck.status = "completed" → show normal voice UI
if session type = onboarding_diagnostic → show lighter UI ("Mini check" not "Exercise 1/4")
```

### Deck UI layout (replaces message bubbles when deck active)

```
Today's Mission
[mission text]

Why this?
[reason from session_insight — short, 1 sentence]

──────────────────────────
Exercise {currentIndex + 1} / {totalCards}

{card.title}

{card.task}

Goal:
• {successCriteria[0]}
• {successCriteria[1]}
──────────────────────────

[AI subtitle / transcript — existing component]

[Hold to speak — existing mic button]

[Retry] [Next] [Skip]   ← show based on card state
```

For onboarding_diagnostic sessions, replace "Exercise X / Y" with "Mini check".

### Button visibility rules

Show Retry button when: evaluator returns retryRecommended = true AND card.attempts < 3
Show Next button when: evaluator returns nextAction = "next_card"
Show Skip button: always visible
Show Finish button when: evaluator returns nextAction = "finish_session"

### Fallback

If no deck exists → render existing voice UI unchanged. Do NOT crash.

---

## PART 6 — Turn-Agent Prompt Behavior

Turn-agent receives ONLY the current card context, not the full deck.

### Inject into system prompt when deck is active

```
CURRENT EXERCISE CARD:
Exercise {index}/{total}
Type: {type}
Title: {title}
Task: {task}
Success criteria:
- {criteria[0]}
- {criteria[1]}
Retry allowed: {retryAllowed}
Attempts so far: {attempts}

CARD INSTRUCTIONS:
1. Stay focused on this card's task.
2. Do not ask unrelated questions.
3. Keep response under 3 sentences.
4. Give short specific feedback after user answers.
5. If user has not answered yet, invite them to answer the card task.
6. If user drifts, acknowledge briefly and redirect to the card.
7. If user asks a side question, answer in one sentence then return to card.
8. Do not jump to a harder task — next card will come after evaluation.
9. Do not create a new mission mid-session.
10. If user expresses they want to stop, acknowledge and switch to CLOSING mode.

BAD: "Describe your app in as much detail as you can."
GOOD: "Let's start small. Describe one web app idea in just 2 sentences."
```

### Headers to pass from orchestrator to turn-agent (add to existing headers)

```
X-Deck-Active: "true" | "false"
X-Card-Index: "0"
X-Card-Total: "4"
X-Card-Type: "simple_explanation"
X-Card-Title: "Start simple"
X-Card-Task: "Describe one web app idea in 2 sentences."
X-Card-Attempts: "0"
X-Card-Retry-Allowed: "true"
```

---

## PART 7 — Evaluation + Retry / Next

After user answers a card, evaluate against successCriteria.

### Evaluator

Do NOT make a separate LLM call for evaluation.
Inject evaluation instruction into the turn-agent system prompt alongside the card context.
The turn-agent both responds to the user AND outputs an evaluation block.

Add to turn-agent system prompt when deck is active:

```
After responding to the user, output a JSON evaluation block on a new line:
EVAL:{"passed":bool,"feedback":"string","retryRecommended":bool,"nextAction":"retry|next_card|finish_session","detectedIssues":["string"]}

Rules for evaluation:
1. Be forgiving — if meaning is clear, grammar imperfect → pass with light feedback.
2. If user did not attempt the task → retry.
3. If user code-switches heavily when card requires English → retry.
4. If attempts >= 3 → nextAction = next_card, result = partial.
5. If card type = final_boss and result is passed or partial → nextAction = finish_session.
6. Do NOT trap user in infinite retry.
```

Parse the EVAL: block in the turn-agent streaming response.
Strip it before sending text to client.
Send card update to memory-service based on eval result.

### Card state update after evaluation

```python
card_update = {
    "status": "completed" if passed else "in_progress",
    "attempts": attempts + 1,
    "result": "passed" if passed else ("partial" if attempts >= 2 else "not_passed"),
    "feedback": feedback,
}
```

---

## PART 8 — End Session + Partial Completion

Session can end by: completed_deck | user_clicked_end | voice_end_intent | low_energy_detected | idle_timeout

### On session end

1. Read deck state from Redis
2. Calculate: completedCards, totalCards, skippedCards, deckStatus
3. Map end reason to deck status:
   - completed_deck → "completed"
   - user_clicked_end / voice_end_intent / low_energy_detected → "ended_early"
   - idle_timeout → "abandoned"
4. Save end_reason in deck
5. Run consolidation with deck progress included

### Closing messages by AI

If completed:
"Nice work, {name}.
Today you completed all {total} exercises. You practiced {practiced_skill}.
Next time, we'll practice {recommended_next}."

If ended_early:
"Ok {name}, we'll stop here.
You still practiced the first part: {completed_skills}.
No need to finish everything today.
Next time, we can continue or keep it lighter."

If idle_timeout:
No AI closing message. Consolidate silently.

### Language

Never use: "failed", "incomplete"
Use: "paused", "continue next time", "still working on"

---

## PART 9 — Edge Cases

Handle in turn-agent behavior:

**User rejects mission:**
- Offer: "We can do free talk or a quick 2-minute practice instead."
- Save user_rejected_mission = true in deck metadata
- Do not force the original mission

**Short answers (2+ times in a row):**
- Reduce pressure
- Offer a sentence frame: "You can say: 'My app helps ___ to ___.' Try that."

**Confusion ("I don't understand" / "What does that mean?"):**
- Explain task simply in 1 sentence
- Give one example
- Restart same card
- Do NOT count as failed attempt

**Code-switching (vocabulary gap):**
- Redirect once: "Try describing it with simpler English — no Vietnamese needed."
- If card requires English-only, retry

**Skip:**
- User says "skip" or clicks Skip button
- Mark card.status = "skipped"
- Move to next card
- Do not mark as failed

**Too many retries (attempts >= 3):**
- Show or say a model answer
- Mark result = "partial"
- Move to next card automatically

**STT low confidence:**
- Ask: "I didn't catch that clearly — could you say it again?"
- Do not evaluate uncertain transcript as failure

**Low energy signals** (repeated "I don't know", "I'm tired", many short answers):
- Offer: "[One more quick task] or [End session]"
- If user chooses end: end_reason = "low_energy_detected"
- Consolidation notes this for lighter next deck

---

## PART 10 — Consolidation Update

Update consolidation.py to include exercise deck context.

### Input to consolidation (add to existing)

Pass deck state as additional context to the LLM extraction prompt:

```python
deck_context = {
    "session_type": deck.get("sessionType"),
    "deck_status": deck.get("status"),
    "end_reason": deck.get("endReason"),
    "completed_cards": len([c for c in deck["cards"] if c["status"] == "completed"]),
    "total_cards": len(deck["cards"]),
    "skipped_cards": len([c for c in deck["cards"] if c["status"] == "skipped"]),
    "card_results": [{"type": c["type"], "result": c.get("result"), "attempts": c["attempts"]} for c in deck["cards"]],
}
```

Add to consolidation LLM prompt:
```
This session may be partially completed. 
Do NOT treat early ending as failure.
Extract useful progress from completed/attempted cards only.
If user ended early due to tiredness, recommend lighter next mission.
If user abandoned via idle timeout, do not assume emotion or motivation.
If user code-switched, identify whether trigger was vocabulary_gap or grammar_uncertainty.
```

### Extended session_insight output (add these fields)

```json
{
  "session_insight": {
    "session_type": "onboarding_diagnostic | personalized_training | adaptive_training",
    "practiced_skill": "string",
    "progress_made": ["string"],
    "struggled_with": "string",
    "improved_vs_before": "string | null",
    "next_challenge": "string",
    "code_switch_pattern": "none | low | medium | high",
    "code_switch_trigger": "vocabulary_gap | grammar_uncertainty | both | unknown",
    "energy_signal": "high | medium | low | unknown",
    "deck_completion": {
      "status": "completed | ended_early | abandoned",
      "completed_cards": 2,
      "total_cards": 4,
      "end_reason": "user_clicked_end"
    },
    "recommended_next_mode": "new_deck | resume_deck | lighter_deck | quick_practice",
    "recommended_next_mission": "string"
  }
}
```

---

## Implementation Order for Claude Code

### Phase 1 — Data Model + Storage (no UI, no prompt changes)

1. Create `ExerciseDeckService` in `BE/services/memory-service/`
2. Add Redis storage methods (get/save/update/end deck)
3. Expose endpoints in `memory_ops.py`
4. Proxy endpoints through NestJS orchestrator `session.controller.ts`
5. Add `X-Deck-*` headers to turn controller

Verify: call POST /session/{id}/deck manually, check Redis, check logs.

---

### Phase 2 — Deck Generation

1. Add `generateDeck()` in `session.service.ts`
2. Call after greeting completes, based on session type
3. Session 1 → mini deck (2 cards)
4. Session 2 → full personalized deck from session_insight
5. Session 3+ → adaptive deck based on mission + previous deck

Verify: complete a real session 1, check deck created in Redis with correct cards.

---

### Phase 3 — Voice Room UI

1. Fetch deck state on session start in `use-chat.ts`
2. Pass `currentDeck` state through hook
3. Render deck UI in `chat/page.tsx` when deck active
4. Show mission, reason, card title, task, criteria, mic button
5. Show Retry/Next/Skip buttons based on card state
6. Fallback to existing UI when no deck

Verify: open app, see deck UI render with correct card content.

---

### Phase 4 — Turn-Agent Card Injection

1. Read current card in turn controller before forwarding to turn-agent
2. Add X-Deck-* headers
3. Inject card context into system prompt in `build_prompt_node.py`
4. Replace generic challenge with card-focused instruction

Verify: check turn-agent logs, confirm card task appears in system prompt, AI stays on card task.

---

### Phase 5 — Evaluator + Retry/Next

1. Add EVAL: block instruction to turn-agent system prompt (deck active only)
2. Parse EVAL: from streaming response in turn-agent
3. Strip EVAL: before sending to client
4. Call update_current_card after each turn with eval result
5. FE reads updated card state, shows Retry/Next buttons
6. FE calls move_to_next_card when user clicks Next

Verify: answer a card, check Retry/Next appears, click Next, check card index increments.

---

### Phase 6 — End Session + Partial Completion

1. Update `endSession()` in `session.service.ts` to read deck before consolidation
2. Map end reason to deck status
3. Pass deck_context to consolidation
4. Update consolidation.py with deck context and extended session_insight fields
5. Update AI closing message based on deck completion

Verify: end session mid-deck, check deck status = ended_early, check consolidation output has deck_completion field.

---

### Phase 7 — Edge Cases

1. Add low energy detection in turn-agent (repeated short answers)
2. Add skip handling
3. Add max retry logic (attempts >= 3 → partial → move on)
4. Add confusion detection (do not count as failed attempt)
5. Add code-switch detection and redirect in turn-agent coaching notes

Verify each case manually with a voice session.

---

## What NOT to Change

- Do not change STT/TTS pipeline
- Do not change pgvector retrieval or long-term memory
- Do not change billing service
- Do not add Postgres tables — use Redis for deck state
- Do not change the register form
- Do not add progress dashboards, XP, scores
- Do not build resume/dashboard UI yet (Phase 7+ scope)

---

## Required Test Cases

After each phase, verify these before proceeding:

**TEST 1 — Session 1 (onboarding)**
- AI introduces itself, confirms goal
- asks 2-4 natural questions
- only 1-2 mini cards generated
- no full 4-card deck
- consolidation creates first session_insight with session_type = onboarding_diagnostic

**TEST 2 — Session 2 (personalized)**
- greeting references specific behavioral observation from session 1
- 4-card deck created
- first card is small/warm-up
- no giant open-ended challenge

**TEST 3 — Mission priority**
- Set today_challenge = "Emerald Buddha"
- Old session_insight = "delayed flight"
- Verify greeting uses Emerald Buddha
- Verify turn-agent does not mention delayed flight
- Check log: missionSource = "active_mission"

**TEST 4 — End early**
- Complete 1 of 4 cards, click End
- Check deck_status = ended_early
- Check completedCards = 1
- Check next session does not claim user completed all 4

**TEST 5 — Low energy**
- Give 3 short answers in a row
- AI should offer One more quick task or End session
- If End: check end_reason = low_energy_detected in deck

**TEST 6 — Code-switching**
- Switch to Vietnamese mid-card
- AI redirects once: describe with simple English
- Check consolidation output has code_switch_trigger = vocabulary_gap

**TEST 7 — Too many retries**
- Fail same card 3 times
- System moves on automatically
- Card.result = partial
- No more retry prompts
