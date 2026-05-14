import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
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

  async countTodaySessions(userId: string): Promise<number> {
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    return this.repo.count({ where: { userId, startedAt: MoreThanOrEqual(todayMidnight) } });
  }

  async start(userId: string) {
    const billingUrl = this.cfg.get<string>('BILLING_SERVICE_URL');
    let limits = { is_unlimited: false, daily_session_limit: 10, session_token_limit: 30000 };
    try {
      const { data } = await firstValueFrom(
        this.http.get<any>(`${billingUrl}/internal/limits/${userId}`),
      );
      limits = data;
    } catch { /* fail open if billing unreachable */ }

    if (!limits.is_unlimited) {
      const todayCount = await this.countTodaySessions(userId);
      if (todayCount >= limits.daily_session_limit) {
        throw new HttpException(
          { error: 'SESSION_LIMIT_REACHED', limit: limits.daily_session_limit, used: todayCount },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // Close any orphaned active sessions (e.g. page refresh without clicking "New Chat")
    // and trigger consolidation for each, so long-term memory is not lost.
    const orphaned = await this.repo.find({ where: { userId, status: 'active' }, select: ['id'] });
    if (orphaned.length > 0) {
      console.log(`[Session] closing ${orphaned.length} orphaned session(s) for user ${userId}`);
      await this.repo.update(
        orphaned.map((s) => s.id),
        { status: 'ended', endedAt: new Date() },
      );
      for (const s of orphaned) {
        this.triggerConsolidation(userId, s.id).catch(console.error);
      }
    }

    const session = this.repo.create({ userId, status: 'active' });
    await this.repo.save(session);

    // Fire-and-forget: record session start in billing analytics
    firstValueFrom(
      this.http.post(`${billingUrl}/internal/usage/increment-session`, { user_id: userId }),
    ).catch((err) => console.error('[Session] failed to increment session count in billing:', err?.message));

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
    // Short-term memory is now user-scoped (rolling buffer), so we can always
    // retrieve recent conversation context regardless of the current session.
    const prefix = `[Greeting][getGreetingContext] user=${userId}`;
    const payload = {
      query: 'recent conversation context',
      session_id: '',   // not used for short-term retrieval (user-scoped now)
      limit: 3,
      layers: ['short_term'],
    };
    console.log(`${prefix} → POST /retrieve layers=${JSON.stringify(payload.layers)}`);
    try {
      const res = await firstValueFrom(
        this.http.post(`${this.cfg.get('MEMORY_SERVICE_URL')}/retrieve/${userId}`, payload),
      );
      const chunks: any[] = res.data?.chunks ?? [];
      console.log(`${prefix} ← ${chunks.length} chunks returned:`);
      chunks.forEach((c, i) =>
        console.log(`  [${i}] source=${c.source} score=${c.score?.toFixed(3)} text="${String(c.text).slice(0, 80)}"`)
      );
      const context = chunks.map((c) => c.text).join('\n');
      console.log(`${prefix} context=${context ? `"${context.slice(0, 120)}..."` : 'empty'}`);
      return context;
    } catch (err: any) {
      console.error(`${prefix} ✖ failed:`, err?.message);
      return '';
    }
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
    console.log(`[Consolidation] ── triggering ───────────────────────`);
    console.log(`[Consolidation]   user    : ${userId}`);
    console.log(`[Consolidation]   session : ${sessionId}`);
    try {
      const res = await firstValueFrom(
        this.http.post(`${this.cfg.get('MEMORY_SERVICE_URL')}/consolidate/${userId}`, {
          session_id: sessionId,
        }),
      );
      console.log(`[Consolidation] queued → memory-service responded:`, res.data);
    } catch (err: any) {
      console.error(`[Consolidation] ✖ failed to queue — memory-service unreachable:`, err?.message);
    }
  }
}
