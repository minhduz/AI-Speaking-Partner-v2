import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Per-turn user speech audio, uploaded out-of-band (does NOT block realtime
 * STT/LLM) and stored privately in Cloudflare R2. The DB keeps only the object
 * key + metadata — never a public URL. Teacher playback uses short-lived signed
 * GET URLs minted on demand by the backend.
 */
@Entity({ schema: 'speaking_app', name: 'turn_audio' })
@Index('idx_turn_audio_session', ['sessionId'])
@Index('idx_turn_audio_attempt', ['lessonAttemptId'])
@Index('idx_turn_audio_user', ['userId'])
export class TurnAudio {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'session_id', type: 'uuid' }) sessionId: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'turn_id', type: 'uuid', nullable: true }) turnId: string | null;
  @Column({ name: 'turn_index', type: 'int', nullable: true }) turnIndex: number | null;
  @Column({ name: 'lesson_attempt_id', type: 'uuid', nullable: true }) lessonAttemptId: string | null;
  @Column() bucket: string;
  @Column({ name: 'object_key', type: 'text', unique: true }) objectKey: string;
  @Column({ name: 'content_type' }) contentType: string;
  @Column({ name: 'byte_size', type: 'int' }) byteSize: number;
  @Column({ name: 'duration_ms', type: 'int', nullable: true }) durationMs: number | null;
  @Column({ type: 'text', nullable: true }) transcript: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
