import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TurnAudioService } from './turn-audio.service';

// Multipart text fields arrive as strings; coerce the numeric ones.
class TurnAudioMetaDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) turn_index?: number;
  @IsOptional() @IsString() lesson_attempt_id?: string;
  @IsOptional() @IsString() transcript?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) duration_ms?: number;
  @IsOptional() @IsString() client_turn_id?: string;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class TurnAudioController {
  constructor(private turnAudio: TurnAudioService) {}

  // POST /session/:id/turn-audio — upload one user turn's audio (multipart).
  @Post('session/:id/turn-audio')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async upload(
    @Req() req,
    @Param('id') sessionId: string,
    @UploadedFile() file: { buffer: Buffer; mimetype?: string; size?: number } | undefined,
    @Body() body: TurnAudioMetaDto,
  ) {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('Missing audio file');
    }
    return this.turnAudio.recordTurnAudio(req.user.id, sessionId, file, {
      turnIndex: body.turn_index ?? null,
      lessonAttemptId: body.lesson_attempt_id ?? null,
      transcript: body.transcript ?? null,
      durationMs: body.duration_ms ?? null,
      clientTurnId: body.client_turn_id ?? null,
    });
  }

  // GET /turn-audio/:id/play-url — short-lived signed URL for playback.
  @Get('turn-audio/:id/play-url')
  playUrl(@Req() req, @Param('id') id: string) {
    return this.turnAudio.getPlayUrl({ id: req.user.id, role: req.user.role }, id);
  }
}
