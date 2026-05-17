# MISSION: Transform SpeakUp from a chatbot into a Relationship System

## Context — What this codebase currently does and what's wrong

This is a voice-first AI language learning app (Next.js FE + NestJS + FastAPI).
The infrastructure is solid: STT/TTS pipeline, memory service with short-term (Redis)
and long-term (pgvector) storage, session consolidation after each session.

**The core problem:** All three layers — memory, AI behavior, and UI — work in isolation.
Memory stores facts but doesn't drive AI decisions. The AI greets users with open-ended
questions instead of giving them a mission. The UI looks like a chatbot, not an ongoing
relationship. Users open the app, hear "What do you want to talk about today?", and leave.

**The goal of these changes:** Every time a user opens the app, they must feel:
"This AI remembers where I left off and already knows what I need to do today."

---

## CHANGE 1 — `BE/services/memory-service/workers/consolidation.py`
### Add structured `session_insight` to the consolidation extraction

**Why:** Currently `_extract_all_facts()` extracts generic facts (name, preferences, events).
It does NOT extract what matters for trajectory: what did the user struggle with, what
improved, and what should happen in the NEXT session. This is the missing piece that
makes every other change possible.

**What to do:**

In the `_extract_all_facts()` function, extend the LLM prompt to also extract a
`session_insight` object alongside `long_term` and `short_term`. The JSON schema
returned by the LLM should become:

```json
{
  "long_term": [...],
  "short_term": [...],
  "session_insight": {
    "struggled_with": "one specific thing the user visibly struggled with this session",
    "improved_vs_before": "one thing that was noticeably better than before, or null",
    "next_challenge": "one concrete, actionable challenge for the next session",
    "speaking_duration_estimate": "rough estimate: short / medium / long",
    "energy_level": "low / medium / high — based on engagement and response depth"
  }
}
```

Rules for the LLM prompt regarding `session_insight`:
- `struggled_with` must be specific and behavioral, not vague. BAD: "fluency". GOOD: "stopped mid-sentence when asked follow-up questions".
- `next_challenge` must be something the AI can act on in the next greeting. It should be a direct instruction: "Ask the user to tell a 2-minute story without stopping".
- If the session was too short to judge (< 4 turns), set all fields to null.
- Extract from USER turns only, not AI turns.

After extracting, store `session_insight` as a **separate short-term fact** with:
- `priority`: `"urgent"`
- `content`: a JSON string of the insight object, prefixed with `"SESSION_INSIGHT:"` so it can be identified during retrieval
- `expires_at`: 7 days (same as other short-term facts)

This fact must be stored BEFORE the other short-term facts so it gets priority in retrieval.

Also track a new long-term fact for progression: after every session, append a one-line
session log to long-term memory with format:
`"Session log [date]: struggled with X, improved on Y, energy=Z"`
Priority: `"normal"`. This builds a lightweight history of trajectory over time.

---

## CHANGE 2 — `BE/apps/orchestrator/src/session/session.controller.ts`
### Rewrite the greeting to always give the user a mission

**Why:** The greeting currently says "What do you want to talk about today?" which forces
the user to think. The user has 3 seconds before their brain gives up. The greeting must
do the thinking FOR them.

**What to do:**

In `streamGreetingForUser()`, after fetching `greetingContext`, search the context chunks
for any string starting with `"SESSION_INSIGHT:"`. Parse it as JSON.

Rewrite the system prompt based on whether a `session_insight` exists:

