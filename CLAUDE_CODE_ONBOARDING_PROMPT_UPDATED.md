# MISSION: Conversational First-Session Onboarding for AI Speaking App

## Core Goal

Replace static onboarding questions with a **natural first speaking session**.

Do **not** add more fields to the register form. The register form should remain account setup only.

The first real relationship-building moment happens when the user enters `/chat` and presses the mic for the first time.

The system should:

1. Detect whether this is the user's first speaking session.
2. Use a special onboarding greeting prompt only for that first session.
3. Let the AI naturally learn about the user through conversation.
4. Run lightweight onboarding extraction in parallel.
5. Show a subtle frontend "adapting to you" experience.
6. Seed the first `session_insight` from actual observed conversation.
7. Return to the normal relationship/memory system from session 2 onward.

---

## Why This Matters

The current register flow collects:

- name
- native language
- target language
- self-reported level
- learning goal
- account credentials

That is enough to start. Asking more form questions creates friction.

The weakness of the current experience is that the AI has profile fields but no behavioral signal. It may know the user says they are intermediate, but it has not heard their speaking style, confidence, hesitation pattern, or real motivation.

This feature fixes that.

---

## Final User Experience

```text
[Existing register form — unchanged]
        ↓
[User lands on /chat]
        ↓
[First speaking session starts]
        ↓
[Backend returns is_first_session = true]
        ↓
[AI greets user by name and references registered goal]
        ↓
[AI has a natural 2-4 minute adaptive conversation]
        ↓
[System silently extracts onboarding signals]
        ↓
[Frontend subtly shows "Adapting to your style..."]
        ↓
[AI gives a small mini challenge]
        ↓
[Session ends]
        ↓
[Consolidation creates first session_insight]
        ↓
[Session 2+ uses normal relationship system]
```

---

# Important Product Rules

## Keep the register form unchanged

Do not add:

- weakness question
- preferred topic question
- speaking fear question
- personality question
- learning schedule question

The first session should discover those naturally.

## Keep onboarding one-time only

The onboarding UI and onboarding prompt should only run during the user's first speaking session.

After that:

- normal chat UI returns
- sidebar returns
- normal greeting system returns
- normal consolidation continues

## Do not make the user feel analyzed

Avoid UI text such as:

- weakness detected
- low confidence
- bad grammar
- level mismatch
- nervous speaker

Use softer wording:

- Learning your speaking style...
- Adapting to your goal...
- Preparing a small practice...
- Getting a feel for your pace...

---

# Data Model: Onboarding State

Create a shared TypeScript/Python-compatible shape for temporary onboarding state.

This is a temporary Redis object, not the final memory object.

```ts
export interface OnboardingState {
  motivation: "casual" | "career" | "travel" | "education" | "social" | "unclear" | null;
  confidence_signal: "high" | "medium" | "low" | "unclear" | null;
  speaking_style: "verbose" | "brief" | "mixed" | "unclear" | null;
  emotional_energy: "excited" | "relaxed" | "nervous" | "neutral" | "unclear" | null;
  notable_weakness_hints: string[];
  facts: string[];
  updated_at: string;
}
```

Redis key:

```text
user:{user_id}:onboarding_state
```

TTL:

```text
24 hours
```

---

# Data Model: First Session Insight

When consolidation finishes the first session, create or enrich the existing `session_insight` with this shape.

```ts
export interface FirstSessionInsight {
  is_first_session_insight: true;
  source: "onboarding_conversation";
  user_id: string;
  session_id: string;

  target_language: string;
  native_language?: string;
  self_reported_level?: string;
  learning_goal?: string;

  observed_speaking_level?: string;
  inferred_motivation?: string;
  confidence_level?: "low" | "medium" | "high" | "unclear";
  speaking_style?: "verbose" | "brief" | "mixed" | "unclear";
  emotional_energy?: "excited" | "relaxed" | "nervous" | "neutral" | "unclear";

  speaking_weaknesses: string[];
  speaking_strengths: string[];
  preferred_practice_contexts: string[];

  recommended_next_session?: {
    type: "casual" | "interview" | "travel" | "presentation" | "daily_conversation" | "academic";
    reason: string;
    suggested_challenge: string;
  };

  evidence: string[];
  uncertainty_notes: string[];
}
```

