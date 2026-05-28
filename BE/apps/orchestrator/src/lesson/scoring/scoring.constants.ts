// Hybrid Scoring + Mastery Path constants. All thresholds/SLA/weights live here
// so the decision logic stays free of magic numbers.

// Lifecycle of a lesson attempt's score.
export enum ScoringStatus {
  SUBMITTED = 'submitted',
  AI_SCORED = 'ai_scored',
  NEEDS_REVIEW = 'needs_review',
  HUMAN_SCORED = 'human_scored',
  FINALIZED = 'finalized',
  DISPUTED = 'disputed',
}

// What kind of gate a lesson is. Drives the review decision + mastery weight.
export enum TaskType {
  PRACTICE = 'practice',
  CHECKPOINT = 'checkpoint',
  LEVEL_FINAL = 'level_final',
}

// Workflow state of a human-review task (separate axis from the review
// *decision* which stays on TeacherReview.status: approved/revised/rejected).
export enum ReviewTaskStatus {
  PENDING = 'pending',
  ASSIGNED = 'assigned',
  COMPLETED = 'completed',
  ESCALATED = 'escalated',
  CANCELLED = 'cancelled',
}

// Skills tracked for mastery + score breakdown.
export enum SkillKey {
  TASK_COMPLETION = 'task_completion',
  GRAMMAR = 'grammar',
  VOCABULARY = 'vocabulary',
  PRONUNCIATION = 'pronunciation',
  FLUENCY = 'fluency',
}

export const ALL_SKILLS: SkillKey[] = [
  SkillKey.TASK_COMPLETION,
  SkillKey.GRAMMAR,
  SkillKey.VOCABULARY,
  SkillKey.PRONUNCIATION,
  SkillKey.FLUENCY,
];

// Reasons an attempt is routed to a human. Stored on review_reason / review task.
export enum ReviewReason {
  LOW_CONFIDENCE = 'low_confidence',
  LOW_TRANSCRIPT_QUALITY = 'low_transcript_quality',
  LOW_AUDIO_QUALITY = 'low_audio_quality',
  NEAR_THRESHOLD = 'near_threshold',
  TASK_COMPLETION_FAIL = 'task_completion_fail',
  ANSWER_TOO_SHORT = 'answer_too_short',
  LEVEL_FINAL = 'level_final',
  DISPUTE = 'dispute',
  LEARNER_REQUESTED = 'learner_requested',
}

// Risk thresholds (0..1 quality/confidence; 0..100 scores).
export const MIN_AI_CONFIDENCE = 0.7;
export const MIN_TRANSCRIPT_QUALITY = 0.6;
export const MIN_AUDIO_QUALITY = 0.6;
// How close (in points) to the pass score counts as "near threshold".
export const NEAR_THRESHOLD_BAND = 5;
export const MIN_TASK_COMPLETION = 50;
// A finalized skill below this floor blocks unlocking the next node.
export const CRITICAL_SKILL_FLOOR = 40;

// Review SLA in hours, by task type / dispute.
export const SLA_HOURS = {
  [TaskType.CHECKPOINT]: 6,
  [TaskType.LEVEL_FINAL]: 24,
  dispute: 48,
} as const;

// Mastery weight per task type — practice nudges, level-final dominates.
export const MASTERY_WEIGHT: Record<TaskType, number> = {
  [TaskType.PRACTICE]: 1,
  [TaskType.CHECKPOINT]: 3,
  [TaskType.LEVEL_FINAL]: 5,
};

// Queue priority per task type — higher is reviewed first.
export const TASK_PRIORITY: Record<TaskType, number> = {
  [TaskType.PRACTICE]: 0,
  [TaskType.CHECKPOINT]: 5,
  [TaskType.LEVEL_FINAL]: 10,
};