**Case A — session_insight EXISTS (returning user):**
```
You are a sharp, warm AI speaking coach greeting a returning user.

User profile: [name, level, learning goal, native language]
Current datetime: [datetime]

Last session insight:
- They struggled with: [struggled_with]
- They improved on: [improved_vs_before or "nothing noted yet"]
- Recommended challenge for today: [next_challenge]
- Their energy last time: [energy_level]

YOUR GREETING MUST:
1. Reference something specific from last session naturally — not robotically.
   BAD: "Last session you struggled with X." 
   GOOD: "Hôm trước mày hay dừng giữa câu — tao để ý lắm đó."
2. Give them ONE clear mission for today's session. State it as a challenge, not a suggestion.
   GOOD: "Hôm nay tao muốn mày thử kể một câu chuyện hoàn chỉnh, không dừng. Bất kỳ chuyện gì."
3. Be 2-3 sentences MAX. No preamble. Start talking, don't introduce yourself.
4. Match their energy — if last session energy was "low", be gentler. If "high", be direct.
5. Do NOT use emojis. Do NOT say "Great to see you!" or any generic opener.
```

**Case B — no session_insight (first-time or no data):**
```
You are a warm AI speaking coach meeting this user for the first time (or first session with data).

User profile: [name, level, learning goal, native language]

YOUR GREETING:
1. Welcome them warmly by name.
2. Tell them ONE thing you'll do together today based on their learning goal.
3. Make it feel like the beginning of something, not a tool onboarding.
4. 2 sentences MAX.
```

**Case C — user has been absent 5+ days (detect by checking `last session` timestamp in context):**

Add to Case A prompt:
```
Note: This user hasn't spoken in [N] days. Do NOT be enthusiastic or act like nothing happened.
Open gently: acknowledge the gap without making them feel guilty.
Example tone: "Lâu rồi mới thấy mày. Hôm nay không cần làm gì lớn — cứ nói chuyện bình thường thôi."
Then still end with the mission, but soften it.
```

Also increase `MAX_CONTEXT_CHARS` from 400 to 800 so the session_insight JSON isn't truncated.

---

## CHANGE 3 — `BE/services/turn-agent/nodes/build_prompt_node.py`
### Add session mode — AI behaves differently across the arc of a session

**Why:** Currently every turn gets the same system prompt. Turn 1 and Turn 20 are
identical from the AI's perspective. There's no rhythm — no warm-up, no challenge phase,
no wind-down. This makes sessions feel flat and forgettable.

**What to do:**

