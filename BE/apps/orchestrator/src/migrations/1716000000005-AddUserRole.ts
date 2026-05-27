import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserRole1716000000005 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE speaking_app.users ADD COLUMN IF NOT EXISTS role VARCHAR NOT NULL DEFAULT 'student'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE speaking_app.users DROP COLUMN IF EXISTS role`,
    );
  }
}
