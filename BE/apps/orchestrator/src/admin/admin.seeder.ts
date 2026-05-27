import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { User } from '../user/entities/user.entity';
import { UserRole } from '../user/user-role.enum';

// Dev-only teacher accounts so the review-assign flow can be exercised end to
// end. Seeded outside production only; created if missing, never overwritten.
const DEV_TEACHER_SEEDS = [
  { email: 'teacher1@gmail.com', name: 'Teacher One' },
  { email: 'teacher2@gmail.com', name: 'Teacher Two' },
  { email: 'teacher3@gmail.com', name: 'Teacher Three' },
];
const DEV_TEACHER_PASSWORD = '123456';

/**
 * Bootstraps the root admin from ADMIN_EMAIL / ADMIN_PASSWORD env vars.
 * - No matching user  → create one with role=admin.
 * - User exists, role != admin → promote to admin (idempotent).
 * - Env vars unset → skip (log a warning), so a dev machine without the vars
 *   still boots. Mirrors LessonSeeder's fail-soft OnModuleInit pattern.
 *
 * Also seeds a few fixed teacher accounts in non-production environments so the
 * admin review-assign flow has reviewers to assign to.
 */
@Injectable()
export class AdminSeeder implements OnModuleInit {
  private readonly log = new Logger('AdminSeeder');

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    private cfg: ConfigService,
  ) {}

  async onModuleInit() {
    try {
      await this.seed();
    } catch (err: any) {
      this.log.warn(`Admin seed skipped: ${err?.message ?? err}`);
    }
    try {
      await this.seedDevTeachers();
    } catch (err: any) {
      this.log.warn(`Teacher seed skipped: ${err?.message ?? err}`);
    }
  }

  private async seedDevTeachers() {
    if ((this.cfg.get<string>('NODE_ENV') || '').toLowerCase() === 'production') {
      return;
    }

    const passwordHash = await bcrypt.hash(DEV_TEACHER_PASSWORD, 10);
    for (const seed of DEV_TEACHER_SEEDS) {
      const email = seed.email.trim().toLowerCase();
      const existing = await this.userRepo.findOne({ where: { email } });
      if (existing) continue;
      const teacher = this.userRepo.create({
        email,
        name: seed.name,
        passwordHash,
        role: UserRole.TEACHER,
      });
      await this.userRepo.save(teacher);
      this.log.log(`Created dev teacher ${email}`);
    }
  }

  private async seed() {
    const email = (this.cfg.get<string>('ADMIN_EMAIL') || '').trim().toLowerCase();
    const password = this.cfg.get<string>('ADMIN_PASSWORD') || '';

    if (!email || !password) {
      this.log.warn('ADMIN_EMAIL/ADMIN_PASSWORD not set — no root admin seeded');
      return;
    }

    const existing = await this.userRepo.findOne({ where: { email } });
    if (existing) {
      if (existing.role !== UserRole.ADMIN) {
        existing.role = UserRole.ADMIN;
        await this.userRepo.save(existing);
        this.log.log(`Promoted existing user ${email} to admin`);
      }
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const admin = this.userRepo.create({
      email,
      name: 'Administrator',
      passwordHash,
      role: UserRole.ADMIN,
    });
    await this.userRepo.save(admin);
    this.log.log(`Created root admin ${email}`);
  }
}
