import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'billing', name: 'user_addons' })
export class UserAddon {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'user_id' }) userId: string;

  @Column({ name: 'addon_package_id', nullable: true }) addonPackageId: string | null;

  @Column({ name: 'tokens_purchased', type: 'bigint' }) tokensPurchased: number;

  @Column({ name: 'tokens_remaining', type: 'bigint' }) tokensRemaining: number;

  @Column({ name: 'payment_order_id', nullable: true }) paymentOrderId: string | null;

  @Column({ name: 'expires_at', nullable: true }) expiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
