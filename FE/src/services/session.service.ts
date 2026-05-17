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

export interface StartSessionResponse {
  session_id: string;
  is_first_session: boolean;
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
export type EndReason = 'user_clicked' | 'voice_intent' | 'idle_timeout' | 'tab_close';

export interface CloseSessionResponse {
  session_id: string;
  /** AI-generated farewell text. Empty string on failure. */
  text: string;
  /** TTS audio base64. null on TTS failure. */
  audio_b64: string | null;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const sessionService = {
  start: async (): Promise<StartSessionResponse> => {
    log('POST /session/start');
    const res = await fetchWithAuth(`${API_BASE}/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('Failed to start session');
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

  streamGreetingAnon: async (): Promise<AsyncGenerator<GreetingEvent>> => {
    const dt = encodeURIComponent(new Date().toISOString());
    log('GET /session/greeting/stream');
    const res = await fetch(`${API_BASE}/session/greeting/stream?datetime=${dt}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`Greeting stream failed: ${res.status}`);
    async function* wrapped(): AsyncGenerator<GreetingEvent> {
      for await (const event of parseSSE<GreetingEvent>(res)) {
        log('greeting event ←', event.type === 'audio' ? { type: 'audio', audio_b64: '[base64]' } : event);
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
        log(`greeting event ←`, event.type === 'audio' ? { type: 'audio', audio_b64: '[base64]' } : event);
        yield event;
      }
    }
    return wrapped();
  },

  streamTurnText: async (sessionId: string, transcript: string): Promise<AsyncGenerator<TurnEvent>> => {
    log(`POST /turn/${sessionId}/stream-text`, { transcript: transcript.slice(0, 60) });
    const res = await fetch(`${API_BASE}/turn/${sessionId}/stream-text`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
        'X-Client-Datetime': new Date().toISOString(),
      },
      body: JSON.stringify({ transcript }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      log(`POST /turn/${sessionId}/stream-text → ERROR`, { status: res.status, body });
      throw new Error(`Turn text stream failed: ${res.status}`);
    }
    async function* wrapped(): AsyncGenerator<TurnEvent> {
      let audioChunkCount = 0;
      for await (const event of parseSSE<TurnEvent>(res)) {
        if (event.type === 'audio_chunk') {
          audioChunkCount++;
        } else {
          log(`turn-text event ←`, event.type === 'audio'
            ? { type: event.type, audio_b64: '[base64]', text: event.text }
            : event.type === 'audio_end'
              ? { type: event.type, chunks: audioChunkCount }
              : event);
        }
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
        log(`turn event ←`, event.type === 'audio' ? { type: 'audio', audio_b64: '[base64]' } : event);
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
   * Hard-end: marks session ended/abandoned + triggers consolidation.
   * Always call AFTER close() (or if closing fails).
   */
  end: async (sessionId: string, reason: EndReason = 'user_clicked'): Promise<void> => {
    log(`POST /session/end`, { session_id: sessionId, reason });
    await fetchWithAuth(`${API_BASE}/session/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, reason }),
    });
    log(`POST /session/end → ok`);
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