Rules:

- Keep `self_reported_level` and `observed_speaking_level` separate.
- Do not overwrite permanent user profile fields unless confidence is high.
- Evidence should be short observations, not full transcript chunks.
- If uncertain, store `"unclear"` or add to `uncertainty_notes`.
- Do not invent weaknesses without evidence.

---

# CHANGE A — Backend: Detect First Speaking Session

File:

```text
BE/apps/orchestrator/src/session/session.service.ts
```

## Goal

When a speaking session starts, return whether it is the user's first speaking session.

## Implementation

In `session.start(userId)`, create the session first, then count sessions for that user.

```ts
const session = await this.repo.save({
  userId,
  status: "active",
  startedAt: new Date(),
});

const totalSessions = await this.repo.count({
  where: { userId },
});

const isFirstSession = totalSessions === 1;

return {
  session_id: session.id,
  is_first_session: isFirstSession,
};
```

## Add helper method

```ts
async isOnboardingSession(userId: string, sessionId: string): Promise<boolean> {
  const session = await this.repo.findOne({
    where: { id: sessionId, userId },
  });

  if (!session) return false;

  const earlierSessions = await this.repo.count({
    where: {
      userId,
      startedAt: LessThan(session.startedAt),
    },
  });

  return earlierSessions === 0;
}
```

## Important warning

Avoid relying on `count <= 1` globally after users already have multiple sessions.

For greeting and turn routing, prefer checking the current `sessionId` if available.

If your flow does not have `sessionId` before greeting, use:

- `count === 0` before creating the first session
- `count === 1` immediately after creating it

---

# CHANGE B — Backend: Onboarding Greeting Prompt

File:

```text
BE/apps/orchestrator/src/session/session.controller.ts
```

Function:

```text
streamGreetingForUser()
```

## Goal

Use a different greeting prompt only for the first speaking session.

## Logic

Before building the greeting prompt:

```ts
const isOnboarding = await this.sessionService.isOnboardingSession(userId, sessionId);
```

If `sessionId` is not available in the greeting route:

```ts
const isOnboarding = await this.sessionService.isFirstSession(userId);
```

Use onboarding prompt only if `isOnboarding === true`.

Otherwise, keep the existing returning-user greeting logic unchanged.

## Onboarding system prompt

