import { useEffect, useRef } from 'react';

interface Props {
  texts: string[];
  totalResponses: number;
}

type WordLevel = 'hero' | 'large' | 'medium' | 'small';

interface Star {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  pulse: number;
  phase: number;
}

interface Orb {
  x: number;
  y: number;
  radius: number;
  speed: number;
  sway: number;
  phase: number;
  opacity: number;
}

interface WordInstance {
  id: number;
  text: string;
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  level: WordLevel;
  vertical: boolean;
  rotation: number;
  warm: boolean;
  opacity: number;
  shadowBlur: number;
  bornAt: number;
  fadeDuration: number;
  focus: boolean;
  driftX: number;
  driftY: number;
  phase: number;
  exitingAt?: number;
}

const MAX_WORDS = 400;
const FONT_FAMILY = '"Arial Black", "Helvetica Neue", sans-serif';

let wordId = 0;

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number) {
  return Math.floor(randomBetween(min, max + 1));
}

function chooseLevelStyle(level: WordLevel) {
  if (level === 'hero') {
    return { fontSize: randomBetween(60, 80), opacity: randomBetween(0.86, 1), shadowBlur: randomBetween(30, 40) };
  }
  if (level === 'large') {
    return { fontSize: randomBetween(36, 50), opacity: randomBetween(0.8, 1), shadowBlur: randomBetween(18, 25) };
  }
  if (level === 'medium') {
    return { fontSize: randomBetween(20, 30), opacity: randomBetween(0.5, 0.8), shadowBlur: randomBetween(12, 20) };
  }
  return { fontSize: randomBetween(12, 16), opacity: randomBetween(0.3, 0.6), shadowBlur: randomBetween(8, 14) };
}

function rectsOverlap(a: WordInstance, b: WordInstance) {
  const padding = 24;
  return !(
    a.x + a.width / 2 + padding < b.x - b.width / 2 ||
    a.x - a.width / 2 - padding > b.x + b.width / 2 ||
    a.y + a.height / 2 + padding < b.y - b.height / 2 ||
    a.y - a.height / 2 - padding > b.y + b.height / 2
  );
}

function buildStars(width: number, height: number): Star[] {
  const count = randomInt(150, 200);
  return Array.from({ length: count }, () => ({
    x: randomBetween(0, width),
    y: randomBetween(0, height),
    radius: randomBetween(1, 3),
    opacity: randomBetween(0.3, 1),
    pulse: randomBetween(0.35, 1.1),
    phase: randomBetween(0, Math.PI * 2),
  }));
}

function buildOrbs(width: number, height: number): Orb[] {
  const count = randomInt(10, 15);
  return Array.from({ length: count }, () => ({
    x: randomBetween(0, width),
    y: randomBetween(0, height),
    radius: randomBetween(20, 60),
    speed: randomBetween(7, 18),
    sway: randomBetween(10, 34),
    phase: randomBetween(0, Math.PI * 2),
    opacity: randomBetween(0.1, 0.2),
  }));
}

function buildLevelsForAnswer(): WordLevel[] {
  const roll = Math.random();
  if (roll < 0.12) return ['hero'];
  if (roll < 0.38) return ['large'];
  if (roll < 0.78) return ['medium'];
  return ['small'];
}

