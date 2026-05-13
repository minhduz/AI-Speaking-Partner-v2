import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DictionaryCache } from './entities/dictionary-cache.entity';
import { DictionaryHistory } from './entities/dictionary-history.entity';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class DictionaryService {
  private readonly logger = new Logger(DictionaryService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @InjectRepository(DictionaryCache)
    private readonly cacheRepo: Repository<DictionaryCache>,
    @InjectRepository(DictionaryHistory)
    private readonly historyRepo: Repository<DictionaryHistory>,
  ) {}

  async lookup(word: string, contextSentence: string | undefined, userId: string, targetLang = 'en'): Promise<any> {
    const normalized = word.trim().toLowerCase().split(/\s+/)[0];
    word = normalized;

    // 1. Check DB Cache — keyed by (word, targetLang)
    let cacheEntry = await this.cacheRepo.findOne({ where: { word, language: targetLang } });

    let dictionaryData: any;

    if (cacheEntry) {
      this.logger.log(`Cache hit for word: ${word} [${targetLang}]`);
      dictionaryData = cacheEntry.data;
    } else {
      this.logger.log(`Cache miss for word: ${word} [${targetLang}]. Fetching...`);

      const [dictResult, aiExamples] = await Promise.all([
        this.fetchFreeDictionary(word),
        this.fetchAiContext(word, contextSentence, targetLang),
      ]);

      dictionaryData = this.mergeResults(word, dictResult, aiExamples);

      // For non-English, translate definitions using MyMemory
      let translationSucceeded = true;
      if (targetLang !== 'en') {
        const result = await this.translateDictData(dictionaryData, targetLang);
        dictionaryData = result.data;
        translationSucceeded = result.succeeded;
      }

      // Only cache if translation actually succeeded — don't cache English fallback under non-English key
      if (translationSucceeded) {
        cacheEntry = this.cacheRepo.create({ word, language: targetLang, data: dictionaryData });
        await this.cacheRepo.save(cacheEntry);
      }
    }

    dictionaryData.cacheId = cacheEntry.id;

    return dictionaryData;
  }

  private async fetchFreeDictionary(word: string): Promise<any> {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    try {
      const response = await firstValueFrom(this.httpService.get(url));
      return Array.isArray(response.data) ? response.data : null;
    } catch (error: any) {
      if (error?.response?.status === 404) {
        this.logger.warn(`Word not found in dictionary: "${word}"`);
        return null;
      }
      this.logger.error(`Free Dictionary API Error for ${word}:`, error.message);
      return null;
    }
  }

  private async fetchAiContext(word: string, contextSentence?: string, targetLang = 'en'): Promise<any> {
    const llmUrl = this.configService.get<string>('LLM_GATEWAY_URL');
    if (!llmUrl || !contextSentence) return null;

    const langNames: Record<string, string> = { vi: 'Vietnamese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', fr: 'French', es: 'Spanish', en: 'English' };
    const languageName = langNames[targetLang] || 'English';

    const systemPrompt = `You are a helpful dictionary assistant. Provide exactly 2 example sentences for the word "${word}" based on this context: "${contextSentence}".
If ${languageName} is not English, write each example sentence in English, followed by its ${languageName} translation in parentheses.
Also provide 3 synonyms translated to ${languageName}.
Classify the word into a broad topic category (e.g., "Emotions", "Technology", "Food & Dining", "Business").
Return ONLY valid JSON in this format: { "examples": ["example 1", "example 2"], "synonyms": ["syn1", "syn2", "syn3"], "topic": "Category Name" }`;

    try {
      const response = await firstValueFrom(
        this.httpService.post(`${llmUrl}/complete`, {
          system: systemPrompt,
          messages: [{ role: 'user', content: `Please provide the examples and synonyms for the word "${word}".` }],
        }),
      );
      let text = response.data?.response_text || response.data?.text || response.data;
      if (typeof text === 'string') {
        text = text.replace(/```json\n?|\n?```/g, '').trim();
        return JSON.parse(text);
      }
      return text;
    } catch (error) {
      this.logger.error(`LLM API Error for ${word}:`, error);
      return null;
    }
  }

  private async translateText(text: string, targetLang: string): Promise<{ text: string; ok: boolean }> {
    const email = this.configService.get<string>('MYMEMORY_EMAIL', '');
    const emailParam = email ? `&de=${encodeURIComponent(email)}` : '';
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${targetLang}${emailParam}`;
    try {
      const response = await firstValueFrom(this.httpService.get(url));
      const status: number = response.data?.responseStatus;
      const translated: string = response.data?.responseData?.translatedText;
      if (status !== 200 || !translated || translated.startsWith('MYMEMORY WARNING')) {
        this.logger.warn(`MyMemory error for "${text.slice(0, 40)}" [${targetLang}]: status=${status}`);
        return { text, ok: false };
      }
      return { text: translated, ok: true };
    } catch (err) {
      this.logger.warn(`MyMemory request failed for "${text.slice(0, 30)}": ${err}`);
      return { text, ok: false };
    }
  }

  private async translateDictData(data: any, targetLang: string): Promise<{ data: any; succeeded: boolean }> {
    const allDefs: string[] = data.meanings.flatMap((m: any) => m.definitions as string[]);

    const [wordResult, ...defResults] = await Promise.all([
      this.translateText(data.word, targetLang),
      ...allDefs.map((def) => this.translateText(def, targetLang)),
    ]);

    // Consider succeeded only if at least the word itself was translated
    if (!wordResult.ok) {
      return { data, succeeded: false };
    }

    let defIdx = 0;
    const newMeanings = data.meanings.map((m: any) => ({
      ...m,
      definitions: (m.definitions as string[]).map(() => {
        const r = defResults[defIdx++];
        return r?.ok ? r.text : (m.definitions[defIdx - 1] ?? '');
      }),
    }));

    return {
      data: {
        ...data,
        translation: wordResult.text !== data.word ? wordResult.text : undefined,
        meanings: newMeanings,
      },
      succeeded: true,
    };
  }

  private mergeResults(word: string, dictEntries: any[], aiResult: any): any {
    const meanings: any[] = [];
    let phonetic = '';

    if (dictEntries && dictEntries.length > 0) {
      const firstEntry = dictEntries[0];
      if (firstEntry.phonetic) {
        phonetic = firstEntry.phonetic;
      } else if (firstEntry.phonetics?.length > 0) {
        phonetic = firstEntry.phonetics.find((p: any) => p.text)?.text || '';
      }

      for (const entry of dictEntries) {
        for (const meaning of (entry.meanings || [])) {
          const definitions = (meaning.definitions || [])
            .map((d: any) => d.definition)
            .filter((def: string) => def && !def.startsWith('(heading)') && !def.startsWith('(see '));
          const examples = (meaning.definitions || []).map((d: any) => d.example).filter(Boolean);
          const synonyms = [
            ...(meaning.synonyms || []),
            ...(meaning.definitions || []).flatMap((d: any) => d.synonyms || []),
          ];
          meanings.push({ partOfSpeech: meaning.partOfSpeech || 'unknown', definitions, examples, synonyms });
        }
      }
    }

    if (meanings.length === 0) {
      meanings.push({ partOfSpeech: 'unknown', definitions: ['Definition not found.'], examples: [], synonyms: [] });
    }

    if (aiResult?.examples?.length > 0) {
      meanings[0].examples = [...aiResult.examples, ...meanings[0].examples];
    }

    const allTopSynonyms = meanings.flatMap((m) => m.synonyms || []);
    const uniqueSynonyms = [...new Set([...(aiResult?.synonyms || []), ...allTopSynonyms])].slice(0, 8);

    return { word, phonetic, meanings, synonyms: uniqueSynonyms, topic: aiResult?.topic || 'Uncategorized' };
  }

  async getFlashcards(userId: string): Promise<any[]> {
    const history = await this.historyRepo.find({
      where: { userId },
      relations: ['wordCache'],
      order: { createdAt: 'DESC' },
    });

    const grouped: Record<string, any[]> = {};
    for (const item of history) {
      if (!item.wordCache) continue;
      const data = item.wordCache.data;
      if (!data) continue;
      
      const topic = data.topic || 'Uncategorized';
      if (!grouped[topic]) grouped[topic] = [];
      
      if (!grouped[topic].find(w => w.word === data.word)) {
        grouped[topic].push({
          id: item.id,
          word: data.word,
          translation: data.translation || data.meanings?.[0]?.definitions?.[0] || '',
          phonetic: data.phonetic,
          examples: data.meanings?.[0]?.examples || [],
          createdAt: item.createdAt,
        });
      }
    }

    return Object.keys(grouped).map((topic) => ({
      topic,
      words: grouped[topic],
    }));
  }

  async addFlashcard(userId: string, cacheId: string, contextSentence?: string): Promise<boolean> {
    const NULL_UUID = '00000000-0000-0000-0000-000000000000';
    if (!userId || userId === NULL_UUID) return false;

    // Verify cache exists
    const cacheEntry = await this.cacheRepo.findOne({ where: { id: cacheId } });
    if (!cacheEntry) return false;

    // Prevent duplicates
    const existing = await this.historyRepo.findOne({ where: { userId, wordId: cacheId } });
    if (existing) return true;

    try {
      await this.historyRepo.save({
        userId,
        wordId: cacheId,
        contextSentence,
      });
      return true;
    } catch (e) {
      this.logger.error('Failed to save user flashcard', e);
      return false;
    }
  }

  async deleteFlashcard(historyId: string, userId: string): Promise<boolean> {
    try {
      const result = await this.historyRepo.delete({ id: historyId, userId });
      return result.affected !== null && result.affected !== undefined && result.affected > 0;
    } catch (e) {
      this.logger.error(`Failed to delete user flashcard ${historyId}`, e);
      return false;
    }
  }
}
