import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEndReason1716000000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE speaking_app.sessions ADD COLUMN IF NOT EXISTS end_reason VARCHAR`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE speaking_app.sessions DROP COLUMN IF EXISTS end_reason`,
    );
  }
}
