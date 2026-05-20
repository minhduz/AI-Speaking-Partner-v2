import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { DictionaryCache } from './dictionary-cache.entity';

// status lifecycle: new → learning → reviewing → mastered
@Entity({ schema: 'dictionary', name: 'user_history' })
export class DictionaryHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'word_id', type: 'uuid' })
  wordId: string;

  @Column({ name: 'context_sentence', type: 'text', nullable: true })
  contextSentence: string;

  // 'new' | 'learning' | 'reviewing' | 'mastered'
  @Column({ type: 'varchar', default: 'new' })
  status: string;

  @Column({ name: 'review_count', type: 'int', default: 0 })
  reviewCount: number;

  @Column({ name: 'mastery_score', type: 'float', default: 0 })
  masteryScore: number;

  // interval in days used by the SR scheduler
  @Column({ name: 'interval_days', type: 'float', default: 1 })
  intervalDays: number;

  @Column({ name: 'last_reviewed_at', type: 'timestamp', nullable: true })
  lastReviewedAt: Date | null;

  @Column({ name: 'next_review_at', type: 'timestamp', nullable: true })
  nextReviewAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => DictionaryCache)
  @JoinColumn({ name: 'word_id' })
  wordCache: DictionaryCache;
}
