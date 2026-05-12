import { Controller, Get, Query } from '@nestjs/common';
import { DictionaryService } from './dictionary.service';

@Controller('dictionary')
export class DictionaryController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  @Get('lookup')
  async lookup(
    @Query('word') word: string,
    @Query('context') context: string,
    @Query('userId') userId: string,
  ) {
    return this.dictionaryService.lookup(word, context, userId);
  }
}
