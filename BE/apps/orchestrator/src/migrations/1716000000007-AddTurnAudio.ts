import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-turn user speech audio stored privately in Cloudflare R2. DB holds only
 * object_key + metadata (no public URLs). Additive + idempotent.
 */
export class AddTurnAudio1716000000007 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS speaking_app.turn_audio (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id         UUID NOT NULL REFERENCES speaking_app.sessions(id) ON DELETE CASCADE,
        user_id            UUID NOT NULL REFERENCES speaking_app.users(id) ON DELETE CASCADE,
        turn_id            UUID REFERENCES speaking_app.turns(id) ON DELETE SET NULL,
        turn_index         INT,
        lesson_attempt_id  UUID REFERENCES speaking_app.lesson_attempts(id) ON DELETE SET NULL,
        bucket             VARCHAR NOT NULL,
        object_key         TEXT NOT NULL UNIQUE,
        content_type       VARCHAR NOT NULL,
        byte_size          INT NOT NULL,
        duration_ms        INT,
        transcript         TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_turn_audio_session ON speaking_app.turn_audio (session_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_turn_audio_attempt ON speaking_app.turn_audio (lesson_attempt_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_turn_audio_user ON speaking_app.turn_audio (user_id)`,
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
          WHERE c.contype = 'f'
            AND n.nspname = 'speaking_app'
            AND t.relname = 'turn_audio'
            AND a.attname = 'lesson_attempt_id'
        ) THEN
          ALTER TABLE speaking_app.turn_audio
            ADD CONSTRAINT fk_turn_audio_lesson_attempt
            FOREIGN KEY (lesson_attempt_id)
            REFERENCES speaking_app.lesson_attempts(id)
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS speaking_app.turn_audio`);
  }
}
