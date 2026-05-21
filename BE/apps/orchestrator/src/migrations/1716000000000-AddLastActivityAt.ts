import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLastActivityAt1716000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE speaking_app.sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE speaking_app.sessions DROP COLUMN IF EXISTS last_activity_at`,
    );
  }
}
