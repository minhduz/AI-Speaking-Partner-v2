import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usage } from './usage.entity';
import { SubscriptionService } from '../subscription/subscription.service';

@Injectable()
export class UsageService {
  constructor(
    @InjectRepository(Usage) private readonly repo: Repository<Usage>,
    private readonly subscriptions: SubscriptionService,
  ) {}

  // Returns plan limits: free = 10 sessions/day + 30k tokens/session; subscribed = unlimited
  async getLimits(userId: string): Promise<{ is_unlimited: boolean; daily_session_limit: number; session_token_limit: number }> {
    const sub = await this.subscriptions.getActive(userId);
    if (sub && sub.plan.tokenLimit === -1) {
      return { is_unlimited: true, daily_session_limit: -1, session_token_limit: -1 };
    }
    return { is_unlimited: false, daily_session_limit: 10, session_token_limit: 30000 };
  }

  // Called by turn-agent after every turn — records usage for analytics only
  // Per-session token enforcement is handled by the orchestrator before forwarding to turn-agent
  async increment(userId: string, tokensUsed: number) {
    const usage = await this._getOrCreate(userId);
    await this.repo.update(usage.id, { tokensUsed: usage.tokensUsed + tokensUsed });
  }

  // Called by orchestrator on session start — tracks monthly session count for analytics
  async incrementSession(userId: string) {
    const usage = await this._getOrCreate(userId);
    await this.repo.update(usage.id, { sessionsUsed: usage.sessionsUsed + 1 });
  }

  async getUsage(userId: string) {
    const [limits, usage] = await Promise.all([
      this.getLimits(userId),
      this._getOrCreate(userId),
    ]);
    return {
      is_unlimited:        limits.is_unlimited,
      daily_session_limit: limits.daily_session_limit,
      session_token_limit: limits.session_token_limit,
      tokens_used:         usage.tokensUsed,   // cumulative this billing period (analytics)
      sessions_used:       usage.sessionsUsed, // cumulative this billing period (analytics)
      resets_at:           usage.periodEnd,
    };
  }

  private async _getOrCreate(userId: string): Promise<Usage> {
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    let usage = await this.repo.findOne({ where: { userId, periodStart: start } });
    if (!usage) {
      try {
        usage = this.repo.create({ userId, periodStart: start, periodEnd: end });
        await this.repo.save(usage);
      } catch (err: any) {
        // Handle race condition: another request already inserted the record
        if (err?.code === '23505') {
          usage = await this.repo.findOne({ where: { userId, periodStart: start } });
        } else {
          throw err;
        }
      }
    }
    return usage!;
  }
}
