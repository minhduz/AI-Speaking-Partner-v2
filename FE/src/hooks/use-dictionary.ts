import { useState, useCallback, useRef, useEffect } from 'react';
import type { DictionaryData } from '@/components/chat/dictionary-popup/dictionary-popup';
import { httpClient } from '@/lib/http-client';
import { userService } from '@/services/user.service';

const NATIVE_LANG_TO_CODE: Record<string, string> = {
  vietnamese: 'vi', english: 'en', chinese: 'zh', korean: 'ko',
  japanese: 'ja', french: 'fr', spanish: 'es', german: 'de',
  russian: 'ru', arabic: 'ar', hindi: 'hi',
};
const DICT_LANG_KEY = 'dict_target_lang';

export function useDictionary(sessionTopic?: string) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<DictionaryData | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [targetLang, setTargetLang] = useState<string>(() =>
    (typeof window !== 'undefined' ? localStorage.getItem(DICT_LANG_KEY) : null) ?? 'vi'
  );
  const [lookupKey, setLookupKey] = useState(0);
  const currentWordRef = useRef('');

  // If no saved preference, init from user's nativeLanguage once
  useEffect(() => {
    if (localStorage.getItem(DICT_LANG_KEY)) return;
    userService.me().then((profile) => {
      const code = NATIVE_LANG_TO_CODE[profile.nativeLanguage?.toLowerCase()] ?? 'vi';
      setTargetLang(code);
    }).catch(() => {});
  }, []);

  const fetchWord = useCallback(async (word: string, lang: string) => {
    if (!word.trim()) return;
    setLookupKey(k => k + 1);
    setIsOpen(true);
    setIsLoading(true);
    setError(undefined);
    setData(null);
    try {
      const encodedWord = encodeURIComponent(word.trim());
      const context = encodeURIComponent('Please give me an example.');
      const result = await httpClient.get<DictionaryData>(
        `/api/dictionary?word=${encodedWord}&context=${context}&targetLang=${lang}`,
      );
      setData(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const translate = useCallback((text: string) => {
    currentWordRef.current = text;
    fetchWord(text, targetLang);
  }, [fetchWord, targetLang]);

  const changeLanguage = useCallback((lang: string) => {
    setTargetLang(lang);
    localStorage.setItem(DICT_LANG_KEY, lang);
    if (currentWordRef.current) {
      fetchWord(currentWordRef.current, lang);
    }
  }, [fetchWord]);

  const close = useCallback(() => setIsOpen(false), []);

  const addFlashcard = useCallback(async (cacheId: string) => {
    const topic = sessionTopic || data?.topic || 'Uncategorized';
    try {
      await httpClient.post('/api/dictionary/flashcards', {
        cacheId,
        contextSentence: topic,
      });
    } catch (err) {
      console.error('Failed to add flashcard', err);
      throw err;
    }
  }, [sessionTopic, data]);

  return {
    isOpen,
    isLoading,
    data,
    error,
    targetLang,
    lookupKey,
    translate,
    changeLanguage,
    close,
    addFlashcard,
  };
}
