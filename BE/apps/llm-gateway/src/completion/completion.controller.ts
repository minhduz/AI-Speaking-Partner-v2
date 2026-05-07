import { Controller, Post, Body, Res, Get } from '@nestjs/common';
import { Response } from 'express';
import { IsString, IsArray, IsOptional } from 'class-validator';
import { CompletionService, Message } from './completion.service';

class CompleteDto {
  @IsString() system: string;
  @IsArray() messages: Message[];
}

@Controller()
export class CompletionController {
  constructor(private svc: CompletionService) {}

  // POST /complete — full response
  @Post('complete')
  complete(@Body() dto: CompleteDto) {
    return this.svc.complete(dto.system, dto.messages);
  }

  // POST /stream — SSE token stream
  @Post('stream')
  async stream(@Body() dto: CompleteDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      for await (const chunk of this.svc.stream(dto.system, dto.messages)) {
        res.write(chunk);
      }
    } catch (e) {
      res.write(`\n[ERROR] ${e.message}`);
    } finally {
      res.end();
    }
  }

  // GET /health
  @Get('health')
  health() { return { status: 'ok', service: 'llm-gateway' }; }
}
