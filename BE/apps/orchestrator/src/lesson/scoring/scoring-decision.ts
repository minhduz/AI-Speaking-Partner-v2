// Pure, dependency-free scoring decision logic. No DB, no Nest — unit-testable.
import {
  ALL_SKILLS,
  CRITICAL_SKILL_FLOOR,
  MIN_AI_CONFIDENCE,
  MIN_AUDIO_QUALITY,
  MIN_TASK_COMPLETION,
  MIN_TRANSCRIPT_QUALITY,
  NEAR_THRESHOLD_BAND,
  ReviewReason,
  ScoringStatus,
  SkillKey,
  TASK_PRIORITY,
  TaskType,
} from './scoring.constants';

export interface ScoringSignals {
  taskType: TaskType;
  aiScore: number; // 0..100
  passScore: number; // 0..100
  taskCompletion: number; // 0..100
  aiConfidence: number; // 0..1
  transcriptQuality: number; // 0..1
  audioQuality: number; // 0..1
  answerTooShort?: boolean;
  disputeRequested?: boolean;
}

export interface ScoringDecision {
  autoFinalize: boolean;
  reviewRequired: boolean;
  reviewReasons: ReviewReason[];
  scoringStatus: ScoringStatus;
  // Quality too low to trust any score → ask the learner to resubmit; don't
  // finalize and don't open a human review (nothing to review yet).
  qualityResubmit: boolean;
}

/**
 * Collect every reason an attempt would need a human. Level-final ALWAYS needs
 * review. Practice never does (handled by the caller — practice auto-finalizes
 * regardless). Checkpoints are risk-gated.
 */
export function requiresHumanReview(s: ScoringSignals): {
  required: boolean;
  reasons: ReviewReason[];
} {
  const reasons: ReviewReason[] = [];

  if (s.taskType === TaskType.LEVEL_FINAL) reasons.push(ReviewReason.LEVEL_FINAL);
  if (s.disputeRequested) reasons.push(ReviewReason.DISPUTE);
  if (s.aiConfidence < MIN_AI_CONFIDENCE) reasons.push(ReviewReason.LOW_CONFIDENCE);
  if (s.transcriptQuality < MIN_TRANSCRIPT_QUALITY) reasons.push(ReviewReason.LOW_TRANSCRIPT_QUALITY);
  if (s.audioQuality < MIN_AUDIO_QUALITY) reasons.push(ReviewReason.LOW_AUDIO_QUALITY);
  if (Math.abs(s.aiScore - s.passScore) <= NEAR_THRESHOLD_BAND) reasons.push(ReviewReason.NEAR_THRESHOLD);
  if (s.taskCompletion < MIN_TASK_COMPLETION) reasons.push(ReviewReason.TASK_COMPLETION_FAIL);
  if (s.answerTooShort) reasons.push(ReviewReason.ANSWER_TOO_SHORT);

  return { required: reasons.length > 0, reasons };
}

/**
 * Decide what happens to an attempt right after AI scoring.
 * - practice: auto-finalize, never gates a level.
 * - level_final: always NEEDS_REVIEW; ai_score must NOT become final.
 * - checkpoint: auto-finalize only if no risk reason fires.
 * Quality so low it can't be trusted (transcript/audio) → qualityResubmit.
 */
export function decideScoringOutcome(s: ScoringSignals): ScoringDecision {
  // Low quality normally means "resubmit", but a LEVEL_FINAL must ALWAYS go to
  // a human (bad audio on a level gate is itself something a teacher inspects),
  // so it never takes the resubmit bypass.
  const qualityResubmit =
    s.taskType !== TaskType.LEVEL_FINAL &&
    (s.transcriptQuality < MIN_TRANSCRIPT_QUALITY || s.audioQuality < MIN_AUDIO_QUALITY);

  if (s.taskType === TaskType.PRACTICE) {
    // Practice is feedback-only; even on poor quality we just resubmit, never
    // open a human review for practice.
    if (qualityResubmit) {
      return {
        autoFinalize: false,
        reviewRequired: false,
        reviewReasons: [],
        scoringStatus: ScoringStatus.AI_SCORED,
        qualityResubmit: true,
      };
    }
    return {
      autoFinalize: true,
      reviewRequired: false,
      reviewReasons: [],
      scoringStatus: ScoringStatus.FINALIZED,
      qualityResubmit: false,
    };
  }

  const { required, reasons } = requiresHumanReview(s);

  if (required) {
    return {
      autoFinalize: false,
      reviewRequired: true,
      reviewReasons: reasons,
      scoringStatus: ScoringStatus.NEEDS_REVIEW,
      qualityResubmit,
    };
  }

  // Checkpoint with no risk → safe to auto-finalize.
  return {
    autoFinalize: true,
    reviewRequired: false,
    reviewReasons: [],
    scoringStatus: ScoringStatus.FINALIZED,
    qualityResubmit: false,
  };
}

