// progress.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { Session } from '../session/entities/session.entity';
import { Turn } from '../turn/entities/turn.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Session, Turn])],
  controllers: [ProgressController],
  providers: [ProgressService],
})
export class ProgressModule {}
