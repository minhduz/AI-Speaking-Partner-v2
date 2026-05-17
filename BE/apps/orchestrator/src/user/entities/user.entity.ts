import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'speaking_app', name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) email: string;
  @Column({ name: 'password_hash', select: false }) passwordHash: string;
  @Column() name: string;
  @Column({ name: 'google_id', nullable: true, unique: true }) googleId: string;
  @Column({ name: 'target_language', default: 'english' }) targetLanguage: string;
  @Column({ default: 'beginner' }) level: string;
  @Column({ name: 'native_language', default: 'vietnamese' }) nativeLanguage: string;
  @Column({ name: 'learning_goal', nullable: true }) learningGoal: string;
  @Column({ default: 'Asia/Ho_Chi_Minh' }) timezone: string;
  @Column({ name: 'voice_id', default: 'Adrian' }) voiceId: string;
  @Column({ name: 'speech_rate', type: 'float', default: 1.0 }) speechRate: number;
  @Column({ name: 'conversation_style', default: 'friendly' }) conversationStyle: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
