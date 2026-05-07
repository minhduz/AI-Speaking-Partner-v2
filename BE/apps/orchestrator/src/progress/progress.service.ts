// progress.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { Session } from '../session/entities/session.entity';
import { Turn } from '../turn/entities/turn.entity';

@Injectable()
export class ProgressService {
  constructor(
    @InjectRepository(Session) private sessionRepo: Repository<Session>,
    @InjectRepository(Turn)    private turnRepo:    Repository<Turn>,
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
