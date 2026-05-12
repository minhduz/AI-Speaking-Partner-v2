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

export type GreetingEvent =
  | { type: 'text'; chunk: string }
  | { type: 'audio'; audio_b64: string; text?: string }
  | { type: 'done'; greeting: string }
  | { type: 'error'; message: string };

export type TurnEvent =
  | { type: 'transcript'; text: string }
  | { type: 'pronunciation'; data: { score?: number } }
  | { type: 'text'; chunk: string }
  | { type: 'audio'; audio_b64: string; text?: string }
  | { type: 'title'; text: string }
  | { type: 'quota_warning'; percent_used: number; upgrade_url: string }
  | { type: 'done'; tokens_used: number }
  | { type: 'error'; message: string };

export interface QuotaWarning {
  percent_used: number;
  upgrade_url: string;
}

export interface ChatMessage {
  role: 'ai' | 'user';
  text: string;
  sentences?: string[];
  pronunciationScore?: number;
  pending?: boolean;
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
