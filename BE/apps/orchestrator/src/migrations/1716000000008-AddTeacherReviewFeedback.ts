import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Learner rating/feedback on a completed teacher review.
 *  - One row per (teacher_review_id, student_id) — upsert, never duplicate.
 *  - Metadata only: rating (1..5) + optional comment. No audio.
 * Additive + idempotent. teacher_reviews / lesson_attempts / users already
 * exist by migration ...004/...006.
 */
export class AddTeacherReviewFeedback1716000000008 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS speaking_app.teacher_review_feedback (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        teacher_review_id UUID NOT NULL REFERENCES speaking_app.teacher_reviews(id) ON DELETE CASCADE,
        lesson_attempt_id UUID NOT NULL REFERENCES speaking_app.lesson_attempts(id) ON DELETE CASCADE,
        student_id        UUID NOT NULL REFERENCES speaking_app.users(id) ON DELETE CASCADE,
        teacher_id        UUID NOT NULL REFERENCES speaking_app.users(id) ON DELETE CASCADE,
        rating            INT  NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment           TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_teacher_review_feedback
         ON speaking_app.teacher_review_feedback (teacher_review_id, student_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_teacher_review_feedback_teacher
         ON speaking_app.teacher_review_feedback (teacher_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS speaking_app.teacher_review_feedback`);
  }
}
