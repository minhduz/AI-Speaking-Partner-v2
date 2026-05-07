import { Controller, Post, Get, Param, Body, UseGuards, Req, Res, HttpCode } from '@nestjs/common';
import { Response } from 'express';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SessionService } from './session.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

class EndSessionDto { @IsString() session_id: string; }

@Controller('session')
@UseGuards(JwtAuthGuard)
export class SessionController {
  constructor(
    private sessionService: SessionService,
    private http: HttpService,
    private cfg: ConfigService,
  ) {}

  // POST /session/start → { session_id }  returns in ~5ms
  @Post('start')
  start(@Req() req) { return this.sessionService.start(req.user.id); }

  // GET /session/:id/greeting/stream → SSE
  @Get(':id/greeting/stream')
  async greetingStream(@Param('id') sessionId: string, @Req() req, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      // 1. Fetch urgent memory context (exam, appointments)
      const urgentContext = await this.sessionService.getUrgentContext(req.user.id);

      // 2. Stream greeting from LLM gateway
      const llmRes = await this.http.axiosRef.post(
        `${this.cfg.get('LLM_GATEWAY_URL')}/stream`,
        {
          system: `You are a friendly English speaking coach.
${urgentContext ? `Important — user context: ${urgentContext}` : ''}
Greet the user warmly and open the session. Max 2 sentences.`,
          messages: [{ role: 'user', content: 'start' }],
        },
        { responseType: 'stream' },
      );

      let fullText = '';
      llmRes.data.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        fullText += text;
        send({ type: 'text', chunk: text });
      });

      llmRes.data.on('end', async () => {
        try {
          const ttsRes = await this.http.axiosRef.post(
            `${this.cfg.get('SPEECH_SERVICE_URL')}/tts`,
            { text: fullText },
          );
          send({ type: 'audio', audio_b64: ttsRes.data.audio_b64 });
        } catch { /* TTS failure non-critical */ }
        send({ type: 'done', greeting: fullText });
        res.end();
      });
    } catch {
      send({ type: 'error', message: 'Failed to generate greeting' });
      res.end();
    }
  }

  // POST /session/end
  @Post('end') @HttpCode(200)
  end(@Body() dto: EndSessionDto, @Req() req) {
    return this.sessionService.end(dto.session_id, req.user.id);
  }
}
