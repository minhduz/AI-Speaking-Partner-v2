import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { DictionaryCache } from './dictionary-cache.entity';

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => DictionaryCache)
  @JoinColumn({ name: 'word_id' })
  wordCache: DictionaryCache;
}
