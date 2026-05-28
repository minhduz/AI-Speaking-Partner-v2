import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type LessonProgressState =
  | 'locked'
  | 'unlocked'
  | 'in_progress'
  | 'under_review'
  | 'completed'
  | 'needs_retry';

@Entity({ schema: 'speaking_app', name: 'user_lesson_progress' })
@Index('uniq_user_lesson_progress', ['userId', 'lessonId'], { unique: true })
export class UserLessonProgress {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'lesson_id' }) lessonId: string;
  @Column({ default: 'locked' }) state: LessonProgressState;
  @Column({ name: 'best_score', type: 'int', nullable: true }) bestScore: number | null;
  @Column({ name: 'last_attempt_id', type: 'uuid', nullable: true }) lastAttemptId: string | null;
  @Column({ name: 'unlocked_at', type: 'timestamptz', nullable: true }) unlockedAt: Date | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