```ts
const onboardingSystemPrompt = [
  `You are a warm, sharp AI speaking partner.`,
  `The user just signed up and this is their first speaking session.`,
  ``,
  `Known profile:`,
  `- Name: ${user.name}`,
  `- Native language: ${user.nativeLanguage ?? "unknown"}`,
  `- Target language: ${user.targetLanguage}`,
  `- Self-reported level: ${user.level ?? "unknown"}`,
  `- Learning goal: ${user.learningGoal ?? "unknown"}`,
  ``,
  `MISSION:`,
  `Start a real conversation, not a survey.`,
  `Make the user feel recognized from the first 10 seconds.`,
  `Use the registered learning goal naturally, then discover more through conversation.`,
  ``,
  `PHASE 1 — Opening greeting:`,
  `- Greet the user by name.`,
  `- Reference their learning goal as something you will help with, not as a question.`,
  `- End with exactly ONE natural follow-up question about that goal.`,
  `- Keep the whole response under 3 sentences.`,
  ``,
  `PHASE 2 — Adaptive discovery:`,
  `Naturally infer:`,
  `- real motivation`,
  `- confidence level`,
  `- speaking comfort`,
  `- speaking pattern`,
  `- likely blocker or weakness`,
  `- preferred practice context`,
  ``,
  `Do NOT ask directly:`,
  `- "What is your weakness?"`,
  `- "What is your CEFR level?"`,
  `- "Are you A1/B1/C1?"`,
  `- "Do you want IELTS?" unless the registered goal mentions IELTS or exams.`,
  ``,
  `PHASE 3 — Mini challenge:`,
  `When you have enough signal, transition naturally.`,
  `Example transition: "Ok, I understand you a bit better now. Let's try a small real practice."`,
  `Then give exactly ONE mini scenario based on their goal and answers.`,
  ``,
  `Mini challenge examples:`,
  `- Casual learner: "Imagine we just met at a coffee shop. Tell me what your week has been like."`,
  `- Career learner: "Imagine you're introducing yourself to a new international colleague. Go."`,
  `- Travel learner: "You're at an airport and your flight got delayed. Talk to me like I'm the airline staff."`,
  `- Presentation learner: "Explain one idea from your work or study clearly in 45 seconds."`,
  `- Academic learner: "Explain a topic you know well as if teaching a younger student."`,
  ``,
  `PHASE 4 — Closing:`,
  `Give brief supportive feedback.`,
  `Mention what you will adapt for next time.`,
  `Do not overwhelm the user with corrections.`,
  ``,
  `ABSOLUTE RULES:`,
  `- Ask only one question per turn.`,
  `- Never ask two unrelated questions in the same turn.`,
  `- Do not correct grammar during onboarding unless the user explicitly asks.`,
  `- Do not mention that you are extracting user data.`,
  `- Do not mention onboarding insight, memory extraction, or profiling.`,
  `- Do not use emojis in voice responses.`,
  `- Keep each response under 3 sentences.`,
  `- Speak primarily in ${user.targetLanguage}.`,
  `- If the user mixes in ${user.nativeLanguage ?? "their native language"}, you may briefly mirror it to reduce pressure, then guide them back to ${user.targetLanguage}.`,
].filter(Boolean).join("\n");
```

## Tone note

Do not hard-code Vietnamese slang like `tao/mày` unless the app already uses that tone and the user has opted into it.

Safer default:

- English target language: warm casual English.
- Vietnamese UI/user: supportive Vietnamese explanation is allowed only when needed.
- User uses casual Vietnamese first: AI may mirror lightly.

---

# CHANGE C — Backend: Pass Onboarding Flag to Turn Agent

File:

```text
BE/apps/orchestrator/src/turn/turn.controller.ts
```

## Goal

The turn agent needs to know whether this turn belongs to the first onboarding session.

## Implementation

When forwarding the user turn to turn-agent:

```ts
const isOnboarding = await this.sessionService.isOnboardingSession(userId, sessionId);

headers: {
  ...existingHeaders,
  "X-Is-Onboarding": isOnboarding ? "true" : "false",
  "X-Session-Id": sessionId,
  "X-User-Id": userId,
}
```

## Rule

Only onboarding sessions should trigger onboarding intent extraction.

Do not run onboarding extraction forever.

---

# CHANGE D — Turn Agent: Parallel Onboarding Extraction

File:

```text
BE/services/turn-agent/nodes/build_prompt_node.py
```

## Goal

During onboarding only, analyze each user message in parallel and update Redis.

This should not block the main LLM response.

## Detect onboarding

Read header:

```python
is_onboarding = request.headers.get("X-Is-Onboarding") == "true"
```

If true, call:

```python
asyncio.create_task(
    extract_onboarding_intent(
        transcript=transcript,
        user_id=user_id,
        session_id=session_id,
    )
)
```

## Extractor prompt

```python
INTENT_EXTRACTION_PROMPT = '''
Analyze this single user message in the context of a language learning onboarding conversation.

Return ONLY valid JSON, no markdown, no explanation.

Schema:
{
  "motivation": "casual | career | travel | education | social | unclear",
  "confidence_signal": "high | medium | low | unclear",
  "speaking_style": "verbose | brief | mixed | unclear",
  "emotional_energy": "excited | relaxed | nervous | neutral | unclear",
  "notable_weakness_hint": "string or null",
  "extracted_fact": "one plain sentence fact about the user, or null"
}

Rules:
- Base the analysis ONLY on this user message.
- Use "unclear" when there is not enough evidence.
- Do not infer sensitive attributes.
- Do not diagnose mental state.
- Keep extracted_fact short and useful for language practice personalization.

User message:
{transcript}
'''
```

