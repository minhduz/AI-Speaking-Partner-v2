import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as bcrypt from 'bcryptjs';
import { User } from '../user/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    private jwt: JwtService,
    private cfg: ConfigService,
    private http: HttpService,
  ) {}

  async register(email: string, password: string, name: string, timezone?: string) {
    const exists = await this.userRepo.findOne({ where: { email } });
    if (exists) throw new ConflictException('Email already registered');
    const passwordHash = await bcrypt.hash(password, 10);
    const user = this.userRepo.create({ email, passwordHash, name, timezone });
    await this.userRepo.save(user);

    // Initialise free subscription — fire and forget (non-blocking)
    const billingUrl = this.cfg.get('BILLING_SERVICE_URL');
    firstValueFrom(
      this.http.post(`${billingUrl}/subscription/internal/subscription/init-free/${user.id}`, {}),
    ).catch((err) =>
      console.error('[Auth] Failed to init free subscription:', err.message),
    );

    return this.tokens(user);
  }

  async login(email: string, password: string) {
    const user = await this.userRepo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email })
      .getOne();
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return this.tokens(user);
  }

  async refresh(token: string) {
    try {
      const payload = this.jwt.verify(token, { secret: this.cfg.get('JWT_SECRET') });
      const user = await this.userRepo.findOne({ where: { id: payload.sub } });
      if (!user) throw new UnauthorizedException();
      return {
        access_token: this.jwt.sign(
          { sub: user.id, email: user.email },
          { expiresIn: this.cfg.get('JWT_EXPIRES_IN') },
        ),
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private tokens(user: User) {
    const payload = { sub: user.id, email: user.email };
    return {
      user: { id: user.id, name: user.name, email: user.email },
      access_token: this.jwt.sign(payload),
      refresh_token: this.jwt.sign(payload, {
        expiresIn: this.cfg.get('JWT_REFRESH_EXPIRES_IN'),
      }),
    };
  }
}
