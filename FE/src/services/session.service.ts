import { getAccessToken } from '@/lib/http-client';
import type { GreetingEvent, SessionSummary, TurnHistoryPage } from '@/types/session.types';

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

export type TurnEvent =
  | { type: 'transcript'; text: string }
  | { type: 'pronunciation'; data: { score?: number; [key: string]: unknown } }
  | { type: 'text'; chunk: string }
  | { type: 'audio'; audio_b64: string; text?: string }
  | { type: 'title'; text: string }
  | { type: 'quota_warning'; percent_used: number; upgrade_url: string }
  | { type: 'done'; tokens_used: number }
  | { type: 'error'; message: string };

export const sessionService = {
  start: async (): Promise<{ session_id: string }> => {
    log('POST /session/start');
    const res = await fetch(`${API_BASE}/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!res.ok) throw new Error('Failed to start session');
    const data = await res.json();
    log('POST /session/start →', data);
    return data;
  },

  streamGreetingAnon: async (): Promise<AsyncGenerator<GreetingEvent>> => {
    log('GET /session/greeting/stream');
    const res = await fetch(`${API_BASE}/session/greeting/stream`, {
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

  list: async (page: number, limit = 25): Promise<{ items: SessionSummary[]; total: number; hasMore: boolean }> => {
    log(`GET /session/list page=${page}`);
    const res = await fetch(`${API_BASE}/session/list?page=${page}&limit=${limit}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch sessions');
    return res.json();
  },

  streamGreeting: async (sessionId: string): Promise<AsyncGenerator<GreetingEvent>> => {
    log(`GET /session/${sessionId}/greeting/stream`);
    const res = await fetch(`${API_BASE}/session/${sessionId}/greeting/stream`, {
      headers: authHeaders(),
    });
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

  streamTurn: async (sessionId: string, audioBlob: Blob): Promise<AsyncGenerator<TurnEvent>> => {
    log(`POST /turn/${sessionId}/stream`, { blobSize: audioBlob.size, type: audioBlob.type });
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

    const res = await fetch(`${API_BASE}/turn/${sessionId}/stream`, {
      method: 'POST',
      headers: authHeaders(),
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
    const res = await fetch(`${API_BASE}/turn/${sessionId}`, {
      method: 'POST',
      headers: authHeaders(),
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
    await fetch(`${API_BASE}/session/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ session_id: sessionId }),
    });
    log(`POST /session/end → ok`);
  },
};
