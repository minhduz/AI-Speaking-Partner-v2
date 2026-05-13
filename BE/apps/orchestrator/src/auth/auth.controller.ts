import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { AuthService } from './auth.service';

class RegisterDto {
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
  @IsString() name: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() target_language?: string;
  @IsOptional() @IsString() level?: string;
  @IsOptional() @IsString() native_language?: string;
  @IsOptional() @IsString() learning_goal?: string;
}
class LoginDto {
  @IsEmail() email: string;
  @IsString() password: string;
}
class RefreshDto {
  @IsString() refresh_token: string;
}
class GoogleTokenDto {
  @IsString() credential: string; // Google ID token
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login') @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('google') @HttpCode(200)
  async googleAuth(@Body() dto: GoogleTokenDto) {
    return this.auth.verifyGoogleToken(dto.credential);
  }

  @Post('refresh') @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refresh_token);
  }

  @Post('logout') @HttpCode(204)
  logout() { return; }
}
