import { useEffect, useRef, useCallback } from 'react';

interface SpotlightSceneProps {
  sessionId: string;
  questionId?: string;
  fallbackTexts: string[];
}

interface TextInstance {
  id: number;
  text: string;
  x: number;
  y: number;
  size: number;
  alpha: number;
  targetAlpha: number;
  vx: number;
  vy: number;
  removing: boolean;
}

const MAX_INSTANCES = 500;
const MIN_SPAWN = 3;
const MAX_SPAWN = 5;
const RECONNECT_DELAY = 3000;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function randomRange(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildWsUrl(sessionId: string) {
  if (!sessionId) return '';
  const { protocol, host } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}/api/ws/sessions/${sessionId}/spotlight`;
}

export function SpotlightScene({ sessionId, questionId, fallbackTexts }: SpotlightSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const instancesRef = useRef<TextInstance[]>([]);
  const nextIdRef = useRef(0);
  const gradientCacheRef = useRef<{ width: number; height: number; gradient: CanvasGradient } | null>(null);
  const widthRef = useRef<number>(window.innerWidth);
  const heightRef = useRef<number>(window.innerHeight);
  const animationFrameRef = useRef<number>();
  const lastTimestampRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number>();
  const fallbackSeenRef = useRef<Set<string>>(new Set());
  const spawnCursorRef = useRef(0);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    widthRef.current = width;
    heightRef.current = height;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctxRef.current = ctx;
    }
    gradientCacheRef.current = null;
  }, []);

  const ensureCapacity = useCallback(() => {
    const activeCount = instancesRef.current.filter((instance) => !instance.removing).length;
    if (activeCount <= MAX_INSTANCES) return;
    const overflow = activeCount - MAX_INSTANCES;
    const sorted = [...instancesRef.current].sort((a, b) => a.id - b.id);
    let removed = 0;
    for (const instance of sorted) {
      if (instance.removing) continue;
      instance.targetAlpha = 0;
      instance.removing = true;
      removed += 1;
      if (removed >= overflow) break;
    }
  }, []);

  const pickSpawnPosition = useCallback((width: number, height: number) => {
    const cursor = spawnCursorRef.current;
    spawnCursorRef.current += 1;

    const angle = cursor * GOLDEN_ANGLE + randomRange(-0.28, 0.28);
    const sequence = (cursor * 0.61803398875) % 1;
    const centerPass = cursor % 4 === 0;
    const radius = centerPass ? randomRange(0.05, 0.38) : Math.sqrt(sequence);
    const xRadius = width * 0.46;
    const yRadius = height * 0.42;
    const jitterX = randomRange(-width * 0.035, width * 0.035);
    const jitterY = randomRange(-height * 0.035, height * 0.035);

    return {
      x: clamp(width / 2 + Math.cos(angle) * radius * xRadius + jitterX, width * 0.06, width * 0.94),
      y: clamp(height / 2 + Math.sin(angle) * radius * yRadius + jitterY, height * 0.08, height * 0.92),
    };
  }, []);

  const spawnInstances = useCallback((name: string, options?: { instant?: boolean }) => {
    if (!name.trim()) return;
    const count = Math.floor(randomRange(MIN_SPAWN, MAX_SPAWN + 1));
    const width = widthRef.current;
    const height = heightRef.current;
    for (let i = 0; i < count; i += 1) {
      const targetAlpha = randomRange(0.3, 0.9);
      const position = pickSpawnPosition(width, height);
      instancesRef.current.push({
        id: nextIdRef.current += 1,
        text: name,
        x: position.x,
        y: position.y,
        size: randomRange(18, 36),
        alpha: options?.instant ? targetAlpha : 0,
        targetAlpha,
        vx: randomRange(-10, 10) * 0.02, // px per second
        vy: randomRange(-10, 10) * 0.02,
        removing: false,
      });
    }
    ensureCapacity();
  }, [ensureCapacity, pickSpawnPosition]);

  const spawnMany = useCallback((names: string[], options?: { instant?: boolean }) => {
    names.forEach((raw) => spawnInstances(raw, options));
  }, [spawnInstances]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas]);

  useEffect(() => {
    instancesRef.current = [];
    fallbackSeenRef.current.clear();
    spawnCursorRef.current = 0;
    gradientCacheRef.current = null;
  }, [questionId]);

  useEffect(() => {
    if (!fallbackTexts.length) {
      fallbackSeenRef.current.clear();
      instancesRef.current.forEach((instance) => {
        instance.targetAlpha = 0;
        instance.removing = true;
      });
      return;
    }

    fallbackTexts.forEach((text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (fallbackSeenRef.current.has(key)) return;
      fallbackSeenRef.current.add(key);
      spawnInstances(trimmed, { instant: true });
    });
  }, [fallbackTexts, spawnInstances]);

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const url = buildWsUrl(sessionId);
      if (!url) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === 'history' && Array.isArray(payload.names)) {
            spawnMany(payload.names, { instant: true });
          } else if (payload?.type === 'name' && typeof payload.name === 'string') {
            spawnInstances(payload.name);
          } else if (Array.isArray(payload)) {
            spawnMany(payload, { instant: true });
          }
        } catch (err) {
          console.warn('[SpotlightScene] invalid message', err);
        }
      });

      const scheduleReconnect = () => {
        if (cancelled) return;
        reconnectRef.current = window.setTimeout(connect, RECONNECT_DELAY);
      };

      ws.addEventListener('close', scheduleReconnect);
      ws.addEventListener('error', () => {
        ws.close();
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectRef.current) {
        window.clearTimeout(reconnectRef.current);
      }
      wsRef.current?.close();
    };
  }, [sessionId, spawnInstances, spawnMany]);

  useEffect(() => {
    const render = (timestamp: number) => {
      const ctx = ctxRef.current;
      const canvas = canvasRef.current;
      if (!ctx || !canvas) {
        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }
      const width = widthRef.current;
      const height = heightRef.current;
      const delta = lastTimestampRef.current ? (timestamp - lastTimestampRef.current) / 1000 : 0;
      lastTimestampRef.current = timestamp;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, width, height);

      const gradientCache = gradientCacheRef.current;
      let gradient = gradientCache?.gradient;
      if (!gradient || gradientCache?.width !== width || gradientCache?.height !== height) {
        gradient = ctx.createRadialGradient(
          width / 2,
          height / 2,
          Math.max(width, height) * 0.08,
          width / 2,
          height / 2,
          Math.max(width, height) * 0.7,
        );
        gradient.addColorStop(0, 'rgba(255, 225, 180, 0.25)');
        gradient.addColorStop(0.35, 'rgba(255, 210, 160, 0.08)');
        gradient.addColorStop(1, 'rgba(10, 10, 10, 0)');
        gradientCacheRef.current = { width, height, gradient };
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      const instances = instancesRef.current;
      for (let i = instances.length - 1; i >= 0; i -= 1) {
        const instance = instances[i];
        const speedFactor = delta || 0.016;
        instance.x += instance.vx * speedFactor * 60;
        instance.y += instance.vy * speedFactor * 60;

        if (instance.x < -100) instance.x = width + 50;
        if (instance.x > width + 100) instance.x = -50;
        if (instance.y < -100) instance.y = height + 50;
        if (instance.y > height + 100) instance.y = -50;

        instance.alpha += (instance.targetAlpha - instance.alpha) * 0.05;
        if (instance.removing && instance.alpha <= 0.02) {
          instances.splice(i, 1);
          continue;
        }

        ctx.globalAlpha = Math.max(0, Math.min(1, instance.alpha));
        ctx.fillStyle = '#ffffff';
        ctx.font = `${instance.size}px 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(instance.text, instance.x, instance.y);
      }
      ctx.globalAlpha = 1;

      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}
