import { useEffect, useRef } from 'react';

interface Props {
  texts: string[];
  totalResponses: number;
  refreshIntervalSec?: number;
  refreshPaused?: boolean;
  refreshNonce?: number;
}

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

interface WordTarget {
  key: string;
  text: string;
  frequency: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  rotation: number;
  warm: boolean;
  opacity: number;
  shadowBlur: number;
}

interface WordInstance extends WordTarget {
  currentX: number;
  currentY: number;
  currentFontSize: number;
  currentRotation: number;
  currentOpacity: number;
  fromX: number;
  fromY: number;
  fromFontSize: number;
  fromRotation: number;
  fromOpacity: number;
  transitionStart: number;
  transitionDuration: number;
  driftX: number;
  driftY: number;
  phase: number;
  removing?: boolean;
}

const FONT_FAMILY = '"Arial Black", "Helvetica Neue", sans-serif';
const MIN_TRANSITION_MS = 1000;
const MAX_TRANSITION_MS = 2000;

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number) {
  return Math.floor(randomBetween(min, max + 1));
}

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function normalizeWord(text: string) {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function rectsOverlap(a: WordTarget, b: WordTarget) {
  const padding = Math.max(2, Math.min(a.fontSize, b.fontSize) * 0.08);
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

function buildWordEntries(texts: string[]) {
  const map = new Map<string, { text: string; frequency: number }>();
  texts.forEach((rawText) => {
    const key = normalizeWord(rawText);
    if (!key) return;
    const current = map.get(key);
    if (current) {
      current.frequency += 1;
      return;
    }
    map.set(key, { text: rawText.trim().replace(/\s+/g, ' '), frequency: 1 });
  });
  return [...map.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.frequency - a.frequency || a.text.localeCompare(b.text));
}

function measureWord(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  rotation: number,
) {
  ctx.font = `900 ${fontSize}px ${FONT_FAMILY}`;
  const rawWidth = Math.max(ctx.measureText(text).width, fontSize * 1.6);
  const rawHeight = fontSize * 1.18;
  const vertical = Math.abs(rotation) > 0.1;
  return {
    width: vertical ? rawHeight : rawWidth,
    height: vertical ? rawWidth : rawHeight,
  };
}

function makeTargetAt(
  ctx: CanvasRenderingContext2D,
  entry: { key: string; text: string; frequency: number },
  fontSize: number,
  x: number,
  y: number,
  rotation: number,
  warm: boolean,
): WordTarget {
  const measured = measureWord(ctx, entry.text, fontSize, rotation);
  return {
    key: entry.key,
    text: entry.text,
    frequency: entry.frequency,
    x,
    y,
    width: measured.width,
    height: measured.height,
    fontSize,
    rotation,
    warm,
    opacity: warm ? randomBetween(0.78, 1) : randomBetween(0.68, 0.96),
    shadowBlur: fontSize * (warm ? 0.58 : 0.46),
  };
}

function buildGridCells(width: number, height: number) {
  const cols = 4;
  const rows = 3;
  const cells: { x: number; y: number; width: number; height: number }[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({
        x: (col + 0.5) * (width / cols),
        y: (row + 0.5) * (height / rows),
        width: width / cols,
        height: height / rows,
      });
    }
  }
  const centerX = width / 2;
  const centerY = height / 2;
  return cells.sort((a, b) => {
    const distanceA = Math.hypot(a.x - centerX, a.y - centerY);
    const distanceB = Math.hypot(b.x - centerX, b.y - centerY);
    return distanceB - distanceA;
  });
}

function clampToBounds(target: WordTarget, width: number, height: number, edgePadding: number) {
  return {
    x: Math.min(width - target.width / 2 - edgePadding, Math.max(target.width / 2 + edgePadding, target.x)),
    y: Math.min(height - target.height / 2 - edgePadding, Math.max(target.height / 2 + edgePadding, target.y)),
  };
}

function findGridPosition(
  ctx: CanvasRenderingContext2D,
  entry: { key: string; text: string; frequency: number },
  fontSize: number,
  rotation: number,
  warm: boolean,
  cell: { x: number; y: number; width: number; height: number },
  placed: WordTarget[],
  width: number,
  height: number,
  edgePadding: number,
) {
  const directions = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];

  for (let shrink = 0; shrink <= 3; shrink += 1) {
    const nextSize = fontSize * Math.pow(0.85, shrink);
    const maxRadius = Math.max(cell.width, cell.height) * 1.45;
    const step = Math.max(10, nextSize * 0.46);
    for (let radius = 0; radius <= maxRadius; radius += step) {
      for (let dirIndex = 0; dirIndex < directions.length; dirIndex += 1) {
        const [dx, dy] = directions[dirIndex];
        const angleOffset = radius === 0 ? 0 : randomBetween(-step * 0.35, step * 0.35);
        const candidate = makeTargetAt(
          ctx,
          entry,
          nextSize,
          cell.x + dx * radius + angleOffset,
          cell.y + dy * radius + randomBetween(-step * 0.35, step * 0.35),
          rotation,
          warm,
        );
        const clamped = clampToBounds(candidate, width, height, edgePadding);
        const target = { ...candidate, ...clamped };
        if (!placed.some((word) => rectsOverlap(word, target))) {
          return target;
        }
      }
    }
  }

  return null;
}

