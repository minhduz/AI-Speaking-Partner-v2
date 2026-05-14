import { useState, useRef, useCallback } from 'react';
import { useClickOutside } from '@/hooks/use-click-outside';

export interface DictionaryData {
  cacheId?: string;
  word: string;
  phonetic?: string;
  translation?: string;
  meanings: {
    partOfSpeech: string;
    definitions: string[];
    examples: string[];
  }[];
  synonyms?: string[];
}

const LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
];

interface DictionaryPopupProps {
  isOpen: boolean;
  onClose: () => void;
  isLoading: boolean;
  data: DictionaryData | null;
  error?: string;
  style?: React.CSSProperties;
  targetLang: string;
  onLanguageChange: (lang: string) => void;
  onAddFlashcard?: (cacheId: string) => Promise<void>;
}

export function DictionaryPopup({ isOpen, onClose, isLoading, data, error, style, targetLang, onLanguageChange, onAddFlashcard }: DictionaryPopupProps) {
  const popupRef = useClickOutside<HTMLDivElement>(onClose, isOpen);
  const [isAdding, setIsAdding] = useState(false);
  const [addedWords, setAddedWords] = useState<Set<string>>(new Set());
  const [dragPos, setDragPos] = useState<{ top: number; left: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startTop: number; startLeft: number } | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const initTop = typeof style?.top === 'number' ? style.top : 0;
    const initLeft = typeof style?.left === 'number' ? style.left : 0;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTop: dragPos?.top ?? initTop,
      startLeft: dragPos?.left ?? initLeft,
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setDragPos({
        top: dragRef.current.startTop + ev.clientY - dragRef.current.startY,
        left: dragRef.current.startLeft + ev.clientX - dragRef.current.startX,
      });
    };

    const onMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [style, dragPos]);

  if (!isOpen) return null;

  const positionClass = style ? '' : 'absolute bottom-[calc(100%+12px)] right-0';
  const isAdded = data?.word ? addedWords.has(data.word) : false;

  const effectiveStyle: React.CSSProperties | undefined = style
    ? { ...style, top: dragPos?.top ?? style.top, left: dragPos?.left ?? style.left }
    : style;

  const handleAddFlashcard = async () => {
    if (!data?.cacheId || !onAddFlashcard) return;
    setIsAdding(true);
    try {
      await onAddFlashcard(data.cacheId);
      setAddedWords((prev) => new Set(prev).add(data!.word));
    } catch (err) {
      console.error(err);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div
      ref={popupRef}
      style={effectiveStyle}
      className={`${positionClass} w-80 max-h-100 flex flex-col bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-[#EAE6DF] z-50 animate-in fade-in zoom-in-95 duration-200`}
    >
      {/* Header — drag handle */}
      <div
        onMouseDown={style ? handleDragStart : undefined}
        className={`flex justify-between items-center px-5 pt-5 pb-3 border-b border-gray-100 shrink-0 ${style ? 'cursor-move select-none' : ''}`}
      >
        <h3 className="text-[#8447FF] font-semibold text-base flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          Dictionary
        </h3>
        <div className="flex items-center gap-2">
          <select
            value={targetLang}
            onChange={(e) => onLanguageChange(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 cursor-pointer hover:border-gray-300 transition-colors outline-none"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
          <button onMouseDown={(e) => e.stopPropagation()} onClick={onClose} className="text-gray-400 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-full p-1.5 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="py-10 flex flex-col items-center justify-center gap-4">
           <div className="w-8 h-8 rounded-full border-[3px] border-[#8447FF] border-t-transparent animate-spin" />
           <p className="text-sm font-medium text-gray-500 animate-pulse">Looking up...</p>
        </div>
      )}

      {error && !isLoading && (
         <div className="m-5 p-3 text-center text-red-500 text-sm font-medium bg-red-50 rounded-xl border border-red-100">
           {error}
         </div>
      )}

      {!isLoading && data && (
        <>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div className="border-b border-gray-100 pb-3">
              <h2 className="text-2xl font-bold text-gray-900 leading-tight">{data.word}</h2>
              {data.phonetic && (
                <p className="text-[#8447FF] font-mono text-sm mt-1 bg-[#8447FF]/10 inline-block px-2 py-0.5 rounded-md">{data.phonetic}</p>
              )}
              {data.translation && (
                <p className="text-lg font-semibold text-[#8447FF] mt-1">{data.translation}</p>
              )}
            </div>

            <div className="space-y-4">
              {data.meanings.map((meaning, idx) => (
                <div key={idx} className="space-y-2.5">
                  <span className="inline-block px-2 py-1 bg-gray-100 text-gray-600 text-xs font-semibold rounded uppercase tracking-wider">
                    {meaning.partOfSpeech}
                  </span>

                  <ul className="list-disc pl-5 space-y-1.5">
                    {meaning.definitions.map((def, i) => (
                      <li key={i} className="text-sm text-gray-700 leading-relaxed marker:text-gray-300">{def}</li>
                    ))}
                  </ul>

                  {meaning.examples && meaning.examples.length > 0 && (
                    <div className="mt-3 bg-violet-50/50 rounded-xl p-3 border border-violet-100/50">
                      <p className="text-xs font-bold text-violet-700 mb-2 uppercase tracking-wider flex items-center gap-1.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                        Examples
                      </p>
                      <ul className="space-y-2">
                        {meaning.examples.map((ex, i) => (
                          <li key={i} className="text-sm text-gray-600 italic border-l-2 border-violet-300 pl-2.5 leading-relaxed">&quot;{ex}&quot;</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {data.synonyms && data.synonyms.length > 0 && (
              <div className="pt-2 border-t border-gray-100">
                 <p className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">Related</p>
                 <div className="flex flex-wrap gap-2">
                   {data.synonyms.map((syn, i) => (
                      <span key={i} className="px-2.5 py-1 bg-white border border-gray-200 hover:border-gray-300 transition-colors cursor-default text-gray-600 text-xs font-medium rounded-full shadow-sm">
                        {syn}
                      </span>
                   ))}
                 </div>
              </div>
            )}
          </div>

          {data.cacheId && onAddFlashcard && (
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl shrink-0">
              <button
                onClick={handleAddFlashcard}
                disabled={isAdded || isAdding}
                className={`w-full py-2.5 px-4 rounded-xl font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2 ${
                  isAdded
                    ? 'bg-green-100 text-green-700 border border-green-200'
                    : 'bg-[#8447FF] hover:bg-[#6B35CC] text-white shadow-sm hover:shadow active:scale-[0.98]'
                }`}
              >
                {isAdding ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Adding...
                  </>
                ) : isAdded ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    Added to Flashcards
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    Add to Flashcards
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
