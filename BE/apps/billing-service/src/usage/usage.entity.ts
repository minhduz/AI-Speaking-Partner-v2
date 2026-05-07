import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'billing', name: 'usage' })
export class Usage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'tokens_used', default: 0 }) tokensUsed: number;
  @Column({ name: 'sessions_used', default: 0 }) sessionsUsed: number;
  @Column({ name: 'period_start' }) periodStart: Date;
  @Column({ name: 'period_end' }) periodEnd: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
