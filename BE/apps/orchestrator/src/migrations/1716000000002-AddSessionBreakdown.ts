import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persist the end-of-session evaluation report ("breakdown") on the session
 * row so it survives the Redis TTL and can be shown in History (which may be
 * viewed long after the session ended). Written by the memory-service
 * consolidation worker; read by the orchestrator for both the post-session
 * view and the history review panel.
 */
export class AddSessionBreakdown1716000000002 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE speaking_app.sessions ADD COLUMN IF NOT EXISTS breakdown JSONB`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE speaking_app.sessions DROP COLUMN IF EXISTS breakdown`,
    );
  }
}
