import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, LessThan } from 'typeorm';
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

  /**
   * Returns true when the user has never had a speaking session yet.
   * Used by the greeting route BEFORE a session exists (no sessionId available).
   * Counts all sessions including orphaned/ended ones to stay deterministic.
   */
  async isFirstSession(userId: string): Promise<boolean> {
    const count = await this.repo.count({ where: { userId } });
    return count === 0;
  }

  /**
   * Returns true when the given session is the user's first session ever.
   * Preferred over isFirstSession when a sessionId is in hand (greeting tied to id,
   * turn routing) because it's stable across orphaned-session edge cases.
   */
  async isOnboardingSession(userId: string, sessionId: string): Promise<boolean> {
    if (!sessionId) return false;
    const session = await this.repo.findOne({ where: { id: sessionId, userId } });
    if (!session) return false;
    const earlier = await this.repo.count({
      where: { userId, startedAt: LessThan(session.startedAt) },
    });
    return earlier === 0;
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

    // First-session detection: count AFTER saving. == 1 → this is the user's first
    // ever speaking session (no prior or orphaned rows). Drives the onboarding UI/prompt.
    const totalSessions = await this.repo.count({ where: { userId } });
    const isFirstSession = totalSessions === 1;

    // Fire-and-forget: record session start in billing analytics
    firstValueFrom(
      this.http.post(`${billingUrl}/internal/usage/increment-session`, { user_id: userId }),
    ).catch((err) => console.error('[Session] failed to increment session count in billing:', err?.message));

    return { session_id: session.id, is_first_session: isFirstSession };
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

  async getSessionInsight(userId: string): Promise<any> {
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/session-insight/${userId}`;
    try {
      const { data } = await firstValueFrom<any>(this.http.get<any>(url));
      return data;
    } catch (err: any) {
      console.error(`[Session] session-insight fetch failed:`, err?.message);
      // Fail open: FE treats this as "no insight" and renders nothing.
      return { has_insight: false };
    }
  }

  async getTodayChallenge(userId: string): Promise<string | null> {
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/today-challenge/${userId}`;
    try {
      const { data } = await firstValueFrom<any>(this.http.get<any>(url));
      const mission = data?.active_mission;
      return typeof mission === 'string' && mission.trim() ? mission.trim() : null;
    } catch (err: any) {
      console.error(`[Session] today-challenge fetch failed:`, err?.message);
      return null;
    }
  }

  async setTodayChallenge(userId: string, challenge: string): Promise<any> {
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/today-challenge/${userId}`;
    try {
      const { data } = await firstValueFrom<any>(this.http.put<any>(url, { challenge }));
      return data;
    } catch (err: any) {
      console.error(`[Session] today-challenge save failed:`, err?.message);
      return { active_mission: null, source: 'none' };
    }
  }

  async getOnboardingState(userId: string): Promise<any> {
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/onboarding-state/${userId}`;
    try {
      const { data } = await firstValueFrom<any>(this.http.get<any>(url));
      // Memory-service returns {} when no state — pass it through; the FE
      // treats an empty object as "no insight yet".
      return data ?? {};
    } catch (err: any) {
      console.error(`[Session] onboarding-state fetch failed:`, err?.message);
      return {};
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
