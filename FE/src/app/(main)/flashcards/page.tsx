'use client';

import { useState, useEffect } from 'react';
import { httpClient } from '@/lib/http-client';
import { Sidebar } from '@/components/chat/sidebar/sidebar';
import { useAuthContext } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';

interface FlashcardWord {
  id: string;
  uniqueKey?: string; // used for forcing re-renders when looping
  word: string;
  translation: string;
  phonetic: string;
  examples: string[];
  createdAt: string;
}

interface FlashcardGroup {
  topic: string;
  words: FlashcardWord[];
}

export default function FlashcardsPage() {
  const { logout } = useAuthContext();
  const router = useRouter();
  const [groups, setGroups] = useState<FlashcardGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);

  useEffect(() => {
    async function loadFlashcards() {
      try {
        const data = await httpClient.get<FlashcardGroup[]>('/api/dictionary/flashcards');
        setGroups(data);
        if (data.length > 0) setActiveTopic(data[0].topic);
      } catch (err) {
        console.error('Failed to load flashcards', err);
      } finally {
        setLoading(false);
      }
    }
    loadFlashcards();
  }, []);

  const activeGroup = groups.find(g => g.topic === activeTopic);

  return (
    <div className="flex w-full h-full">
      <Sidebar
        onNewChat={() => router.push('/chat')}
        onLogout={logout}
        currentSessionId={null}
        onSessionClick={(session) => router.push(`/chat?sessionId=${session.id}`)}
      />
      <main className="flex-1 flex h-full bg-[#F8F9FB] overflow-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-10 h-10 rounded-full border-4 border-[#8447FF]/30 border-t-[#8447FF] animate-spin" />
          </div>
        ) : groups.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 animate-reveal">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-sm border border-[#E8E4D9] mb-5">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#8447FF" strokeWidth="1.5" className="opacity-80">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18" />
                <path d="M9 21V9" />
              </svg>
            </div>
            <p className="text-lg font-medium text-gray-700">You haven&apos;t translated any words yet.</p>
            <p className="text-[15px] mt-2 text-gray-500 max-w-sm text-center">Look up words in the chat and add them to flashcards!</p>
          </div>
        ) : (
          <>
            {/* Deck Area */}
            <div className="flex-1 flex flex-col relative overflow-hidden">
              {/* Topic Selector */}
              <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
                <div className="relative">
                  <select
                    value={activeTopic || ''}
                    onChange={(e) => setActiveTopic(e.target.value)}
                    className="appearance-none bg-white/80 backdrop-blur-md border border-[#E8E4D9] text-gray-700 font-bold py-2.5 pl-5 pr-10 rounded-full shadow-sm outline-none cursor-pointer hover:bg-white transition-colors"
                  >
                    {groups.map((group) => (
                      <option key={group.topic} value={group.topic}>
                        {group.topic} • {group.words.length} words
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-400">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </div>
                </div>
              </div>

              {activeGroup && (
                <FlashcardDeck key={activeGroup.topic} words={activeGroup.words} />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function FlashcardDeck({ words }: { words: FlashcardWord[] }) {
  const [deck, setDeck] = useState<FlashcardWord[]>(
    words.map(w => ({ ...w, uniqueKey: w.id }))
  );
  const [learnedCount, setLearnedCount] = useState(0);

  const handleSwipeLeft = async (index: number) => {
    const wordToDelete = deck[index];
    // Learned -> remove from deck
    setDeck(prev => prev.filter((_, i) => i !== index));
    setLearnedCount(c => c + 1);
    
    // Delete from DB
    try {
      await httpClient.delete(`/api/dictionary/flashcards/${wordToDelete.id}`);
    } catch (err) {
      console.error('Failed to delete flashcard', err);
    }
  };

  const handleSwipeRight = (index: number) => {
    // Unlearned -> move to back of deck
    setDeck(prev => {
      const newDeck = [...prev];
      const [movedCard] = newDeck.splice(index, 1);
      // Give it a new key so it mounts fresh at the bottom of the deck
      return [...newDeck, { ...movedCard, uniqueKey: `${movedCard.id}-${Math.random()}` }];
    });
  };

  if (deck.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center animate-reveal">
        <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center shadow-inner mb-6">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-800">You did it!</h2>
        <p className="text-gray-500 mt-2">You have reviewed all {learnedCount} words in this topic.</p>
        <button 
          onClick={() => {
            setDeck(words.map(w => ({ ...w, uniqueKey: w.id })));
            setLearnedCount(0);
          }}
          className="mt-8 px-6 py-2.5 bg-white border border-[#E8E4D9] text-gray-700 rounded-xl font-medium shadow-sm hover:shadow hover:bg-gray-50 transition-all"
        >
          Review Again
        </button>
      </div>
    );
  }

  // Determine which cards to render. Render up to 3 cards for the 3D stack effect.
  // The first item in `deck` is the top card.
  // We reverse them so the top card renders LAST (highest z-index).
  const visibleCards = deck.slice(0, 3).reverse();

  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      {/* Top hints */}
      <div className="absolute top-10 left-0 w-full flex justify-between px-16 text-gray-400 font-semibold tracking-widest text-sm uppercase">
        <div className="flex flex-col items-center opacity-70">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-2"><path d="M19 12H5M5 12l7-7M5 12l7 7"/></svg>
          Learned
        </div>
        <div className="flex flex-col items-center opacity-70">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-2"><path d="M5 12h14M19 12l-7-7M19 12l-7 7"/></svg>
          Review Later
        </div>
      </div>

      <div className="relative w-full max-w-sm aspect-[3/4] perspective-1000">
        <AnimatePresence>
          {visibleCards.map((word) => {
            // Find its actual index in the deck (0 means top card)
            const deckIndex = deck.findIndex(w => w.uniqueKey === word.uniqueKey);
            return (
              <SwipeableCard
                key={word.uniqueKey}
                word={word}
                depth={deckIndex}
                onSwipeLeft={() => handleSwipeLeft(0)}
                onSwipeRight={() => handleSwipeRight(0)}
              />
            );
          })}
        </AnimatePresence>
      </div>
      
      <div className="absolute bottom-10 text-gray-400 font-medium">
        {deck.length} cards remaining
      </div>
    </div>
  );
}

function SwipeableCard({ 
  word, 
  depth, 
  onSwipeLeft, 
  onSwipeRight 
}: { 
  word: FlashcardWord; 
  depth: number; 
  onSwipeLeft: () => void; 
  onSwipeRight: () => void; 
}) {
  const [flipped, setFlipped] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [exitX, setExitX] = useState(0);

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-15, 15]);
  
  // Opacity indicators for swiping
  const learnedOpacity = useTransform(x, [-100, -200], [0, 1]);
  const reviewOpacity = useTransform(x, [100, 200], [0, 1]);

  const handleDragEnd = (event: any, info: any) => {
    const swipeThreshold = 100;
    const velocityThreshold = 500;

    const isFastSwipe = Math.abs(info.velocity.x) > velocityThreshold;
    const isFarSwipe = Math.abs(info.offset.x) > swipeThreshold;

    if (isFarSwipe || isFastSwipe) {
      const direction = info.offset.x > 0 ? 1 : -1;
      setExitX(direction * 500);
      
      if (direction === -1) {
        onSwipeLeft();
      } else {
        onSwipeRight();
      }
    }
  };

  const isTop = depth === 0;

  return (
    <motion.div
      className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing origin-bottom"
      style={{ 
        x, 
        rotate,
        zIndex: 10 - depth,
      }}
      initial={{ 
        scale: 1 - depth * 0.05, 
        y: depth * 20, 
        opacity: depth >= 3 ? 0 : 1 
      }}
      animate={{ 
        scale: 1 - depth * 0.05, 
        y: depth * 20, 
        opacity: depth >= 3 ? 0 : 1,
        transition: { type: 'spring', stiffness: 300, damping: 20 }
      }}
      drag={isTop ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.8}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={(e, info) => {
        setTimeout(() => setIsDragging(false), 100);
        handleDragEnd(e, info);
      }}
      exit={{ x: exitX, opacity: 0, transition: { duration: 0.2 } }}
    >
      <div 
        className={`w-full h-full transition-transform duration-500 preserve-3d relative shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-[24px] ${
          flipped ? 'rotate-y-180' : ''
        }`}
        onClick={() => {
          if (!isDragging && isTop) setFlipped(!flipped);
        }}
      >
        {/* Front */}
        <div className="absolute inset-0 backface-hidden w-full h-full bg-white rounded-[24px] border border-[#E8E4D9] flex flex-col items-center justify-center p-8 overflow-hidden pointer-events-none">
          {/* Swipe Indicators */}
          <motion.div 
            style={{ opacity: learnedOpacity }} 
            className="absolute top-8 right-8 border-4 border-green-500 text-green-500 font-bold text-2xl px-4 py-1 rounded-xl rotate-[15deg]"
          >
            LEARNED
          </motion.div>
          <motion.div 
            style={{ opacity: reviewOpacity }} 
            className="absolute top-8 left-8 border-4 border-amber-500 text-amber-500 font-bold text-2xl px-4 py-1 rounded-xl -rotate-[15deg]"
          >
            REVIEW
          </motion.div>

          <p className="text-4xl font-bold text-gray-800 text-center mb-4">{word.word}</p>
          {word.phonetic && (
            <p className="text-lg text-gray-500 font-mono tracking-widest">{word.phonetic}</p>
          )}
          <div className="absolute bottom-8 flex items-center gap-2 text-sm font-medium text-gray-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
            Tap to flip
          </div>
        </div>

        {/* Back */}
        <div className="absolute inset-0 backface-hidden w-full h-full bg-[#8447FF] rounded-[24px] border border-[#6B35CC] text-white flex flex-col p-8 rotate-y-180 overflow-y-auto custom-scrollbar pointer-events-none">
          <div className="flex-1 flex flex-col">
            <p className="text-2xl font-bold text-center mb-6 leading-relaxed border-b border-white/20 pb-6">{word.translation}</p>
            
            {word.examples && word.examples.length > 0 ? (
              <div className="space-y-4">
                <p className="text-xs text-[#C4A0FF] uppercase tracking-widest font-bold flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  Examples
                </p>
                <ul className="text-base text-white/95 space-y-4">
                  {word.examples.slice(0, 2).map((ex, i) => (
                    <li key={i} className="leading-relaxed relative pl-4">
                      <span className="absolute left-0 top-2.5 w-1.5 h-1.5 rounded-full bg-[#C4A0FF]"></span>
                      {ex.replace(/<[^>]*>?/gm, '')}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center opacity-60">
                No examples available
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
