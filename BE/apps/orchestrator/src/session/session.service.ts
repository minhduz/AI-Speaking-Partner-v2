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

  async getUrgentContext(userId: string): Promise<string> {
    try {
      const res = await firstValueFrom(
        this.http.post(`${this.cfg.get('MEMORY_SERVICE_URL')}/retrieve/${userId}`, {
          query: 'urgent important events today exam appointment',
          session_id: '',
          limit: 5,
        }),
      );
      return res.data?.chunks
        ?.filter((c: any) => c.source === 'urgent')
        ?.map((c: any) => c.text)
        ?.join('\n') ?? '';
    } catch { return ''; }
  }

  private async triggerConsolidation(userId: string, sessionId: string) {
    await firstValueFrom(
      this.http.post(`${this.cfg.get('MEMORY_SERVICE_URL')}/consolidate/${userId}`, {
        session_id: sessionId,
      }),
    );
  }
}
