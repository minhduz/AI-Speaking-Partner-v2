import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usage } from './usage.entity';
import { SubscriptionService } from '../subscription/subscription.service';

@Injectable()
export class UsageService {
  constructor(
    @InjectRepository(Usage) private repo: Repository<Usage>,
    private subscriptions: SubscriptionService,
  ) {}

  // Called by orchestrator quota guard before every turn
  async checkQuota(userId: string): Promise<{ allowed: boolean; tokens_used: number; tokens_limit: number }> {
    const sub = await this.subscriptions.getActive(userId);
    if (!sub) return { allowed: false, tokens_used: 0, tokens_limit: 0 };

    const tokenLimit = sub.plan.tokenLimit;
    if (tokenLimit === -1) return { allowed: true, tokens_used: 0, tokens_limit: -1 };

    const usage = await this._getOrCreate(userId);
    return {
      allowed:      usage.tokensUsed < tokenLimit,
      tokens_used:  usage.tokensUsed,
      tokens_limit: tokenLimit,
    };
  }

  // Called after every turn to record consumption
  async increment(userId: string, tokensUsed: number) {
    const usage = await this._getOrCreate(userId);
    await this.repo.update(usage.id, {
      tokensUsed:   usage.tokensUsed + tokensUsed,
      sessionsUsed: usage.sessionsUsed,
    });
  }

  // Called by orchestrator on session start
  async incrementSession(userId: string) {
    const usage = await this._getOrCreate(userId);
    await this.repo.update(usage.id, { sessionsUsed: usage.sessionsUsed + 1 });
  }

  async getUsage(userId: string) {
    const sub   = await this.subscriptions.getActive(userId);
    const usage = await this._getOrCreate(userId);
    const tl    = sub?.plan?.tokenLimit ?? 50000;
    const sl    = sub?.plan?.sessionLimit ?? 10;
    return {
      tokens_used:      usage.tokensUsed,
      tokens_limit:     tl,
      tokens_percent:   tl === -1 ? 0 : Math.round((usage.tokensUsed / tl) * 100),
      sessions_used:    usage.sessionsUsed,
      sessions_limit:   sl,
      sessions_percent: sl === -1 ? 0 : Math.round((usage.sessionsUsed / sl) * 100),
      resets_at:        usage.periodEnd,
    };
  }

  private async _getOrCreate(userId: string): Promise<Usage> {
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    let usage = await this.repo.findOne({ where: { userId, periodStart: start } });
    if (!usage) {
      usage = this.repo.create({ userId, periodStart: start, periodEnd: end });
      await this.repo.save(usage);
    }
    return usage;
  }
}
