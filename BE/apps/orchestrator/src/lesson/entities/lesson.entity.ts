import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'speaking_app', name: 'lessons' })
export class Lesson {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() level: string;
  @Column() topic: string;
  @Column() unit: string;
  @Column({ name: 'order_index', default: 0 }) orderIndex: number;
  @Column() title: string;
  @Column({ type: 'text' }) objective: string;
  @Column({ name: 'mini_plan_text', type: 'text', default: '' }) miniPlanText: string;
  @Column({ name: 'pass_score', type: 'int', default: 70 }) passScore: number;
  @Column({ name: 'is_review', default: false }) isReview: boolean;
<<<<<<< HEAD
  // 'practice' | 'checkpoint' | 'level_final' (see scoring.constants TaskType).
  @Column({ name: 'task_type', default: 'practice' }) taskType: string;
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
  @Column({ name: 'is_published', default: true }) isPublished: boolean;
  @Column({ name: 'next_lesson_id', type: 'uuid', nullable: true }) nextLessonId: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
