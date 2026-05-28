import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

// Per-user, per-skill mastery. Updated whenever an attempt is FINALIZED, with a
// weight that depends on the task type (practice nudges, level-final dominates).
@Entity({ schema: 'speaking_app', name: 'user_skill_mastery' })
@Index('uniq_user_skill_mastery', ['userId', 'skill'], { unique: true })
export class UserSkillMastery {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id' }) userId: string;
  // task_completion | grammar | vocabulary | pronunciation | fluency
  @Column() skill: string;
  @Column({ name: 'mastery_score', type: 'float', default: 0 }) masteryScore: number;
  @Column({ name: 'evidence_count', type: 'int', default: 0 }) evidenceCount: number;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
