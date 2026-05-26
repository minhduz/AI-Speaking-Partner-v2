import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

<<<<<<< HEAD
// The review *decision* axis (unchanged, kept for back-compat + attempt sync).
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
export type TeacherReviewStatus = 'pending' | 'approved' | 'revised' | 'rejected';

@Entity({ schema: 'speaking_app', name: 'teacher_reviews' })
export class TeacherReview {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'lesson_attempt_id' }) lessonAttemptId: string;
  @Column({ name: 'reviewer_id', type: 'uuid', nullable: true }) reviewerId: string | null;
  @Column({ default: 'pending' }) status: TeacherReviewStatus;
  @Column({ name: 'final_score', type: 'int', nullable: true }) finalScore: number | null;
  @Column({ type: 'text', nullable: true }) comment: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt: Date | null;
<<<<<<< HEAD

  // ── Review-task workflow (separate axis from the decision `status`) ──────
  // 'pending' | 'assigned' | 'completed' | 'escalated' | 'cancelled'
  @Column({ name: 'task_status', default: 'pending' }) taskStatus: string;
  @Column({ name: 'task_type', type: 'varchar', nullable: true }) taskType: string | null;
  @Column({ type: 'int', default: 0 }) priority: number;
  @Column({ name: 'due_at', type: 'timestamptz', nullable: true }) dueAt: Date | null;
  @Column({ name: 'review_reason', type: 'text', nullable: true }) reviewReason: string | null;
  @Column({ name: 'assigned_to', type: 'uuid', nullable: true }) assignedTo: string | null;

  // Denormalized snapshot so the queue can order/display without joins.
  @Column({ name: 'student_id', type: 'uuid', nullable: true }) studentId: string | null;
  @Column({ name: 'lesson_id', type: 'uuid', nullable: true }) lessonId: string | null;
  @Column({ type: 'varchar', nullable: true }) level: string | null;
  @Column({ type: 'varchar', nullable: true }) topic: string | null;

  @Column({ name: 'ai_score_snapshot', type: 'jsonb', nullable: true }) aiScoreSnapshot: Record<string, unknown> | null;
  @Column({ name: 'human_score', type: 'int', nullable: true }) humanScore: number | null;
  @Column({ name: 'human_score_breakdown', type: 'jsonb', nullable: true }) humanScoreBreakdown: Record<string, number> | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt: Date | null;
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
}
