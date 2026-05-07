import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Plan } from '../../plans/entities/plan.entity';

@Entity({ schema: 'billing', name: 'subscriptions' })
export class Subscription {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'plan_id' }) planId: string;
  @ManyToOne(() => Plan) @JoinColumn({ name: 'plan_id' }) plan: Plan;
  @Column({ default: 'active' }) status: string;
  @Column({ name: 'current_period_start' }) currentPeriodStart: Date;
  @Column({ name: 'current_period_end' }) currentPeriodEnd: Date;
  @Column({ name: 'auto_renew', default: true }) autoRenew: boolean;
  @Column({ name: 'cancelled_at', nullable: true }) cancelledAt: Date;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
