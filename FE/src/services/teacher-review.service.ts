import { httpClient } from '@/lib/http-client';

export type ReviewStatus = 'pending' | 'approved' | 'revised' | 'rejected';
export type ReviewDecision = 'approved' | 'revised' | 'rejected';

export type ReviewSkill =
  | 'task_completion'
  | 'grammar'
  | 'vocabulary'
  | 'pronunciation'
  | 'fluency';

export interface AudioTurn {
  id: string;
  turn_index: number | null;
  transcript: string | null;
  content_type: string;
  byte_size: number;
  duration_ms: number | null;
  created_at: string;
}

// A task handed out by GET /review-tasks/next (system-ordered, not self-picked).
export interface ReviewTask {
  review_id: string;
  lesson_attempt_id: string;
  task_status: string;
  task_type: string | null;
  priority: number;
  due_at: string | null;
  review_reason: string | null;
  assigned_to: string | null;
  student_id: string | null;
  lesson_id: string | null;
  level: string | null;
  topic: string | null;
  ai_score_snapshot: { ai_score?: number; breakdown?: Record<string, number> } | null;
  created_at: string;
  audio_turns?: AudioTurn[];
}

export interface SubmitReviewPayload {
  score_breakdown?: Partial<Record<ReviewSkill, number>>;
  final_score?: number;
  decision?: ReviewDecision;
  note?: string;
}

export type ReviewPeriod = 'day' | 'month' | 'year' | 'all';

export interface TeacherProfile {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface TeacherQueueSummary {
  assigned_open: number;
  pending_available: number;
  overdue: number;
  completed_today: number;
  completed_this_month: number;
  completed_this_year: number;
}

export interface TeacherStatsBucket {
  bucket: string;
  count: number;
}

export interface TeacherStats {
  daily: TeacherStatsBucket[];
  monthly: TeacherStatsBucket[];
  yearly: TeacherStatsBucket[];
  average_rating: number;
  rating_count: number;
  rating_distribution: Record<string, number>;
}

export interface TeacherHistoryItem {
  review_id: string;
  lesson_attempt_id: string;
  completed_at: string | null;
  reviewed_at: string | null;
  task_type: string | null;
  decision: string;
  final_score: number | null;
  human_score: number | null;
  note: string | null;
  student: { id: string; name: string; email: string } | null;
  lesson: { id: string; title: string; level: string; topic: string } | null;
  rating: number | null;
  rating_comment: string | null;
}

export interface TeacherFeedbackItem {
  review_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
  student: { id: string; name: string; email: string } | null;
  lesson: { id: string; title: string; level: string; topic: string } | null;
}

export interface TeacherDashboard {
  teacher: TeacherProfile | null;
  queue: TeacherQueueSummary;
  stats: TeacherStats;
  recent_history: TeacherHistoryItem[];
  recent_feedback: TeacherFeedbackItem[];
}

export interface Paged<T> {
  total: number;
  page: number;
  limit: number;
  items: T[];
}

function qs(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

// Canonical reviewer workflow: get the next assigned task, claim it, submit a
// human score. Reviewers don't browse/cherry-pick from a full queue.
export const reviewTaskService = {
  next: (): Promise<{ task: ReviewTask | null }> =>
    httpClient.get<{ task: ReviewTask | null }>('/review-tasks/next'),

  assign: (id: string): Promise<ReviewTask> =>
    httpClient.post<ReviewTask>(`/review-tasks/${id}/assign`, {}),

  submit: (id: string, payload: SubmitReviewPayload) =>
    httpClient.post<{
      review_id: string;
      task_status: string;
      decision: ReviewDecision;
      final_score: number | null;
      attempt_status: string;
      scoring_status: string;
    }>(`/review-tasks/${id}/submit`, payload),

  escalate: (id: string, reason: string) =>
    httpClient.post(`/review-tasks/${id}/escalate`, { reason }),

  // Short-lived signed playback URL for a saved user-audio turn.
  audioPlayUrl: (turnAudioId: string): Promise<{ url: string; content_type: string }> =>
    httpClient.get<{ url: string; content_type: string }>(`/turn-audio/${turnAudioId}/play-url`),

  // ── Teacher dashboard ──────────────────────────────────────────────────────
  dashboard: (): Promise<TeacherDashboard> =>
    httpClient.get<TeacherDashboard>('/review-tasks/dashboard'),

  history: (params: { period?: ReviewPeriod; page?: number; limit?: number } = {}): Promise<Paged<TeacherHistoryItem>> =>
    httpClient.get<Paged<TeacherHistoryItem>>(`/review-tasks/history${qs(params)}`),

  feedback: (params: { period?: ReviewPeriod; page?: number; limit?: number } = {}): Promise<Paged<TeacherFeedbackItem>> =>
    httpClient.get<Paged<TeacherFeedbackItem>>(`/review-tasks/feedback${qs(params)}`),

  stats: (): Promise<TeacherStats> => httpClient.get<TeacherStats>('/review-tasks/stats'),
};
