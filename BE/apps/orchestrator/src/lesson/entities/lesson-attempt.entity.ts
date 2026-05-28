import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export type LessonAttemptStatus =
  | 'in_progress'
  | 'under_review'
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

@Entity({ schema: 'speaking_app', name: 'lesson_attempts' })
export class LessonAttempt {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'lesson_id' }) lessonId: string;
  @Column({ name: 'session_id', type: 'uuid', nullable: true }) sessionId: string | null;
  @Column({ default: 'in_progress' }) status: LessonAttemptStatus;
  @Column({ type: 'int', nullable: true }) score: number | null;
  @Column({ name: 'ai_feedback', type: 'jsonb', nullable: true }) aiFeedback: Record<string, unknown> | null;
  @Column({ name: 'next_action', default: 'none' }) nextAction: LessonNextAction;
  @Column({ name: 'teacher_review_status', default: 'not_required' }) teacherReviewStatus: TeacherReviewStatusOnAttempt;

  // ── Scoring lifecycle (Hybrid Scoring) ──────────────────────────────────
  // 'submitted' | 'ai_scored' | 'needs_review' | 'human_scored' | 'finalized' | 'disputed'
  @Column({ name: 'scoring_status', default: 'submitted' }) scoringStatus: string;
  @Column({ name: 'ai_score', type: 'int', nullable: true }) aiScore: number | null;
  @Column({ name: 'final_score', type: 'int', nullable: true }) finalScore: number | null;
  @Column({ name: 'review_required', default: false }) reviewRequired: boolean;
  @Column({ name: 'review_reason', type: 'text', nullable: true }) reviewReason: string | null;
  @Column({ name: 'ai_confidence', type: 'float', nullable: true }) aiConfidence: number | null;
  @Column({ name: 'transcript_quality', type: 'float', nullable: true }) transcriptQuality: number | null;
  @Column({ name: 'audio_quality', type: 'float', nullable: true }) audioQuality: number | null;
  @Column({ name: 'ai_score_breakdown', type: 'jsonb', nullable: true }) aiScoreBreakdown: Record<string, number> | null;
  @Column({ name: 'final_score_breakdown', type: 'jsonb', nullable: true }) finalScoreBreakdown: Record<string, number> | null;
  @Column({ name: 'finalized_at', type: 'timestamptz', nullable: true }) finalizedAt: Date | null;

  @CreateDateColumn({ name: 'started_at' }) startedAt: Date;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt: Date | null;
}
