import { Controller, Get, Post, Delete, Param, Query, Body } from '@nestjs/common';
import { DictionaryService } from './dictionary.service';

@Controller('dictionary')
export class DictionaryController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  @Get('lookup')
  async lookup(
    @Query('word') word: string,
    @Query('context') context: string,
    @Query('userId') userId: string,
    @Query('targetLang') targetLang: string,
  ) {
    return this.dictionaryService.lookup(word, context, userId, targetLang || 'en');
  }

  @Get('flashcards')
  async getFlashcards(@Query('userId') userId: string) {
    if (!userId) return [];
    return this.dictionaryService.getFlashcards(userId);
  }

  @Post('flashcards')
  async addFlashcard(
    @Body('userId') userId: string,
    @Body('cacheId') cacheId: string,
    @Body('contextSentence') contextSentence?: string,
  ) {
    if (!userId || !cacheId) return { success: false };
    const success = await this.dictionaryService.addFlashcard(userId, cacheId, contextSentence);
    return { success };
  }

  @Delete('flashcards/:id')
  async deleteFlashcard(
    @Param('id') id: string,
    @Query('userId') userId: string,
  ) {
    if (!userId || !id) return { success: false };
    const success = await this.dictionaryService.deleteFlashcard(id, userId);
    return { success };
  }
}
