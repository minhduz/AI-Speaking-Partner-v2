import { useState, useCallback, useRef } from 'react';
import type { DictionaryData } from '@/components/chat/dictionary-popup/dictionary-popup';
import { httpClient } from '@/lib/http-client';

export function useDictionary(sessionTopic?: string) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<DictionaryData | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [targetLang, setTargetLang] = useState('vi');
  const currentWordRef = useRef('');

  const fetchWord = useCallback(async (word: string, lang: string) => {
    if (!word.trim()) return;
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
    translate,
    changeLanguage,
    close,
    addFlashcard,
  };
}