/**
 * Whether a finalized attempt is allowed to unlock the next node: must pass the
 * lesson, complete the task, and have no critical skill below the floor.
 */
export function canUnlockNext(input: {
  finalScore: number;
  passScore: number;
  taskCompletion: number;
  skillScores: Record<string, number>;
}): boolean {
  if (input.finalScore < input.passScore) return false;
  if (input.taskCompletion < MIN_TASK_COMPLETION) return false;
  const anyCriticalFail = Object.values(input.skillScores).some(
    (v) => typeof v === 'number' && v < CRITICAL_SKILL_FLOOR,
  );
  return !anyCriticalFail;
}

export type LessonOutcomeStatus = 'passed' | 'needs_retry' | 'failed';
export type LessonBlockReason = 'below_pass_score' | 'task_completion' | 'critical_skill' | null;

export interface LessonOutcome {
  status: LessonOutcomeStatus;
  unlock: boolean;
  blockReason: LessonBlockReason;
}

/**
 * Single source of truth for whether a finalized attempt passes + unlocks the
 * next node. Decided by final_score + task_completion + per-skill floors —
 * NOT by the last card's pass/fail (that was a hidden gate that wrongly held
 * back attempts whose final_score already cleared the pass score). Pure +
 * testable; used by BOTH the AI auto-finalize and human-review paths.
 *
 * `breakdown` keys are the five SkillKey values plus an optional `total`; only
 * the five real skills are checked for critical failure (never `total`).
 */
export function computeLessonOutcome(input: {
  finalScore: number;
  passScore: number;
  breakdown: Record<string, number>;
}): LessonOutcome {
  const { finalScore, passScore, breakdown } = input;
  const taskCompletion = breakdown[SkillKey.TASK_COMPLETION] ?? 0;
  const taskOk = taskCompletion >= MIN_TASK_COMPLETION;
  const criticalSkillFail = ALL_SKILLS.some(
    (s) => typeof breakdown[s] === 'number' && (breakdown[s] as number) < CRITICAL_SKILL_FLOOR,
  );

  if (finalScore < passScore) {
    // Below the pass mark — retry if salvageable, otherwise a full fail.
    return {
      status: finalScore >= 50 ? 'needs_retry' : 'failed',
      unlock: false,
      blockReason: 'below_pass_score',
    };
  }
  // final_score >= pass_score from here.
  if (!taskOk) {
    return { status: 'needs_retry', unlock: false, blockReason: 'task_completion' };
  }
  if (criticalSkillFail) {
    return { status: 'needs_retry', unlock: false, blockReason: 'critical_skill' };
  }
  // Cleared score, task completion, and every skill floor → pass + unlock,
  // regardless of whether the final card itself was partial/failed.
  return { status: 'passed', unlock: true, blockReason: null };
}

/** Human-readable reason a finalized attempt did not pass/unlock (for the UI). */
export function lessonRetryReasonText(reason: LessonBlockReason): string | null {
  switch (reason) {
    case 'below_pass_score':
      return 'Score is below the pass mark.';
    case 'task_completion':
      return 'Task completion is below the required level.';
    case 'critical_skill':
      return 'One skill still needs more practice.';
    default:
      return null;
  }
}

// ── Review queue ordering ────────────────────────────────────────────────────

export interface ReviewTaskOrderInput {
  priority: number;
  taskType: TaskType;
  dueAt: Date | string | null;
  createdAt: Date | string;
}

function ms(d: Date | string | null, fallback: number): number {
  if (!d) return fallback;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : fallback;
}

/**
 * Comparator for getNextReviewTask: priority DESC, then level_final first,
 * then earliest due_at, then oldest created_at. Returns <0 if a should come
 * before b. Pure so it can be unit-tested.
 */
export function compareReviewTasks(a: ReviewTaskOrderInput, b: ReviewTaskOrderInput): number {
  if (a.priority !== b.priority) return b.priority - a.priority;

  const aFinal = a.taskType === TaskType.LEVEL_FINAL ? 0 : 1;
  const bFinal = b.taskType === TaskType.LEVEL_FINAL ? 0 : 1;
  if (aFinal !== bFinal) return aFinal - bFinal;

  const aDue = ms(a.dueAt, Number.MAX_SAFE_INTEGER);
  const bDue = ms(b.dueAt, Number.MAX_SAFE_INTEGER);
  if (aDue !== bDue) return aDue - bDue;

  return ms(a.createdAt, 0) - ms(b.createdAt, 0);
}

// Re-export so callers can reference priority mapping without a second import.
export { TASK_PRIORITY };