function buildLayout(ctx: CanvasRenderingContext2D, texts: string[], width: number, height: number) {
  const entries = buildWordEntries(texts);
  if (entries.length === 0) return [];

  const area = width * height;
  const vmin = Math.min(width, height);
  const baseSize = Math.sqrt(area / entries.length) * 0.36;
  const minFrequency = Math.min(...entries.map((entry) => entry.frequency));
  const maxFrequency = Math.max(...entries.map((entry) => entry.frequency));
  const placed: WordTarget[] = [];
  const edgePadding = Math.max(10, Math.min(width, height) * 0.014);
  const cells = buildGridCells(width, height);

  if (entries.length <= 3) {
    const size = width * 0.06;
    const positions = entries.length === 1
      ? [{ x: width / 2, y: height / 2 }]
      : entries.length === 2
        ? [{ x: width * 0.32, y: height / 2 }, { x: width * 0.68, y: height / 2 }]
        : [{ x: width * 0.22, y: height / 2 }, { x: width * 0.5, y: height / 2 }, { x: width * 0.78, y: height / 2 }];
    return entries.map((entry, index) => makeTargetAt(
      ctx,
      entry,
      size,
      positions[index].x,
      positions[index].y,
      0,
      index % 2 === 0,
    ));
  }

  entries.forEach((entry, index) => {
    const frequencyRatio = maxFrequency === minFrequency
      ? 0.5
      : (entry.frequency - minFrequency) / (maxFrequency - minFrequency);
    const frequencyWeight = 0.6 + frequencyRatio * 1.4;
    const maxSize = entries.length < 10 ? width * 0.1 : vmin * 0.18;
    const fontSize = Math.max(10, Math.min(maxSize, baseSize * frequencyWeight));
    const rotation = entries.length < 10 ? 0 : Math.random() < 0.13 ? (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : 0;
    const warm = index % 3 === 0 || frequencyRatio > 0.55;
    const cell = cells[index % cells.length];
    const target = findGridPosition(ctx, entry, fontSize, rotation, warm, cell, placed, width, height, edgePadding);
    if (target) {
      placed.push(target);
    }
  });

  return placed;
}

function applyTargets(instances: WordInstance[], targets: WordTarget[], now: number) {
  const currentByKey = new Map(instances.map((word) => [word.key, word]));
  const targetKeys = new Set(targets.map((target) => target.key));
  const next: WordInstance[] = [];

  targets.forEach((target) => {
    const existing = currentByKey.get(target.key);
    if (existing) {
      next.push({
        ...existing,
        ...target,
        fromX: existing.currentX,
        fromY: existing.currentY,
        fromFontSize: existing.currentFontSize,
        fromRotation: existing.currentRotation,
        fromOpacity: existing.currentOpacity,
        transitionStart: now,
        transitionDuration: randomBetween(MIN_TRANSITION_MS, MAX_TRANSITION_MS),
        removing: false,
      });
      return;
    }
    next.push({
      ...target,
      currentX: target.x,
      currentY: target.y,
      currentFontSize: target.fontSize,
      currentRotation: target.rotation,
      currentOpacity: 0,
      fromX: target.x,
      fromY: target.y,
      fromFontSize: target.fontSize,
      fromRotation: target.rotation,
      fromOpacity: 0,
      transitionStart: now,
      transitionDuration: randomBetween(MIN_TRANSITION_MS, MAX_TRANSITION_MS),
      driftX: randomBetween(-1.8, 1.8),
      driftY: randomBetween(-1.8, 1.8),
      phase: randomBetween(0, Math.PI * 2),
    });
  });

  instances.forEach((word) => {
    if (targetKeys.has(word.key)) return;
    next.push({
      ...word,
      fromX: word.currentX,
      fromY: word.currentY,
      fromFontSize: word.currentFontSize,
      fromRotation: word.currentRotation,
      fromOpacity: word.currentOpacity,
      x: word.currentX,
      y: word.currentY,
      fontSize: word.currentFontSize,
      rotation: word.currentRotation,
      opacity: 0,
      transitionStart: now,
      transitionDuration: randomBetween(MIN_TRANSITION_MS, MAX_TRANSITION_MS),
      removing: true,
    });
  });

  return next;
}

export function MagicWordCloudScene({
  texts,
  totalResponses,
  refreshPaused = false,
  refreshNonce = 0,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wordsRef = useRef<WordInstance[]>([]);
  const starsRef = useRef<Star[]>([]);
  const orbsRef = useRef<Orb[]>([]);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const rafRef = useRef<number | null>(null);
  const layoutSignatureRef = useRef('');

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const relayout = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(320, rect.width);
      const height = Math.max(320, rect.height);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { width, height, dpr };
      starsRef.current = buildStars(width, height);
      orbsRef.current = buildOrbs(width, height);
      if (ctx && texts.length > 0) {
        const targets = buildLayout(ctx, texts, width, height);
        wordsRef.current = applyTargets(wordsRef.current, targets, performance.now());
      }
    };

    relayout();
    const observer = new ResizeObserver(relayout);
    observer.observe(container);
    window.addEventListener('resize', relayout);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', relayout);
    };
  }, []);

  useEffect(() => {
    if (refreshPaused) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const { width, height } = sizeRef.current;
    if (!ctx || width === 0 || height === 0) return;

    if (totalResponses === 0 || texts.length === 0) {
      wordsRef.current = [];
      layoutSignatureRef.current = '';
      return;
    }

    const signature = `${refreshNonce}:${texts.length}:${texts.join('\u0001')}`;
    if (signature === layoutSignatureRef.current) return;
    layoutSignatureRef.current = signature;
    const targets = buildLayout(ctx, texts, width, height);
    wordsRef.current = applyTargets(wordsRef.current, targets, performance.now());
  }, [texts, totalResponses, refreshPaused, refreshNonce]);

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
      wordsRef.current = wordsRef.current.filter((word) => !(word.removing && word.currentOpacity <= 0.01));
      wordsRef.current.forEach((word) => {
        const progress = Math.min(1, Math.max(0, (now - word.transitionStart) / word.transitionDuration));
        const eased = easeInOut(progress);
        word.currentX = word.fromX + (word.x - word.fromX) * eased;
        word.currentY = word.fromY + (word.y - word.fromY) * eased;
        word.currentFontSize = word.fromFontSize + (word.fontSize - word.fromFontSize) * eased;
        word.currentRotation = word.fromRotation + (word.rotation - word.fromRotation) * eased;
        word.currentOpacity = word.fromOpacity + (word.opacity - word.fromOpacity) * eased;

        const driftX = Math.sin(now * 0.0002 + word.phase) * word.driftX;
        const driftY = Math.cos(now * 0.00018 + word.phase) * word.driftY;
        ctx.save();
        ctx.translate(word.currentX + driftX, word.currentY + driftY);
        if (Math.abs(word.currentRotation) > 0.01) {
          ctx.rotate(word.currentRotation);
        }
        ctx.globalAlpha = word.currentOpacity;
        ctx.font = `900 ${word.currentFontSize}px ${FONT_FAMILY}`;
        ctx.fillStyle = word.warm ? '#E8D5A3' : '#FFFFFF';
        ctx.shadowColor = word.warm ? '#D4A843' : '#8899BB';
        ctx.shadowBlur = word.shadowBlur;
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
