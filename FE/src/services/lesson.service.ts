import { httpClient } from '@/lib/http-client';

export type LessonState = 'locked' | 'unlocked' | 'in_progress' | 'completed' | 'needs_retry';

export interface LessonPathItem {
  lesson_id: string;
  title: string;
  level: string;
  topic: string;
  unit: string;
  order_index: number;
  objective: string;
  is_review: boolean;
  pass_score: number;
  state: LessonState;
  best_score: number | null;
  last_attempt_id: string | null;
  next_lesson_id: string | null;
}

export interface LessonGroup {
  level: string;
  topic: string;
  unit: string;
  lessons: LessonPathItem[];
}

export interface LessonPath {
  continue_lesson: LessonPathItem | null;
  recommended_lesson: LessonPathItem | null;
  groups: LessonGroup[];
}

export interface LessonDetailCard {
  id: string;
  order_index: number;
  type: string;
  title: string;
  task_preview: string;
  expected_duration_seconds: number;
  is_personalized?: boolean;
}

export interface LessonDetail {
  lesson: {
    id: string;
    title: string;
    level: string;
    topic: string;
    unit: string;
    order_index: number;
    objective: string;
    mini_plan_text: string;
    pass_score: number;
    is_review: boolean;
    next_lesson_id: string | null;
  };
  cards: LessonDetailCard[];
  progress: {
    state: LessonState;
    best_score: number | null;
    last_attempt_id: string | null;
  };
  in_progress_attempt_id: string | null;
  personalized?: boolean;
}

export interface StartLessonResponse {
  session_id: string;
  lesson_attempt_id: string;
  lesson: {
    id: string;
    title: string;
    objective: string;
    pass_score: number;
    mini_plan_text: string;
  };
  deck_summary: { cards: number; mission: string };
}

export type LessonAttemptStatus =
  | 'in_progress'
  | 'passed'
  | 'needs_retry'
  | 'failed'
  | 'abandoned';

export type LessonNextAction =
  | 'next_lesson'
  | 'retry_lesson'
  | 'remedial_drill'
  | 'continue_later'
  | 'none';

export type TeacherReviewStatusOnAttempt =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'revised'
  | 'rejected';

export interface LessonAttemptResult {
  attempt: {
    id: string;
    lesson_id: string;
    session_id: string | null;
    status: LessonAttemptStatus;
    score: number | null;
    next_action: LessonNextAction;
    teacher_review_status: TeacherReviewStatusOnAttempt;
    ai_feedback: Record<string, unknown> | null;
    started_at: string;
    completed_at: string | null;
  };
  lesson: {
    id: string;
    title: string;
    level: string;
    topic: string;
    unit: string;
    pass_score: number;
    next_lesson_id: string | null;
  } | null;
  cards: Array<{
    id: string;
    lesson_card_id: string | null;
    runtime_card_id: string;
    status: 'not_started' | 'completed' | 'skipped';
    result: 'passed' | 'failed' | null;
    attempts: number;
    score: number | null;
    feedback: string | null;
  }>;
  stats: { cards_completed: number; cards_total: number };
  teacher_review: {
    id: string;
    status: 'pending' | 'approved' | 'revised' | 'rejected';
    final_score: number | null;
    comment: string | null;
    reviewed_at: string | null;
  } | null;
}

export const lessonService = {
  getPath: () => httpClient.get<LessonPath>('/lessons/path'),
  getDetail: (id: string) => httpClient.get<LessonDetail>(`/lessons/${id}`),
  start: (id: string) =>
    httpClient.post<StartLessonResponse>(`/lessons/${id}/start`, {}),
  getAttempt: (attemptId: string) =>
    httpClient.get<LessonAttemptResult>(`/lessons/attempts/${attemptId}`),
};
