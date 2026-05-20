import { Controller, Get, Post, Delete, Patch, Param, Query, Body } from '@nestjs/common';
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

  @Get('flashcards/archived')
  async getArchivedFlashcards(@Query('userId') userId: string) {
    if (!userId) return [];
    return this.dictionaryService.getArchivedFlashcards(userId);
  }

  @Get('flashcards/review-due')
  async getReviewDue(@Query('userId') userId: string) {
    if (!userId) return [];
    return this.dictionaryService.getReviewDue(userId);
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

  @Patch('flashcards/:id/review')
  async reviewFlashcard(
    @Param('id') id: string,
    @Query('userId') userId: string,
    @Body('result') result: 'easy' | 'again' | 'hard',
  ) {
    if (!userId || !id || !result) return { success: false };
    return this.dictionaryService.reviewFlashcard(id, userId, result);
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
