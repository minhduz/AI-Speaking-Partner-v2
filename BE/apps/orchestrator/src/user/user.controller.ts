import { Controller, Get, Put, Post, Delete, Body, Req, UseGuards, HttpCode } from '@nestjs/common';
import { IsOptional, IsString, IsIn, IsNumber, Min, Max } from 'class-validator';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserService } from './user.service';
import { ACCEPTED_VOICES, normalizeVoiceId } from './voice-options';

const ALLOWED_STYLES = ['friendly', 'formal', 'casual', 'playful', 'professional'] as const;

class VoicePreviewDto {
  @IsIn(ACCEPTED_VOICES as unknown as string[]) voiceId!: string;
  @IsOptional() @IsNumber() @Min(0.75) @Max(1.5) speechRate?: number;
  @IsOptional() @IsString() text?: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() targetLanguage?: string;
  @IsOptional() @IsString() level?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() nativeLanguage?: string;
  @IsOptional() @IsString() learningGoal?: string;
  @IsOptional() @IsIn(ACCEPTED_VOICES as unknown as string[]) voiceId?: string;
  @IsOptional() @IsNumber() @Min(0.75) @Max(1.5) speechRate?: number;
  @IsOptional() @IsIn(ALLOWED_STYLES as unknown as string[]) conversationStyle?: string;
}

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(
    private userService: UserService,
    private http: HttpService,
    private cfg: ConfigService,
  ) {}

  @Get('me')
  me(@Req() req) { return this.userService.findById(req.user.id); }

  @Put('me')
  update(@Req() req, @Body() dto: UpdateUserDto) {
    return this.userService.update(req.user.id, dto);
  }

  // Sample sentence → /tts on the speech-service. Used by the settings modal so
  // the user can hear a voice + speed before saving the preference.
  @Post('voice-preview')
  async voicePreview(@Body() dto: VoicePreviewDto) {
    const speechUrl = this.cfg.get('SPEECH_SERVICE_URL');
    const text = dto.text?.trim() || 'Hi! This is how I sound. Ready to start practicing?';
    const r = await this.http.axiosRef.post(`${speechUrl}/tts`, {
      text,
      voice: normalizeVoiceId(dto.voiceId),
      speech_rate: dto.speechRate,
    });
    return { audio_b64: r.data.audio_b64, format: r.data.format ?? 'mp3' };
  }

  @Delete('me') @HttpCode(204)
  delete(@Req() req) { return this.userService.delete(req.user.id); }

  @Delete('memory') @HttpCode(204)
  wipeMemory(@Req() req) { return this.userService.wipeMemory(req.user.id); }
}