## Redis merge logic

Key:

```python
key = f"user:{user_id}:onboarding_state"
```

Merge rules:

```python
def merge_onboarding_state(old: dict, new: dict) -> dict:
    merged = old or {}

    scalar_fields = [
        "motivation",
        "confidence_signal",
        "speaking_style",
        "emotional_energy",
    ]

    for field in scalar_fields:
        old_value = merged.get(field)
        new_value = new.get(field)

        if old_value in [None, "unclear"] and new_value not in [None, "unclear"]:
            merged[field] = new_value
        elif field not in merged:
            merged[field] = new_value or "unclear"

    weakness = new.get("notable_weakness_hint")
    if weakness:
        merged.setdefault("notable_weakness_hints", [])
        if weakness not in merged["notable_weakness_hints"]:
            merged["notable_weakness_hints"].append(weakness)

    fact = new.get("extracted_fact")
    if fact:
        merged.setdefault("facts", [])
        if fact not in merged["facts"]:
            merged["facts"].append(fact)

    merged["updated_at"] = datetime.utcnow().isoformat()
    return merged
```

Save with TTL:

```python
await redis.set(key, json.dumps(merged), ex=86400)
```

## Failure behavior

If extraction fails:

- log the error
- do not crash the turn response
- do not retry synchronously

---

# CHANGE E — Memory Service: Onboarding State Endpoint

File:

```text
BE/services/memory-service
```

Add endpoint:

```http
GET /onboarding-state/{user_id}
```

Returns `{}` if not found.

Otherwise returns the Redis object.

Security note:

Do not expose arbitrary `user_id` to the frontend directly.

The orchestrator should expose a protected current-user route instead.

---

# CHANGE F — Orchestrator: Proxy Onboarding State to Frontend

File:

```text
BE/apps/orchestrator/src/session/session.controller.ts
```

Add route:

```http
GET /session/onboarding-state
```

Auth:

- JWT protected
- use current authenticated user id
- do not accept user id from query/body

Controller behavior:

```ts
@Get("onboarding-state")
@UseGuards(JwtAuthGuard)
async getOnboardingState(@Req() req) {
  const userId = req.user.id;
  return this.memoryClient.getOnboardingState(userId);
}
```

Return `{}` if no onboarding state exists.

---

# CHANGE G — Memory Service: First-Session Consolidation Enrichment

File:

```text
BE/services/memory-service/workers/consolidation.py
```

## Goal

When the first session ends, merge Redis onboarding state into the first `session_insight`.

## Helper

```python
async def _get_onboarding_state(user_id: str) -> dict:
    key = f"user:{user_id}:onboarding_state"
    raw = await redis_client.client.get(key)

    if not raw:
        return {}

    try:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        return json.loads(raw)
    except Exception:
        return {}
```

## Suggested challenge mapping

```python
motivation_to_challenge = {
    "casual": "Have a relaxed 5-minute conversation about something that happened this week.",
    "career": "Practice introducing yourself confidently in a professional context.",
    "travel": "Handle a short travel problem, such as a delayed flight or hotel check-in.",
    "education": "Explain a topic you know well as if teaching someone younger.",
    "social": "Tell a short story about a memorable experience with another person.",
}
```

## Merge logic

When building `session_insight`:

