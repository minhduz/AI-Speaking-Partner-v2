'use client';

import { useClickOutside } from '@/hooks/use-click-outside';

export interface DictionaryData {
  word: string;
  phonetic?: string;
  meanings: {
    partOfSpeech: string;
    definitions: string[];
    examples: string[];
  }[];
  synonyms?: string[];
}

interface DictionaryPopupProps {
  isOpen: boolean;
  onClose: () => void;
  isLoading: boolean;
  data: DictionaryData | null;
  error?: string;
}

export function DictionaryPopup({ isOpen, onClose, isLoading, data, error }: DictionaryPopupProps) {
  // Use the custom hook for click-outside logic
  const popupRef = useClickOutside<HTMLDivElement>(onClose, isOpen);

  if (!isOpen) return null;

  return (
    <div 
      ref={popupRef}
      className="absolute bottom-[calc(100%+12px)] right-0 w-80 max-h-100 overflow-y-auto bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-[#EAE6DF] p-5 z-50 animate-in fade-in zoom-in-95 duration-200"
    >
      {/* Header with close button */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-[#4A6741] font-semibold text-base flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          Dictionary
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-full p-1.5 transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {isLoading && (
        <div className="py-10 flex flex-col items-center justify-center gap-4">
           <div className="w-8 h-8 rounded-full border-[3px] border-[#4A6741] border-t-transparent animate-spin" />
           <p className="text-sm font-medium text-gray-500 animate-pulse">Translating context...</p>
        </div>
      )}

      {error && !isLoading && (
         <div className="py-6 text-center text-red-500 text-sm font-medium bg-red-50 rounded-xl border border-red-100">
           {error}
         </div>
      )}

      {!isLoading && data && (
        <div className="space-y-5">
          <div className="border-b border-gray-100 pb-3">
            <h2 className="text-2xl font-bold text-gray-900 leading-tight">{data.word}</h2>
            {data.phonetic && (
              <p className="text-[#4A6741] font-mono text-sm mt-1 bg-[#4A6741]/10 inline-block px-2 py-0.5 rounded-md">{data.phonetic}</p>
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
                  <div className="mt-3 bg-blue-50/50 rounded-xl p-3 border border-blue-100/50">
                    <p className="text-xs font-bold text-blue-800 mb-2 uppercase tracking-wider flex items-center gap-1.5">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                      </svg>
                      Examples
                    </p>
                    <ul className="space-y-2">
                      {meaning.examples.map((ex, i) => (
                        <li key={i} className="text-sm text-gray-600 italic border-l-2 border-blue-300 pl-2.5 leading-relaxed">&quot;{ex}&quot;</li>
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
      )}
    </div>
  );
}
