import {
  Controller, Post, Get, Param, Req, Res,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TurnService } from './turn.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

@Controller('turn')
@UseGuards(JwtAuthGuard)
export class TurnController {
  constructor(
    private turnService: TurnService,
    private http: HttpService,
    private cfg: ConfigService,
  ) {}

  // POST /turn/:session_id — full response (non-streaming)
  @Post(':session_id')
  @UseInterceptors(FileInterceptor('audio'))
  async processTurn(
    @Param('session_id') sessionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req,
  ) {
    console.log(`\n[Turn] ▶ POST /turn/${sessionId}`);
    console.log(`[Turn]   user     : ${req.user?.id}`);
    console.log(`[Turn]   file     : ${file ? `${file.size}b  ${file.mimetype}  "${file.originalname}"` : 'MISSING'}`);

    if (!file) {
      console.error('[Turn] ✖ No audio file in request — check FormData field name is "audio"');
      throw new BadRequestException('No audio file received');
    }

    return this.turnService.processTurn(sessionId, req.user.id, file.buffer, file.mimetype);
  }

  // POST /turn/:session_id/stream — SSE streaming variant
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
      await this.turnService.checkQuota(req.user.id);
      const turnIndex = await this.turnService.getTurnIndex(sessionId);
      const speechUrl = this.cfg.get('SPEECH_SERVICE_URL');
      const memoryUrl = this.cfg.get('MEMORY_SERVICE_URL');
      const llmUrl    = this.cfg.get('LLM_GATEWAY_URL');

      const formData = new FormData();
      formData.append('audio', new Blob([file.buffer as any], { type: file.mimetype || 'audio/webm' }), 'audio.webm');
      const sttRes = await this.http.axiosRef.post(`${speechUrl}/stt`, formData);
      const { transcript, confidence, pronunciation } = sttRes.data;
      send({ type: 'transcript', text: transcript });
      send({ type: 'pronunciation', data: pronunciation });

      const promptRes = await this.http.axiosRef.post(`${memoryUrl}/build-prompt/${req.user.id}`, {
        query: transcript, session_id: sessionId,
      });

      const llmStream = await this.http.axiosRef.post(
        `${llmUrl}/stream`,
        { system: promptRes.data.system_prompt, messages: [{ role: 'user', content: transcript }] },
        { responseType: 'stream' },
      );

      let fullText = '';
      let sentenceBuffer = '';
      let ttsChain: Promise<void> = Promise.resolve();

      llmStream.data.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        fullText += text;
        sentenceBuffer += text;
        // removed send({ type: 'text' }) so frontend syncs with audio

        const match = sentenceBuffer.match(/^([\s\S]*?[.!?]+[\s\n]+)/);
        if (match) {
          const sentence = match[1];
          sentenceBuffer = sentenceBuffer.slice(sentence.length);
          const cleanSentence = sentence.trim();
          if (cleanSentence.length > 0) {
            const ttsPromise = this.http.axiosRef.post(`${speechUrl}/tts`, { text: cleanSentence })
              .catch(e => { console.error('[TTS Stream Error]', e?.message); return null; });
            ttsChain = ttsChain.then(async () => {
              const ttsRes = await ttsPromise;
              if (ttsRes) send({ type: 'audio', audio_b64: ttsRes.data.audio_b64, text: cleanSentence });
            });
          }
        }
      });

      llmStream.data.on('end', async () => {
        const remaining = sentenceBuffer.trim();
        if (remaining.length > 0) {
          const ttsPromise = this.http.axiosRef.post(`${speechUrl}/tts`, { text: remaining })
            .catch(e => { console.error('[TTS Stream Error]', e?.message); return null; });
          ttsChain = ttsChain.then(async () => {
            const ttsRes = await ttsPromise;
            if (ttsRes) send({ type: 'audio', audio_b64: ttsRes.data.audio_b64, text: remaining });
          });
        }

        await ttsChain;

        const tokensUsed = Math.ceil((transcript.length + fullText.length) / 4);
        try {
          await this.turnService.persistStreamedTurn(sessionId, req.user.id, turnIndex, {
            transcript, confidence, pronunciation, response_text: fullText, tokens_used: tokensUsed,
          });
        } catch (e) { console.error('[Turn Persist Error]', e?.message); }

        send({ type: 'done', tokens_used: tokensUsed });
        res.end();
      });
    } catch (err) {
      send({ type: 'error', message: err.message });
      res.end();
    }
  }
}
