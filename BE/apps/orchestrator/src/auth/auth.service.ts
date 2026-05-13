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

  async register(dto: {
    email: string; password: string; name: string; timezone?: string;
    target_language?: string; level?: string; native_language?: string; learning_goal?: string;
  }) {
    const exists = await this.userRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already registered');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      email: dto.email, passwordHash, name: dto.name, timezone: dto.timezone,
      targetLanguage: dto.target_language, level: dto.level,
      nativeLanguage: dto.native_language, learningGoal: dto.learning_goal,
    });
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

  async googleLogin(profile: { email: string; name: string; googleId: string }) {
    // Try to find existing user by googleId or email
    let user = await this.userRepo.findOne({ where: [
      { googleId: profile.googleId },
      { email: profile.email },
    ] });

    const isNewUser = !user;

    if (user && !user.googleId) {
      // Link existing email account to Google
      user.googleId = profile.googleId;
      await this.userRepo.save(user);
    }

    if (!user) {
      // Create new user without password
      user = this.userRepo.create({
        email: profile.email,
        name: profile.name,
        googleId: profile.googleId,
        passwordHash: '', // no password for Google users
      });
      await this.userRepo.save(user);
    }

    // Init free subscription for new users
    if (isNewUser) {
      const billingUrl = this.cfg.get('BILLING_SERVICE_URL');
      firstValueFrom(
        this.http.post(`${billingUrl}/subscription/internal/subscription/init-free/${user.id}`, {}),
      ).catch((err) =>
        console.error('[Auth] Failed to init free subscription:', err.message),
      );
    }

    return { ...this.tokens(user), isNewUser };
  }

  async verifyGoogleToken(idToken: string) {
    // Verify the Google ID token via Google's tokeninfo endpoint
    const res = await firstValueFrom(
      this.http.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`),
    ).catch(() => null);

    if (!res || !res.data?.email) {
      throw new UnauthorizedException('Invalid Google token');
    }

    const { sub: googleId, email, name } = res.data;

    // Verify the audience matches our client ID
    const clientId = this.cfg.get('GOOGLE_CLIENT_ID');
    if (clientId && res.data.aud !== clientId) {
      throw new UnauthorizedException('Google token audience mismatch');
    }

    return this.googleLogin({ email, name: name || email.split('@')[0], googleId });
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
