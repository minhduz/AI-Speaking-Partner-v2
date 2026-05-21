export interface SessionSummary {
  id: string;
  title: string | null;
  status: string;
  startedAt: string;
  /** 'guided_learning' (deck + eval) or 'free_talk' (open conversation). */
  mode?: 'guided_learning' | 'free_talk';
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

// Deck-evaluation event emitted by the turn-agent when a deck is active.
// `data` mirrors the JSON the LLM produces after `EVAL:`; FE uses it to update
// the current card's status/feedback/next_action optimistically.
export interface DeckEvalEvent {
  type: 'eval';
  card_index: number;
  data: {
    passed: boolean;
    feedback: string;
    retryRecommended: boolean;
    nextAction: 'retry' | 'next_card' | 'finish_session';
    detectedIssues: string[];
  };
}

export type TurnEvent =
  | { type: 'word'; text: string; is_final: boolean }
  | { type: 'transcript'; text: string }
  | { type: 'pronunciation'; data: { score?: number } }
  | SegmentEvent
  | DeckEvalEvent
  | { type: 'title'; text: string }
  | { type: 'session_ended' }
  | { type: 'deck_new_topic'; topic: string }
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
