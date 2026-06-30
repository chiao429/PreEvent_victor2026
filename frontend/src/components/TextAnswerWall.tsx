import { useEffect, useRef, useState } from 'react';

interface Props {
  texts: string[];
  totalResponses: number;
}

const CARD_COLORS = [
  'bg-indigo-500/20 border-indigo-400/40 text-indigo-100',
  'bg-violet-500/20 border-violet-400/40 text-violet-100',
  'bg-cyan-500/20 border-cyan-400/40 text-cyan-100',
  'bg-emerald-500/20 border-emerald-400/40 text-emerald-100',
  'bg-pink-500/20 border-pink-400/40 text-pink-100',
  'bg-amber-500/20 border-amber-400/40 text-amber-100',
  'bg-sky-500/20 border-sky-400/40 text-sky-100',
  'bg-rose-500/20 border-rose-400/40 text-rose-100',
];

interface AnimatedText {
  text: string;
  key: number;
  colorClass: string;
  visible: boolean;
}

let keyCounter = 0;

export function TextAnswerWall({ texts, totalResponses }: Props) {
  const [cards, setCards] = useState<AnimatedText[]>([]);
  const prevTextsRef = useRef<string[]>([]);

  useEffect(() => {
    const prev = prevTextsRef.current;
    const newTexts = texts.filter((_, i) => i >= prev.length);

    if (newTexts.length > 0) {
      setCards((prevCards) => {
        const incoming = newTexts.map((text, i) => ({
          text,
          key: keyCounter++,
          colorClass: CARD_COLORS[(prevCards.length + i) % CARD_COLORS.length],
          visible: false,
        }));
        const updated = [...prevCards, ...incoming].slice(-20);
        return updated;
      });

      // Trigger fade-in on next tick
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setCards((prev) => prev.map((c) => ({ ...c, visible: true })));
        });
      });
    }

    prevTextsRef.current = texts;
  }, [texts]);

  // Initial load: show all existing with animation
  useEffect(() => {
    if (texts.length > 0 && cards.length === 0) {
      const initial = texts.map((text, i) => ({
        text,
        key: keyCounter++,
        colorClass: CARD_COLORS[i % CARD_COLORS.length],
        visible: false,
      }));
      setCards(initial);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setCards((prev) => prev.map((c) => ({ ...c, visible: true })));
        });
      });
      prevTextsRef.current = texts;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full">
      {/* Count badge */}
      <div className="flex items-center justify-center gap-3 mb-8">
        <div className="flex items-baseline gap-2">
          <span className="text-7xl font-black text-white tabular-nums">
            {totalResponses}
          </span>
          <span className="text-2xl text-gray-400 font-medium">則回應</span>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="text-center py-8">
          <div className="inline-flex items-center gap-2 text-gray-600">
            <span className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <p className="text-gray-600 mt-3">等待第一則回應...</p>
        </div>
      ) : (
        <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
          {cards.map((card) => (
            <div
              key={card.key}
              className={`
                break-inside-avoid rounded-2xl border px-4 py-3
                transition-all duration-700 ease-out
                ${card.colorClass}
                ${card.visible
                  ? 'opacity-100 translate-y-0 scale-100'
                  : 'opacity-0 translate-y-6 scale-95'
                }
              `}
              style={{ display: 'inline-block', width: '100%' }}
            >
              <p className="text-sm md:text-base leading-relaxed break-words">
                {card.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
