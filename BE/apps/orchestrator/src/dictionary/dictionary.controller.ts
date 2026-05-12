import { Controller, Get, Query, Req, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
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
          params: { word, context, userId },
        }),
      );
      return response.data;
    } catch (error) {
      throw new HttpException('Dictionary service unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
