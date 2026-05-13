import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { User } from './entities/user.entity';

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
    return user;
  }

  async update(id: string, data: Partial<Pick<User, 'name' | 'targetLanguage' | 'level' | 'timezone' | 'nativeLanguage' | 'learningGoal'>>) {
    await this.repo.update(id, data);
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
