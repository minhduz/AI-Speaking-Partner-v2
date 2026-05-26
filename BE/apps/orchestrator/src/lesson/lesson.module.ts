import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';

import { Lesson } from './entities/lesson.entity';
import { LessonCard } from './entities/lesson-card.entity';
import { UserLessonProgress } from './entities/user-lesson-progress.entity';
import { LessonAttempt } from './entities/lesson-attempt.entity';
import { CardAttempt } from './entities/card-attempt.entity';
import { TeacherReview } from './entities/teacher-review.entity';
import { Session } from '../session/entities/session.entity';
import { User } from '../user/entities/user.entity';

import { LessonService } from './lesson.service';
import { LessonController, TeacherReviewController } from './lesson.controller';
import { LessonSeeder } from './lesson.seeder';
import { TeacherReviewGuard } from './guards/teacher-review.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Lesson,
      LessonCard,
      UserLessonProgress,
      LessonAttempt,
      CardAttempt,
      TeacherReview,
      Session,
      User,
    ]),
    HttpModule,
  ],
  controllers: [LessonController, TeacherReviewController],
  providers: [LessonService, LessonSeeder, TeacherReviewGuard],
  exports: [LessonService, TypeOrmModule],
})
// SessionModule uses forwardRef(() => LessonModule) to close the circular
// SessionService → LessonService dependency. LessonModule itself only uses
// the Session entity (via TypeOrmModule.forFeature) and not SessionService.
export class LessonModule {}
