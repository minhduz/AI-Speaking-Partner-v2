import { useState, useRef, useCallback, useEffect } from 'react';
import { useClickOutside } from '@/hooks/use-click-outside';

const SNAP_M = 12;

function getCorners(w: number, h: number) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  return [
    { top: SNAP_M,         left: SNAP_M },
    { top: SNAP_M,         left: W - w - SNAP_M },
    { top: H - h - SNAP_M, left: SNAP_M },
    { top: H - h - SNAP_M, left: W - w - SNAP_M },
  ];
}

function nearestCorner(top: number, left: number, w: number, h: number) {
  return getCorners(w, h).reduce((best, c) =>
    Math.hypot(top - c.top, left - c.left) < Math.hypot(top - best.top, left - best.left) ? c : best
  );
}

export interface DictionaryData {
  cacheId?: string;
  word: string;
  phonetic?: string;
  translation?: string;
  topic?: string;
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
  const [snapping, setSnapping] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startTop: number; startLeft: number } | null>(null);

  // Below md (768px) we render as a bottom sheet so the "Add to flashcard"
  // button always clears the bottom nav (z-50, ~72px + safe-area). Above md we
  // keep the corner-snap behavior driven by the parent's `style` prop.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setSnapping(false);
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

    const onMouseUp = (ev: MouseEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (!drag) return;
      const finalTop = drag.startTop + ev.clientY - drag.startY;
      const finalLeft = drag.startLeft + ev.clientX - drag.startX;
      const el = popupRef.current;
      const w = el?.offsetWidth ?? 320;
      const h = el?.offsetHeight ?? 440;
      const corner = nearestCorner(finalTop, finalLeft, w, h);
      setSnapping(true);
      setDragPos(corner);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [style, dragPos, popupRef]);

  if (!isOpen) return null;

  const positionClass = style ? '' : 'absolute bottom-[calc(100%+12px)] right-0';
  const isAdded = data?.word ? addedWords.has(data.word) : false;

  // Mobile: anchor to bottom of viewport, full width minus margins, sitting on
  // top of the bottom nav (72px) with safe-area + breathing gap.
  const mobileStyle: React.CSSProperties | undefined = style
    ? {
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))',
        top: 'auto',
        zIndex: style.zIndex,
      }
    : undefined;

  const desktopStyle: React.CSSProperties | undefined = style
    ? {
        ...style,
        top: dragPos?.top ?? style.top,
        left: dragPos?.left ?? style.left,
        transition: snapping ? 'top 0.25s cubic-bezier(0.34,1.56,0.64,1), left 0.25s cubic-bezier(0.34,1.56,0.64,1)' : 'none',
      }
    : style;

  const effectiveStyle = isMobile ? mobileStyle : desktopStyle;

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
      style={{
        ...effectiveStyle,
        border: '2px solid #e2e2e2',
        boxShadow: '0 5px 0 #e2e2e2, 0 16px 40px rgba(0,0,0,0.14)',
      }}
      className={`${positionClass} ${
        isMobile
          ? 'w-auto max-h-[calc(100dvh-160px-env(safe-area-inset-bottom,0)-env(safe-area-inset-top,0))]'
          : 'w-[min(360px,calc(100vw-24px))] max-h-[min(520px,calc(100dvh-24px))]'
      } flex flex-col bg-white rounded-3xl z-50 animate-in fade-in zoom-in-95 duration-200 overflow-hidden`}
      data-dictionary-popup
    >
      {/* Header — drag handle (desktop only; mobile bottom-sheet doesn't drag) */}
      <div
        onMouseDown={style && !isMobile ? handleDragStart : undefined}
        className={`flex justify-between items-center gap-3 px-5 py-4 shrink-0 ${style && !isMobile ? 'cursor-move select-none' : ''}`}
        style={{ borderBottom: '2px solid #f3f3f3' }}
      >
        <h3 className="text-base font-black flex items-center gap-2" style={{ color: '#2b6c00' }}>
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
            className="max-w-32 cursor-pointer rounded-2xl px-3 py-2 text-xs font-extrabold outline-none transition-colors sm:max-w-36"
            style={{ background: '#ffffff', color: '#6f7b64', border: '2px solid #e2e2e2', boxShadow: '0 2px 0 #e2e2e2' }}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-2xl transition-colors active:translate-y-0.5"
            style={{ background: '#ffffff', color: '#6f7b64', border: '2px solid #e2e2e2', boxShadow: '0 2px 0 #e2e2e2' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="py-10 flex flex-col items-center justify-center gap-4">
           <div className="w-8 h-8 rounded-full border-[4px] border-[#58cc02]/25 border-t-[#58cc02] animate-spin" />
           <p className="text-sm font-bold animate-pulse" style={{ color: '#6f7b64' }}>Looking up...</p>
        </div>
      )}

      {error && !isLoading && (
         <div className="m-5 p-3 text-center text-sm font-bold rounded-2xl" style={{ background: '#ffdad6', color: '#93000a', border: '2px solid #f2b8b5' }}>
           {error}
         </div>
      )}

      {!isLoading && data && (
        <>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div className="pb-3" style={{ borderBottom: '2px solid #f3f3f3' }}>
              <h2 className="text-3xl font-black leading-tight" style={{ color: '#1a1c1c' }}>{data.word}</h2>
              {data.phonetic && (
                <p className="font-mono text-sm mt-2 inline-block px-3 py-1 rounded-xl" style={{ color: '#004666', background: '#dceeff' }}>{data.phonetic}</p>
              )}
              {data.translation && (
                <p className="text-xl font-black mt-2" style={{ color: '#2b6c00' }}>{data.translation}</p>
              )}
            </div>

            <div className="space-y-4">
              {data.meanings.map((meaning, idx) => (
                <div key={idx} className="space-y-2.5">
                  <span className="inline-block px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider" style={{ background: '#f3f3f3', color: '#6f7b64' }}>
                    {meaning.partOfSpeech}
                  </span>

                  <ul className="list-disc pl-5 space-y-1.5">
                    {meaning.definitions.map((def, i) => (
                      <li key={i} className="text-sm font-semibold leading-relaxed marker:text-[#becbb1]" style={{ color: '#3f4a36' }}>{def}</li>
                    ))}
                  </ul>

                  {meaning.examples && meaning.examples.length > 0 && (
                    <div className="mt-3 rounded-2xl p-3" style={{ background: '#dceeff', border: '2px solid #c8e6ff' }}>
                      <p className="text-xs font-black mb-2 uppercase tracking-wider flex items-center gap-1.5" style={{ color: '#004666' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                        Examples
                      </p>
                      <ul className="space-y-2">
                        {meaning.examples.map((ex, i) => (
                          <li key={i} className="text-sm italic pl-2.5 leading-relaxed" style={{ color: '#004666', borderLeft: '2px solid #2fb8ff' }}>&quot;{ex}&quot;</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {data.synonyms && data.synonyms.length > 0 && (
              <div className="pt-2" style={{ borderTop: '2px solid #f3f3f3' }}>
                 <p className="text-xs font-black mb-2 uppercase tracking-wider" style={{ color: '#6f7b64' }}>Related</p>
                 <div className="flex flex-wrap gap-2">
                   {data.synonyms.map((syn, i) => (
                      <span key={i} className="px-2.5 py-1 transition-colors cursor-default text-xs font-bold rounded-full" style={{ background: '#ffffff', border: '2px solid #e2e2e2', color: '#6f7b64' }}>
                        {syn}
                      </span>
                   ))}
                 </div>
              </div>
            )}
          </div>

          {data.cacheId && onAddFlashcard && (
            <div className="px-5 py-4 shrink-0 space-y-3" style={{ background: '#ffffff', borderTop: '2px solid #f3f3f3' }}>
              {data.topic && (
                <p className="text-[11px] font-bold text-center" style={{ color: '#6f7b64' }}>
                  Will be grouped into <span style={{ color: '#2b6c00' }}>{data.topic}</span>
                </p>
              )}
              <button
                onClick={handleAddFlashcard}
                disabled={isAdded || isAdding}
                className="w-full py-3 px-4 rounded-2xl font-black text-sm transition-all duration-200 flex items-center justify-center gap-2 active:translate-y-1 disabled:opacity-80"
                style={isAdded
                  ? { background: '#d7ffb8', color: '#2b6c00', border: '2px solid #58cc02', boxShadow: '0 4px 0 #46a302' }
                  : { background: '#58cc02', color: '#1e5000', boxShadow: '0 4px 0 #46a302' }}
              >
                {isAdding ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-[#1e5000]/25 border-t-[#1e5000] animate-spin" />
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
