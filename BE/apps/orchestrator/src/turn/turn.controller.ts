import {
  Controller, Get, Post, Param, Query, Req, Res, Body,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TurnService } from './turn.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { normalizeVoiceId } from '../user/voice-options';

const SENTENCE_BOUNDARY = /^([\s\S]*?[.!?]+\s+)/;

type UploadedAudioFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

// Take the first whitespace-separated word so the agent addresses the user by a
// single given name (e.g. "Đức" from "Đức Nguyễn Minh") instead of the full name.
function firstName(fullName: string | null | undefined): string {
  if (!fullName) return '';
  return fullName.trim().split(/\s+/)[0] ?? '';
}

// HTTP headers default to ISO-8859-1, which silently drops Vietnamese diacritics
// (Đ, ứ, ễ …). URL-encode any field that may carry non-ASCII before sending; the
// turn-agent decodes on receipt.
function encodeHeader(value: string | null | undefined): string {
  return encodeURIComponent(value ?? '');
}

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

  // POST /turn/:session_id/stream-text — SSE streaming when FE has already transcribed via STT WebSocket
  @Post(':session_id/stream-text')
  async streamTurnText(
    @Param('session_id') sessionId: string,
    @Body() body: { transcript: string },
    @Req() req,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      const [user, turnIndex, limitsRes, sessionTokens, isOnboarding, activeMission, deck] = await Promise.all([
        this.turnService.getUserEntity(req.user.id),
        this.turnService.getTurnIndex(sessionId),
        this.http.axiosRef
          .get(`${this.cfg.get('BILLING_SERVICE_URL')}/internal/limits/${req.user.id}`)
          .catch(() => ({ data: { is_unlimited: false, session_token_limit: 30000 } })),
        this.turnService.getSessionTokens(sessionId),
        this.turnService.isOnboardingSession(req.user.id, sessionId),
        this.turnService.getActiveMission(req.user.id),
        this.turnService.getDeckInfo(sessionId),
      ]);

      const limits = limitsRes.data;
      if (!limits.is_unlimited && sessionTokens >= limits.session_token_limit) {
        send({ type: 'error', message: 'SESSION_TOKEN_LIMIT_REACHED', limit: limits.session_token_limit });
        res.end();
        return;
      }

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

      const upstream = await this.http.axiosRef.post(
        `${this.cfg.get('TURN_AGENT_URL')}/turn/stream-text`,
        { transcript: body.transcript },
        {
          responseType: 'stream',
          headers: {
            'X-User-Id':            req.user.id,
            'X-Session-Id':         sessionId,
            'X-Turn-Index':         String(turnIndex),
            'X-User-Name':          encodeHeader(firstName(user?.name)),
            'X-User-Level':         user?.level ?? 'beginner',
            'X-Target-Language':    user?.targetLanguage ?? 'english',
            'X-Native-Language':    user?.nativeLanguage ?? 'vietnamese',
            'X-Learning-Goal':      encodeHeader(user?.learningGoal),
            'X-User-Timezone':      user?.timezone ?? 'UTC',
            'X-Current-Datetime':   currentDatetime,
            'X-Is-Onboarding':      isOnboarding ? 'true' : 'false',
            'X-Active-Mission':     activeMission ? encodeURIComponent(activeMission) : '',
            'X-Voice-Id':           normalizeVoiceId(user?.voiceId),
            'X-Speech-Rate':        String(user?.speechRate ?? 1.0),
            'X-Conversation-Style': user?.conversationStyle ?? 'friendly',
            'X-Deck-Active':             deck.active ? 'true' : 'false',
            'X-Deck-Status':             deck.status || 'none',
            'X-Card-Index':              String(deck.current_card_index),
            'X-Card-Total':              String(deck.total_cards),
            'X-Card-Type':               deck.current_card?.type ?? '',
            'X-Card-Title':              encodeHeader(deck.current_card?.title),
            'X-Card-Task':               encodeHeader(deck.current_card?.task),
            'X-Card-Attempts':           String(deck.current_card?.attempts ?? 0),
            'X-Card-Retry-Allowed':      deck.current_card?.retry_allowed ? 'true' : 'false',
            'X-Card-Success-Criteria':   encodeHeader(JSON.stringify(deck.current_card?.success_criteria ?? [])),
          },
        },
      );

      upstream.data.pipe(res);
      upstream.data.on('error', (err: Error) => {
        if (!res.writableEnded) {
          send({ type: 'error', message: 'upstream stream failed' });
          res.end();
        }
      });
    } catch (err: any) {
      send({ type: 'error', message: err?.message ?? 'stream failed' });
      res.end();
    }
  }

  // POST /turn/:session_id — full response (non-streaming fallback)
  @Post(':session_id')
  @UseInterceptors(FileInterceptor('audio'))
  async processTurn(
    @Param('session_id') sessionId: string,
    @UploadedFile() file: UploadedAudioFile,
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
    @UploadedFile() file: UploadedAudioFile,
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
      // Parallel: user entity + turn index + limits + current session tokens + onboarding flag
      const [user, turnIndex, limitsRes, sessionTokens, isOnboarding, activeMission, deck] = await Promise.all([
        this.turnService.getUserEntity(req.user.id),
        this.turnService.getTurnIndex(sessionId),
        this.http.axiosRef
          .get(`${this.cfg.get('BILLING_SERVICE_URL')}/internal/limits/${req.user.id}`)
          .catch(() => ({ data: { is_unlimited: false, session_token_limit: 30000 } })),
        this.turnService.getSessionTokens(sessionId),
        this.turnService.isOnboardingSession(req.user.id, sessionId),
        this.turnService.getActiveMission(req.user.id),
        this.turnService.getDeckInfo(sessionId),
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
            'X-User-Id':            req.user.id,
            'X-Session-Id':         sessionId,
            'X-Turn-Index':         String(turnIndex),
            'X-User-Name':          encodeHeader(firstName(user?.name)),
            'X-User-Level':         user?.level ?? 'beginner',
            'X-Target-Language':    user?.targetLanguage ?? 'english',
            'X-Native-Language':    user?.nativeLanguage ?? 'vietnamese',
            'X-Learning-Goal':      encodeHeader(user?.learningGoal),
            'X-User-Timezone':      user?.timezone ?? 'UTC',
            'X-Current-Datetime':   currentDatetime,
            'X-Is-Onboarding':      isOnboarding ? 'true' : 'false',
            'X-Active-Mission':     activeMission ? encodeURIComponent(activeMission) : '',
            'X-Voice-Id':           normalizeVoiceId(user?.voiceId),
            'X-Speech-Rate':        String(user?.speechRate ?? 1.0),
            'X-Conversation-Style': user?.conversationStyle ?? 'friendly',
            'X-Deck-Active':             deck.active ? 'true' : 'false',
            'X-Deck-Status':             deck.status || 'none',
            'X-Card-Index':              String(deck.current_card_index),
            'X-Card-Total':              String(deck.total_cards),
            'X-Card-Type':               deck.current_card?.type ?? '',
            'X-Card-Title':              encodeHeader(deck.current_card?.title),
            'X-Card-Task':               encodeHeader(deck.current_card?.task),
            'X-Card-Attempts':           String(deck.current_card?.attempts ?? 0),
            'X-Card-Retry-Allowed':      deck.current_card?.retry_allowed ? 'true' : 'false',
            'X-Card-Success-Criteria':   encodeHeader(JSON.stringify(deck.current_card?.success_criteria ?? [])),
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
