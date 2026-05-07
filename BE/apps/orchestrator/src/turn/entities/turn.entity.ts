import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Session } from '../../session/entities/session.entity';

@Entity({ schema: 'speaking_app', name: 'turns' })
export class Turn {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'session_id' }) sessionId: string;
  @ManyToOne(() => Session) @JoinColumn({ name: 'session_id' }) session: Session;
  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'turn_index' }) turnIndex: number;
  @Column({ type: 'jsonb', default: '{}' }) data: Record<string, any>;
  @Column({ name: 'tokens_used', default: 0 }) tokensUsed: number;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
