import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'speaking_app', name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) email: string;
  @Column({ name: 'password_hash', select: false }) passwordHash: string;
  @Column() name: string;
  @Column({ name: 'target_language', default: 'english' }) targetLanguage: string;
  @Column({ default: 'beginner' }) level: string;
  @Column({ default: 'Asia/Ho_Chi_Minh' }) timezone: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
