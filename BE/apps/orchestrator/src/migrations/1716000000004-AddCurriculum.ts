import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Curriculum-first pivot. Adds the durable lesson model:
 *   lessons / lesson_cards          — curriculum source of truth
 *   user_lesson_progress            — per-user progression state
 *   lesson_attempts / card_attempts — durable record of what the user did
 *   teacher_reviews                 — human-review queue
 * Plus sessions.lesson_attempt_id so a speaking session can be tied to a
 * lesson attempt (Free Talk sessions stay null).
 */
export class AddCurriculum1716000000004 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS speaking_app.lessons (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        level           VARCHAR NOT NULL,
        topic           VARCHAR NOT NULL,
        unit            VARCHAR NOT NULL,
        order_index     INT NOT NULL DEFAULT 0,
        title           VARCHAR NOT NULL,
        objective       TEXT NOT NULL,
        mini_plan_text  TEXT NOT NULL DEFAULT '',
        pass_score      INT NOT NULL DEFAULT 70,
        is_review       BOOLEAN NOT NULL DEFAULT FALSE,
        is_published    BOOLEAN NOT NULL DEFAULT TRUE,
        next_lesson_id  UUID,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_lessons_path
        ON speaking_app.lessons (level, topic, unit, order_index);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS speaking_app.lesson_cards (
        id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lesson_id                  UUID NOT NULL REFERENCES speaking_app.lessons(id) ON DELETE CASCADE,
        order_index                INT NOT NULL DEFAULT 0,
        type                       VARCHAR NOT NULL,
        title                      VARCHAR NOT NULL,
        task_template              TEXT NOT NULL,
        success_criteria           JSONB NOT NULL DEFAULT '[]'::jsonb,
        expected_duration_seconds  INT NOT NULL DEFAULT 60,
        retry_allowed              BOOLEAN NOT NULL DEFAULT TRUE
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_lesson_cards_lesson
        ON speaking_app.lesson_cards (lesson_id, order_index);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS speaking_app.user_lesson_progress (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES speaking_app.users(id) ON DELETE CASCADE,
        lesson_id       UUID NOT NULL REFERENCES speaking_app.lessons(id) ON DELETE CASCADE,
        state           VARCHAR NOT NULL DEFAULT 'locked',
        best_score      INT,
        last_attempt_id UUID,
        unlocked_at     TIMESTAMPTZ,
        completed_at    TIMESTAMPTZ,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_lesson_progress
        ON speaking_app.user_lesson_progress (user_id, lesson_id);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS speaking_app.lesson_attempts (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                UUID NOT NULL REFERENCES speaking_app.users(id) ON DELETE CASCADE,
        lesson_id              UUID NOT NULL REFERENCES speaking_app.lessons(id) ON DELETE CASCADE,
        session_id             UUID,
        status                 VARCHAR NOT NULL DEFAULT 'in_progress',
        score                  INT,
        ai_feedback            JSONB,
        next_action            VARCHAR NOT NULL DEFAULT 'none',
        teacher_review_status  VARCHAR NOT NULL DEFAULT 'not_required',
        started_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at           TIMESTAMPTZ
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_lesson_attempts_user_lesson
        ON speaking_app.lesson_attempts (user_id, lesson_id);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS speaking_app.card_attempts (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lesson_attempt_id  UUID NOT NULL REFERENCES speaking_app.lesson_attempts(id) ON DELETE CASCADE,
        lesson_card_id     UUID,
        runtime_card_id    VARCHAR NOT NULL,
        status             VARCHAR NOT NULL DEFAULT 'not_started',
        result             VARCHAR,
        attempts           INT NOT NULL DEFAULT 0,
        score              INT,
        feedback           TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_card_attempts_lesson_attempt
        ON speaking_app.card_attempts (lesson_attempt_id);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS speaking_app.teacher_reviews (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lesson_attempt_id  UUID NOT NULL REFERENCES speaking_app.lesson_attempts(id) ON DELETE CASCADE,
        reviewer_id        UUID,
        status             VARCHAR NOT NULL DEFAULT 'pending',
        final_score        INT,
        comment            TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at        TIMESTAMPTZ
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_teacher_reviews_status
        ON speaking_app.teacher_reviews (status);
    `);

    // Sessions can now be tied to a lesson attempt. NULL = free talk / legacy.
    await queryRunner.query(`
      ALTER TABLE speaking_app.sessions
        ADD COLUMN IF NOT EXISTS lesson_attempt_id UUID
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_lesson_attempt
        ON speaking_app.sessions (lesson_attempt_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE speaking_app.sessions DROP COLUMN IF EXISTS lesson_attempt_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS speaking_app.teacher_reviews`);
    await queryRunner.query(`DROP TABLE IF EXISTS speaking_app.card_attempts`);
    await queryRunner.query(`DROP TABLE IF EXISTS speaking_app.lesson_attempts`);
    await queryRunner.query(`DROP TABLE IF EXISTS speaking_app.user_lesson_progress`);
    await queryRunner.query(`DROP TABLE IF EXISTS speaking_app.lesson_cards`);
    await queryRunner.query(`DROP TABLE IF EXISTS speaking_app.lessons`);
  }
}