function normalizeWord(text: string) {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function createWordInstance(
  ctx: CanvasRenderingContext2D,
  text: string,
  level: WordLevel,
  width: number,
  height: number,
  existing: WordInstance[],
  animate: boolean,
): WordInstance | null {
  const style = chooseLevelStyle(level);
  const vertical = Math.random() < 0.3;
  const rotation = vertical ? (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : 0;
  const warm = Math.random() < 0.6;
  ctx.font = `900 ${style.fontSize}px ${FONT_FAMILY}`;
  const measured = Math.max(ctx.measureText(text).width, style.fontSize * 1.5);
  const boxWidth = vertical ? style.fontSize * 1.25 : measured;
  const boxHeight = vertical ? measured : style.fontSize * 1.2;
  const margin = Math.max(28, style.fontSize * 0.7);

  let candidate: WordInstance | null = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const x = randomBetween(margin + boxWidth / 2, Math.max(margin + boxWidth / 2, width - margin - boxWidth / 2));
    const y = randomBetween(margin + boxHeight / 2, Math.max(margin + boxHeight / 2, height - margin - boxHeight / 2));
    const next: WordInstance = {
      id: wordId++,
      text,
      key: normalizeWord(text),
      x,
      y,
      width: boxWidth,
      height: boxHeight,
      fontSize: style.fontSize,
      level,
      vertical,
      rotation,
      warm,
      opacity: style.opacity,
      shadowBlur: style.shadowBlur,
      bornAt: performance.now(),
      fadeDuration: animate && level !== 'hero' ? 1500 : 0,
      focus: animate && level === 'hero',
      driftX: randomBetween(-2.5, 2.5),
      driftY: randomBetween(-2.5, 2.5),
      phase: randomBetween(0, Math.PI * 2),
    };
    candidate = next;
    if (!existing.some((item) => rectsOverlap(item, next))) {
      return next;
    }
  }

  return candidate && !existing.some((item) => rectsOverlap(item, candidate)) ? candidate : null;
}

function drawFourPointStar(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, opacity: number) {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.shadowColor = '#E8D5A3';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(x - radius * 3, y);
  ctx.lineTo(x + radius * 3, y);
  ctx.moveTo(x, y - radius * 3);
  ctx.lineTo(x, y + radius * 3);
  ctx.stroke();
  ctx.restore();
}

export function MagicWordCloudScene({ texts, totalResponses }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wordsRef = useRef<WordInstance[]>([]);
  const starsRef = useRef<Star[]>([]);
  const orbsRef = useRef<Orb[]>([]);
  const prevTextsRef = useRef<string[]>([]);
  const prevTotalResponsesRef = useRef(0);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(320, rect.width);
      const height = Math.max(320, rect.height);
      const previousSize = sizeRef.current;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (previousSize.width > 0 && previousSize.height > 0) {
        const scaleX = width / previousSize.width;
        const scaleY = height / previousSize.height;
        wordsRef.current = wordsRef.current.map((word) => ({
          ...word,
          x: word.x * scaleX,
          y: word.y * scaleY,
        }));
      }
      sizeRef.current = { width, height, dpr };
      starsRef.current = buildStars(width, height);
      orbsRef.current = buildOrbs(width, height);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const previous = prevTextsRef.current;
    const wasReset = totalResponses === 0 || totalResponses < prevTotalResponsesRef.current || texts.length === 0;
    if (wasReset) {
      wordsRef.current = [];
      prevTextsRef.current = texts;
      prevTotalResponsesRef.current = totalResponses;
      return;
    }

    const incoming = texts.length > previous.length
      ? texts.filter((_, index) => index >= previous.length)
      : previous.length > 0 && texts.length === previous.length && texts[texts.length - 1] !== previous[previous.length - 1]
        ? [texts[texts.length - 1]]
        : [];
    const isHistory = previous.length === 0 && texts.length > 0;
    const newTexts = isHistory ? texts : incoming;
    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0 || newTexts.length === 0) {
      prevTextsRef.current = texts;
      prevTotalResponsesRef.current = totalResponses;
      return;
    }

    const nextWords = [...wordsRef.current];
    const existingKeys = new Set(nextWords.map((word) => word.key));
    newTexts.forEach((text) => {
      const key = normalizeWord(text);
      if (!key || existingKeys.has(key)) return;
      buildLevelsForAnswer().forEach((level, index) => {
        const instance = createWordInstance(ctx, text, level, width, height, nextWords, !isHistory);
        if (instance) {
          instance.focus = !isHistory && index === 0 && level === 'hero';
          nextWords.push(instance);
          existingKeys.add(key);
        }
      });
    });

    const overflow = nextWords.length - MAX_WORDS;
    if (overflow > 0 && isHistory) {
      wordsRef.current = nextWords.slice(-MAX_WORDS);
      prevTextsRef.current = texts;
      prevTotalResponsesRef.current = totalResponses;
      return;
    }
    if (overflow > 0) {
      const now = performance.now();
      nextWords.slice(0, overflow).forEach((word) => {
        word.exitingAt = now;
      });
    }

    wordsRef.current = nextWords;
    prevTextsRef.current = texts;
    prevTotalResponsesRef.current = totalResponses;
  }, [texts, totalResponses]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const render = (now: number) => {
      const { width, height, dpr } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#050510';
      ctx.fillRect(0, 0, width, height);

      starsRef.current.forEach((star, index) => {
        const twinkle = 0.65 + Math.sin(now * 0.001 * star.pulse + star.phase) * 0.35;
        ctx.globalAlpha = Math.max(0.3, Math.min(1, star.opacity * twinkle));
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = index % 4 === 0 ? '#D4A843' : '#8899BB';
        ctx.shadowBlur = index % 5 === 0 ? 8 : 0;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
        if (index % 19 === 0) {
          drawFourPointStar(ctx, star.x, star.y, star.radius, ctx.globalAlpha);
        }
      });

      orbsRef.current.forEach((orb) => {
        orb.y -= orb.speed / 60;
        if (orb.y + orb.radius < -20) {
          orb.y = height + orb.radius;
          orb.x = randomBetween(0, width);
        }
        const x = orb.x + Math.sin(now * 0.0006 + orb.phase) * orb.sway;
        ctx.globalAlpha = orb.opacity;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.shadowColor = '#88AAFF';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x, orb.y, orb.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      wordsRef.current = wordsRef.current.filter((word) => !word.exitingAt || now - word.exitingAt < 1000);
      wordsRef.current.forEach((word) => {
        const age = now - word.bornAt;
        const fadeProgress = word.fadeDuration > 0 ? Math.min(1, age / word.fadeDuration) : 1;
        const exitProgress = word.exitingAt ? Math.max(0, 1 - (now - word.exitingAt) / 1000) : 1;
        const focusProgress = word.focus ? Math.min(1, age / 500) : 1;
        const focusScale = word.focus ? 1.2 - 0.2 * focusProgress : 1;
        const glowBoost = word.focus ? 2 - focusProgress : 1;
        const driftX = Math.sin(now * 0.00022 + word.phase) * word.driftX;
        const driftY = Math.cos(now * 0.00018 + word.phase) * word.driftY;

        ctx.save();
        ctx.translate(word.x + driftX, word.y + driftY);
        if (word.vertical) {
          ctx.rotate(word.rotation);
        }
        ctx.scale(focusScale, focusScale);
        ctx.globalAlpha = word.opacity * fadeProgress * exitProgress;
        ctx.font = `900 ${word.fontSize}px ${FONT_FAMILY}`;
        ctx.fillStyle = word.warm ? '#E8D5A3' : '#FFFFFF';
        ctx.shadowColor = word.warm ? '#D4A843' : '#8899BB';
        ctx.shadowBlur = word.shadowBlur * glowBoost;
        ctx.fillText(word.text, 0, 0);
        ctx.restore();
      });

      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[520px] overflow-hidden bg-[#050510]">
      <canvas ref={canvasRef} className="absolute inset-0 block" aria-label="魔幻星空 Word Cloud" />
    </div>
  );
}
