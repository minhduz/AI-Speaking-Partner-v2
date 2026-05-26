import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

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
}
