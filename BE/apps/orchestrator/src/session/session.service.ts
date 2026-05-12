import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Session } from './entities/session.entity';

@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(Session) private repo: Repository<Session>,
    private http: HttpService,
    private cfg: ConfigService,
  ) {}

  async start(userId: string) {
    const session = this.repo.create({ userId, status: 'active' });
    await this.repo.save(session);
    return { session_id: session.id };
  }

  async end(sessionId: string, userId: string) {
    await this.repo.update(
      { id: sessionId, userId },
      { status: 'ended', endedAt: new Date() },
    );
    // Trigger consolidation async — fire and forget
    this.triggerConsolidation(userId, sessionId).catch(console.error);
    return { session_id: sessionId, status: 'ended' };
  }

  async getGreetingContext(userId: string): Promise<string> {
    try {
      const res = await firstValueFrom(
        this.http.post(`${this.cfg.get('MEMORY_SERVICE_URL')}/retrieve/${userId}`, {
          query: 'important events today upcoming exams appointments goals plans',
          session_id: '',
          limit: 10,
          layers: ['urgent', 'long_term'],
        }),
      );
      const chunks: any[] = res.data?.chunks ?? [];
      return chunks
        .filter((c) => c.source === 'urgent' || (c.source === 'long_term' && c.score > 0.5))
        .map((c) => c.text)
        .join('\n');
    } catch { return ''; }
  }

  async list(userId: string, page: number, limit: number) {
    const [items, total] = await this.repo.findAndCount({
      where: { userId, isArchived: false },
      order: { startedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      select: ['id', 'title', 'status', 'startedAt'],
    });
    return { items, total, page, limit, hasMore: (page - 1) * limit + items.length < total };
  }

  private async triggerConsolidation(userId: string, sessionId: string) {
    await firstValueFrom(
      this.http.post(`${this.cfg.get('MEMORY_SERVICE_URL')}/consolidate/${userId}`, {
        session_id: sessionId,
      }),
    );
  }
}
