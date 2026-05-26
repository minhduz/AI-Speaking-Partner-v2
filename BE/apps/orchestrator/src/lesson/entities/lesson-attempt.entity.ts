import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

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
  @CreateDateColumn({ name: 'started_at' }) startedAt: Date;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt: Date | null;
}
