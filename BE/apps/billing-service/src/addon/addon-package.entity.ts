import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'billing', name: 'addon_packages' })
export class AddonPackage {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column() name: string;

  @Column({ name: 'token_amount', type: 'bigint' }) tokenAmount: number;

  @Column({ name: 'price_vnd' }) priceVnd: number;

  @Column({ name: 'is_active', default: true }) isActive: boolean;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
