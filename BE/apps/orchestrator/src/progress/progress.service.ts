// progress.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { Session } from '../session/entities/session.entity';
import { Turn } from '../turn/entities/turn.entity';
import { UserService } from '../user/user.service';

@Injectable()
export class ProgressService {
  constructor(
    @InjectRepository(Session) private sessionRepo: Repository<Session>,
    @InjectRepository(Turn)    private turnRepo:    Repository<Turn>,
    private users: UserService,
  ) {}

  async getOverall(userId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalSessions, sessionsThisMonth] = await Promise.all([
      this.sessionRepo.count({ where: { userId, status: 'ended' } }),
      this.sessionRepo.count({
        where: { userId, status: 'ended', startedAt: MoreThanOrEqual(monthStart) },
      }),
    ]);

    // Avg pronunciation across all sessions
    const avgResult = await this.sessionRepo
      .createQueryBuilder('s')
      .select('AVG(s.avgPronunciationScore)', 'avg')
      .where('s.userId = :userId AND s.status = :status', { userId, status: 'ended' })
      .getRawOne();

    // Tokens this month from turns
    const tokenResult = await this.turnRepo
      .createQueryBuilder('t')
      .select('SUM(t.tokensUsed)', 'total')
      .where('t.userId = :userId AND t.createdAt >= :monthStart', { userId, monthStart })
      .getRawOne();

    // Score over time (last 30 sessions)
    const recentSessions = await this.sessionRepo.find({
      where: { userId, status: 'ended' },
      order: { startedAt: 'DESC' },
      take: 30,
      select: ['startedAt', 'avgPronunciationScore'],
    });

    return {
      total_sessions:             totalSessions,
      avg_pronunciation_score:    Math.round((+avgResult?.avg || 0) * 100) / 100,
      tokens_used_this_month:     +tokenResult?.total || 0,
      sessions_this_month:        sessionsThisMonth,
      score_over_time:            recentSessions.reverse().map((s) => ({
        date:  s.startedAt,
        score: s.avgPronunciationScore,
      })),
    };
  }

  /**
   * Dashboard stats for the Home page: current streak + this-week activity.
   * Counts every session the user started (any status) so "studied today" is
   * reflected immediately, not only after a session is consciously ended.
   */
  async getDashboard(userId: string) {
    const since = new Date();
    since.setDate(since.getDate() - 60);

    const rows = await this.sessionRepo.find({
      where: { userId, startedAt: MoreThanOrEqual(since) },
      select: ['startedAt'],
      order: { startedAt: 'DESC' },
    });

    // Day key in the *user's* timezone — server-local keys would roll the day
    // over at the wrong hour for non-UTC users (e.g. a 6am session in Vietnam
    // on a UTC server would be bucketed into the previous day).
    const user = await this.users.findById(userId).catch(() => null);
    const tz = user?.timezone || 'Asia/Ho_Chi_Minh';
    const dayFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const dayKey = (d: Date) => dayFmt.format(d);
    const studiedDays = new Set(rows.map((r) => dayKey(new Date(r.startedAt))));

    // Streak: consecutive days up to today. Grace — if nothing today yet, count
    // from yesterday so the streak doesn't break until a full day is missed.
    const cursor = new Date();
    let currentStreak = 0;
    if (!studiedDays.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (studiedDays.has(dayKey(cursor))) {
      currentStreak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    // Weekly: Mon→Sun of the current week with per-day session counts.
    const labels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const now = new Date();
    const mondayOffset = (now.getDay() + 6) % 7; // 0 = Monday
    const monday = new Date(now);
    monday.setDate(now.getDate() - mondayOffset);
    monday.setHours(0, 0, 0, 0);

    const countOnDay = (d: Date) =>
      rows.filter((r) => dayKey(new Date(r.startedAt)) === dayKey(d)).length;

    const weekly = labels.map((day, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return { day, count: countOnDay(d), is_today: dayKey(d) === dayKey(now) };
    });

    return {
      current_streak: currentStreak,
      weekly,
      sessions_today: countOnDay(now),
    };
  }

  async getSessionBreakdown(userId: string, page = 1, limit = 20) {
    const [sessions, total] = await this.sessionRepo.findAndCount({
      where: { userId, status: 'ended' },
      order: { startedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      sessions: sessions.map((s) => ({
        session_id:             s.id,
        title:                  s.title,
        started_at:             s.startedAt,
        avg_pronunciation_score: s.avgPronunciationScore,
        total_tokens:           s.totalTokens,
      })),
      total, page, limit,
    };
  }
}
