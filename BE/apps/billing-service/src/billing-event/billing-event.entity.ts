import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'billing', name: 'billing_events' })
export class BillingEvent {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'sepay_transaction_id', type: 'bigint', nullable: true, unique: true })
  sepayTransactionId: number | null;

  @Column({ name: 'user_id', nullable: true }) userId: string | null;

  @Column({ name: 'event_type' }) eventType: string;

  @Column({ name: 'reference_code', nullable: true }) referenceCode: string | null;

  @Column({ type: 'jsonb', nullable: true }) payload: any;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