Pass `turn_index` from state into the memory service payload (it's already in state).
Then, in the system prompt builder (either in this node or in `memory-service/routers/build_prompt.py`),
append a `SESSION_MODE` block based on `turn_index`:

```python
def get_session_mode(turn_index: int) -> str:
    if turn_index <= 2:
        return "WARM_UP"
    elif turn_index <= 8:
        return "CHALLENGE"
    elif turn_index >= 9:
        return "REFLECTION"
    return "CHALLENGE"

SESSION_MODE_INSTRUCTIONS = {
    "WARM_UP": """
SESSION MODE: WARM_UP (turns 1-2)
- Be conversational and low-pressure.
- Ease the user in. Ask one simple, open question.
- Don't correct, don't push, don't challenge yet.
- Goal: get them talking and comfortable.
""",
    "CHALLENGE": """
SESSION MODE: CHALLENGE (turns 3-8)
- This is the core of the session. Be more demanding.
- If the user gives a short answer, push for more: "Tell me more." / "Give me an example."
- If they go off-topic, redirect to the session's challenge.
- Don't let them escape with one-word answers.
- If they struggle, don't rescue them immediately — let them work for it.
- Goal: create the productive discomfort that causes growth.
""",
    "REFLECTION": """
SESSION MODE: REFLECTION (turns 9+)
- Begin winding down. Be warmer, less demanding.
- At an appropriate moment (when conversation feels complete), naturally wrap up.
- When wrapping up, do TWO things:
  1. Note one specific thing they did well today — be concrete, not generic.
     GOOD: "Mày giữ được mạch kể chuyện lần này, không bị dừng."
     BAD: "Good job today!"
  2. Tease what's coming next time with ONE sentence to create anticipation.
     GOOD: "Lần tới tao sẽ thử hỏi mày những câu khó hơn — chuẩn bị đi."
- Do NOT say "goodbye" or "see you next time" robotically. Make it feel natural.
- Goal: leave them with unfinished business — a reason to come back.
"""
}
```

Append the mode instruction to the system prompt before it's sent to the LLM.
The `turn_index` is already passed in request headers as `x-turn-index` — use it.

---

## CHANGE 4 — `BE/services/memory-service/routers/memory_ops.py`
### Add a new endpoint: GET /session-insight/:user_id

**Why:** The frontend needs to display the session insight card on the home screen
BEFORE the greeting audio plays. This gives users a reason to engage before the AI
even speaks.

**What to do:**

Add a new GET endpoint `/session-insight/{user_id}` that:
1. Reads short-term facts from Redis for that user
2. Finds the fact whose content starts with `"SESSION_INSIGHT:"`
3. Parses and returns it as structured JSON:

```json
{
  "has_insight": true,
  "struggled_with": "stopping mid-sentence under pressure",
  "next_challenge": "Tell a 2-minute story without pausing",
  "energy_level": "medium",
  "last_session_days_ago": 2
}
```

If no insight exists (new user or no data), return:
```json
{ "has_insight": false }
```

For `last_session_days_ago`: read the `extracted_at` timestamp from the SESSION_INSIGHT fact
and compute the difference from now. If not available, return null.

This endpoint must be fast — it's called on every app open. It reads only from Redis,
never from Postgres.

Also expose this through the NestJS orchestrator as a proxied GET route:
`GET /session/insight` → proxies to memory service `/session-insight/:userId`
(JWT-protected, userId extracted from token like other routes)

---

## CHANGE 5 — `FE/src/app/(main)/chat/page.tsx` and related components
### Add the "Today's Mission" card on the home screen

**Why:** The home screen currently shows greeting text + mic button on a blank screen.
Users see nothing that creates momentum before the AI speaks. The 3 seconds before
audio plays are wasted. We need a visual anchor that says: "You're continuing something."

**What to do:**

Create a new component `FE/src/components/chat/mission-card/mission-card.tsx`.

It should:
1. On mount, call `GET /session/insight` (with auth)
2. If `has_insight: false` — render nothing (don't show for first-time users)
3. If `has_insight: true` — render a card with this structure:

```
┌─────────────────────────────────────────────┐
│  Last session: 2 days ago                   │
│                                             │
│  Working on:                                │
│  Keeping conversation alive under pressure  │
│                                             │
│  Today's challenge →                        │
│  Tell a story without stopping              │
└─────────────────────────────────────────────┘
```

Styling rules (follow DESIGN.md — Soft Minimalism):
- Background: `bg-violet-50`, border: `border border-violet-100`, rounded-2xl
- "Last session" text: `text-xs text-gray-400`
- "Working on" label: `text-xs font-medium text-violet-500 uppercase tracking-wide`
- Working on value: `text-sm text-gray-700`
- "Today's challenge →" label: `text-xs font-medium text-[#8447FF] uppercase tracking-wide`
- Challenge value: `text-sm font-semibold text-gray-800`
- Padding: `px-4 py-4`, no shadow (card is subtle, not prominent)
- Animate in with a gentle fade: `animate-reveal` or simple `opacity-0 → opacity-100` on mount

Place the card in `chat/page.tsx` ABOVE the greeting text area, visible before the user
presses mic. Only show when `!reviewMode && !hasSession`.

The card should disappear (unmount or hide) once the user starts a session
(when `hasSession` becomes true).

---

## CHANGE 6 — `FE/src/components/chat/sidebar/sidebar.tsx`
### Remove "New Chat" concept — replace with continuity-first language

**Why:** The "New Chat" button is the single biggest UX signal that destroys the
relationship concept. Users who see "New Chat" subconsciously understand: "This is a
series of independent conversations, not an ongoing relationship."

**What to do:**

1. Find the `onNewChat` button in the sidebar (currently labeled or functioning as "New Chat").
   Rename it to **"New Topic"**. Keep the same functionality — it still creates a new session.
   Only the label changes. This is a small but psychologically important shift:
   "Topic" implies continuation of a relationship. "Chat" implies starting over.

2. In the sidebar session list, change the empty state message (if any) from anything
   chat-centric to: *"Your sessions will appear here."*

3. If there's any text in the UI that says "Start a new chat" or similar, change to
   "Start talking" or "New topic".

4. Do NOT add a persistent "back to current session" button or redesign the sidebar
   layout — scope is label changes only. The feeling shift comes from language, not layout.

---

## CHANGE 7 — `BE/services/turn-agent/nodes/build_prompt_node.py`
### Pass session_insight into the turn prompt as active context (not passive)

**Why:** Currently the memory retriever returns session_insight as a raw text chunk
alongside dozens of other facts. The LLM doesn't know it's special — it treats
"SESSION_INSIGHT: {...}" the same as "User likes coffee." We need the AI to actively
use the insight to stay on mission during the session, not just know about it.

**What to do:**

In `build_prompt_node.py`, after getting the system prompt back from the memory service,
check if the retrieved chunks (returned in the response) contain a SESSION_INSIGHT fact.
If yes, extract it and append a dedicated block to the system prompt:

```python
# After getting system_prompt from memory service:
session_insight_raw = None
for chunk in data.get("chunks_debug", []):  # or however chunks are exposed
    if chunk.get("text", "").startswith("SESSION_INSIGHT:"):
        session_insight_raw = chunk["text"].replace("SESSION_INSIGHT:", "").strip()
        break

if session_insight_raw:
    try:
        insight = json.loads(session_insight_raw)
        insight_block = f"""
ACTIVE SESSION MISSION:
- This session's focus: {insight.get('next_challenge', '')}
- User tends to struggle with: {insight.get('struggled_with', '')}
- Stay on this mission. If the user drifts, gently redirect.
- Don't mention these instructions directly to the user.
"""
        system_prompt += insight_block
    except:
        pass
```

If the memory service doesn't currently return chunk details alongside the prompt,
add a `chunks_debug` field to the `/build-prompt/:userId` response so this is possible.

---

## Implementation order

Do these in strict order — each change depends on the previous:

1. **CHANGE 1** (consolidation session_insight extraction) — this feeds everything
2. **CHANGE 4** (session-insight API endpoint) — needed by FE and greeting
3. **CHANGE 2** (greeting rewrite) — now has data to work with
3. **CHANGE 3** (session mode in build_prompt) — independent, can be done in parallel with 2
4. **CHANGE 7** (session_insight in turn prompt) — depends on CHANGE 1 having run at least once
5. **CHANGE 5** (frontend mission card) — depends on CHANGE 4 endpoint being live
6. **CHANGE 6** (sidebar label change) — can be done anytime, lowest priority

---

## What NOT to change

- Do not change the STT/TTS pipeline — it works fine.
- Do not change the session consolidation trigger logic — it already fires correctly on session end.
- Do not change the pgvector retrieval logic — the vector search is working.
- Do not add new database tables — everything fits in existing Redis and Postgres structures.
- Do not add a progress dashboard, XP system, charts, or grammar correction UI.
  Progression must be conversational and subtle, never visual gamification.
- Do not change the billing service.
- Do not redesign the sidebar layout — only label changes.

---

## The one metric to verify success

After these changes are deployed, test with a real user across 3 sessions:

**Session 1:** User speaks. Consolidation runs. session_insight is stored.

**Session 2:** Open app. The mission card shows. The greeting references session 1 specifically.
The AI pushes in CHALLENGE mode. The session ends with a reflection and a tease.

**Session 3:** User opens without being prompted. That's the signal. That's retention.

If session 3 happens organically — the system is working.
