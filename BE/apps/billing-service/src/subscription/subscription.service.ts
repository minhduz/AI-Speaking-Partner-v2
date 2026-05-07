import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Subscription } from './entities/subscription.entity';
import { PlansService } from '../plans/plans.service';

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(Subscription) private repo: Repository<Subscription>,
    private plans: PlansService,
  ) {}

  // Called on register — assign free plan
  async initFree(userId: string) {
    const freePlan = await this.plans.findByName('free');
    const sub = this.repo.create({
      userId,
      planId:             freePlan.id,
      status:             'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd:   new Date('2099-12-31'),  // free never expires
      autoRenew:          false,
    });
    await this.repo.save(sub);
    return sub;
  }

  // Called by webhook after SePay confirms payment
  async activate(userId: string, planId: string) {
    const plan = await this.plans.findById(planId);
    const now  = new Date();
    const end  = new Date(now);

    if (plan.interval === 'month') end.setMonth(end.getMonth() + 1);
    else if (plan.interval === 'year') end.setFullYear(end.getFullYear() + 1);

    // Deactivate existing sub
    await this.repo.update({ userId, status: 'active' }, { status: 'superseded' });

    const sub = this.repo.create({
      userId,
      planId,
      status:             'active',
      currentPeriodStart: now,
      currentPeriodEnd:   end,
      autoRenew:          false,
    });
    await this.repo.save(sub);
    return sub;
  }

  async cancel(userId: string) {
    await this.repo.update(
      { userId, status: 'active' },
      { autoRenew: false, cancelledAt: new Date() },
    );
    const sub = await this.getActive(userId);
    return { status: sub?.status, current_period_end: sub?.currentPeriodEnd };
  }

  async getActive(userId: string) {
    return this.repo.findOne({
      where: { userId, status: 'active' },
      relations: ['plan'],
      order: { createdAt: 'DESC' },
    });
  }

  async getForUser(userId: string) {
    const sub = await this.getActive(userId);
    if (!sub) return null;
    return {
      plan:               sub.plan,
      status:             sub.status,
      current_period_end: sub.currentPeriodEnd,
      auto_renew:         sub.autoRenew,
      cancelled_at:       sub.cancelledAt,
    };
  }

  // Cron: expire subscriptions that have passed their period end
  @Cron(CronExpression.EVERY_HOUR)
  async expireSubscriptions() {
    const expired = await this.repo.find({
      where: { status: 'active', currentPeriodEnd: LessThanOrEqual(new Date()) },
    });
    for (const sub of expired) {
      // Revert to free
      const freePlan = await this.plans.findByName('free');
      await this.repo.update(sub.id, { status: 'expired' });
      await this.initFree(sub.userId);
    }
    if (expired.length) console.log(`[Billing] Expired ${expired.length} subscriptions`);
  }
}
