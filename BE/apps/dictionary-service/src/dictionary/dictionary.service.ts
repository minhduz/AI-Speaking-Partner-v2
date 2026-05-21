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

      const wordLang = this.detectWordLanguage(word);
      const [primaryResult, aiExamples] = await Promise.all([
        wordLang === 'en' ? this.fetchWordnik(word) : this.fetchWiktionary(word, wordLang),
        this.fetchAiContext(word, contextSentence, targetLang, wordLang),
      ]);
      // Fallback chain:
      // English   → Wordnik → FreeDictionary → Wiktionary (last resort)
      // Non-Latin → Wiktionary (already tried above) → nothing
      // Latin non-English (fr/es/de…) → Wordnik fails → FreeDictionary fails → Wiktionary with auto-lang
      let dictResult = primaryResult;
      if (!dictResult && wordLang === 'en') dictResult = await this.fetchFreeDictionary(word);
      if (!dictResult) dictResult = await this.fetchWiktionary(word, wordLang);

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

  private detectWordLanguage(word: string): string {
    if (/[぀-ゟ゠-ヿ]/.test(word)) return 'ja'; // hiragana/katakana
    if (/[一-鿿㐀-䶿豈-﫿]/.test(word)) return 'zh'; // CJK
    if (/[가-힯ᄀ-ᇿ]/.test(word)) return 'ko'; // Hangul
    if (/[Ѐ-ӿ]/.test(word)) return 'ru'; // Cyrillic
    if (/[؀-ۿ]/.test(word)) return 'ar'; // Arabic
    if (/[ऀ-ॿ]/.test(word)) return 'hi'; // Devanagari
    return 'en';
  }

  private async fetchWiktionary(word: string, langCode: string): Promise<any[] | null> {
    try {
      const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
      const res = await firstValueFrom(this.httpService.get(url));
      const data: Record<string, any[]> = res.data ?? {};

      // Pick entries for detected language, fall back to first available
      const langEntries = data[langCode] ?? data[Object.keys(data)[0]];
      if (!langEntries?.length) return null;

      const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').trim();

      const meanings = langEntries.map((entry: any) => {
        const defs = (entry.definitions ?? [])
          .map((d: any) => ({
            definition: stripHtml(d.definition ?? ''),
            example: d.parsedExamples?.[0]?.example
              ? stripHtml(d.parsedExamples[0].example)
              : (d.examples?.[0] ? stripHtml(d.examples[0]) : undefined),
            synonyms: [],
          }))
          .filter((d: any) => d.definition);
        return { partOfSpeech: entry.partOfSpeech || 'unknown', definitions: defs, synonyms: [] };
      }).filter((m: any) => m.definitions.length > 0);

      if (!meanings.length) return null;
      return [{ word, phonetic: '', phonetics: [], meanings }];
    } catch (err: any) {
      this.logger.warn(`Wiktionary lookup failed for "${word}" [${langCode}]: ${err?.message}`);
      return null;
    }
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

  private async fetchWordnik(word: string): Promise<any[] | null> {
    const apiKey = this.configService.get<string>('WORDNIK_API_KEY');
    if (!apiKey) return null;
    const base = `https://api.wordnik.com/v4/word.json/${encodeURIComponent(word)}`;
    try {
      const [defsRes, relRes, pronRes] = await Promise.allSettled([
        firstValueFrom(this.httpService.get(`${base}/definitions?limit=10&useCanonical=false&includeTags=false&api_key=${apiKey}`)),
        firstValueFrom(this.httpService.get(`${base}/relatedWords?useCanonical=false&relationshipTypes=synonym&limitPerRelationshipType=8&api_key=${apiKey}`)),
        firstValueFrom(this.httpService.get(`${base}/pronunciations?useCanonical=false&limit=3&api_key=${apiKey}`)),
      ]);

      const defs: any[] = defsRes.status === 'fulfilled' && Array.isArray(defsRes.value.data) ? defsRes.value.data : [];
      if (defs.length === 0) return null;

      const synonyms: string[] = relRes.status === 'fulfilled'
        ? (relRes.value.data ?? [])
            .filter((r: any) => r.relationshipType === 'synonym')
            .flatMap((r: any) => r.words as string[])
            .slice(0, 8)
        : [];

      // Prefer IPA, fall back to ahd/arpabet
      const pronList: any[] = pronRes.status === 'fulfilled' && Array.isArray(pronRes.value.data) ? pronRes.value.data : [];
      const ipa = pronList.find((p) => p.rawType === 'IPA')?.raw
        ?? pronList.find((p) => p.rawType === 'ahd-legacy' || p.rawType === 'ahd')?.raw
        ?? '';

      // Wordnik definitions contain XML-like tags (<xref>, <ant>, <i>, etc.)
      // Strip them before translation so MyMemory doesn't preserve the markup.
      const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

      // Group definitions by partOfSpeech, deduplicate near-identical entries
      const byPos: Record<string, string[]> = {};
      for (const d of defs) {
        const pos = (d.partOfSpeech || 'unknown').replace(/-/g, ' ');
        if (!byPos[pos]) byPos[pos] = [];
        const clean = d.text ? stripTags(d.text) : '';
        // Skip empty, very short, or duplicate (same first 40 chars) entries
        if (!clean || clean.length < 5) continue;
        const isDupe = byPos[pos].some(existing => existing.slice(0, 40) === clean.slice(0, 40));
        if (!isDupe) byPos[pos].push(clean);
      }

      const meanings = Object.entries(byPos).map(([partOfSpeech, posDefs], i) => ({
        partOfSpeech,
        definitions: posDefs.map((def) => ({
          definition: def,
          example: undefined, // examples come from AI context only
          synonyms: i === 0 ? synonyms : [],
        })),
        synonyms: i === 0 ? synonyms : [],
      }));

      return [{ word, phonetic: ipa, phonetics: ipa ? [{ text: ipa }] : [], meanings }];
    } catch (err: any) {
      this.logger.warn(`Wordnik lookup failed for "${word}": ${err?.message}`);
      return null;
    }
  }

  private static readonly ALLOWED_TOPICS = [
    'Daily Life',
    'Work & Business',
    'Travel',
    'Food & Dining',
    'Emotions',
    'Technology',
    'Education',
    'Health',
    'Relationships',
    'Culture',
    'Slang & Idioms',
    'Academic',
    'Uncategorized',
  ];

  private async fetchAiContext(word: string, contextSentence?: string, targetLang = 'en', wordLang = 'en'): Promise<any> {
    const llmUrl = this.configService.get<string>('LLM_GATEWAY_URL');
    if (!llmUrl || !contextSentence) return null;

    const langNames: Record<string, string> = { vi: 'Vietnamese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', fr: 'French', es: 'Spanish', en: 'English', ru: 'Russian', ar: 'Arabic', hi: 'Hindi' };
    const nativeLangName = langNames[targetLang] || 'English';
    const wordLangName = langNames[wordLang] || 'English';
    const topicList = DictionaryService.ALLOWED_TOPICS.join(', ');

    const systemPrompt = `You are a helpful dictionary assistant. The word "${word}" is a ${wordLangName} word.
Provide exactly 2 natural example sentences using "${word}" in ${wordLangName}.
If ${nativeLangName} is not ${wordLangName}, add a ${nativeLangName} translation in parentheses after each sentence.
Also provide 3 synonyms in ${wordLangName} (translated to ${nativeLangName} if different).
Classify the word into exactly one of these topic categories: ${topicList}.
Return ONLY valid JSON: { "examples": ["example 1", "example 2"], "synonyms": ["syn1", "syn2", "syn3"], "topic": "Category Name" }`;

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
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;
        return JSON.parse(jsonMatch[0]);
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

    const rawTopic = aiResult?.topic as string | undefined;
    const topic = rawTopic && DictionaryService.ALLOWED_TOPICS.includes(rawTopic) ? rawTopic : 'Uncategorized';
    return { word, phonetic, meanings, synonyms: uniqueSynonyms, topic };
  }

  private buildWordDto(item: any): any {
    const data = item.wordCache.data;
    return {
      id: item.id,
      word: data.word,
      translation: data.translation || data.meanings?.[0]?.definitions?.[0] || '',
      phonetic: data.phonetic,
      examples: data.meanings?.[0]?.examples || [],
      status: item.status,
      reviewCount: item.reviewCount,
      masteryScore: item.masteryScore,
      nextReviewAt: item.nextReviewAt,
      lastReviewedAt: item.lastReviewedAt,
      createdAt: item.createdAt,
    };
  }

  private resolveTopic(data: any): string {
    const raw = data.topic as string | undefined;
    return raw && DictionaryService.ALLOWED_TOPICS.includes(raw) ? raw : 'Uncategorized';
  }

  private computeReview(item: any, result: 'easy' | 'again' | 'hard') {
    const now = new Date();
    let { intervalDays, masteryScore, reviewCount } = item;

    reviewCount += 1;
    if (result === 'again') {
      intervalDays = 1;
      masteryScore = Math.max(0, masteryScore - 0.15);
    } else if (result === 'hard') {
      intervalDays = Math.max(1, intervalDays * 1.2);
      masteryScore = Math.min(1, masteryScore + 0.05);
    } else {
      intervalDays = intervalDays < 1 ? 4 : intervalDays * 2.5;
      masteryScore = Math.min(1, masteryScore + 0.2);
    }

    let status: string;
    if (masteryScore >= 0.8 && reviewCount >= 3) {
      status = 'mastered';
    } else if (reviewCount <= 2) {
      status = 'learning';
    } else {
      status = 'reviewing';
    }
    if (result === 'again') status = 'learning';

    const nextReviewAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
    return { intervalDays, masteryScore, reviewCount, status, lastReviewedAt: now, nextReviewAt };
  }

  async getFlashcards(userId: string): Promise<any[]> {
    const now = new Date();
    const history = await this.historyRepo
      .createQueryBuilder('h')
      .leftJoinAndSelect('h.wordCache', 'wc')
      .where('h.user_id = :userId', { userId })
      .andWhere('h.status != :mastered', { mastered: 'mastered' })
      .andWhere('(h.next_review_at IS NULL OR h.next_review_at <= :now)', { now })
      .orderBy('h.created_at', 'DESC')
      .getMany();

    const grouped: Record<string, any[]> = {};
    for (const item of history) {
      if (!item.wordCache?.data) continue;
      const topic = this.resolveTopic(item.wordCache.data);
      if (!grouped[topic]) grouped[topic] = [];
      if (!grouped[topic].find(w => w.word === item.wordCache.data.word)) {
        grouped[topic].push(this.buildWordDto(item));
      }
    }

    return Object.keys(grouped).map((topic) => ({ topic, words: grouped[topic] }));
  }

  async getArchivedFlashcards(userId: string): Promise<any[]> {
    const now = new Date();
    // Words that have been studied: either scheduled in future OR mastered
    const history = await this.historyRepo
      .createQueryBuilder('h')
      .leftJoinAndSelect('h.wordCache', 'wc')
      .where('h.user_id = :userId', { userId })
      .andWhere('h.status != :new', { new: 'new' })
      .andWhere('(h.next_review_at > :now OR h.status = :mastered)', { now, mastered: 'mastered' })
      .orderBy('h.last_reviewed_at', 'DESC')
      .getMany();

    const grouped: Record<string, any[]> = {};
    for (const item of history) {
      if (!item.wordCache?.data) continue;
      const topic = this.resolveTopic(item.wordCache.data);
      if (!grouped[topic]) grouped[topic] = [];
      grouped[topic].push(this.buildWordDto(item));
    }

    return Object.keys(grouped).map((topic) => ({ topic, words: grouped[topic] }));
  }

  async getReviewDue(userId: string): Promise<any[]> {
    const now = new Date();
    const history = await this.historyRepo
      .createQueryBuilder('h')
      .leftJoinAndSelect('h.wordCache', 'wc')
      .where('h.user_id = :userId', { userId })
      .andWhere('h.status != :mastered', { mastered: 'mastered' })
      .andWhere('h.status != :new', { new: 'new' })
      .andWhere('h.next_review_at IS NOT NULL')
      .andWhere('h.next_review_at <= :now', { now })
      .orderBy('h.next_review_at', 'ASC')
      .getMany();

    return history
      .filter(item => item.wordCache?.data)
      .map(item => this.buildWordDto(item));
  }

  async reviewFlashcard(historyId: string, userId: string, result: 'easy' | 'again' | 'hard'): Promise<{ success: boolean; status: string; nextReviewAt: Date }> {
    const item = await this.historyRepo.findOne({ where: { id: historyId, userId } });
    if (!item) return { success: false, status: '', nextReviewAt: null };

    const updates = this.computeReview(item, result);
    try {
      await this.historyRepo.update({ id: historyId, userId }, updates);
      return { success: true, status: updates.status, nextReviewAt: updates.nextReviewAt };
    } catch (e) {
      this.logger.error(`Failed to review flashcard ${historyId}`, e);
      return { success: false, status: '', nextReviewAt: null };
    }
  }

  async addFlashcard(userId: string, cacheId: string, contextSentence?: string): Promise<boolean> {
    const NULL_UUID = '00000000-0000-0000-0000-000000000000';
    if (!userId || userId === NULL_UUID) return false;

    // Verify cache exists
    const cacheEntry = await this.cacheRepo.findOne({ where: { id: cacheId } });
    if (!cacheEntry) return false;

    // If word already exists but is scheduled for the future, reset so it appears immediately
    const existing = await this.historyRepo.findOne({ where: { userId, wordId: cacheId } });
    if (existing) {
      if (existing.nextReviewAt && existing.nextReviewAt > new Date()) {
        await this.historyRepo.update({ id: existing.id }, { nextReviewAt: null });
      }
      return true;
    }

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