```python
onboarding_state = await _get_onboarding_state(user_id)

if onboarding_state:
    insight["is_first_session_insight"] = True
    insight["source"] = "onboarding_conversation"

    insight["inferred_motivation"] = insight.get("inferred_motivation") or onboarding_state.get("motivation")
    insight["confidence_level"] = insight.get("confidence_level") or onboarding_state.get("confidence_signal")
    insight["speaking_style"] = insight.get("speaking_style") or onboarding_state.get("speaking_style")
    insight["emotional_energy"] = insight.get("emotional_energy") or onboarding_state.get("emotional_energy")

    insight.setdefault("speaking_weaknesses", [])
    for weakness in onboarding_state.get("notable_weakness_hints", []):
        if weakness not in insight["speaking_weaknesses"]:
            insight["speaking_weaknesses"].append(weakness)

    insight.setdefault("evidence", [])
    for fact in onboarding_state.get("facts", []):
        if fact not in insight["evidence"]:
            insight["evidence"].append(fact)

    motivation = onboarding_state.get("motivation")
    if motivation in motivation_to_challenge and not insight.get("recommended_next_session"):
        insight["recommended_next_session"] = {
            "type": motivation,
            "reason": "Based on the user's first conversation signals.",
            "suggested_challenge": motivation_to_challenge[motivation],
        }
```

## Long-term memory facts

Store only safe, useful, non-sensitive facts.

Good examples:

- User wants to practice English for meetings.
- User prefers relaxed casual topics.
- User tends to answer briefly at the start of speaking sessions.

Avoid judgmental examples:

- User has low confidence.
- User is nervous.
- User is bad at grammar.

Use neutral phrasing:

```python
safe_fact = "User may benefit from gentle warm-up questions before challenging speaking tasks."
```

## Cleanup

After consolidation completes successfully:

```python
await redis_client.client.delete(f"user:{user_id}:onboarding_state")
```

If consolidation fails, keep Redis state until TTL expires.

---

# CHANGE H — Frontend Session Service

File:

```text
FE/src/services/session.service.ts
```

## Update start session response type

```ts
export interface StartSessionResponse {
  session_id: string;
  is_first_session: boolean;
}
```

## Add onboarding state type

```ts
export interface OnboardingState {
  motivation: string | null;
  confidence_signal: string | null;
  speaking_style: string | null;
  emotional_energy: string | null;
  notable_weakness_hints?: string[];
  facts: string[];
  updated_at?: string;
}
```

## Add API call

```ts
getOnboardingState: async (): Promise<OnboardingState | null> => {
  const res = await fetchWithAuth(`${API_BASE}/session/onboarding-state`);

  if (!res.ok) return null;

  const data = await res.json();

  if (!data || Object.keys(data).length === 0) {
    return null;
  }

  return data;
};
```

---

# CHANGE I — Frontend Hook State

File:

```text
FE/src/hooks/use-chat.ts
```

## Add state

```ts
const [isOnboardingSession, setIsOnboardingSession] = useState(false);
const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
```

When starting a session:

```ts
const session = await sessionService.start();

setSessionId(session.session_id);
setIsOnboardingSession(Boolean(session.is_first_session));
```

## Poll onboarding state

```ts
useEffect(() => {
  if (!isOnboardingSession || !sessionId || status !== "active") return;

  let cancelled = false;

  const poll = async () => {
    const state = await sessionService.getOnboardingState();
    if (!cancelled) {
      setOnboardingState(state);
    }
  };

  poll();
  const interval = window.setInterval(poll, 3000);

  return () => {
    cancelled = true;
    window.clearInterval(interval);
  };
}, [isOnboardingSession, sessionId, status]);
```

## Clear state on end

```ts
const endSession = async () => {
  // existing logic...

  setIsOnboardingSession(false);
  setOnboardingState(null);
};
```

## Export from hook

```ts
return {
  // existing exports...
  isOnboardingSession,
  onboardingState,
};
```

---

# CHANGE J — Frontend Chat Page Onboarding Layout

File:

```text
FE/src/app/(main)/chat/page.tsx
```

## Goal

Render a special first-time speaking room only during onboarding.

## Layout requirements

When `isOnboardingSession === true`:

- hide sidebar
- hide normal header
- full-screen clean layout
- centered AI presence indicator
- larger greeting text
- centered conversation bubbles
- large mic button
- subtle onboarding panel
- "Tap to reply" hint before first user message

## Suggested structure

