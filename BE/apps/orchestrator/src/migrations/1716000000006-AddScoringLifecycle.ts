import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hybrid Scoring + Mastery Path.
 *  - lessons.task_type            — practice | checkpoint | level_final
 *  - lesson_attempts.*            — scoring lifecycle (ai/final score, status,
 *                                   review flags, quality, breakdowns)
 *  - teacher_reviews.*            — promote the thin review row into a review
 *                                   task (workflow status, priority, SLA, etc.)
 *  - user_skill_mastery           — per-user, per-skill mastery
 * All additive + idempotent. Curriculum tables live in migration ...004 (not
 * init.sql), so these ALTERs run safely after that migration.
 */
export class AddScoringLifecycle1716000000006 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // ── lessons.task_type ────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE speaking_app.lessons ADD COLUMN IF NOT EXISTS task_type VARCHAR NOT NULL DEFAULT 'practice'`,
    );
    // Backfill: review lessons become checkpoints (seeder later tags the
    // level's final review as level_final).
    await queryRunner.query(
      `UPDATE speaking_app.lessons SET task_type = 'checkpoint' WHERE is_review = TRUE AND task_type = 'practice'`,
    );

    // ── lesson_attempts scoring lifecycle ────────────────────────────────
    const attemptCols: string[] = [
      `scoring_status VARCHAR NOT NULL DEFAULT 'submitted'`,
      `ai_score INT`,
      `final_score INT`,
      `review_required BOOLEAN NOT NULL DEFAULT FALSE`,
      `review_reason TEXT`,
      `ai_confidence FLOAT`,
      `transcript_quality FLOAT`,
      `audio_quality FLOAT`,
      `ai_score_breakdown JSONB`,
      `final_score_breakdown JSONB`,
      `finalized_at TIMESTAMPTZ`,
    ];
    for (const col of attemptCols) {
      await queryRunner.query(
        `ALTER TABLE speaking_app.lesson_attempts ADD COLUMN IF NOT EXISTS ${col}`,
      );
    }
    // Backfill history: attempts that already reached a terminal status were
    // effectively AI-finalized under the old flow. Treat them as FINALIZED with
    // final/ai_score = the legacy score so getAttempt() shows their real grade
    // instead of defaulting to 'submitted'. Only touch rows still at the default.
    await queryRunner.query(`
      UPDATE speaking_app.lesson_attempts
         SET scoring_status = 'finalized',
             ai_score       = score,
             final_score    = score,
             finalized_at    = COALESCE(completed_at, NOW())
       WHERE scoring_status = 'submitted'
         AND status IN ('passed', 'needs_retry', 'failed')
         AND score IS NOT NULL
    `);

    // ── teacher_reviews → review task ────────────────────────────────────
    const reviewCols: string[] = [
      `task_type VARCHAR`,
      `task_status VARCHAR NOT NULL DEFAULT 'pending'`,
      `priority INT NOT NULL DEFAULT 0`,
      `due_at TIMESTAMPTZ`,
      `review_reason TEXT`,
      `assigned_to UUID`,
      `student_id UUID`,
      `lesson_id UUID`,
      `level VARCHAR`,
      `topic VARCHAR`,
      `ai_score_snapshot JSONB`,
      `human_score INT`,
      `human_score_breakdown JSONB`,
      `completed_at TIMESTAMPTZ`,
    ];
    for (const col of reviewCols) {
      await queryRunner.query(
        `ALTER TABLE speaking_app.teacher_reviews ADD COLUMN IF NOT EXISTS ${col}`,
      );
    }
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_teacher_reviews_queue
         ON speaking_app.teacher_reviews (task_status, priority DESC, due_at)`,
    );

    // ── user_skill_mastery ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS speaking_app.user_skill_mastery (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        UUID NOT NULL REFERENCES speaking_app.users(id) ON DELETE CASCADE,
        skill          VARCHAR NOT NULL,
        mastery_score  FLOAT NOT NULL DEFAULT 0,
        evidence_count INT NOT NULL DEFAULT 0,
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_skill_mastery
         ON speaking_app.user_skill_mastery (user_id, skill)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS speaking_app.user_skill_mastery`);
    await queryRunner.query(`DROP INDEX IF EXISTS speaking_app.idx_teacher_reviews_queue`);

    const reviewCols = [
      'task_type', 'task_status', 'priority', 'due_at', 'review_reason',
      'assigned_to', 'student_id', 'lesson_id', 'level', 'topic',
      'ai_score_snapshot', 'human_score', 'human_score_breakdown', 'completed_at',
    ];
    for (const col of reviewCols) {
      await queryRunner.query(
        `ALTER TABLE speaking_app.teacher_reviews DROP COLUMN IF EXISTS ${col}`,
      );
    }

    const attemptCols = [
      'scoring_status', 'ai_score', 'final_score', 'review_required', 'review_reason',
      'ai_confidence', 'transcript_quality', 'audio_quality',
      'ai_score_breakdown', 'final_score_breakdown', 'finalized_at',
    ];
    for (const col of attemptCols) {
      await queryRunner.query(
        `ALTER TABLE speaking_app.lesson_attempts DROP COLUMN IF EXISTS ${col}`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE speaking_app.lessons DROP COLUMN IF EXISTS task_type`,
    );
  }
}
