import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Unique } from 'typeorm';

@Entity({ schema: 'dictionary', name: 'cache' })
@Unique(['word', 'language'])
export class DictionaryCache {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  word: string;

  @Column({ default: 'en' })
  language: string;

  @Column({ type: 'jsonb' })
  data: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
