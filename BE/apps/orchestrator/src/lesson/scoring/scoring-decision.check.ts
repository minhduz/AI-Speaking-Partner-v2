// Zero-dependency tests for the pure scoring decision logic. The orchestrator
// has no jest; this uses Node's built-in test runner. After `nest build`, run:
//   node dist/lesson/scoring/scoring-decision.check.js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  decideScoringOutcome,
  requiresHumanReview,
  canUnlockNext,
  compareReviewTasks,
  computeLessonOutcome,
  lessonRetryReasonText,
  type ScoringSignals,
} from './scoring-decision';
import { ScoringStatus, TaskType, ReviewReason, SkillKey } from './scoring.constants';

// Helper: a full 5-skill breakdown all at `v`, with task_completion overridable.
function breakdown(v: number, taskCompletion = v) {
  return {
    [SkillKey.TASK_COMPLETION]: taskCompletion,
    [SkillKey.GRAMMAR]: v,
    [SkillKey.VOCABULARY]: v,
    [SkillKey.PRONUNCIATION]: v,
    [SkillKey.FLUENCY]: v,
    total: v,
  };
}

const good: Omit<ScoringSignals, 'taskType' | 'aiScore'> = {
  passScore: 70,
  taskCompletion: 90,
  aiConfidence: 0.95,
  transcriptQuality: 0.95,
  audioQuality: 0.95,
};

test('practice auto-finalizes', () => {
  const d = decideScoringOutcome({ ...good, taskType: TaskType.PRACTICE, aiScore: 85 });
  assert.equal(d.autoFinalize, true);
  assert.equal(d.reviewRequired, false);
  assert.equal(d.scoringStatus, ScoringStatus.FINALIZED);
});

test('checkpoint high-confidence, score far from pass → auto-finalize', () => {
  const d = decideScoringOutcome({ ...good, taskType: TaskType.CHECKPOINT, aiScore: 90 });
  assert.equal(d.autoFinalize, true);
  assert.equal(d.reviewRequired, false);
});

test('checkpoint near threshold → NEEDS_REVIEW', () => {
  const d = decideScoringOutcome({ ...good, taskType: TaskType.CHECKPOINT, aiScore: 72 });
  assert.equal(d.autoFinalize, false);
  assert.equal(d.reviewRequired, true);
  assert.equal(d.scoringStatus, ScoringStatus.NEEDS_REVIEW);
  assert.ok(d.reviewReasons.includes(ReviewReason.NEAR_THRESHOLD));
});

test('checkpoint low confidence → NEEDS_REVIEW', () => {
  const d = decideScoringOutcome({
    ...good,
    taskType: TaskType.CHECKPOINT,
    aiScore: 90,
    aiConfidence: 0.4,
  });
  assert.equal(d.reviewRequired, true);
  assert.ok(d.reviewReasons.includes(ReviewReason.LOW_CONFIDENCE));
});

test('level_final always NEEDS_REVIEW, never auto-finalize', () => {
  const d = decideScoringOutcome({ ...good, taskType: TaskType.LEVEL_FINAL, aiScore: 95 });
  assert.equal(d.autoFinalize, false);
  assert.equal(d.reviewRequired, true);
  assert.ok(d.reviewReasons.includes(ReviewReason.LEVEL_FINAL));
});

test('checkpoint low transcript/audio quality → qualityResubmit', () => {
  const d = decideScoringOutcome({
    ...good,
    taskType: TaskType.CHECKPOINT,
    aiScore: 90,
    transcriptQuality: 0.3,
  });
  assert.equal(d.qualityResubmit, true);
});

test('level_final with low quality still NEEDS_REVIEW (never resubmit)', () => {
  const d = decideScoringOutcome({
    ...good,
    taskType: TaskType.LEVEL_FINAL,
    aiScore: 90,
    transcriptQuality: 0.2,
    audioQuality: 0.2,
  });
  assert.equal(d.qualityResubmit, false);
  assert.equal(d.reviewRequired, true);
  assert.equal(d.autoFinalize, false);
  assert.ok(d.reviewReasons.includes(ReviewReason.LEVEL_FINAL));
});

test('requiresHumanReview collects task_completion fail', () => {
  const r = requiresHumanReview({
    ...good,
    taskType: TaskType.CHECKPOINT,
    aiScore: 90,
    taskCompletion: 10,
  });
  assert.equal(r.required, true);
  assert.ok(r.reasons.includes(ReviewReason.TASK_COMPLETION_FAIL));
});

