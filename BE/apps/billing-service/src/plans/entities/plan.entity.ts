import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'billing', name: 'plans' })
export class Plan {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column() interval: string;
  @Column({ name: 'price_vnd', default: 0 }) priceVnd: number;
  @Column({ name: 'token_limit', default: 50000 }) tokenLimit: number;
  @Column({ name: 'session_limit', default: 10 }) sessionLimit: number;
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
