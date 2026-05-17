export interface SessionSummary {
  id: string;
  title: string | null;
  status: string;
  startedAt: string;
}

export interface Session {
  id: string;
  title: string;
  status: 'active' | 'ended';
  pronunciation_score: number | null;
  created_at: string;
  updated_at: string;
}

export interface TurnData {
  user_text?: string;
  ai_text?: string;
  pronunciation_score?: number;
  audio_base64?: string;
}

export interface Turn {
  id: string;
  session_id: string;
  turn_index: number;
  data: TurnData;
  created_at: string;
}

export interface HistoryGroup {
  label: 'Today' | 'Yesterday' | 'Older Conversations';
  sessions: Session[];
}

// Unified segment event: one text segment + its complete TTS audio (MP3 base64).
// Used by both greeting and turn flows. Segments are emitted in order, but TTS
// runs in parallel server-side so first-audio latency stays low.
export interface SegmentEvent { type: 'segment'; text: string; audio_b64: string }

export type GreetingEvent =
  | SegmentEvent
  | { type: 'done'; greeting: string }
  | { type: 'error'; message: string };

export type TurnEvent =
  | { type: 'word'; text: string; is_final: boolean }
  | { type: 'transcript'; text: string }
  | { type: 'pronunciation'; data: { score?: number } }
  | SegmentEvent
  | { type: 'title'; text: string }
  | { type: 'done'; tokens_used: number }
  | { type: 'error'; message: string; limit?: number; used?: number };

export interface ChatMessage {
  role: 'ai' | 'user';
  text: string;
  sentences?: string[];
  pronunciationScore?: number;
  pending?: boolean;
  isHistoric?: boolean;
}

export interface TurnHistoryItem {
  id: string;
  turnIndex: number;
  transcript: string;
  responseText: string;
  pronunciationScore: number | null;
  createdAt: string;
}

export interface TurnHistoryPage {
  items: TurnHistoryItem[];
  total: number;
  page: number;
  hasMore: boolean;
}
