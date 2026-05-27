import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * A learner's rating/feedback on a COMPLETED teacher review. One row per
 * (teacher_review_id, student_id) — the learner can update it but never create
 * a duplicate. Stores rating/comment metadata only (never audio).
 */
@Entity({ schema: 'speaking_app', name: 'teacher_review_feedback' })
@Index('uniq_teacher_review_feedback', ['teacherReviewId', 'studentId'], { unique: true })
export class TeacherReviewFeedback {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'teacher_review_id', type: 'uuid' }) teacherReviewId: string;
  @Column({ name: 'lesson_attempt_id', type: 'uuid' }) lessonAttemptId: string;
  @Column({ name: 'student_id', type: 'uuid' }) studentId: string;
  @Column({ name: 'teacher_id', type: 'uuid' }) teacherId: string;
  @Column({ type: 'int' }) rating: number;
  @Column({ type: 'text', nullable: true }) comment: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
