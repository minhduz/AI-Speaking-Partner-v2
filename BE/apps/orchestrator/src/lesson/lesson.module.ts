import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';

import { Lesson } from './entities/lesson.entity';
import { LessonCard } from './entities/lesson-card.entity';
import { UserLessonProgress } from './entities/user-lesson-progress.entity';
import { LessonAttempt } from './entities/lesson-attempt.entity';
import { CardAttempt } from './entities/card-attempt.entity';
import { TeacherReview } from './entities/teacher-review.entity';
<<<<<<< HEAD
import { TeacherReviewFeedback } from './entities/teacher-review-feedback.entity';
import { UserSkillMastery } from './entities/user-skill-mastery.entity';
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
import { Session } from '../session/entities/session.entity';
import { User } from '../user/entities/user.entity';

import { LessonService } from './lesson.service';
import { LessonController, TeacherReviewController } from './lesson.controller';
<<<<<<< HEAD
import { ReviewTaskController } from './review-task.controller';
import { TurnAudioModule } from '../turn/turn-audio.module';
import { LessonSeeder } from './lesson.seeder';
import { RolesGuard } from '../auth/guards/roles.guard';
=======
import { LessonSeeder } from './lesson.seeder';
import { TeacherReviewGuard } from './guards/teacher-review.guard';
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Lesson,
      LessonCard,
      UserLessonProgress,
      LessonAttempt,
      CardAttempt,
      TeacherReview,
<<<<<<< HEAD
      TeacherReviewFeedback,
      UserSkillMastery,
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
      Session,
      User,
    ]),
    HttpModule,
<<<<<<< HEAD
    TurnAudioModule,
  ],
  controllers: [LessonController, TeacherReviewController, ReviewTaskController],
  providers: [LessonService, LessonSeeder, RolesGuard],
=======
  ],
  controllers: [LessonController, TeacherReviewController],
  providers: [LessonService, LessonSeeder, TeacherReviewGuard],
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
  exports: [LessonService, TypeOrmModule],
})
// SessionModule uses forwardRef(() => LessonModule) to close the circular
// SessionService → LessonService dependency. LessonModule itself only uses
// the Session entity (via TypeOrmModule.forFeature) and not SessionService.
export class LessonModule {}
