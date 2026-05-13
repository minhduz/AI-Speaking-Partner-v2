import {
  Controller, Get, Post, Param, Query, Req, Res,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TurnService } from './turn.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

const SENTENCE_BOUNDARY = /^([\s\S]*?[.!?]+\s+)/;

function getCurrentDatetime(timezone: string, date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return date.toUTCString();
  }
}

@Controller('turn')
@UseGuards(JwtAuthGuard)
export class TurnController {
  constructor(
    private readonly turnService: TurnService,
    private readonly http: HttpService,
    private readonly cfg: ConfigService,
  ) {}

  // GET /turn/by-session/:session_id?page=1&limit=20 — paginated turn history
  @Get('by-session/:session_id')
  getTurnsBySession(
    @Param('session_id') sessionId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Req() req,
  ) {
    return this.turnService.getBySession(sessionId, req.user.id, +page, +limit);
  }

  // POST /turn/:session_id — full response (non-streaming fallback)
  @Post(':session_id')
  @UseInterceptors(FileInterceptor('audio'))
  async processTurn(
    @Param('session_id') sessionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req,
  ) {
    const fileInfo = file ? `${file.size}b  ${file.mimetype}  "${file.originalname}"` : 'MISSING';
    console.log(`\n[Turn] ▶ POST /turn/${sessionId}`);
    console.log(`[Turn]   user     : ${req.user?.id}`);
    console.log(`[Turn]   file     : ${fileInfo}`);

    if (!file) {
      console.error('[Turn] ✖ No audio file in request — check FormData field name is "audio"');
      throw new BadRequestException('No audio file received');
    }

    return this.turnService.processTurn(sessionId, req.user.id, file.buffer, file.mimetype);
  }

  // POST /turn/:session_id/stream — SSE streaming via turn-agent
  @Post(':session_id/stream')
  @UseInterceptors(FileInterceptor('audio'))
  async streamTurn(
    @Param('session_id') sessionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    if (!file) {
      send({ type: 'error', message: 'No audio provided' });
      res.end();
      return;
    }

    try {
      // Parallel: user entity + turn index + limits + current session tokens
      const [user, turnIndex, limitsRes, sessionTokens] = await Promise.all([
        this.turnService.getUserEntity(req.user.id),
        this.turnService.getTurnIndex(sessionId),
        this.http.axiosRef
          .get(`${this.cfg.get('BILLING_SERVICE_URL')}/internal/limits/${req.user.id}`)
          .catch(() => ({ data: { is_unlimited: false, session_token_limit: 30000 } })),
        this.turnService.getSessionTokens(sessionId),
      ]);

      const limits = limitsRes.data;

      // Session token limit check (free users only)
      if (!limits.is_unlimited && sessionTokens >= limits.session_token_limit) {
        send({ type: 'error', message: 'SESSION_TOKEN_LIMIT_REACHED', limit: limits.session_token_limit });
        res.end();
        return;
      }

      // Resolve current datetime
      const clientIso = req.headers['x-client-datetime'];
      const currentDatetime = clientIso
        ? (() => {
            try {
              const d = new Date(clientIso);
              return isNaN(d.getTime())
                ? getCurrentDatetime(user?.timezone ?? 'UTC')
                : getCurrentDatetime(user?.timezone ?? 'UTC', d);
            } catch { return getCurrentDatetime(user?.timezone ?? 'UTC'); }
          })()
        : getCurrentDatetime(user?.timezone ?? 'UTC');

      // Forward audio + context to turn-agent
      const formData = new FormData();
      formData.append(
        'audio',
        new Blob([file.buffer as any], { type: file.mimetype || 'audio/webm' }),
        'audio.webm',
      );

      const upstream = await this.http.axiosRef.post(
        `${this.cfg.get('TURN_AGENT_URL')}/turn/stream`,
        formData,
        {
          responseType: 'stream',
          headers: {
            'X-User-Id':          req.user.id,
            'X-Session-Id':       sessionId,
            'X-Turn-Index':       String(turnIndex),
            'X-User-Name':        user?.name ?? '',
            'X-User-Level':       user?.level ?? 'beginner',
            'X-Target-Language':  user?.targetLanguage ?? 'english',
            'X-User-Timezone':    user?.timezone ?? 'UTC',
            'X-Current-Datetime': currentDatetime,
          },
        },
      );

      // Pipe turn-agent SSE stream directly to client
      upstream.data.pipe(res);
      upstream.data.on('error', (err: Error) => {
        console.error('[Turn][proxy] upstream stream error:', err.message);
        if (!res.writableEnded) {
          send({ type: 'error', message: 'upstream stream failed' });
          res.end();
        }
      });

    } catch (err: any) {
      console.error('[Turn][stream] FAILED:', err?.message ?? err);
      if (err?.response) {
        console.error('[Turn][stream] upstream status:', err.response.status);
        const body = typeof err.response.data === 'string'
          ? err.response.data
          : JSON.stringify(err.response.data ?? '');
        console.error('[Turn][stream] upstream body:', body.slice(0, 500));
      }
      send({ type: 'error', message: err?.message ?? 'stream failed' });
      res.end();
    }
  }
}
