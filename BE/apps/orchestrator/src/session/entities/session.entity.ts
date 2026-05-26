import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../user/entities/user.entity';

/**
 * status values:
 *   active    – session in progress
 *   ending    – AI closing message is being played (transient)
 *   ended     – user consciously finished the session (has closing summary)
 *   abandoned – user disappeared / idle-timeout / tab close (no closing)
 *
 * end_reason values: user_clicked | voice_intent | idle_timeout | tab_close | orphan
 *
 * mode values:
 *   guided_learning – default. Deck + mission + skill_radar evaluation.
 *   free_talk       – open conversation only. No deck generation, no eval board.
 */
export type SessionMode = 'guided_learning' | 'free_talk';

@Entity({ schema: 'speaking_app', name: 'sessions' })
export class Session {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id' }) userId: string;
  @ManyToOne(() => User) @JoinColumn({ name: 'user_id' }) user: User;
  @Column({ nullable: true }) title: string;
  @Column({ default: 'active' }) status: string;
  @Column({ default: 'guided_learning' }) mode: SessionMode;
  @Column({ name: 'total_tokens', default: 0 }) totalTokens: number;
  @Column({ name: 'avg_pronunciation_score', type: 'float', default: 0 }) avgPronunciationScore: number;
  @Column({ name: 'is_archived', default: false }) isArchived: boolean;
  @Column({ name: 'archived_at', nullable: true }) archivedAt: Date;
  @CreateDateColumn({ name: 'started_at' }) startedAt: Date;
  @Column({ name: 'ended_at', nullable: true }) endedAt: Date;
  @Column({ name: 'last_activity_at', nullable: true }) lastActivityAt: Date;
  @Column({ name: 'end_reason', nullable: true }) endReason: string;
  // End-of-session evaluation report, written by the consolidation worker.
  // Null until consolidation finishes (or for sessions that predate the feature).
  @Column({ type: 'jsonb', nullable: true }) breakdown: Record<string, unknown> | null;
  // Curriculum-first pivot: when this session backs a lesson attempt, the
  // attempt's id is stamped here. NULL for Free Talk and for legacy non-lesson
  // guided sessions. Used to gate legacy deck-generation paths from clobbering
  // a lesson deck and to drive lesson scoring/progression on session end.
  @Column({ name: 'lesson_attempt_id', type: 'uuid', nullable: true }) lessonAttemptId: string | null;
}
