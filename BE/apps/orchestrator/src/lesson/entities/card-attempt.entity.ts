import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CardAttemptStatus = 'not_started' | 'completed' | 'skipped';
export type CardAttemptResult = 'passed' | 'failed' | null;

@Entity({ schema: 'speaking_app', name: 'card_attempts' })
export class CardAttempt {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'lesson_attempt_id' }) lessonAttemptId: string;
  @Column({ name: 'lesson_card_id', type: 'uuid', nullable: true }) lessonCardId: string | null;
  @Column({ name: 'runtime_card_id' }) runtimeCardId: string;
  @Column({ default: 'not_started' }) status: CardAttemptStatus;
  @Column({ type: 'varchar', nullable: true }) result: 'passed' | 'failed' | null;
  @Column({ type: 'int', default: 0 }) attempts: number;
  @Column({ type: 'int', nullable: true }) score: number | null;
  @Column({ type: 'text', nullable: true }) feedback: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