```tsx
if (isOnboardingSession) {
  return (
    <main className="min-h-screen bg-cream relative flex flex-col items-center justify-center px-4">
      <div className="flex flex-col items-center justify-center gap-6 w-full max-w-md">
        <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center animate-pulse">
          <div className="h-6 w-6 rounded-full bg-primary" />
        </div>

        {greetingSentences.length > 0 && (
          <div className="text-center text-3xl font-medium leading-snug">
            {greetingSentences.map((sentence, index) => (
              <p key={index}>{sentence}</p>
            ))}
          </div>
        )}

        {messages.length > 0 && (
          <div className="w-full max-w-sm space-y-3">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} compact />
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={toggleRecording}
          disabled={isAiSpeaking}
          className="h-20 w-20 rounded-full flex items-center justify-center shadow-lg"
        >
          {/* existing mic icon */}
        </button>

        {messages.length === 0 && (
          <p className="text-sm text-gray-400">Tap to reply</p>
        )}
      </div>

      <OnboardingPanel
        isVisible={isOnboardingSession}
        state={onboardingState}
      />
    </main>
  );
}
```

Normal UI remains unchanged:

```tsx
return (
  <>
    {!isOnboardingSession && <Sidebar />}
    {/* existing normal chat UI */}
  </>
);
```

---

# CHANGE K — Frontend Onboarding Panel Component

New file:

```text
FE/src/components/chat/onboarding-panel/onboarding-panel.tsx
```

## Behavior

Only render when:

```ts
isVisible === true
```

and at least 2 useful labels exist.

Useful means:

- not null
- not `"unclear"`
- not empty string

## Labels

```ts
const MOTIVATION_LABELS: Record<string, string> = {
  casual: "casual learner",
  career: "career-focused",
  travel: "travel prep",
  education: "academic goals",
  social: "social connection",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "comfortable speaking",
  medium: "building confidence",
  low: "prefers gentle warm-up",
};

const ENERGY_LABELS: Record<string, string> = {
  excited: "high energy today",
  relaxed: "prefers relaxed pace",
  nervous: "needs gentle pace",
  neutral: "balanced pace",
};
```

## Component

```tsx
import type { OnboardingState } from "@/services/session.service";

interface OnboardingPanelProps {
  isVisible: boolean;
  state: OnboardingState | null;
}

export function OnboardingPanel({ isVisible, state }: OnboardingPanelProps) {
  if (!isVisible || !state) return null;

  const items: string[] = [];

  if (state.motivation && state.motivation !== "unclear") {
    items.push(MOTIVATION_LABELS[state.motivation] ?? state.motivation);
  }

  if (state.confidence_signal && state.confidence_signal !== "unclear") {
    items.push(CONFIDENCE_LABELS[state.confidence_signal] ?? "adapting confidence");
  }

  if (state.emotional_energy && state.emotional_energy !== "unclear") {
    items.push(ENERGY_LABELS[state.emotional_energy] ?? "adapting pace");
  }

  for (const fact of state.facts ?? []) {
    if (fact && items.length < 4) {
      items.push(fact);
    }
  }

  const visibleItems = items.slice(0, 4);

  if (visibleItems.length < 2) return null;

  return (
    <aside className="fixed bottom-24 left-4 max-w-[180px] rounded-2xl border border-gray-100 bg-white/80 px-3 py-3 shadow-sm backdrop-blur-sm">
      <p className="mb-2 text-xs font-medium text-gray-400">
        Learning about you...
      </p>

      <div className="space-y-1.5">
        {visibleItems.map((item, index) => (
          <p
            key={`${item}-${index}`}
            className="animate-fade-in text-xs text-gray-600"
            style={{ animationDelay: `${index * 120}ms` }}
          >
            ✓ {item}
          </p>
        ))}
      </div>
    </aside>
  );
}
```

## Important UX rule

Do not display raw weakness hints in the panel.

Weakness hints can be used in consolidation, but they should not be shown live to the user.

---

# CHANGE L — Session 2+ Greeting Behavior

File depends on current greeting system.

## Goal

If latest insight has:

