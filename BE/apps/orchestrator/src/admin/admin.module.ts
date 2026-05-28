import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../user/entities/user.entity';
import { Session } from '../session/entities/session.entity';
import { Lesson } from '../lesson/entities/lesson.entity';
import { LessonAttempt } from '../lesson/entities/lesson-attempt.entity';
import { TeacherReview } from '../lesson/entities/teacher-review.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { LessonModule } from '../lesson/lesson.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminSeeder } from './admin.seeder';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Session, Lesson, LessonAttempt, TeacherReview]),
    // For shared teacher analytics (ratings, completed counts, dashboard).
    LessonModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminSeeder, RolesGuard],
})
export class AdminModule {}
