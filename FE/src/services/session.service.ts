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

export interface TurnResult {
  turn_id: string;
  transcript: string;
  confidence: number;
  pronunciation: { score?: number; [key: string]: unknown } | null;
  response_text: string;
  audio_b64: string;
  tokens_used: number;
}

export const sessionService = {
  start: async (): Promise<{ session_id: string }> => {
    log('POST /session/start');
    const res = await fetchWithAuth(`${API_BASE}/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('Failed to start session');
    const data = await res.json();
    log('POST /session/start →', data);
    return data;
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
        log('greeting event ←', event.type === 'segment' ? { type: 'segment', text: event.text, audio_b64: '[base64]' } : event);
        yield event;
      }
    }
    return wrapped();
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

  end: async (sessionId: string): Promise<void> => {
    log(`POST /session/end`, { session_id: sessionId });
    await fetchWithAuth(`${API_BASE}/session/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    log(`POST /session/end → ok`);
  },

  // Fire-and-forget version that survives tab close / page unload.
  // Uses keepalive:true so the browser keeps the request alive after the page is gone.
  endBeacon: (sessionId: string): void => {
    const token = getAccessToken();
    fetch(`${API_BASE}/session/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ session_id: sessionId }),
      keepalive: true,
    }).catch(() => {});
  },
};
