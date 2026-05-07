// history.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';
import { Session } from '../session/entities/session.entity';
import { Turn } from '../turn/entities/turn.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Session, Turn])],
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
