import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add a `mode` column to sessions to distinguish:
 *   - 'guided_learning' (default): structured deck + missions + evaluation
 *   - 'free_talk':                  open conversation, no deck, no eval
 *
 * Existing rows are backfilled to 'guided_learning' so history stays meaningful.
 */
export class AddSessionMode1716000000003 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE speaking_app.sessions ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'guided_learning'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE speaking_app.sessions DROP COLUMN IF EXISTS mode`,
    );
  }
}
