import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { geoPath, geoTransform } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, LineString, MultiPolygon, Polygon } from 'geojson';
import type { QuestionOption } from '../types';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';
const HUD_BG = '#02060d';
const HUD_PRIMARY = '#7ddfff';
const HUD_GRID_COLOR = 'rgba(52,134,181,0.18)';
const SIGNAL_COLOR = '#f4b766';
const STAR_COUNT = 70;
const IDLE_GLOW_BASE = 0.08;
const IDLE_GLOW_AMPLITUDE = 0.05;
const IDLE_GLOW_PERIOD = 16; // seconds

const TAIWAN_REGIONS = [
  { name: '北', label: '北', lat: 25.05, lon: 121.50 },
  { name: '中', label: '中', lat: 24.15, lon: 120.55 },
  { name: '南', label: '南', lat: 22.65, lon: 120.25 },
  { name: '東', label: '東', lat: 23.80, lon: 121.50 },
] as const;

const OVERSEAS_POINTS = [
  { id: 'taiwanStrait', lat: 25.8, lon: 119.0 },
  { id: 'fujianCoast', lat: 24.6, lon: 118.5 },
  { id: 'okinawa', lat: 26.2, lon: 127.7 },
  { id: 'guam', lat: 13.4, lon: 144.8 },
  { id: 'luzon', lat: 15.5, lon: 121.0 },
  { id: 'visayas', lat: 11.0, lon: 123.0 },
  { id: 'borneo', lat: 4.5, lon: 118.0 },
  { id: 'malaysia', lat: 3.1, lon: 101.7 },
  { id: 'vietnam', lat: 16.0, lon: 108.2 },
  { id: 'hongkong', lat: 22.3, lon: 114.2 },
] as const;

const SIGNAL_POINTS = [
  { lat: 31.2, lon: 121.5 }, // Shanghai
  { lat: 28.0, lon: 120.7 },
  { lat: 24.9, lon: 118.6 },
  { lat: 25.7, lon: 122.3 }, // Ryukyu
  { lat: 34.0, lon: 129.4 }, // Kyushu
  { lat: 35.4, lon: 139.45 }, // Tokyo
  { lat: 23.7, lon: 120.9 }, // Taiwan interior
  { lat: 21.0, lon: 105.8 }, // Hanoi
  { lat: 19.4, lon: 109.5 },
  { lat: 14.6, lon: 120.9 },
  { lat: 10.3, lon: 123.9 },
  { lat: 6.2, lon: 125.5 },
  { lat: 3.1, lon: 101.7 },
  { lat: 1.4, lon: 103.9 }, // Singapore
] as const;

const HUD_DECOR_LABELS = [
  { text: 'VICTOR-2026', top: '8%', left: '6%' },
  { text: 'EKKLESIA', bottom: '10%', right: '8%' },
];

const TAIWAN_REGION_NAMES = new Set(TAIWAN_REGIONS.map((region) => region.name));
const COUNTRY_IDS = new Set(['96', '156', '158', '360', '392', '458', '608']);
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

interface HudStar {
  sprite: THREE.Sprite;
  baseOpacity: number;
  amplitude: number;
  speed: number;
  phase: number;
}

interface HudSignal {
  sprite: THREE.Sprite;
  pulseSpeed: number;
  baseScale: number;
  phase: number;
}

interface ThreeMapSceneHUDProps {
  options: QuestionOption[];
  sessionId?: string;
}

