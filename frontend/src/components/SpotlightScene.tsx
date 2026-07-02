import { useEffect, useRef } from 'react';

interface SpotlightSceneProps {
  questionId?: string;
  fallbackTexts: string[];
  sloganText?: string;
  sloganVisible?: boolean;
}

interface TextTile {
  id: number;
  text: string;
  x: number;
  y: number;
  size: number;
  alpha: number;
  targetAlpha: number;
  revealAt: number;
  fadeDuration: number;
  warm: boolean;
  weight: number;
  driftAmpX: number;
  driftAmpY: number;
  driftPeriod: number;
  driftPhase: number;
  highlightUntil?: number;
  highlightStartedAt?: number;
  highlightWarm?: boolean;
}

const FONT_FAMILY = "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif";

function randomRange(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function getFontRange(width: number, height: number) {
  const vmin = Math.min(width, height);
  return {
    min: vmin * 0.024,
    max: vmin * 0.052,
    floor: vmin * 0.018,
  };
}

function buildTiles(ctx: CanvasRenderingContext2D, texts: string[], width: number, height: number, now: number) {
  const cleanTexts = texts.map((text) => text.trim()).filter(Boolean);
  if (cleanTexts.length === 0) return [];

  const pool = shuffle(cleanTexts);
  const fontRange = getFontRange(width, height);
  const tiles: Omit<TextTile, 'revealAt' | 'fadeDuration'>[] = [];
  const sidePadding = width * 0.032;
  const topPadding = height * 0.065;
  const bottomLimit = height * 0.955;
  const rowGap = Math.min(width, height) * 0.014;
  const textGap = width * 0.014;
  const maxTextWidth = width * 0.24;
  let y = topPadding;
  let id = 0;

  while (y < bottomLimit) {
    const rowSize = randomRange(fontRange.min, fontRange.max);
    const lineHeight = rowSize * 1.42;
    let x = sidePadding + randomRange(0, width * 0.012);
    const rowTexts = shuffle(pool);
    let didPlace = false;

    for (let rowIndex = 0; rowIndex < rowTexts.length; rowIndex += 1) {
      const text = rowTexts[rowIndex];
      const prominence = rowIndex % 9 === 0 ? randomRange(1.16, 1.36) : randomRange(0.86, 1.08);
      const weight = prominence > 1.12 ? 800 : 700;
      let size = rowSize * prominence;
      ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
      let measured = ctx.measureText(text).width;
      if (measured > maxTextWidth) {
        size = Math.max(fontRange.floor, size * (maxTextWidth / measured));
        ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
        measured = ctx.measureText(text).width;
      }
      if (x + measured > width - sidePadding) break;

      const centerX = x + measured / 2;
      const centerY = y - size * 0.4;
      const dx = (centerX - width / 2) / (width / 2);
      const dy = (centerY - height / 2) / (height / 2);
      const distance = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const centerGlow = 1 - distance;
      const targetAlpha = 0.32 + centerGlow * 0.58 + randomRange(-0.06, 0.06);

      tiles.push({
        id: id += 1,
        text,
        x,
        y,
        size,
        alpha: 0,
        targetAlpha: Math.max(0.3, Math.min(0.95, targetAlpha)),
        warm: centerGlow > 0.42 && Math.random() < 0.42,
        weight,
        driftAmpX: randomRange(width * 0.003, width * 0.008) * (Math.random() < 0.5 ? -1 : 1),
        driftAmpY: randomRange(height * 0.003, height * 0.008) * (Math.random() < 0.5 ? -1 : 1),
        driftPeriod: randomRange(6000, 12000),
        driftPhase: randomRange(0, Math.PI * 2),
      });

      x += measured + textGap;
      didPlace = true;
    }

    if (!didPlace) break;
    y += lineHeight + rowGap;
  }

  const revealOrder = shuffle([...tiles.keys()]);
  const batchStarts = new Map<number, number>();
  let cursor = 0;
  let batchStart = now + 180;
  while (cursor < revealOrder.length) {
    const batchSize = Math.floor(randomRange(5, 9));
    for (let index = 0; index < batchSize && cursor < revealOrder.length; index += 1) {
      batchStarts.set(revealOrder[cursor], batchStart);
      cursor += 1;
    }
    batchStart += randomRange(240, 430);
  }

  return tiles.map((tile, index) => ({
    ...tile,
    revealAt: batchStarts.get(index) ?? now,
    fadeDuration: 190,
  }));
}

export function SpotlightScene({
  questionId,
  fallbackTexts,
  sloganText = 'We Are One',
  sloganVisible = false,
}: SpotlightSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tilesRef = useRef<TextTile[]>([]);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const animationFrameRef = useRef<number>();
  const builtSignatureRef = useRef('');
  const nextHighlightAtRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rebuild = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { width, height, dpr };
      if (ctx && builtSignatureRef.current) {
        tilesRef.current = buildTiles(ctx, fallbackTexts, width, height, performance.now());
      }
    };

    rebuild();
    window.addEventListener('resize', rebuild);
    return () => window.removeEventListener('resize', rebuild);
  }, []);

  useEffect(() => {
    const signature = `${questionId ?? ''}:${fallbackTexts.length}:${fallbackTexts.join('\u0001')}`;
    if (signature === builtSignatureRef.current) return;
    builtSignatureRef.current = signature;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const { width, height } = sizeRef.current;
    if (!ctx || width === 0 || height === 0) return;
    tilesRef.current = buildTiles(ctx, fallbackTexts, width, height, performance.now());
  }, [fallbackTexts, questionId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const render = (now: number) => {
      const { width, height, dpr } = sizeRef.current;
      const visibleTiles = tilesRef.current.filter((tile) => now >= tile.revealAt + tile.fadeDuration);
      const activeHighlightCount = visibleTiles.filter((tile) => (tile.highlightUntil ?? 0) > now).length;
      if (visibleTiles.length > 0 && now >= nextHighlightAtRef.current && activeHighlightCount < 3) {
        const selected: TextTile[] = [];
        const shuffledTiles = shuffle(visibleTiles.filter((tile) => (tile.highlightUntil ?? 0) <= now));
        const desiredCount = Math.min(2, 3 - activeHighlightCount, Math.random() < 0.55 ? 1 : 2);
        shuffledTiles.some((tile) => {
          const tooClose = selected.some((picked) => (
            Math.abs(picked.x - tile.x) < width * 0.24 && Math.abs(picked.y - tile.y) < height * 0.18
          ));
          if (!tooClose) selected.push(tile);
          return selected.length >= desiredCount;
        });
        selected.forEach((tile) => {
          tile.highlightStartedAt = now;
          tile.highlightUntil = now + 1500;
          tile.highlightWarm = Math.random() < 0.55;
        });
        nextHighlightAtRef.current = now + randomRange(800, 1500);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#030405';
      ctx.fillRect(0, 0, width, height);

      const glowWave = 0.5 + Math.sin(now / 540) * 0.5;
      const glowIntensity = (0.7 + glowWave * 0.3) * (sloganVisible ? 1.2 : 1);
      const glowRadiusScale = 0.95 + glowWave * 0.1;
      const gradient = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.035 * glowRadiusScale,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.52 * glowRadiusScale,
      );
      gradient.addColorStop(0, `rgba(255, 255, 255, ${0.36 * glowIntensity})`);
      gradient.addColorStop(0.1, `rgba(245, 219, 168, ${0.23 * glowIntensity})`);
      gradient.addColorStop(0.34, `rgba(145, 155, 155, ${0.08 * glowIntensity})`);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      tilesRef.current.forEach((tile) => {
        const progress = Math.max(0, Math.min(1, (now - tile.revealAt) / tile.fadeDuration));
        tile.alpha = tile.targetAlpha * progress;
        if (tile.alpha <= 0) return;
        const highlightProgress = tile.highlightStartedAt && tile.highlightUntil && now < tile.highlightUntil
          ? Math.sin(Math.min(1, (now - tile.highlightStartedAt) / 1500) * Math.PI)
          : 0;
        const driftX = Math.sin((now / tile.driftPeriod) * Math.PI * 2 + tile.driftPhase) * tile.driftAmpX;
        const driftY = Math.cos((now / (tile.driftPeriod * 1.17)) * Math.PI * 2 + tile.driftPhase) * tile.driftAmpY;
        const scale = 1 + highlightProgress * 0.05;
        ctx.globalAlpha = Math.min(1, tile.alpha + highlightProgress * 0.22) * (sloganVisible ? 0.25 : 1);
        ctx.font = `${tile.weight} ${tile.size}px ${FONT_FAMILY}`;
        ctx.fillStyle = highlightProgress > 0
          ? (tile.highlightWarm ? '#FFD700' : '#FFFFFF')
          : tile.warm ? '#D9C18A' : '#E8EEF2';
        ctx.save();
        ctx.translate(tile.x + driftX, tile.y + driftY);
        ctx.scale(scale, scale);
        ctx.fillText(tile.text, 0, 0);
        ctx.restore();
      });

      ctx.globalAlpha = 1;
      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [sloganVisible]);

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      {sloganVisible && (
        <div className="spotlight-slogan pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center">
          <div className="spotlight-slogan-glow" />
          <div className="spotlight-slogan-text">
            {sloganText.trim() || 'We Are One'}
          </div>
        </div>
      )}
      <style>{`
        .spotlight-slogan {
          animation: spotlightSloganIn 1.5s ease-out both;
        }
        .spotlight-slogan-text {
          position: relative;
          z-index: 2;
          font-size: clamp(88px, 13vw, 260px);
          line-height: 1;
          font-weight: 900;
          letter-spacing: 0;
          color: #ffffff;
          text-align: center;
          text-shadow: 0 0 40px rgba(255,255,255,0.9), 0 0 80px rgba(255,255,255,0.5);
          animation: spotlightSloganBreathe 4s ease-in-out 1.5s infinite;
        }
        .spotlight-slogan-glow {
          position: absolute;
          z-index: 1;
          width: 60vw;
          height: 30vh;
          max-width: 980px;
          max-height: 320px;
          border-radius: 999px;
          background: radial-gradient(ellipse at center, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.28) 24%, rgba(255,255,255,0) 72%);
          opacity: 0.15;
          filter: blur(2px);
          animation: spotlightSloganGlowBreathe 4s ease-in-out infinite;
        }
        @keyframes spotlightSloganIn {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes spotlightSloganBreathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }
        @keyframes spotlightSloganGlowBreathe {
          0%, 100% { transform: scale(0.98); opacity: 0.13; }
          50% { transform: scale(1.04); opacity: 0.17; }
        }
      `}</style>
    </div>
  );
}
