import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'billing', name: 'payment_orders' })
export class PaymentOrder {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'plan_id', nullable: true }) planId: string | null;
  @Column({ name: 'order_type', default: 'subscription' }) orderType: string;
  @Column({ name: 'addon_package_id', nullable: true }) addonPackageId: string | null;
  @Column({ default: 'pending' }) status: string;
  @Column({ name: 'amount_vnd' }) amountVnd: number;
  @Column({ name: 'content_code', unique: true }) contentCode: string;
  @Column({ name: 'transaction_id', unique: true, nullable: true }) transactionId: string;
  @Column({ name: 'qr_url', nullable: true }) qrUrl: string;
  @Column({ name: 'expires_at' }) expiresAt: Date;
  @Column({ name: 'paid_at', nullable: true }) paidAt: Date;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
