import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TurnAudio } from './entities/turn-audio.entity';
import { Session } from '../session/entities/session.entity';
import { TeacherReview } from '../lesson/entities/teacher-review.entity';
import { StorageModule } from '../storage/storage.module';
import { TurnAudioService } from './turn-audio.service';
import { TurnAudioController } from './turn-audio.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TurnAudio, Session, TeacherReview]), StorageModule],
  controllers: [TurnAudioController],
  providers: [TurnAudioService],
  exports: [TurnAudioService],
})
export class TurnAudioModule {}
