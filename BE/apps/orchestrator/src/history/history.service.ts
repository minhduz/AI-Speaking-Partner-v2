// history.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from '../session/entities/session.entity';
import { Turn } from '../turn/entities/turn.entity';

@Injectable()
export class HistoryService {
  constructor(
    @InjectRepository(Session) private sessionRepo: Repository<Session>,
    @InjectRepository(Turn)    private turnRepo:    Repository<Turn>,
  ) {}

  async getSessions(userId: string, page = 1, limit = 20) {
    const [sessions, total] = await this.sessionRepo.findAndCount({
      where: { userId, isArchived: false },
      order: { startedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    // Attach turn count per session
    const result = await Promise.all(
      sessions.map(async (s) => ({
        session_id: s.id,
        title: s.title ?? 'Untitled session',
        started_at: s.startedAt,
        avg_pronunciation_score: s.avgPronunciationScore,
        total_tokens: s.totalTokens,
        turns_count: await this.turnRepo.count({ where: { sessionId: s.id } }),
      })),
    );
    return { sessions: result, total, page, limit };
  }

  async getSession(sessionId: string, userId: string) {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId, userId } });
    if (!session) throw new NotFoundException('Session not found');
    const turns = await this.turnRepo.find({
      where: { sessionId },
      order: { turnIndex: 'ASC' },
    });
    return {
      session: {
        id: session.id,
        title: session.title,
        started_at: session.startedAt,
        ended_at: session.endedAt,
        avg_pronunciation_score: session.avgPronunciationScore,
        total_tokens: session.totalTokens,
      },
      turns: turns.map((t) => ({
        turn_index: t.turnIndex,
        transcript:          t.data.transcript,
        response_text:       t.data.response_text,
        pronunciation:       t.data.pronunciation,
        tokens_used:         t.tokensUsed,
        created_at:          t.createdAt,
      })),
    };
  }
}
