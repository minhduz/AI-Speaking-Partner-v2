import { useState, useCallback } from 'react';
import type { DictionaryData } from '@/components/chat/dictionary-popup/dictionary-popup';
import { httpClient } from '@/lib/http-client';

export function useDictionary() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<DictionaryData | null>(null);
  const [error, setError] = useState<string | undefined>();

  const translate = useCallback((text: string) => {
    if (!text.trim()) return;

    setIsOpen(true);
    setIsLoading(true);
    setError(undefined);

    const fetchDictionary = async () => {
      try {
        const word = encodeURIComponent(text.trim());
        const context = encodeURIComponent('Please give me an example.');
        const result = await httpClient.get<DictionaryData>(
          `/api/dictionary?word=${word}&context=${context}`,
        );
        setData(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Something went wrong';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDictionary();
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  return {
    isOpen,
    isLoading,
    data,
    error,
    translate,
    close,
  };
}