test('canUnlockNext blocks on critical skill failure', () => {
  const base = {
    finalScore: 85,
    passScore: 70,
    taskCompletion: 90,
    skillScores: { [SkillKey.GRAMMAR]: 85, [SkillKey.PRONUNCIATION]: 85 },
  };
  assert.equal(canUnlockNext(base), true);
  assert.equal(
    canUnlockNext({ ...base, skillScores: { ...base.skillScores, [SkillKey.PRONUNCIATION]: 20 } }),
    false,
  );
});

test('compareReviewTasks: priority desc, then level_final first, then due', () => {
  const now = Date.now();
  const hi = { priority: 10, taskType: TaskType.LEVEL_FINAL, dueAt: new Date(now + 1000), createdAt: new Date(now) };
  const lo = { priority: 5, taskType: TaskType.CHECKPOINT, dueAt: new Date(now), createdAt: new Date(now) };
  assert.ok(compareReviewTasks(hi, lo) < 0); // hi priority wins

  const a = { priority: 5, taskType: TaskType.LEVEL_FINAL, dueAt: new Date(now + 5000), createdAt: new Date(now) };
  const b = { priority: 5, taskType: TaskType.CHECKPOINT, dueAt: new Date(now + 5000), createdAt: new Date(now) };
  assert.ok(compareReviewTasks(a, b) < 0); // level_final before checkpoint at equal priority

  const c = { priority: 5, taskType: TaskType.CHECKPOINT, dueAt: new Date(now + 1000), createdAt: new Date(now) };
  const dd = { priority: 5, taskType: TaskType.CHECKPOINT, dueAt: new Date(now + 9000), createdAt: new Date(now) };
  assert.ok(compareReviewTasks(c, dd) < 0); // earlier due first
});

// ── computeLessonOutcome: pass/unlock by score + task_completion + skills,
//    NOT by the last card (the bug: final_score 74 ≥ 70 but Needs retry). ──

test('lesson passes when final_score >= pass even if last card failed', () => {
  // 3/4 cards passed → task_completion 75; final 74; all skills 74.
  const o = computeLessonOutcome({ finalScore: 74, passScore: 70, breakdown: breakdown(74, 75) });
  assert.equal(o.status, 'passed');
  assert.equal(o.unlock, true);
  assert.equal(o.blockReason, null);
});

test('lesson passes at minimum task_completion threshold', () => {
  const o = computeLessonOutcome({ finalScore: 74, passScore: 70, breakdown: breakdown(74, 50) });
  assert.equal(o.status, 'passed');
  assert.equal(o.unlock, true);
});

test('lesson needs_retry when task_completion below threshold', () => {
  const o = computeLessonOutcome({ finalScore: 74, passScore: 70, breakdown: breakdown(74, 30) });
  assert.equal(o.status, 'needs_retry');
  assert.equal(o.unlock, false);
  assert.equal(o.blockReason, 'task_completion');
  assert.equal(lessonRetryReasonText(o.blockReason), 'Task completion is below the required level.');
});

test('lesson needs_retry when a critical skill is below the floor', () => {
  const bd = { ...breakdown(74, 75), [SkillKey.PRONUNCIATION]: 20 };
  const o = computeLessonOutcome({ finalScore: 74, passScore: 70, breakdown: bd });
  assert.equal(o.status, 'needs_retry');
  assert.equal(o.unlock, false);
  assert.equal(o.blockReason, 'critical_skill');
});

test('below pass score → needs_retry (>=50) or failed (<50)', () => {
  const a = computeLessonOutcome({ finalScore: 69, passScore: 70, breakdown: breakdown(69, 75) });
  assert.equal(a.status, 'needs_retry');
  assert.equal(a.blockReason, 'below_pass_score');

  const b = computeLessonOutcome({ finalScore: 40, passScore: 70, breakdown: breakdown(40, 75) });
  assert.equal(b.status, 'failed');
  assert.equal(b.unlock, false);
});

test('total key is ignored for critical-skill check', () => {
  // total below floor must NOT block when the five real skills are fine.
  const bd = { ...breakdown(74, 75), total: 10 };
  const o = computeLessonOutcome({ finalScore: 74, passScore: 70, breakdown: bd });
  assert.equal(o.status, 'passed');
});
