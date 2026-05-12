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

  async lookup(word: string, contextSentence: string | undefined, userId: string): Promise<any> {
    const language = 'en';

    // Normalize: lowercase, take only the first word for phrases/acronyms
    const normalized = word.trim().toLowerCase().split(/\s+/)[0];
    word = normalized;

    // 1. Check DB Cache
    let cacheEntry = await this.cacheRepo.findOne({ where: { word, language } });
    
    let dictionaryData: any;

    if (cacheEntry) {
      this.logger.log(`Cache hit for word: ${word}`);
      dictionaryData = cacheEntry.data;
    } else {
      this.logger.log(`Cache miss for word: ${word}. Fetching from APIs...`);
      
      // 2. Fetch from Free Dictionary API and LLM Gateway concurrently
      const [dictResult, aiExamples] = await Promise.all([
        this.fetchFreeDictionary(word),
        this.fetchAiContext(word, contextSentence),
      ]);

      dictionaryData = this.mergeResults(word, dictResult, aiExamples);

      // 3. Save to DB Cache
      cacheEntry = this.cacheRepo.create({
        word,
        language,
        data: dictionaryData
      });
      await this.cacheRepo.save(cacheEntry);
    }

    // 4. Save to User History asynchronously (only if userId is a real user)
    const NULL_UUID = '00000000-0000-0000-0000-000000000000';
    if (userId && userId !== NULL_UUID) {
      this.historyRepo.save({
        userId,
        wordId: cacheEntry.id,
        contextSentence,
      }).catch((e) => this.logger.error('Failed to save user history', e));
    }

    return dictionaryData;
  }

  private async fetchFreeDictionary(word: string): Promise<any> {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    try {
      const response = await firstValueFrom(this.httpService.get(url));
      return Array.isArray(response.data) ? response.data : null;
    } catch (error: any) {
      // 404 means word not found — expected, not an error
      if (error?.response?.status === 404) {
        this.logger.warn(`Word not found in dictionary: "${word}"`);
        return null;
      }
      this.logger.error(`Free Dictionary API Error for ${word}:`, error.message);
      return null;
    }
  }

  private async fetchAiContext(word: string, contextSentence?: string): Promise<any> {
    const llmUrl = this.configService.get<string>('LLM_GATEWAY_URL');
    if (!llmUrl || !contextSentence) return null;

    const systemPrompt = `You are a helpful dictionary assistant. Provide exactly 2 example sentences for the word "${word}" based on this context: "${contextSentence}".
Also provide 3 synonyms.
Return ONLY valid JSON in this format: { "examples": ["example 1", "example 2"], "synonyms": ["syn1", "syn2", "syn3"] }`;

    try {
      const response = await firstValueFrom(
        this.httpService.post(`${llmUrl}/complete`, {
          system: systemPrompt,
          messages: []
        })
      );
      
      // Handle the LLM response which could be a stream string or a JSON object depending on how llm-gateway implements it
      // Let's assume llm-gateway complete endpoint returns { text: "..." }
      let text = response.data.text || response.data;
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

  private mergeResults(word: string, dictEntries: any[], aiResult: any): any {
    const meanings: any[] = [];
    let phonetic = '';

    // Free Dictionary API returns array of entries, each with meanings[]
    // meanings[] has partOfSpeech and definitions[]
    // definitions[] has definition, example, synonyms, antonyms
    if (dictEntries && dictEntries.length > 0) {
      // Get phonetic from first entry
      const firstEntry = dictEntries[0];
      if (firstEntry.phonetic) {
        phonetic = firstEntry.phonetic;
      } else if (firstEntry.phonetics?.length > 0) {
        phonetic = firstEntry.phonetics.find((p: any) => p.text)?.text || '';
      }

      // Merge all meanings from all entries
      for (const entry of dictEntries) {
        for (const meaning of (entry.meanings || [])) {
          const definitions = (meaning.definitions || []).map((d: any) => d.definition).filter(Boolean);
          const examples = (meaning.definitions || [])
            .map((d: any) => d.example)
            .filter(Boolean);
          const synonyms = [
            ...(meaning.synonyms || []),
            ...(meaning.definitions || []).flatMap((d: any) => d.synonyms || []),
          ];

          meanings.push({
            partOfSpeech: meaning.partOfSpeech || 'unknown',
            definitions,
            examples,
            synonyms,
          });
        }
      }
    }

    if (meanings.length === 0) {
      meanings.push({
        partOfSpeech: 'unknown',
        definitions: ['Definition not found in external dictionary.'],
        examples: [],
        synonyms: [],
      });
    }

    // Merge AI-generated examples into first meaning
    if (aiResult?.examples?.length > 0) {
      meanings[0].examples = [...aiResult.examples, ...meanings[0].examples];
    }

    // Collect all synonyms across all meanings for top-level display
    const allTopSynonyms = meanings.flatMap((m) => m.synonyms || []);
    const uniqueSynonyms = [...new Set([...(aiResult?.synonyms || []), ...allTopSynonyms])].slice(0, 8);

    return {
      word,
      phonetic,
      meanings,
      synonyms: uniqueSynonyms,
    };
  }
}
