import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usage } from './usage.entity';
import { SubscriptionService } from '../subscription/subscription.service';
import { AddonService } from '../addon/addon.service';

export interface QuotaResult {
  allowed: boolean;
  tokens_used: number;
  tokens_limit: number;      // subscription limit; -1 = unlimited
  addon_balance: number;     // remaining add-on tokens
  percent_used: number;      // subscription usage % (capped at 100)
  reset_date: string;        // ISO date of next monthly reset
}

@Injectable()
export class UsageService {
  constructor(
    @InjectRepository(Usage) private readonly repo: Repository<Usage>,
    private readonly subscriptions: SubscriptionService,
    private readonly addonService: AddonService,
  ) {}

  // Called by orchestrator before every turn
  async checkQuota(userId: string): Promise<QuotaResult> {
    const sub = await this.subscriptions.getActive(userId);
    if (!sub) {
      return { allowed: false, tokens_used: 0, tokens_limit: 0, addon_balance: 0, percent_used: 100, reset_date: '' };
    }

    const tokenLimit = sub.plan.tokenLimit;

    if (tokenLimit === -1) {
      return { allowed: true, tokens_used: 0, tokens_limit: -1, addon_balance: 0, percent_used: 0, reset_date: '' };
    }

    const [usage, addonBalance] = await Promise.all([
      this._getOrCreate(userId),
      this.addonService.getBalance(userId),
    ]);

    const subscriptionAllowed = usage.tokensUsed < tokenLimit;
    const addonAllowed        = addonBalance > 0;
    const percentUsed         = Math.min(100, Math.round((usage.tokensUsed / tokenLimit) * 100));

    return {
      allowed:       subscriptionAllowed || addonAllowed,
      tokens_used:   usage.tokensUsed,
      tokens_limit:  tokenLimit,
      addon_balance: addonBalance,
      percent_used:  percentUsed,
      reset_date:    usage.periodEnd.toISOString(),
    };
  }

  // Called after every turn to record consumption
  async increment(userId: string, tokensUsed: number) {
    const usage = await this._getOrCreate(userId);
    const newTokensUsed = usage.tokensUsed + tokensUsed;
    await this.repo.update(usage.id, { tokensUsed: newTokensUsed });

    // Deduct from add-on balance if subscription quota is exceeded
    const sub = await this.subscriptions.getActive(userId);
    const limit = sub?.plan?.tokenLimit ?? 0;
    if (limit !== -1 && newTokensUsed > limit) {
      const prevExcess = Math.max(0, usage.tokensUsed - limit);
      const newExcess  = newTokensUsed - limit;
      const overflow   = newExcess - prevExcess;
      if (overflow > 0) {
        await this.addonService.deductTokens(userId, overflow).catch(() => {});
      }
    }
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