interface MapData {
  texture: THREE.CanvasTexture;
  glowTexture: THREE.CanvasTexture;
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

const createLcg = (initial = 42) => {
  let seed = initial;
  return () => {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
};

function normalizeRegionName(raw: string): TriggerName | null {
  const trimmed = raw.trim();
  if (trimmed === '海外' || trimmed === '海') return '海';
  if (TAIWAN_REGION_NAMES.has(trimmed as TaiwanRegionName)) return trimmed as TaiwanRegionName;
  const first = trimmed[0];
  return TAIWAN_REGION_NAMES.has(first as TaiwanRegionName) ? first as TaiwanRegionName : null;
}

function buildWsUrl(sessionId: string) {
  if (!sessionId) return '';
  const { protocol, host } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}/api/ws/sessions/${sessionId}/map3d`;
}

function createGlowTexture(colorStops: [number, string][]) {
  const size = 200;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot create glow texture');

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  colorStops.forEach(([stop, color]) => gradient.addColorStop(stop, color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createRingTexture(color = 'rgba(125,223,255,0.9)') {
  const size = 160;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot create ring texture');

  ctx.strokeStyle = color;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.32, 0, Math.PI * 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createGridTexture() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot create grid texture');

  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = HUD_GRID_COLOR;
  ctx.lineWidth = 1;

  const spacing = 48;
  for (let x = 0; x <= size; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = 0; y <= size; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(12, 12);
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
  gradient.addColorStop(0.45, 'rgba(125,223,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function makeSprite(
  texture: THREE.Texture,
  color: string,
  opacity: number,
  blending: THREE.Blending = THREE.AdditiveBlending,
) {
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    blending,
    depthWrite: false,
  }));
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
  if (!ctx || !glowCtx) throw new Error('Cannot acquire canvas context');

  ctx.fillStyle = HUD_BG;
  ctx.fillRect(0, 0, W, H);

  const lonMin = 118;
  const lonMax = 123.5;
  const latMin = 17;
  const latMax = 27;
  const midLatRad = ((latMin + latMax) / 2) * (Math.PI / 180);
  const lonScale = Math.cos(midLatRad);
  const lonSpan = (lonMax - lonMin) * lonScale;
  const latSpan = latMax - latMin;
  const uniformScale = Math.min(W / lonSpan, H / latSpan);
  const offsetX = (W - lonSpan * uniformScale) * 0.35;
  const offsetY = (H - latSpan * uniformScale) * 0.75;
  const projectLonLat = (lon: number, lat: number) => [
    offsetX + (lon - lonMin) * lonScale * uniformScale,
    offsetY + (latMax - lat) * uniformScale,
  ] as [number, number];

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

  ctx.strokeStyle = 'rgba(16,60,88,0.35)';
  ctx.lineWidth = 1;
  for (let lat = 3; lat <= 33; lat += 3) {
    const coords: [number, number][] = [];
    for (let lon = 117; lon <= 132; lon += 0.7) coords.push([lon, lat]);
    ctx.beginPath();
    pathGen({ type: 'LineString', coordinates: coords } as LineString);
    ctx.stroke();
  }
  for (let lon = 117; lon <= 132; lon += 3) {
    const coords: [number, number][] = [];
    for (let lat = 3; lat <= 33; lat += 0.7) coords.push([lon, lat]);
    ctx.beginPath();
    pathGen({ type: 'LineString', coordinates: coords } as LineString);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(64,112,150,0.4)';
  ctx.setLineDash([6, 6]);
  visibleCountries
    .filter((country) => String(country.id) !== '158')
    .forEach((country) => {
      ctx.beginPath();
      pathGen(country);
      ctx.stroke();
    });
  ctx.setLineDash([]);

  if (taiwan) {
    ctx.strokeStyle = HUD_PRIMARY;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = 'rgba(125,223,255,0.35)';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    pathGen(taiwan);
    ctx.stroke();
    ctx.shadowBlur = 0;

    glowCtx.save();
    glowCtx.shadowColor = 'rgba(125,223,255,0.8)';
    glowCtx.shadowBlur = 42;
    glowCtx.strokeStyle = HUD_PRIMARY;
    glowCtx.lineWidth = 3.5;
    glowCtx.beginPath();
    geoPath(projection, glowCtx)(taiwan);
    glowCtx.stroke();
    glowCtx.restore();
  }

  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  glowTexture.needsUpdate = true;

  const planeW = 18;
  const planeH = (H / W) * planeW;
  const latLonToXY = (lat: number, lon: number) => {
    const projected = projectLonLat(lon, lat);
    return {
      x: (projected[0] / W - 0.5) * planeW,
      y: -(projected[1] / H - 0.5) * planeH,
    };
  };

  return { texture, glowTexture, planeW, planeH, latLonToXY };
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

export function ThreeMapSceneHUD({ options, sessionId = '' }: ThreeMapSceneHUDProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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
      .catch((err) => console.error('[ThreeMapSceneHUD] map load failed', err))
      .finally(() => {
        if (!cancelled) setLoadingMap(false);
      });

    return () => {
      cancelled = true;
      mapDataRef.current?.texture.dispose();
      mapDataRef.current?.glowTexture.dispose();
    };
  }, []);

  useEffect(() => {
    allLitRef.current = allLitMode;
  }, [allLitMode]);

  useEffect(() => {
    if (!mapReady || !containerRef.current || !mapDataRef.current) return undefined;

    const mount = containerRef.current;
    const { texture, glowTexture, planeW, planeH, latLonToXY } = mapDataRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'absolute inset-0 h-full w-full';
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(HUD_BG);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    const updateCameraFrustum = () => {
      const viewportAspect = mount.clientWidth / mount.clientHeight;
      const planeAspect = planeW / planeH;
      let frustumWidth = planeW;
      let frustumHeight = planeH;

      if (viewportAspect > planeAspect) {
        frustumWidth = planeH * viewportAspect;
      } else {
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
    scene.add(mapGroup);

    const starTexture = createStarTexture();
    const starGroup = new THREE.Group();
    starGroup.position.z = -0.2;
    mapGroup.add(starGroup);
    const hudStars: HudStar[] = [];
    const rand = createLcg(99);
    for (let i = 0; i < STAR_COUNT; i += 1) {
      const sprite = makeSprite(starTexture, '#9edfff', 0.2, THREE.NormalBlending);
      const scale = 0.05 + rand() * 0.12;
      sprite.scale.setScalar(scale);
      sprite.position.set((rand() - 0.5) * planeW * 1.2, (rand() - 0.5) * planeH * 1.2, 0);
      starGroup.add(sprite);
      hudStars.push({
        sprite,
        baseOpacity: 0.08 + rand() * 0.12,
        amplitude: 0.04 + rand() * 0.08,
        speed: 0.15 + rand() * 0.3,
        phase: rand() * Math.PI * 2,
      });
    }

    const gridTexture = createGridTexture();
    const gridMat = new THREE.MeshBasicMaterial({ map: gridTexture, transparent: true, opacity: 0.35 });
    const gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW * 1.2, planeH * 1.2), gridMat);
    gridMesh.position.z = -0.05;
    mapGroup.add(gridMesh);

    const planeGeo = new THREE.PlaneGeometry(planeW, planeH);
    const planeMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.9 });
    mapGroup.add(new THREE.Mesh(planeGeo, planeMat));

    const taiwanGlowMat = new THREE.MeshBasicMaterial({
      map: glowTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const taiwanGlowMesh = new THREE.Mesh(planeGeo, taiwanGlowMat);
    taiwanGlowMesh.position.z = 0.08;
    mapGroup.add(taiwanGlowMesh);

    const glowTextureBright = createGlowTexture([
      [0, 'rgba(255,255,255,0.95)'],
      [0.2, 'rgba(125,223,255,0.6)'],
      [1, 'rgba(125,223,255,0)'],
    ]);
    const ringTexture = createRingTexture('rgba(125,223,255,0.8)');
    const ringTextureGold = createRingTexture('rgba(244,183,102,0.8)');

    const taiwanVisuals = {} as Record<TaiwanRegionName, PointVisual>;
    const overseasVisuals = {} as Record<OverseasPointId, PointVisual>;
    const taiwanPositions = {} as Record<TaiwanRegionName, THREE.Vector3>;
    const overseasPositions = {} as Record<OverseasPointId, THREE.Vector3>;
    const signalSprites: HudSignal[] = [];

    const taiwanHubXY = latLonToXY(23.85, 121.0);
    const taiwanHub = new THREE.Vector3(taiwanHubXY.x, taiwanHubXY.y, 0.32);

    const signalTexture = createGlowTexture([
      [0, 'rgba(244,183,102,1)'],
      [0.3, 'rgba(244,183,102,0.7)'],
      [1, 'rgba(244,183,102,0)'],
    ]);

    TAIWAN_REGIONS.forEach((region) => {
      const xy = latLonToXY(region.lat, region.lon);
      const group = new THREE.Group();
      group.position.set(xy.x, xy.y, 0.4);

      const pulse = makeSprite(ringTexture, HUD_PRIMARY, 0);
      pulse.scale.setScalar(0.52);
      group.add(pulse);

      const core = makeSprite(glowTextureBright, '#ffffff', 0);
      core.scale.setScalar(0.45);
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
        baseScale: 0.45,
        pulseSpeed: 0.9,
      };
      taiwanPositions[region.name] = new THREE.Vector3(xy.x, xy.y, 0.33);
    });
    taiwanVisualsRef.current = taiwanVisuals;

    OVERSEAS_POINTS.forEach((point) => {
      const xy = latLonToXY(point.lat, point.lon);
      const group = new THREE.Group();
      group.position.set(xy.x, xy.y, 0.38);

      const pulse = makeSprite(ringTextureGold, SIGNAL_COLOR, 0);
      pulse.scale.setScalar(0.32);
      group.add(pulse);

      const core = makeSprite(glowTextureBright, SIGNAL_COLOR, 0);
      core.scale.setScalar(0.26);
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
        baseScale: 0.26,
        pulseSpeed: 0.58,
      };
      overseasPositions[point.id] = new THREE.Vector3(xy.x, xy.y, 0.31);
    });
    overseasVisualsRef.current = overseasVisuals;

    SIGNAL_POINTS.forEach((point, index) => {
      const xy = latLonToXY(point.lat, point.lon);
      const sprite = makeSprite(signalTexture, SIGNAL_COLOR, 0.55);
      sprite.position.set(xy.x, xy.y, 0.12);
      const baseScale = 0.12 + (index % 5) * 0.04;
      sprite.scale.setScalar(baseScale);
      mapGroup.add(sprite);
      signalSprites.push({
        sprite,
        pulseSpeed: 0.4 + (index % 7) * 0.08,
        baseScale,
        phase: index * 0.7,
      });
    });

    taiwanConnectionsRef.current = TAIWAN_CONNECTIONS.map(([a, b]) => {
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(HUD_PRIMARY),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(makeConnectionGeometry(taiwanPositions[a], taiwanPositions[b], 0.32), material);
      mapGroup.add(line);
      return { a, b, material };
    });

    overseasConnectionsRef.current = OVERSEAS_POINTS.map((point) => {
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(SIGNAL_COLOR),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(makeConnectionGeometry(taiwanHub, overseasPositions[point.id], 0.7), material);
      mapGroup.add(line);
      return { pointId: point.id, material };
    });

    const clock = new THREE.Clock();
    let taiwanGlowActive = false;

    const triggerVisual = (visual: PointVisual, color: string, activationAt: number) => {
      visual.active = true;
      visual.activationAt = activationAt;
      visual.lastTriggeredAt = activationAt;

      const ripple = makeSprite(ringTexture, color, 0.9);
      ripple.scale.setScalar(visual.baseScale * 0.8);
      ripple.userData = { born: activationAt };
      visual.group.add(ripple);
      visual.ripples.push(ripple);
    };

    const triggerRegion = (name: TriggerName) => {
      const now = clock.getElapsedTime();
      if (name === '海') {
        OVERSEAS_POINTS.forEach((point, index) => {
          triggerVisual(overseasVisuals[point.id], SIGNAL_COLOR, now + index * 0.2);
        });
        return;
      }

      taiwanGlowActive = true;
      triggerVisual(taiwanVisuals[name], '#ffffff', now);
    };
    triggerRef.current = triggerRegion;

    const animatePoint = (visual: PointVisual, elapsed: number, forceLit = false) => {
      const activeNow = forceLit || (visual.active && elapsed >= visual.activationAt);
      const targetOpacity = activeNow ? 1 : 0;
      const coreMaterial = visual.core.material as THREE.SpriteMaterial;
      coreMaterial.opacity += (targetOpacity - coreMaterial.opacity) * 0.1;
      visual.core.scale.setScalar(
        (activeNow ? visual.baseScale * 1.1 : visual.baseScale * 0.85)
        + Math.sin(elapsed * 2.2) * (activeNow ? visual.baseScale * 0.05 : 0),
      );

      const pulseMaterial = visual.pulse.material as THREE.SpriteMaterial;
      if (activeNow) {
        const pulseT = (elapsed * visual.pulseSpeed + visual.group.position.x * 0.05) % 1;
        visual.pulse.scale.setScalar(visual.baseScale * 1.2 + pulseT * visual.baseScale * 3);
        pulseMaterial.opacity = (1 - pulseT) * 0.5;
      } else {
        pulseMaterial.opacity = 0;
      }

      for (let i = visual.ripples.length - 1; i >= 0; i -= 1) {
        const ripple = visual.ripples[i];
        const born = ripple.userData.born as number;
        const age = elapsed - born;
        if (age > 1.4) {
          visual.group.remove(ripple);
          (ripple.material as THREE.SpriteMaterial).dispose();
          visual.ripples.splice(i, 1);
        } else if (age >= 0) {
          ripple.scale.setScalar(visual.baseScale * (1 + age * 4.2));
          (ripple.material as THREE.SpriteMaterial).opacity = (1 - age / 1.4) * 0.8;
        }
      }
    };

    let frameId = 0;

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      hudStars.forEach((star) => {
        const material = star.sprite.material as THREE.SpriteMaterial;
        const flicker = star.baseOpacity + Math.sin(elapsed * star.speed + star.phase) * star.amplitude;
        material.opacity = THREE.MathUtils.clamp(flicker, 0, 1);
      });

      signalSprites.forEach((signal) => {
        const material = signal.sprite.material as THREE.SpriteMaterial;
        const t = Math.sin(elapsed * signal.pulseSpeed + signal.phase) * 0.5 + 0.5;
        signal.sprite.scale.setScalar(signal.baseScale * (0.9 + t * 0.7));
        material.opacity = 0.35 + t * 0.45;
      });

      TAIWAN_REGIONS.forEach((region) => {
        const visual = taiwanVisuals[region.name];
        animatePoint(visual, elapsed, allLitRef.current);
      });

      OVERSEAS_POINTS.forEach((point) => {
        animatePoint(overseasVisuals[point.id], elapsed, allLitRef.current);
      });

      const idleGlow = IDLE_GLOW_BASE
        + Math.sin((elapsed / IDLE_GLOW_PERIOD) * Math.PI * 2) * IDLE_GLOW_AMPLITUDE;
      const glowTarget = allLitRef.current || taiwanGlowActive ? 1 : idleGlow;
      taiwanGlowMat.opacity += (glowTarget - taiwanGlowMat.opacity) * 0.06;

      taiwanConnectionsRef.current.forEach((connection) => {
        const visible = allLitRef.current
          || (taiwanVisuals[connection.a].active && taiwanVisuals[connection.b].active);
        const target = visible ? 0.2 : 0;
        connection.material.opacity += (target - connection.material.opacity) * 0.08;
      });

      overseasConnectionsRef.current.forEach((connection) => {
        const pointVisual = overseasVisuals[connection.pointId];
        const visible = allLitRef.current || (pointVisual.active && elapsed >= pointVisual.activationAt);
        const target = visible ? 0.25 : 0;
        connection.material.opacity += (target - connection.material.opacity) * 0.08;
      });

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
      hudStars.forEach((star) => (star.sprite.material as THREE.SpriteMaterial).dispose());
      signalSprites.forEach((signal) => (signal.sprite.material as THREE.SpriteMaterial).dispose());
      [...Object.values(taiwanVisuals), ...Object.values(overseasVisuals)].forEach((visual) => {
        visual.ripples.forEach((ripple) => (ripple.material as THREE.SpriteMaterial).dispose());
        (visual.core.material as THREE.SpriteMaterial).dispose();
        (visual.pulse.material as THREE.SpriteMaterial).dispose();
      });
      taiwanConnectionsRef.current.forEach((connection) => connection.material.dispose());
      overseasConnectionsRef.current.forEach((connection) => connection.material.dispose());
      planeGeo.dispose();
      planeMat.dispose();
      gridMaterialDispose(gridMat);
      taiwanGlowMat.dispose();
      starTexture.dispose();
      gridTexture.dispose();
      glowTexture.dispose();
      glowTextureBright.dispose();
      ringTexture.dispose();
      ringTextureGold.dispose();
      signalTexture.dispose();
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
    if (!sessionId) return undefined;
    let cancelled = false;
    let reconnectId = 0;

    const connect = () => {
      if (cancelled) return;
      const url = buildWsUrl(sessionId);
      const ws = new WebSocket(url);

      ws.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type !== 'region' || typeof payload.name !== 'string') return;
          const region = normalizeRegionName(payload.name);
          if (region) triggerRef.current(region);
        } catch (err) {
          console.warn('[ThreeMapSceneHUD] invalid websocket message', err);
        }
      });

      ws.addEventListener('close', () => {
        if (!cancelled) reconnectId = window.setTimeout(connect, 3000);
      });
      ws.addEventListener('error', () => ws.close());
    };

    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(reconnectId);
    };
  }, [sessionId]);

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
    <div ref={containerRef} className="relative h-full min-h-[520px] w-full overflow-hidden bg-black">
      <HudDecorOverlay labels={HUD_DECOR_LABELS} />
      {loadingMap && (
        <div className="absolute inset-0 z-30 flex items-center justify-center text-sm text-white/45">
          HUD 地圖載入中...
        </div>
      )}
    </div>
  );
}

function HudDecorOverlay({ labels }: { labels: { text: string; top?: string; left?: string; right?: string; bottom?: string; }[] }) {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="absolute left-6 top-6 h-10 w-10 border-l-2 border-t-2 border-cyan-500/40" />
        <div className="absolute right-6 top-6 h-10 w-10 border-r-2 border-t-2 border-cyan-500/40" />
        <div className="absolute left-6 bottom-6 h-10 w-10 border-l-2 border-b-2 border-cyan-500/40" />
        <div className="absolute right-6 bottom-6 h-10 w-10 border-r-2 border-b-2 border-cyan-500/40" />
        <div className="absolute left-1/2 top-1/2 h-16 w-px -translate-x-1/2 -translate-y-1/2 bg-cyan-500/20" />
        <div className="absolute left-1/2 top-1/2 w-16 h-px -translate-x-1/2 -translate-y-1/2 bg-cyan-500/20" />
        {labels.map((label) => (
          <div
            key={label.text}
            style={label}
            className="absolute rounded border border-cyan-400/40 px-3 py-1 text-[10px] uppercase tracking-[0.4em] text-cyan-200/70"
          >
            {label.text}
          </div>
        ))}
      </div>
    </>
  );
}

function gridMaterialDispose(mat: THREE.Material | THREE.Material[]) {
  if (Array.isArray(mat)) {
    mat.forEach((m) => m.dispose());
  } else {
    mat.dispose();
  }
}
