import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { geoPath, geoTransform } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, LineString, MultiPolygon, Polygon } from 'geojson';
import type { QuestionOption } from '../types';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';
const TAIWAN_WHITE = '#e0e8f4';
const GOLD = '#D4A843';
const STAR_COUNT = 70;
const IDLE_GLOW_BASE = 0.08;
const IDLE_GLOW_AMPLITUDE = 0.04;
const IDLE_GLOW_PERIOD = 15; // seconds

const TAIWAN_REGIONS = [
  { name: '北', label: '北', lat: 25.05, lon: 121.50, labelClass: 'map-label-north' },
  { name: '中', label: '中', lat: 24.15, lon: 120.55, labelClass: 'map-label-left' },
  { name: '南', label: '南', lat: 22.65, lon: 120.25, labelClass: 'map-label-south' },
  { name: '東', label: '東', lat: 23.80, lon: 121.50, labelClass: 'map-label-east' },
] as const;

const TAIWAN_ISLAND_MARKERS = [
  { name: '澎湖', lat: 23.57, lon: 119.58, radius: 12 },
  { name: '馬祖', lat: 26.16, lon: 119.95, radius: 20 },
] as const;

const OVERSEAS_POINTS = [
  { id: 'taiwanStrait', lat: 25.8, lon: 119.0 }, // 左上：台灣海峽海面
  { id: 'fujianCoast', lat: 24.6, lon: 118.5 }, // 左上：福建沿岸
  { id: 'okinawa', lat: 26.2, lon: 127.7 },    // 右上：日本沖繩
  { id: 'guam', lat: 13.4, lon: 144.8 },       // 右下：關島
  { id: 'luzon', lat: 15.5, lon: 121.0 },      // 正下：菲律賓呂宋
  { id: 'visayas', lat: 11.0, lon: 123.0 },    // 下方偏中：菲律賓中部
  { id: 'borneo', lat: 4.5, lon: 118.0 },      // 左下：婆羅洲
  { id: 'malaysia', lat: 3.1, lon: 101.7 },    // 左下偏南：馬來西亞
  { id: 'vietnam', lat: 16.0, lon: 108.2 },    // 左側：越南
  { id: 'hongkong', lat: 22.3, lon: 114.2 },   // 左上：香港
] as const;

const TAIWAN_REGION_NAMES = new Set(TAIWAN_REGIONS.map((region) => region.name));
const COUNTRY_IDS = new Set([
  '96',  // Brunei
  '156', // China
  '158', // Taiwan
  '360', // Indonesia
  '392', // Japan
  '458', // Malaysia
  '608', // Philippines
]);
const TAIWAN_CONNECTIONS: [TaiwanRegionName, TaiwanRegionName][] = [
  ['北', '中'],
  ['中', '南'],
  ['北', '東'],
  ['南', '東'],
];

type TaiwanRegionName = (typeof TAIWAN_REGIONS)[number]['name'];
type TriggerName = TaiwanRegionName | '海';
type OverseasPointId = (typeof OVERSEAS_POINTS)[number]['id'];
type CountryFeature = Feature<Polygon | MultiPolygon> & { id?: string | number };
interface StarFlicker {
  sprite: THREE.Sprite;
  baseOpacity: number;
  amplitude: number;
  speed: number;
  phase: number;
}

interface ThreeMapSceneProps {
  options: QuestionOption[];
}

interface MapData {
  texture: THREE.CanvasTexture;
  taiwanGlowTexture: THREE.CanvasTexture;
  planeW: number;
  planeH: number;
  latLonToXY: (lat: number, lon: number) => { x: number; y: number };
}

interface PointVisual {
  group: THREE.Group;
  core: THREE.Sprite;
  pulse: THREE.Sprite;
  ripples: THREE.Sprite[];
  active: boolean;
  activationAt: number;
  lastTriggeredAt: number;
  baseScale: number;
  pulseSpeed: number;
}

interface TaiwanConnectionVisual {
  a: TaiwanRegionName;
  b: TaiwanRegionName;
  material: THREE.LineBasicMaterial;
}

