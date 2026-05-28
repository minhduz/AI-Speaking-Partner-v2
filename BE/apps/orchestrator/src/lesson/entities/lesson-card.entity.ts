import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Lesson } from './lesson.entity';

/**
 * Cards with order_index >= this offset are "archived": kept on the row so
 * historical card_attempts still have a target, but excluded from any read
 * that builds the lesson detail or the runtime deck. The seeder bumps cards
 * here when it shrinks a lesson but card_attempts still reference them.
 */
export const ARCHIVED_CARD_ORDER_OFFSET = 10_000;

@Entity({ schema: 'speaking_app', name: 'lesson_cards' })
export class LessonCard {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'lesson_id' }) lessonId: string;
  @ManyToOne(() => Lesson, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'lesson_id' }) lesson: Lesson;
  @Column({ name: 'order_index', default: 0 }) orderIndex: number;
  @Column() type: string;
  @Column() title: string;
  @Column({ name: 'task_template', type: 'text' }) taskTemplate: string;
  @Column({ name: 'success_criteria', type: 'jsonb', default: () => "'[]'::jsonb" }) successCriteria: string[];
  @Column({ name: 'expected_duration_seconds', type: 'int', default: 60 }) expectedDurationSeconds: number;
  @Column({ name: 'retry_allowed', default: true }) retryAllowed: boolean;
}
