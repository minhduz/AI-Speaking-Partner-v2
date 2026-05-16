import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { User } from './entities/user.entity';
import { normalizeVoiceId } from './voice-options';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private repo: Repository<User>,
    private http: HttpService,
    private cfg: ConfigService,
  ) {}

  async findById(id: string) {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    const normalizedVoiceId = normalizeVoiceId(user.voiceId);
    if (normalizedVoiceId !== user.voiceId) {
      await this.repo.update(id, { voiceId: normalizedVoiceId });
      user.voiceId = normalizedVoiceId;
    }
    return user;
  }

  async update(id: string, data: Partial<Pick<User, 'name' | 'targetLanguage' | 'level' | 'timezone' | 'nativeLanguage' | 'learningGoal' | 'voiceId' | 'speechRate' | 'conversationStyle'>>) {
    const patch = { ...data };
    if (patch.voiceId !== undefined) {
      patch.voiceId = normalizeVoiceId(patch.voiceId);
    }
    await this.repo.update(id, patch);
    return this.findById(id);
  }

  async delete(id: string) {
    // Wipe memory facts via memory service
    const memUrl = this.cfg.get('MEMORY_SERVICE_URL');
    await firstValueFrom(
      this.http.delete(`${memUrl}/facts/${id}`),
    ).catch(() => null); // non-critical
    await this.repo.delete(id);
  }

  async wipeMemory(id: string) {
    const memUrl = this.cfg.get('MEMORY_SERVICE_URL');
    await firstValueFrom(this.http.delete(`${memUrl}/facts/${id}`));
    return { message: 'Memory cleared' };
  }
}