interface OverseasConnectionVisual {
  pointId: OverseasPointId;
  material: THREE.LineBasicMaterial;
}

function normalizeRegionName(raw: string): TriggerName | null {
  const trimmed = raw.trim();
  if (trimmed === '海外' || trimmed === '海') return '海';
  if (TAIWAN_REGION_NAMES.has(trimmed as TaiwanRegionName)) return trimmed as TaiwanRegionName;
  const first = trimmed[0];
  return TAIWAN_REGION_NAMES.has(first as TaiwanRegionName) ? first as TaiwanRegionName : null;
}

const createLcg = (initial = 42) => {
  let seed = initial;
  return () => {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
};

function createGlowTexture() {
  const size = 160;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot create glow texture');

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.48, 'rgba(255,255,255,0.38)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createStarTexture() {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot create star texture');

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createRingTexture() {
  const size = 180;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot create ring texture');

  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.28, 0, Math.PI * 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

async function buildMapTexture(): Promise<MapData> {
  const topo: Topology = await fetch(GEO_URL).then((res) => res.json());
  const W = 1800;
  const H = 1200;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = W;
  glowCanvas.height = H;
  const ctx = canvas.getContext('2d');
  const glowCtx = glowCanvas.getContext('2d');
  if (!ctx) throw new Error('Cannot acquire canvas context');
  if (!glowCtx) throw new Error('Cannot acquire Taiwan glow context');

  // ── 1. Ocean base: deep blue with subtle stripe texture ──────────────────
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 3) {
    const t = (Math.sin(y * 0.06 + 0.5) + 1) * 0.5;
    ctx.fillStyle = `rgba(30,80,130,${(t * 0.018 + 0.004).toFixed(4)})`;
    ctx.fillRect(0, y, W, 3);
  }

  const lonMin = 118;
  const lonMax = 123.5;
  const latMin = 17;
  const latMax = 27;
  const midLatRad = ((latMin + latMax) / 2) * (Math.PI / 180);
  const lonScale = Math.cos(midLatRad);
  const lonSpan = (lonMax - lonMin) * lonScale;
  const latSpan = latMax - latMin;
  const desiredMargin = 0;
  const availableWidth = Math.max(10, W - desiredMargin * 2);
  const availableHeight = Math.max(10, H - desiredMargin * 2);
  const uniformScale = Math.min(availableWidth / lonSpan, availableHeight / latSpan);
  const offsetX = (W - lonSpan * uniformScale) * 0.35;
  const offsetY = (H - latSpan * uniformScale) * 0.75;
  const projectLonLat = (lon: number, lat: number) => [
    offsetX + (lon - lonMin) * lonScale * uniformScale,
    offsetY + (latMax - lat) * uniformScale,
  ] as [number, number];

  // ── 2. Radial glow centred on Taiwan ─────────────────────────────────────
  const [twCx, twCy] = projectLonLat(121.0, 23.85);
  const oceanGlow = ctx.createRadialGradient(twCx, twCy, 0, twCx, twCy, Math.max(W, H) * 0.55);
  oceanGlow.addColorStop(0, 'rgba(100,140,180,0.08)');
  oceanGlow.addColorStop(1, 'rgba(100,140,180,0)');
  ctx.fillStyle = oceanGlow;
  ctx.fillRect(0, 0, W, H);

  const projection = geoTransform({
    point(lon, lat) {
      const [x, y] = projectLonLat(lon, lat);
      this.stream.point(x, y);
    },
  });
  const pathGen = geoPath(projection, ctx);
  const countries = feature(topo, topo.objects.countries as GeometryCollection);
  const visibleCountries = (countries.features as CountryFeature[]).filter((country) => (
    COUNTRY_IDS.has(String(country.id))
  ));
  const taiwan = visibleCountries.find((country) => String(country.id) === '158');

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();

  ctx.strokeStyle = 'rgba(15,32,56,0.2)';
  ctx.lineWidth = 1;
  for (let lat = 3; lat <= 33; lat += 3) {
    const coords: [number, number][] = [];
    for (let lon = 117; lon <= 132; lon += 0.5) coords.push([lon, lat]);
    ctx.beginPath();
    pathGen({ type: 'LineString', coordinates: coords } as LineString);
    ctx.stroke();
  }
  for (let lon = 117; lon <= 132; lon += 3) {
    const coords: [number, number][] = [];
    for (let lat = 3; lat <= 33; lat += 0.5) coords.push([lon, lat]);
    ctx.beginPath();
    pathGen({ type: 'LineString', coordinates: coords } as LineString);
    ctx.stroke();
  }

  // ── 4. Other countries: alternating deep teal colours ────────────────────
  const nonTaiwan = visibleCountries.filter((country) => String(country.id) !== '158');
  nonTaiwan.forEach((country) => {
    ctx.fillStyle = '#1a3a50';
    ctx.beginPath();
    pathGen(country);
    ctx.fill();
  });
  ctx.strokeStyle = '#2a5a70';
  ctx.lineWidth = 0.5;
  nonTaiwan.forEach((country) => {
    ctx.beginPath();
    pathGen(country);
    ctx.stroke();
  });

  // ── 5. Taiwan: N→S gradient fill + subtle drop shadow + thin stroke ──────
  if (taiwan) {
    ctx.save();
    ctx.shadowBlur = 36;
    ctx.shadowColor = 'rgba(200,220,240,0.6)';
    ctx.fillStyle = '#c8d8ec';
    ctx.beginPath();
    pathGen(taiwan);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#e0e8f4';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pathGen(taiwan);
    ctx.stroke();

    const glowPathGen = geoPath(projection, glowCtx);
    glowCtx.save();
    glowCtx.shadowColor = 'rgba(200,220,240,0.6)';
    glowCtx.shadowBlur = 38;
    glowCtx.fillStyle = '#c8d8ec';
    glowCtx.beginPath();
    glowPathGen(taiwan);
    glowCtx.fill();
    glowCtx.shadowBlur = 0;
    glowCtx.strokeStyle = '#e0e8f4';
    glowCtx.lineWidth = 4.4;
    glowCtx.beginPath();
    glowPathGen(taiwan);
    glowCtx.stroke();
    glowCtx.restore();

    TAIWAN_ISLAND_MARKERS.forEach((island) => {
      const [ix, iy] = projectLonLat(island.lon, island.lat);
      const rx = island.radius;
      const ry = island.radius * 0.8;

      ctx.save();
      ctx.shadowBlur = 24;
      ctx.shadowColor = 'rgba(200,220,240,0.45)';
      ctx.fillStyle = '#c8d8ec';
      ctx.strokeStyle = '#e0e8f4';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(ix, iy, rx, ry, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      glowCtx.save();
      glowCtx.shadowColor = 'rgba(200,220,240,0.55)';
      glowCtx.shadowBlur = 30;
      glowCtx.fillStyle = '#c8d8ec';
      glowCtx.beginPath();
      glowCtx.ellipse(ix, iy, rx, ry, 0.3, 0, Math.PI * 2);
      glowCtx.fill();
      glowCtx.restore();
    });
  }

  // ── 6. Vignette ───────────────────────────────────────────────────────────
  const vignette = ctx.createRadialGradient(
    W / 2, H / 2, Math.min(W, H) * 0.3,
    W / 2, H / 2, Math.max(W, H) * 0.72,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const taiwanGlowTexture = new THREE.CanvasTexture(glowCanvas);
  taiwanGlowTexture.colorSpace = THREE.SRGBColorSpace;
  taiwanGlowTexture.needsUpdate = true;

  const planeW = 18;
  const planeH = (H / W) * planeW;
  const latLonToXY = (lat: number, lon: number) => {
    const projected = projectLonLat(lon, lat);
    return {
      x: (projected[0] / W - 0.5) * planeW,
      y: -(projected[1] / H - 0.5) * planeH,
    };
  };

  return { texture, taiwanGlowTexture, planeW, planeH, latLonToXY };
}

function makeSprite(texture: THREE.Texture, color: string, opacity: number) {
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
}

function makeConnectionGeometry(a: THREE.Vector3, b: THREE.Vector3, arcHeight: number) {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i += 1) {
    const t = i / 40;
    const point = new THREE.Vector3().lerpVectors(a, b, t);
    point.z = 0.14 + Math.sin(t * Math.PI) * arcHeight;
    points.push(point);
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

export function ThreeMapScene({ options }: ThreeMapSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<Record<TaiwanRegionName, HTMLDivElement | null>>({
    北: null,
    中: null,
    南: null,
    東: null,
  });
  const mapDataRef = useRef<MapData | null>(null);
  const taiwanVisualsRef = useRef<Record<TaiwanRegionName, PointVisual> | null>(null);
  const overseasVisualsRef = useRef<Record<OverseasPointId, PointVisual> | null>(null);
  const taiwanConnectionsRef = useRef<TaiwanConnectionVisual[]>([]);
  const overseasConnectionsRef = useRef<OverseasConnectionVisual[]>([]);
  const prevCountsRef = useRef<Record<string, number>>({});
  const triggerRef = useRef<(name: TriggerName) => void>(() => undefined);
  const allLitRef = useRef(false);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [loadingMap, setLoadingMap] = useState(true);
  const [allLitMode, setAllLitMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    buildMapTexture()
      .then((data) => {
        if (cancelled) return;
        mapDataRef.current = data;
        setMapReady(true);
      })
      .catch((err) => console.error('[ThreeMapScene] map load failed', err))
      .finally(() => {
        if (!cancelled) setLoadingMap(false);
      });

    return () => {
      cancelled = true;
      mapDataRef.current?.texture.dispose();
      mapDataRef.current?.taiwanGlowTexture.dispose();
    };
  }, []);

  useEffect(() => {
    allLitRef.current = allLitMode;
  }, [allLitMode]);

  useEffect(() => {
    if (!mapReady || !containerRef.current || !mapDataRef.current) return undefined;

    const mount = containerRef.current;
    const { texture, taiwanGlowTexture, planeW, planeH, latLonToXY } = mapDataRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'absolute inset-0 h-full w-full';
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a1628');

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    const updateCameraFrustum = () => {
      const viewportAspect = mount.clientWidth / mount.clientHeight;
      const planeAspect = planeW / planeH;
      let frustumWidth = planeW;
      let frustumHeight = planeH;

      if (viewportAspect > planeAspect) {
        // Viewport wider than plane, extend width to avoid letterboxing.
        frustumWidth = planeH * viewportAspect;
      } else {
        // Viewport taller than plane, extend height.
        frustumHeight = planeW / viewportAspect;
      }

      camera.left = -frustumWidth / 2;
      camera.right = frustumWidth / 2;
      camera.top = frustumHeight / 2;
      camera.bottom = -frustumHeight / 2;
      camera.updateProjectionMatrix();
    };
    updateCameraFrustum();

    const mapGroup = new THREE.Group();
    mapGroup.rotation.x = 0;
    mapGroup.scale.setScalar(1.3);
    scene.add(mapGroup);

    const starTexture = createStarTexture();
    const starGroup = new THREE.Group();
    starGroup.position.z = 0.01;
    mapGroup.add(starGroup);
    const starFlickers: StarFlicker[] = [];
    const starRand = createLcg(42);
    for (let i = 0; i < STAR_COUNT; i += 1) {
      const sprite = makeSprite(starTexture, '#ffffff', 0);
      const scale = 0.035 + starRand() * 0.08;
      sprite.scale.setScalar(scale);
      sprite.position.set(
        (starRand() - 0.5) * planeW * 1.08,
        (starRand() - 0.5) * planeH * 1.08,
        0,
      );
      starGroup.add(sprite);
      starFlickers.push({
        sprite,
        baseOpacity: 0.08 + starRand() * 0.08,
        amplitude: 0.02 + starRand() * 0.06,
        speed: 0.18 + starRand() * 0.34,
        phase: starRand() * Math.PI * 2,
      });
    }

    const planeGeo = new THREE.PlaneGeometry(planeW, planeH);
    const planeMat = new THREE.MeshBasicMaterial({ map: texture });
    mapGroup.add(new THREE.Mesh(planeGeo, planeMat));
    const taiwanGlowMat = new THREE.MeshBasicMaterial({
      map: taiwanGlowTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const taiwanGlowMesh = new THREE.Mesh(planeGeo, taiwanGlowMat);
    taiwanGlowMesh.position.z = 0.03;
    mapGroup.add(taiwanGlowMesh);

    const glowTexture = createGlowTexture();
    const ringTexture = createRingTexture();
    const taiwanVisuals = {} as Record<TaiwanRegionName, PointVisual>;
    const overseasVisuals = {} as Record<OverseasPointId, PointVisual>;
    const taiwanPositions = {} as Record<TaiwanRegionName, THREE.Vector3>;
    const overseasPositions = {} as Record<OverseasPointId, THREE.Vector3>;
    const taiwanHubXY = latLonToXY(23.85, 121.0);
    const taiwanHub = new THREE.Vector3(taiwanHubXY.x, taiwanHubXY.y, 0.3);
    const overseasGroup = new THREE.Group();
    overseasGroup.position.copy(taiwanHub);
    mapGroup.add(overseasGroup);
    const overseasRipples: THREE.Sprite[] = [];
    let taiwanGlowActive = false;

    TAIWAN_REGIONS.forEach((region) => {
      const xy = latLonToXY(region.lat, region.lon);
      const group = new THREE.Group();
      group.position.set(xy.x, xy.y, 0.36);

      const pulse = makeSprite(ringTexture, TAIWAN_WHITE, 0);
      pulse.scale.setScalar(0.56);
      group.add(pulse);

      const core = makeSprite(glowTexture, TAIWAN_WHITE, 0);
      core.scale.setScalar(0.48);
      group.add(core);

      mapGroup.add(group);
      taiwanVisuals[region.name] = {
        group,
        core,
        pulse,
        ripples: [],
        active: false,
        activationAt: 0,
        lastTriggeredAt: -10,
        baseScale: 0.48,
        pulseSpeed: 0.78,
      };
      taiwanPositions[region.name] = new THREE.Vector3(xy.x, xy.y, 0.31);
    });

    taiwanVisualsRef.current = taiwanVisuals;

    OVERSEAS_POINTS.forEach((point) => {
      const xy = latLonToXY(point.lat, point.lon);
      const group = new THREE.Group();
      group.position.set(xy.x, xy.y, 0.34);

      const pulse = makeSprite(ringTexture, GOLD, 0);
      pulse.scale.setScalar(0.38);
      group.add(pulse);

      const core = makeSprite(glowTexture, GOLD, 0);
      core.scale.setScalar(0.3);
      group.add(core);

      mapGroup.add(group);
      overseasVisuals[point.id] = {
        group,
        core,
        pulse,
        ripples: [],
        active: false,
        activationAt: 0,
        lastTriggeredAt: -10,
        baseScale: 0.3,
        pulseSpeed: 0.5,
      };
      overseasPositions[point.id] = new THREE.Vector3(xy.x, xy.y, 0.28);
    });
    overseasVisualsRef.current = overseasVisuals;

    taiwanConnectionsRef.current = TAIWAN_CONNECTIONS.map(([a, b]) => {
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(TAIWAN_WHITE),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(makeConnectionGeometry(taiwanPositions[a], taiwanPositions[b], 0.26), material);
      mapGroup.add(line);
      return { a, b, material };
    });

    overseasConnectionsRef.current = OVERSEAS_POINTS.map((point) => {
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(GOLD),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(makeConnectionGeometry(taiwanHub, overseasPositions[point.id], 0.62), material);
      mapGroup.add(line);
      return { pointId: point.id, material };
    });

    const clock = new THREE.Clock();
    const triggerVisual = (visual: PointVisual, color: string, activationAt: number) => {
      visual.active = true;
      visual.activationAt = activationAt;
      visual.lastTriggeredAt = activationAt;

      const ripple = makeSprite(ringTexture, color, 0.85);
      ripple.scale.setScalar(visual.baseScale * 0.85);
      ripple.userData = { born: activationAt };
      visual.group.add(ripple);
      visual.ripples.push(ripple);
    };

    const triggerRegion = (name: TriggerName) => {
      const now = clock.getElapsedTime();
      if (name === '海') {
        OVERSEAS_POINTS.forEach((point, index) => {
          triggerVisual(overseasVisuals[point.id], GOLD, now + index * 0.24);
        });
        for (let i = 0; i < 4; i += 1) {
          const ripple = makeSprite(ringTexture, GOLD, 0.82);
          ripple.scale.setScalar(1.05);
          ripple.userData = { born: now + i * 0.22 };
          overseasGroup.add(ripple);
          overseasRipples.push(ripple);
        }
        return;
      }

      taiwanGlowActive = true;
      triggerVisual(taiwanVisuals[name], TAIWAN_WHITE, now);
    };
    triggerRef.current = triggerRegion;

    let frameId = 0;
    const worldPosition = new THREE.Vector3();
    const projected = new THREE.Vector3();

    const animatePoint = (visual: PointVisual, color: string, elapsed: number, forceLit = false) => {
      const activeNow = forceLit || (visual.active && elapsed >= visual.activationAt);
      const targetOpacity = activeNow ? 1 : 0;
      const coreMaterial = visual.core.material as THREE.SpriteMaterial;
      coreMaterial.opacity += (targetOpacity - coreMaterial.opacity) * 0.08;
      visual.core.scale.setScalar(
        (activeNow ? visual.baseScale * 1.08 : visual.baseScale * 0.88)
        + Math.sin(elapsed * 2.4) * (activeNow ? visual.baseScale * 0.05 : 0),
      );

      const pulseMaterial = visual.pulse.material as THREE.SpriteMaterial;
      if (activeNow) {
        const pulseT = (elapsed * visual.pulseSpeed + visual.group.position.x * 0.07) % 1;
        visual.pulse.scale.setScalar(visual.baseScale * 1.15 + pulseT * visual.baseScale * 3.2);
        pulseMaterial.opacity = (1 - pulseT) * 0.44;
      } else {
        pulseMaterial.opacity = 0;
      }

      for (let i = visual.ripples.length - 1; i >= 0; i -= 1) {
        const ripple = visual.ripples[i];
        const born = ripple.userData.born as number;
        const age = elapsed - born;
        if (age < 0) {
          (ripple.material as THREE.SpriteMaterial).opacity = 0;
          continue;
        }
        if (age > 1.25) {
          visual.group.remove(ripple);
          (ripple.material as THREE.SpriteMaterial).dispose();
          visual.ripples.splice(i, 1);
        } else {
          ripple.scale.setScalar(visual.baseScale * 0.9 + age * visual.baseScale * 6.5);
          (ripple.material as THREE.SpriteMaterial).opacity = (1 - age / 1.25) * 0.7;
          (ripple.material as THREE.SpriteMaterial).color.set(color);
        }
      }
    };

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      const width = mount.clientWidth;
      const height = mount.clientHeight;

      starFlickers.forEach((star) => {
        const material = star.sprite.material as THREE.SpriteMaterial;
        const flicker = star.baseOpacity
          + Math.sin(elapsed * star.speed + star.phase) * star.amplitude;
        material.opacity = THREE.MathUtils.clamp(flicker, 0, 1);
      });

      TAIWAN_REGIONS.forEach((region) => {
        const visual = taiwanVisuals[region.name];
        const lit = allLitRef.current || (visual.active && elapsed >= visual.activationAt);
        animatePoint(visual, TAIWAN_WHITE, elapsed, allLitRef.current);

        const label = labelRefs.current[region.name];
        if (label) {
          visual.group.getWorldPosition(worldPosition);
          projected.copy(worldPosition).project(camera);
          const x = (projected.x * 0.5 + 0.5) * width;
          const y = (-projected.y * 0.5 + 0.5) * height;
          label.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          label.style.opacity = `${lit ? 1 : 0.38}`;
        }
      });

      OVERSEAS_POINTS.forEach((point) => {
        animatePoint(overseasVisuals[point.id], GOLD, elapsed, allLitRef.current);
      });

      const idleGlow = IDLE_GLOW_BASE
        + Math.sin((elapsed / IDLE_GLOW_PERIOD) * Math.PI * 2) * IDLE_GLOW_AMPLITUDE;
      const glowTarget = allLitRef.current || taiwanGlowActive ? 1 : idleGlow;
      taiwanGlowMat.opacity += (glowTarget - taiwanGlowMat.opacity) * 0.05;

      taiwanConnectionsRef.current.forEach((connection) => {
        const visible = allLitRef.current
          || (taiwanVisuals[connection.a].active && taiwanVisuals[connection.b].active);
        const target = visible ? 0.15 : 0;
        connection.material.opacity += (target - connection.material.opacity) * 0.08;
      });

      overseasConnectionsRef.current.forEach((connection) => {
        const pointVisual = overseasVisuals[connection.pointId];
        const visible = allLitRef.current || (pointVisual.active && elapsed >= pointVisual.activationAt);
        const target = visible ? 0.18 : 0;
        connection.material.opacity += (target - connection.material.opacity) * 0.08;
      });

      for (let i = overseasRipples.length - 1; i >= 0; i -= 1) {
        const ripple = overseasRipples[i];
        const born = ripple.userData.born as number;
        const age = elapsed - born;
        if (age < 0) {
          (ripple.material as THREE.SpriteMaterial).opacity = 0;
          continue;
        }
        if (age > 2.2) {
          overseasGroup.remove(ripple);
          (ripple.material as THREE.SpriteMaterial).dispose();
          overseasRipples.splice(i, 1);
        } else {
          ripple.scale.setScalar(1.1 + age * 3.8);
          (ripple.material as THREE.SpriteMaterial).opacity = (1 - age / 2.2) * 0.52;
          (ripple.material as THREE.SpriteMaterial).color.set(GOLD);
        }
      }

      if (allLitRef.current && overseasRipples.length === 0) {
        const ripple = makeSprite(ringTexture, GOLD, 0.45);
        ripple.scale.setScalar(1.05);
        ripple.userData = { born: elapsed };
        overseasGroup.add(ripple);
        overseasRipples.push(ripple);
      }

      renderer.render(scene, camera);
    };

    animate();

    const onResize = () => {
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      updateCameraFrustum();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', onResize);
      mount.removeChild(renderer.domElement);
      starFlickers.forEach((star) => (star.sprite.material as THREE.SpriteMaterial).dispose());
      [...Object.values(taiwanVisuals), ...Object.values(overseasVisuals)].forEach((visual) => {
        visual.ripples.forEach((ripple) => (ripple.material as THREE.SpriteMaterial).dispose());
        (visual.core.material as THREE.SpriteMaterial).dispose();
        (visual.pulse.material as THREE.SpriteMaterial).dispose();
      });
      overseasRipples.forEach((ripple) => (ripple.material as THREE.SpriteMaterial).dispose());
      taiwanConnectionsRef.current.forEach((connection) => connection.material.dispose());
      overseasConnectionsRef.current.forEach((connection) => connection.material.dispose());
      planeGeo.dispose();
      planeMat.dispose();
      taiwanGlowMat.dispose();
      starTexture.dispose();
      glowTexture.dispose();
      ringTexture.dispose();
      renderer.dispose();
      rendererRef.current = null;
      taiwanVisualsRef.current = null;
      overseasVisualsRef.current = null;
      taiwanConnectionsRef.current = [];
      overseasConnectionsRef.current = [];
    };
  }, [mapReady]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'a') return;
      setAllLitMode((current) => !current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    options.forEach((option) => {
      const previous = prevCountsRef.current[option.id] ?? 0;
      prevCountsRef.current[option.id] = option.count;
      if (option.count <= previous) return;

      const region = normalizeRegionName(option.label);
      if (region) triggerRef.current(region);
    });
  }, [options]);

  return (
    <div ref={containerRef} className="relative h-full min-h-[520px] w-full overflow-hidden bg-[#0a1628]">
      {loadingMap && (
        <div className="absolute inset-0 z-30 flex items-center justify-center text-sm text-white/45">
          3D 地圖載入中...
        </div>
      )}
    </div>
  );
}