```ts
is_first_session_insight: true
```

then the next session should reference it naturally.

Example:

```text
Last time, I got a feel for your speaking style. Today let's start with something simple and real.
```

If motivation was career:

```text
Last time, I learned that work conversations matter most for you. Let's warm up with a quick professional intro.
```

Do not say:

```text
Based on your onboarding insight...
I extracted your weakness...
Your confidence signal is low...
```

---

# What NOT To Change

- Do not change register form fields.
- Do not add a weakness question.
- Do not add a long onboarding wizard.
- Do not show onboarding UI after the first session.
- Do not show sidebar during onboarding.
- Do not run onboarding extraction on every future session.
- Do not show weakness/confidence labels in a judgmental way.
- Do not store sensitive or speculative facts as long-term memory.
- Do not overwrite self-reported level with observed level.

---

# Acceptance Criteria

## Backend

- `session.start()` returns `session_id` and `is_first_session`.
- First session detection works correctly.
- Greeting uses onboarding prompt only on first session.
- Returning sessions use existing greeting logic.
- Turn controller forwards `X-Is-Onboarding`.
- Turn-agent runs onboarding extraction only when `X-Is-Onboarding: true`.
- Extraction failure does not break main response.
- Redis onboarding state is created with 24h TTL.
- Orchestrator exposes `GET /session/onboarding-state`.
- Consolidation enriches first session insight with onboarding state.
- Redis onboarding state is deleted only after successful consolidation.

## Frontend

- `use-chat.ts` stores `isOnboardingSession`.
- `use-chat.ts` polls onboarding state only during active onboarding session.
- `/chat` renders special onboarding layout only during first session.
- Sidebar is hidden during onboarding.
- Onboarding panel appears only after at least 2 useful facts.
- Onboarding panel does not show weakness hints.
- Normal chat UI returns after onboarding ends.

## UX

- AI greets the user by name.
- AI references the registered goal naturally.
- AI asks one question at a time.
- AI does not ask "what is your weakness?"
- AI does not mention CEFR level names.
- AI gives a mini challenge after enough context.
- User feels like they are having a conversation, not filling a survey.

---

# Suggested Implementation Order

1. Backend first-session detection.
2. Orchestrator start response type update.
3. Onboarding greeting prompt.
4. `X-Is-Onboarding` forwarding to turn-agent.
5. Turn-agent onboarding extraction + Redis state.
6. Memory-service onboarding-state endpoint.
7. Orchestrator `/session/onboarding-state` proxy.
8. Frontend session service type + API call.
9. `use-chat.ts` onboarding state + polling.
10. Onboarding panel component.
11. Chat page onboarding layout.
12. Consolidation enrichment and cleanup.
13. Session 2+ greeting refinement.
14. End-to-end test with one new user and one returning user.

---

# Test Cases

## New user: casual learner

Profile:

```json
{
  "name": "Duc",
  "targetLanguage": "English",
  "level": "intermediate",
  "learningGoal": "I want to speak English for fun"
}
```

Expected:

- first session returns `is_first_session: true`
- AI greets by name
- AI references fun/casual goal
- AI asks one natural question
- onboarding state eventually includes motivation `casual`
- panel shows soft labels only
- mini challenge is casual conversation
- session insight has `is_first_session_insight: true`

## New user: career learner

Profile:

```json
{
  "name": "Duc",
  "targetLanguage": "English",
  "level": "pre-intermediate",
  "learningGoal": "I need English for meetings"
}
```

Expected:

- AI references work/meeting goal
- AI does not ask about IELTS
- onboarding state eventually includes motivation `career`
- mini challenge is professional/self-introduction or meeting context
- next session greeting references work context naturally

## Returning user

Expected:

- `is_first_session: false`
- no onboarding panel
- no special onboarding layout
- no `X-Is-Onboarding: true`
- normal relationship greeting works as before

---

# Final Product Standard

The result should feel like this:

```text
The first session is not a setup step.
It is the first real conversation.
The system learns by listening, not by asking the user to fill more forms.
```
