import { Controller, Get, Post, Delete, Param, Query, Req, Body, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('api/dictionary')
@UseGuards(JwtAuthGuard)
export class DictionaryController {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  async getDictionary(
    @Query('word') word: string,
    @Query('context') context: string,
    @Query('targetLang') targetLang: string,
    @Req() req: any,
  ) {
    if (!word) {
      throw new HttpException('Word is required', HttpStatus.BAD_REQUEST);
    }

    const userId: string = req.user?.id ?? null;

    try {
      const dictServiceUrl = this.configService.get<string>('DICTIONARY_SERVICE_URL', 'http://localhost:3005');
      const response = await firstValueFrom(
        this.httpService.get(`${dictServiceUrl}/dictionary/lookup`, {
          params: { word, context, userId, targetLang: targetLang || 'en' },
        }),
      );
      return response.data;
    } catch (error) {
      throw new HttpException('Dictionary service unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  @Get('flashcards')
  async getFlashcards(@Req() req: any) {
    const userId: string = req.user?.id ?? null;
    if (!userId) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    try {
      const dictServiceUrl = this.configService.get<string>('DICTIONARY_SERVICE_URL', 'http://localhost:3005');
      const response = await firstValueFrom(
        this.httpService.get(`${dictServiceUrl}/dictionary/flashcards`, {
          params: { userId },
        }),
      );
      return response.data;
    } catch (error) {
      throw new HttpException('Dictionary service unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  @Post('flashcards')
  async addFlashcard(
    @Req() req: any,
    @Body('cacheId') cacheId: string,
    @Body('contextSentence') contextSentence?: string,
  ) {
    const userId: string = req.user?.id ?? null;
    if (!userId || !cacheId) {
      throw new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
    }

    try {
      const dictServiceUrl = this.configService.get<string>('DICTIONARY_SERVICE_URL', 'http://localhost:3005');
      const response = await firstValueFrom(
        this.httpService.post(`${dictServiceUrl}/dictionary/flashcards`, {
          userId,
          cacheId,
          contextSentence,
        }),
      );
      return response.data;
    } catch (error) {
      throw new HttpException('Dictionary service unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  @Delete('flashcards/:id')
  async deleteFlashcard(
    @Req() req: any,
    @Param('id') id: string,
  ) {
    const userId: string = req.user?.id ?? null;
    if (!userId || !id) {
      throw new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
    }

    try {
      const dictServiceUrl = this.configService.get<string>('DICTIONARY_SERVICE_URL', 'http://localhost:3005');
      const response = await firstValueFrom(
        this.httpService.delete(`${dictServiceUrl}/dictionary/flashcards/${id}`, {
          params: { userId },
        }),
      );
      return response.data;
    } catch (error) {
      throw new HttpException('Dictionary service unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
