import { httpClient } from '@/lib/http-client';

<<<<<<< HEAD
export type LessonState = 'locked' | 'unlocked' | 'in_progress' | 'under_review' | 'completed' | 'needs_retry';
=======
export type LessonState = 'locked' | 'unlocked' | 'in_progress' | 'completed' | 'needs_retry';
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)

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
<<<<<<< HEAD
  | 'under_review'
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
  | 'passed'
  | 'needs_retry'
  | 'failed'
  | 'abandoned';

<<<<<<< HEAD
export type ScoringStatus =
  | 'submitted'
  | 'ai_scored'
  | 'needs_review'
  | 'human_scored'
  | 'finalized'
  | 'disputed';

export type NodeStatus =
  | 'submitted'
  | 'under_review'
  | 'passed'
  | 'needs_practice'
  | 'retry_required';

=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
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

<<<<<<< HEAD
export type SkillBreakdown = Record<string, number>;

/** The AI's fast-feedback scoring view for an attempt. */
export interface AiReview {
  score: number | null;
  breakdown: SkillBreakdown | null;
  feedback: Record<string, unknown> | null;
  scoring_status: ScoringStatus;
  finalized_at: string | null;
}

export type TeacherReviewState =
  | 'not_requested'
  | 'pending'
  | 'assigned'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'escalated';

/** The optional human-review scoring view. `breakdown`/`score` are populated
 *  ONLY when a teacher has completed the review — never from the AI. */
export interface TeacherReviewView {
  id: string | null;
  review_id: string | null;
  requested: boolean;
  status: TeacherReviewState;
  task_status: string | null;
  decision: 'pending' | 'approved' | 'revised' | 'rejected' | null;
  assigned_teacher: { id: string; name: string; email: string } | null;
  reviewed_by: { id: string; name: string; email: string } | null;
  score: number | null;
  final_score: number | null;
  breakdown: SkillBreakdown | null;
  note: string | null;
  comment: string | null;
  review_reason: string | null;
  requested_at: string | null;
  created_at: string | null;
  completed_at: string | null;
  reviewed_at: string | null;
  /** The viewing student's own rating on this completed review, if any. */
  feedback: TeacherReviewFeedback | null;
}

export interface TeacherReviewFeedback {
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
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
<<<<<<< HEAD
    // Hybrid Scoring lifecycle
    scoring_status: ScoringStatus;
    review_required: boolean;
    review_reason: string | null;
    ai_score: number | null;
    final_score: number | null;
    final_score_breakdown: Record<string, number> | null;
    finalized_at: string | null;
    node_status: NodeStatus;
    /** Why a finalized attempt didn't pass/unlock (null when passed). */
    retry_reason: string | null;
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
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
<<<<<<< HEAD
  ai_review: AiReview;
  teacher_review: TeacherReviewView;
=======
  teacher_review: {
    id: string;
    status: 'pending' | 'approved' | 'revised' | 'rejected';
    final_score: number | null;
    comment: string | null;
    reviewed_at: string | null;
  } | null;
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
}

export const lessonService = {
  getPath: () => httpClient.get<LessonPath>('/lessons/path'),
  getDetail: (id: string) => httpClient.get<LessonDetail>(`/lessons/${id}`),
  start: (id: string) =>
    httpClient.post<StartLessonResponse>(`/lessons/${id}/start`, {}),
  getAttempt: (attemptId: string) =>
    httpClient.get<LessonAttemptResult>(`/lessons/attempts/${attemptId}`),
<<<<<<< HEAD
  requestTeacherReview: (attemptId: string) =>
    httpClient.post<{
      review_id: string;
      status: 'created' | 'already_open';
      task_status: string;
      attempt_status: LessonAttemptStatus;
      scoring_status: ScoringStatus;
      node_status: NodeStatus;
    }>(
      `/lessons/attempts/${attemptId}/request-review`,
      {},
    ),
  // Learner rates a completed teacher review (1..5 + optional comment). Upsert.
  submitReviewFeedback: (reviewId: string, payload: { rating: number; comment?: string }) =>
    httpClient.post<{
      review_id: string;
      rating: number;
      comment: string | null;
      created_at: string;
      updated_at: string;
    }>(`/lessons/reviews/${reviewId}/feedback`, payload),
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
};
