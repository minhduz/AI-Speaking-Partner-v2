import { getAccessToken, tryRefresh } from '@/lib/http-client';
import type { GreetingEvent, SessionSummary, TurnHistoryPage, TurnEvent } from '@/types/session.types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

async function* parseSSE<T>(res: Response): AsyncGenerator<T> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try { yield JSON.parse(line.slice(6)) as T; } catch { /* skip malformed */ }
      }
    }
  }
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchWithAuth(url: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
    ...authHeaders(),
  };
  let res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    const newToken = await tryRefresh();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      res = await fetch(url, { ...init, headers });
    }
  }
  return res;
}

function log(label: string, data?: unknown) {
  if (data !== undefined) {
    console.log(`[session] ${label}`, data);
  } else {
    console.log(`[session] ${label}`);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionInsight {
  has_insight: boolean;
  struggled_with?: string | null;
  improved_vs_before?: string | null;
  next_challenge?: string | null;
  active_mission?: string | null;
  active_mission_source?: string | null;
  energy_level?: string | null;
  speaking_duration_estimate?: string | null;
  last_session_days_ago?: number | null;
}

export type SessionMode = 'guided_learning' | 'free_talk';

export interface StartSessionResponse {
  session_id: string;
  is_first_session: boolean;
  /** Backend echoes the effective mode (may differ from requested if onboarding-forced). */
  mode: SessionMode;
}

export interface SessionQuota {
  is_unlimited: boolean;
  daily_session_limit: number;
  session_token_limit: number;
  sessions_used: number;
  can_start: boolean;
  /** True until the user completes/starts their first guided onboarding session. */
  is_first_session?: boolean;
}

export interface DeckCard {
  id: string;
  type: string;
  title: string;
  task: string;
  success_criteria: string[];
  expected_duration_seconds: number;
  retry_allowed: boolean;
  status: string;
  attempts: number;
  result: string | null;
  feedback: string | null;
  ui_hint: string | null;
  next_action?: 'retry' | 'next_card' | 'finish_session' | null;
}

/**
 * Eval block emitted by the turn-agent at the end of each deck-active turn.
 * Mirrors the JSON the LLM produces after `EVAL:` — used by the FE to update
 * deck UI optimistically before the 3s poll reconciles.
 */
export interface DeckEvalData {
  passed: boolean;
  feedback: string;
  retryRecommended: boolean;
  nextAction: 'retry' | 'next_card' | 'finish_session';
  detectedIssues: string[];
}

export interface ExerciseDeck {
  id: string;
  session_id: string;
  session_type: 'onboarding_diagnostic' | 'personalized_training' | 'adaptive_training' | 'lesson_runtime';
  mission: string;
  mission_source: string;
  reason: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'ended_early' | 'abandoned' | 'none';
  current_card_index: number;
  cards: DeckCard[];
  end_reason: string | null;
  created_at: string;
  updated_at: string;
  /** True when this deck continues an incomplete deck from a previous session. */
  is_continuation?: boolean;
  /** Curriculum-first: present when the deck was minted from a lesson. */
  lesson_id?: string | null;
  lesson_attempt_id?: string | null;
  lesson_title?: string | null;
  pass_score?: number | null;
}

export interface SessionEvaluationCard {
  title: string;
  type: string | null;
  result: 'passed' | 'partial' | 'not_passed' | null;
  attempts: number;
  feedback: string;
}

export interface SessionEvaluationCorrection {
  you_said: string;
  try_this: string;
  why: string;
}

export interface SessionEvaluationSkill {
  skill: string;
  level: 'Strong' | 'Okay' | 'Needs work';
  evidence: string;
}

export interface SessionEvaluationPattern {
  title: string;
  evidence: string;
  practice_tip: string;
}

export interface SessionEvaluationDrill {
  title: string;
  steps: string[];
  success_criteria?: string;
}

export interface SessionEvaluation {
  status: 'ready';
  /** Branches the FE: 'free_talk' → lightweight recap, 'guided_learning' → full board. */
  mode?: SessionMode;
  quality?: 'basic' | 'rich';
  session_id: string;
  generated_at: string;
  summary: string;
  highlights: string[];
  growth_areas: string[];
  next_focus: string;
  energy: string;
  cards: SessionEvaluationCard[];
  spoken_samples: string[];
  corrections?: SessionEvaluationCorrection[];
  skill_radar?: SessionEvaluationSkill[];
  recurring_pattern?: SessionEvaluationPattern | null;
  next_drill?: SessionEvaluationDrill | null;
  stats: {
    user_turns: number;
    cards_completed: number;
    cards_total: number;
    cards_skipped: number;
    duration_minutes: number | null;
  };
}

export interface OnboardingState {
  motivation?: string | null;
  confidence_signal?: string | null;
  speaking_style?: string | null;
  emotional_energy?: string | null;
  notable_weakness_hints?: string[];
  facts?: string[];
  updated_at?: string;
}

export interface TurnResult {
  turn_id: string;
  transcript: string;
  confidence: number;
  pronunciation: { score?: number; [key: string]: unknown } | null;
  response_text: string;
  audio_b64: string;
  tokens_used: number;
}

/**
 * Why a session ended — passed to BE so consolidation / memory can treat
 * deliberate ends differently from abandoned ones.
 *   user_clicked  – End button in UI
 *   voice_intent  – AI detected closing intent in speech
 *   idle_timeout  – 15-min client-side idle timer
 *   tab_close     – beforeunload / beacon
 */
export type EndReason = 'user_clicked' | 'voice_intent' | 'idle_timeout' | 'tab_close' | 'ai_farewell';

export interface CloseSessionResponse {
  session_id: string;
  /** AI-generated farewell text. Empty string on failure. */
  text: string;
  /** TTS audio base64. null on TTS failure. */
  audio_b64: string | null;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const sessionService = {
  getQuota: async (): Promise<SessionQuota | null> => {
    log('GET /session/quota');
    const res = await fetchWithAuth(`${API_BASE}/session/quota`);
    if (!res.ok) return null;
    const data: SessionQuota = await res.json();
    log('GET /session/quota â†’', data);
    return data;
  },

  start: async (mode: SessionMode = 'guided_learning'): Promise<StartSessionResponse> => {
    log('POST /session/start', { mode });
    const res = await fetchWithAuth(`${API_BASE}/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message ?? 'Failed to start session');
    }
    const data: StartSessionResponse = await res.json();
    log('POST /session/start →', data);
    return data;
  },

  getOnboardingState: async (): Promise<OnboardingState | null> => {
    const res = await fetchWithAuth(`${API_BASE}/session/onboarding-state`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || Object.keys(data).length === 0) return null;
    return data as OnboardingState;
  },

  streamGreetingAnon: async (
    signal?: AbortSignal,
    mode: SessionMode = 'guided_learning',
  ): Promise<AsyncGenerator<GreetingEvent>> => {
    const dt = encodeURIComponent(new Date().toISOString());
    const modeParam = mode === 'free_talk' ? '&mode=free_talk' : '';
    log('GET /session/greeting/stream', { mode });
    const res = await fetch(`${API_BASE}/session/greeting/stream?datetime=${dt}${modeParam}`, {
      headers: authHeaders(),
      signal,
    });
    if (!res.ok) throw new Error(`Greeting stream failed: ${res.status}`);
    async function* wrapped(): AsyncGenerator<GreetingEvent> {
      for await (const event of parseSSE<GreetingEvent>(res)) {
        log('greeting event ←', event.type === 'segment' ? { type: 'segment', text: event.text, audio_b64: '[base64]' } : event);
        yield event;
      }
    }
    return wrapped();
  },

  getInsight: async (): Promise<SessionInsight> => {
    log(`GET /session/insight`);
    const res = await fetchWithAuth(`${API_BASE}/session/insight`);
    if (!res.ok) return { has_insight: false };
    const data: SessionInsight = await res.json();
    log(`GET /session/insight →`, data);
    return data;
  },

  setTodayChallenge: async (challenge: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_BASE}/session/today-challenge`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge }),
    });
    if (!res.ok) throw new Error('Failed to save today challenge');
  },

  list: async (page: number, limit = 25): Promise<{ items: SessionSummary[]; total: number; hasMore: boolean }> => {
    log(`GET /session/list page=${page}`);
    const res = await fetchWithAuth(`${API_BASE}/session/list?page=${page}&limit=${limit}`);
    if (!res.ok) throw new Error('Failed to fetch sessions');
    return res.json();
  },

  streamGreeting: async (sessionId: string): Promise<AsyncGenerator<GreetingEvent>> => {
    log(`GET /session/${sessionId}/greeting/stream`);
    const res = await fetchWithAuth(`${API_BASE}/session/${sessionId}/greeting/stream`);
    if (!res.ok) throw new Error(`Greeting stream failed: ${res.status}`);
    log(`GET /session/${sessionId}/greeting/stream → connected (SSE)`);

    async function* wrapped(): AsyncGenerator<GreetingEvent> {
      for await (const event of parseSSE<GreetingEvent>(res)) {
        log(`greeting event ←`, event.type === 'segment' ? { type: 'segment', text: event.text, audio_b64: '[base64]' } : event);
        yield event;
      }
    }
    return wrapped();
  },

  streamTurnText: async (
    sessionId: string,
    transcript: string,
    greetingText?: string,
  ): Promise<AsyncGenerator<TurnEvent>> => {
    log(`POST /turn/${sessionId}/stream-text`, {
      transcript: transcript.slice(0, 60),
      greetingText: greetingText ? `${greetingText.slice(0, 60)}…` : undefined,
    });
    const res = await fetch(`${API_BASE}/turn/${sessionId}/stream-text`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
        'X-Client-Datetime': new Date().toISOString(),
      },
      // greeting_text is only sent on the FIRST turn of a session. The
      // orchestrator forwards it to the turn-agent which (a) prepends it as a
      // prior assistant message in the LLM prompt so the AI knows what it just
      // asked, and (b) writes it to short-term so subsequent turns see it in
      // recent_messages.
      body: JSON.stringify(greetingText ? { transcript, greeting_text: greetingText } : { transcript }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      log(`POST /turn/${sessionId}/stream-text → ERROR`, { status: res.status, body });
      throw new Error(`Turn text stream failed: ${res.status}`);
    }
    async function* wrapped(): AsyncGenerator<TurnEvent> {
      for await (const event of parseSSE<TurnEvent>(res)) {
        log(`turn-text event ←`, event.type === 'segment'
          ? { type: 'segment', text: event.text, audio_b64: '[base64]' }
          : event);
        yield event;
      }
    }
    return wrapped();
  },

  streamTurn: async (sessionId: string, audioBlob: Blob): Promise<AsyncGenerator<TurnEvent>> => {
    log(`POST /turn/${sessionId}/stream`, { blobSize: audioBlob.size, type: audioBlob.type });
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

    const res = await fetch(`${API_BASE}/turn/${sessionId}/stream`, {
      method: 'POST',
      headers: { ...authHeaders(), 'X-Client-Datetime': new Date().toISOString() },
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      log(`POST /turn/${sessionId}/stream → ERROR`, { status: res.status, body });
      throw new Error(`Turn stream failed: ${res.status}`);
    }

    async function* wrapped(): AsyncGenerator<TurnEvent> {
      for await (const event of parseSSE<TurnEvent>(res)) {
        log(`turn event ←`, event.type === 'segment'
          ? { type: 'segment', text: event.text, audio_b64: '[base64]' }
          : event);
        yield event;
      }
    }
    return wrapped();
  },

  sendTurn: async (sessionId: string, audioBlob: Blob): Promise<TurnResult> => {
    log(`POST /turn/${sessionId}`, { blobSize: audioBlob.size, type: audioBlob.type });
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    const res = await fetchWithAuth(`${API_BASE}/turn/${sessionId}`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      log(`POST /turn/${sessionId} → ERROR`, { status: res.status, body });
      let message: string;
      try { message = JSON.parse(body).message ?? body; } catch { message = body; }
      throw new Error(`[${res.status}] ${message}`);
    }
    const data: TurnResult = await res.json();
    log(`POST /turn/${sessionId} →`, {
      turn_id: data.turn_id,
      transcript: data.transcript,
      confidence: data.confidence,
      pronunciation: data.pronunciation,
      response_text: data.response_text,
      tokens_used: data.tokens_used,
      audio_b64: data.audio_b64 ? '[base64]' : null,
    });
    return data;
  },

  getTurns: async (sessionId: string, page = 1, limit = 20): Promise<TurnHistoryPage> => {
    log(`GET /turn/by-session/${sessionId} page=${page}`);
    const res = await fetch(`${API_BASE}/turn/by-session/${sessionId}?page=${page}&limit=${limit}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch turns');
    return res.json();
  },

  /**
   * Hard-end: marks session ended/abandoned + triggers consolidation. Returns
   * the lesson_attempt_id (if any) so the FE can fetch the lesson result.
   * Always call AFTER close() (or if closing fails).
   */
  end: async (sessionId: string, reason: EndReason = 'user_clicked'): Promise<{ lesson_attempt_id: string | null }> => {
    log(`POST /session/end`, { session_id: sessionId, reason });
    const res = await fetchWithAuth(`${API_BASE}/session/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, reason }),
    });
    log(`POST /session/end → ok`);
    if (!res.ok) return { lesson_attempt_id: null };
    const data = await res.json().catch(() => null);
    return { lesson_attempt_id: data?.lesson_attempt_id ?? null };
  },

  /**
   * Soft-close: asks BE to generate an AI farewell message (text + audio).
   * FE plays the audio, then calls end() to finalize.
   * BE marks session 'ending' immediately so turns are no longer accepted.
   */
  close: async (sessionId: string): Promise<CloseSessionResponse> => {
    log(`POST /session/${sessionId}/close`);
    const res = await fetchWithAuth(`${API_BASE}/session/${sessionId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { session_id: sessionId, text: '', audio_b64: null };
    const data: CloseSessionResponse = await res.json();
    log(`POST /session/${sessionId}/close →`, { text: data.text?.slice(0, 80), hasAudio: !!data.audio_b64 });
    return data;
  },

  getDeck: async (sessionId: string): Promise<ExerciseDeck | null> => {
    const res = await fetchWithAuth(`${API_BASE}/session/${sessionId}/deck`);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || data.status === 'none') return null;
    return data as ExerciseDeck;
  },

  /**
   * Fetch the end-of-session evaluation report. Returns null while
   * consolidation is still building it (BE responds {status:'pending'}),
   * so the caller can poll.
   */
  getEvaluation: async (sessionId: string): Promise<SessionEvaluation | null> => {
    const res = await fetchWithAuth(`${API_BASE}/session/${sessionId}/evaluation`);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || data.status === 'pending') return null;
    return data as SessionEvaluation;
  },

  advanceDeckCard: async (sessionId: string): Promise<void> => {
    await fetchWithAuth(`${API_BASE}/session/${sessionId}/deck/next`, { method: 'PUT' });
  },

  skipDeckCard: async (sessionId: string): Promise<void> => {
    await fetchWithAuth(`${API_BASE}/session/${sessionId}/deck/skip`, { method: 'PUT' });
  },

  acceptDeckChallenge: async (sessionId: string): Promise<void> => {
    await fetchWithAuth(`${API_BASE}/session/${sessionId}/deck/card`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });
  },

  /** Force-complete the deck without advancing — used after a lighter-mode card. */
  completeLighterDeck: async (sessionId: string): Promise<void> => {
    await fetchWithAuth(`${API_BASE}/session/${sessionId}/deck/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });
  },

  rejectDeckChallenge: async (sessionId: string): Promise<ExerciseDeck | null> => {
    const res = await fetchWithAuth(`${API_BASE}/session/${sessionId}/deck/end`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ end_reason: 'user_clicked_end' }),
    });
    if (!res.ok) throw new Error(`Failed to reject deck: ${res.status}`);
    const data = await res.json().catch(() => null);
    return data && data.status !== 'none' ? data as ExerciseDeck : null;
  },

  rejectDeckWithMode: async (sessionId: string, endReason: 'user_chose_free_talk' | 'user_wants_to_end'): Promise<ExerciseDeck | null> => {
    const res = await fetchWithAuth(`${API_BASE}/session/${sessionId}/deck/end`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ end_reason: endReason }),
    });
    if (!res.ok) throw new Error(`Failed to end deck with ${endReason}: ${res.status}`);
    const data = await res.json().catch(() => null);
    return data && data.status !== 'none' ? data as ExerciseDeck : null;
  },

  regenerateDeck: async (sessionId: string, topic: string): Promise<void> => {
    await fetchWithAuth(`${API_BASE}/session/${sessionId}/deck/regenerate`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic }),
    });
  },

  /**
   * Fire-and-forget beacon for tab close / page unload.
   * keepalive:true keeps the request alive after page is gone.
   */
  endBeacon: (sessionId: string): void => {
    const token = getAccessToken();
    fetch(`${API_BASE}/session/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ session_id: sessionId, reason: 'tab_close' }),
      keepalive: true,
    }).catch(() => {});
  },
};
