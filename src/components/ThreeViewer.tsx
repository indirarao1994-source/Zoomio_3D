import React, {
  useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle
} from 'react';
import * as THREE from 'three';
import type { Scene as TourScene, Hotspot, TextLabel, SceneLighting } from '../types/tour';
import { getHotspotIcon, iconToSvg } from '../viewer/icons';

/* ── Types ──────────────────────────────────────────────────── */
export interface ViewerHandle {
  captureInitialView: () => { yaw: number; pitch: number };
  resetView: () => void;
}

interface ProjectedItem {
  id: string;
  x: number;
  y: number;
  behind: boolean;
}

export interface ThreeViewerProps {
  scene: TourScene;
  allScenes?: TourScene[];
  currentIndex?: number;
  activeTool?: string;
  activeHotspotId?: string | null;
  activeLabelId?: string | null;
  editMode?: boolean;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  followMode?: boolean;
  onViewerClick?: (yaw: number, pitch: number) => void;
  onHotspotClick?: (hotspot: Hotspot) => void;
  onLabelClick?: (label: TextLabel) => void;
  onNavigate?: (index: number) => void;
}

/* ── Spherical ↔ 3-D conversion ─────────────────────────────── */
function sphericalToVec3(yaw: number, pitch: number): THREE.Vector3 {
  const yr = THREE.MathUtils.degToRad(yaw);
  const pr = THREE.MathUtils.degToRad(pitch);
  return new THREE.Vector3(
    Math.cos(pr) * Math.sin(yr),
    Math.sin(pr),
    -Math.cos(pr) * Math.cos(yr)
  );
}

/* camera direction: where are we looking right now */
function getCameraDir(lonDeg: number, latDeg: number): THREE.Vector3 {
  const phi   = THREE.MathUtils.degToRad(90 - latDeg);
  const theta = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta)
  );
}

function projectToScreen(
  world: THREE.Vector3,
  camera: THREE.Camera,
  w: number,
  h: number
): { x: number; y: number; behind: boolean } {
  const v = world.clone().project(camera);
  return {
    x: ((v.x + 1) / 2) * w,
    y: ((1 - v.y) / 2) * h,
    behind: v.z > 1,
  };
}

/* ── Hotspot icon helpers ─────────────────────────────────────── */
const HOTSPOT_ICONS: Record<string, string> = {
  navigation: '🚪',
  info: 'ℹ️',
  image: '🖼️',
  video: '▶️',
  audio: '🔊',
  link: '🔗',
  pdf: '📄',
  phone: '📞',
};

const HOTSPOT_COLORS: Record<string, string> = {
  navigation: '#00d4ff',
  info: '#fbbf24',
  image: '#a78bfa',
  video: '#f472b6',
  audio: '#34d399',
  link: '#60a5fa',
  pdf: '#fb923c',
  phone: '#4ade80',
};

/* ── CSS filter from lighting ────────────────────────────────── */
function lightingToFilter(l?: SceneLighting): string {
  if (!l) return '';
  const parts: string[] = [];
  if (l.brightness !== 100) parts.push(`brightness(${l.brightness}%)`);
  if (l.contrast   !== 100) parts.push(`contrast(${l.contrast}%)`);
  if (l.saturation !== 100) parts.push(`saturate(${l.saturation}%)`);
  if (l.hue        !== 0)   parts.push(`hue-rotate(${l.hue}deg)`);
  if (l.exposure   !== 100) parts.push(`brightness(${l.exposure / 100})`);
  return parts.join(' ');
}

/* ════════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════════ */
export const ThreeViewer = forwardRef<ViewerHandle, ThreeViewerProps>((props, ref) => {
  const {
    scene,
    allScenes = [],
    currentIndex = 0,
    activeTool = 'select',
    activeHotspotId = null,
    activeLabelId = null,
    editMode = false,
    autoRotate = false,
    autoRotateSpeed = 1,
    followMode = false,
    onViewerClick,
    onHotspotClick,
    onLabelClick,
    onNavigate,
  } = props;

  const mountRef   = useRef<HTMLDivElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement | null>(null);
  const rendererR  = useRef<THREE.WebGLRenderer | null>(null);
  const cameraR    = useRef<THREE.PerspectiveCamera | null>(null);
  const scene3dR   = useRef<THREE.Scene | null>(null);
  const matR       = useRef<THREE.MeshBasicMaterial | null>(null);
  const texCache   = useRef<Record<string, THREE.Texture>>({});

  /* Rotation state */
  const lon   = useRef(scene.initialView?.yaw  ?? 0);
  const lat   = useRef(scene.initialView?.pitch ?? 0);
  const tlon  = useRef(scene.initialView?.yaw  ?? 0);
  const tlat  = useRef(scene.initialView?.pitch ?? 0);
  const drag  = useRef(false);
  const lx    = useRef(0);
  const ly    = useRef(0);
  /**
   * Total pointer travel since pointerdown. The browser still fires `click`
   * after a drag, so without this, dragging to look around while a hotspot
   * tool is selected drops an unwanted hotspot wherever the drag ended.
   */
  const dragDist = useRef(0);
  const rafId = useRef(0);

  /* Follow mode – last mouse position */
  const mousePos = useRef({ x: 0, y: 0 });

  /** Shown briefly when the user clicks the panorama with no tool selected. */
  const [toolPrompt, setToolPrompt] = useState(false);
  const promptTimer = useRef(0);

  /**
   * The render loop is created once (empty deps) so it never captures a fresh
   * `scene` prop. Without this ref it keeps projecting the hotspot list from
   * first mount, so newly placed hotspots and icon edits never appear on the
   * panorama even though they are saved correctly.
   */
  const sceneRef = useRef(scene);
  useEffect(() => { sceneRef.current = scene; }, [scene]);

  /* Projected hotspot/label positions */
  const [projectedHotspots, setProjectedHotspots] = useState<(ProjectedItem & { hotspot: Hotspot })[]>([]);
  const [projectedLabels,   setProjectedLabels  ] = useState<(ProjectedItem & { label: TextLabel })[]>([]);

  const [fading,      setFading     ] = useState(false);
  const [compassDeg,  setCompassDeg ] = useState(0);
  const [cursorStyle, setCursorStyle] = useState<string>('grab');

  /* ── Expose API ──────────────────────────────────────────── */
  useImperativeHandle(ref, () => ({
    captureInitialView: () => ({ yaw: lon.current, pitch: lat.current }),
    resetView: () => {
      tlon.current = scene.initialView?.yaw  ?? 0;
      tlat.current = scene.initialView?.pitch ?? 0;
    },
  }));

  /* ── Cursor changes per tool ─────────────────────────────── */
  useEffect(() => {
    const toolCursors: Record<string, string> = {
      select: 'grab',
      navigation: 'crosshair',
      info: 'crosshair',
      image: 'crosshair',
      video: 'crosshair',
      audio: 'crosshair',
      link: 'crosshair',
      label: 'text',
      lighting: 'default',
      transition: 'default',
      settings: 'default',
    };
    setCursorStyle(toolCursors[activeTool] || 'grab');
  }, [activeTool]);

  /* ── Initialize Three.js ─────────────────────────────────── */
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const w = el.clientWidth  || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.domElement.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;display:block;';
    el.appendChild(renderer.domElement);
    rendererR.current = renderer;
    canvasRef.current = renderer.domElement;

    const camera = new THREE.PerspectiveCamera(80, w / h, 0.1, 1000);
    camera.position.set(0, 0, 0);
    cameraR.current = camera;

    const scene3d = new THREE.Scene();
    scene3dR.current = scene3d;

    const geo = new THREE.SphereGeometry(500, 64, 32);
    geo.scale(-1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x111827 });
    matR.current = mat;
    scene3d.add(new THREE.Mesh(geo, mat));

    /* Render loop */
    let prev = performance.now();
    const animate = () => {
      rafId.current = requestAnimationFrame(animate);
      const now = performance.now();
      const dt  = (now - prev) / 1000;
      prev = now;

      /*
       * Keep the drawing buffer and camera aspect in step with the container.
       * The camera is built once from the mount-time size, so if the editor is
       * created before layout settles (hidden tab, collapsed panel, first
       * paint) the aspect becomes Infinity and the projection matrix goes
       * degenerate — every hotspot then projects to ±1e18 and disappears.
       * The window `resize` listener alone never catches that, because the
       * window never resized.
       */
      const cw0 = el.clientWidth, ch0 = el.clientHeight;
      if (cw0 > 0 && ch0 > 0) {
        const size = renderer.getSize(new THREE.Vector2());
        if (Math.abs(size.x - cw0) > 1 || Math.abs(size.y - ch0) > 1) {
          renderer.setSize(cw0, ch0, false);
          camera.aspect = cw0 / ch0;
          camera.updateProjectionMatrix();
        }
      }

      /* Auto-rotate */
      if (autoRotate) tlon.current += autoRotateSpeed * dt * 20;

      /* Follow mode – nudge toward mouse */
      if (followMode && !drag.current) {
        const W = el.clientWidth, H = el.clientHeight;
        const nx = (mousePos.current.x / W - 0.5) * 2;  // -1 to 1
        const ny = (mousePos.current.y / H - 0.5) * 2;
        tlon.current += nx * 0.3;
        tlat.current -= ny * 0.3;
      }

      /* Smooth damping */
      lon.current += (tlon.current - lon.current) * 0.08;
      lat.current += (tlat.current - lat.current) * 0.08;
      lat.current  = Math.max(-80, Math.min(80, lat.current));

      /* Camera lookAt */
      const phi   = THREE.MathUtils.degToRad(90 - lat.current);
      const theta = THREE.MathUtils.degToRad(lon.current);
      camera.lookAt(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta)
      );

      setCompassDeg(((lon.current % 360) + 360) % 360);

      renderer.render(scene3d, camera);

      /* Project hotspots + labels (every frame) */
      const cw = el.clientWidth, ch = el.clientHeight;
      const live = sceneRef.current;
      const pHotspots = (live.hotspots || []).map(hs => {
        const vec = sphericalToVec3(hs.yaw, hs.pitch);
        const p   = projectToScreen(vec, camera, cw, ch);
        return { id: hs.id, x: p.x, y: p.y, behind: p.behind, hotspot: hs };
      });
      const pLabels = (live.textLabels || []).map(lb => {
        const vec = sphericalToVec3(lb.yaw, lb.pitch);
        const p   = projectToScreen(vec, camera, cw, ch);
        return { id: lb.id, x: p.x, y: p.y, behind: p.behind, label: lb };
      });
      setProjectedHotspots(pHotspots);
      setProjectedLabels(pLabels);
    };
    animate();

    /* Resize handler */
    const onResize = () => {
      if (!el || !rendererR.current || !cameraR.current) return;
      const nw = el.clientWidth, nh = el.clientHeight;
      rendererR.current.setSize(nw, nh);
      cameraR.current.aspect = nw / nh;
      cameraR.current.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId.current);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, []); // eslint-disable-line

  /* ── Keep autoRotate/followMode live in RAF ──────────────── */
  const autoRotateRef = useRef(autoRotate);
  const followRef     = useRef(followMode);
  const speedRef      = useRef(autoRotateSpeed);
  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);
  useEffect(() => { followRef.current     = followMode;  }, [followMode]);
  useEffect(() => { speedRef.current      = autoRotateSpeed; }, [autoRotateSpeed]);

  /* ── Load texture on scene change ───────────────────────── */
  const loadTex = useCallback((url: string) => {
    const mat = matR.current;
    if (!mat) return;
    if (texCache.current[url]) {
      mat.map = texCache.current[url];
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
      return;
    }
    mat.map = null;
    mat.color.set(0x111827);
    mat.needsUpdate = true;
    new THREE.TextureLoader().load(url, (t) => {
      texCache.current[url] = t;
      mat.map = t;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    });
  }, []);

  useEffect(() => {
    setFading(true);
    const tid = setTimeout(() => {
      loadTex(scene.imageUrl);
      tlon.current = scene.initialView?.yaw  ?? 0;
      tlat.current = scene.initialView?.pitch ?? 0;
      setTimeout(() => setFading(false), 80);
    }, 320);
    return () => clearTimeout(tid);
  }, [scene.id, scene.imageUrl, loadTex, scene.initialView]);

  /* ── Pointer drag ────────────────────────────────────────── */
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (['lighting', 'transition', 'settings'].includes(activeTool)) return;
    drag.current = true;
    lx.current = e.clientX;
    ly.current = e.clientY;
    dragDist.current = 0;
    (e.target as Element).setPointerCapture(e.pointerId);
    setCursorStyle('grabbing');
    e.preventDefault();
  }, [activeTool]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - lx.current;
    const dy = e.clientY - ly.current;
    dragDist.current += Math.abs(dx) + Math.abs(dy);
    tlon.current -= dx * 0.2;
    tlat.current += dy * 0.2;
    lx.current = e.clientX;
    ly.current = e.clientY;
  }, []);

  const handlePointerUp = useCallback(() => {
    drag.current = false;
    const toolCursors: Record<string, string> = {
      select: 'grab', navigation: 'crosshair', info: 'crosshair',
      image: 'crosshair', video: 'crosshair', audio: 'crosshair',
      link: 'crosshair', label: 'text', lighting: 'default',
    };
    setCursorStyle(toolCursors[activeTool] || 'grab');
  }, [activeTool]);

  /* Mouse move for follow mode */
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    mousePos.current = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
  }, []);

  /* ── Wheel zoom ──────────────────────────────────────────── */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const cam = cameraR.current;
    if (!cam) return;
    cam.fov = Math.max(30, Math.min(110, cam.fov + e.deltaY * 0.04));
    cam.updateProjectionMatrix();
  }, []);

  /* ── Click in panorama ──────────────────────────────────── */
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!mountRef.current || !cameraR.current) return;
    // A drag ends with a click event too; only treat near-stationary presses
    // as placement clicks.
    if (dragDist.current > 6) return;

    // Clicking the panorama does nothing until a tool is chosen, which reads
    // as "the editor is broken". Say what to do instead of failing silently.
    if (editMode && activeTool === 'select') {
      setToolPrompt(true);
      window.clearTimeout(promptTimer.current);
      promptTimer.current = window.setTimeout(() => setToolPrompt(false), 3200);
      return;
    }

    const el = mountRef.current;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    /* NDC */
    const ndcX = (mx / el.clientWidth)  * 2 - 1;
    const ndcY = -(my / el.clientHeight) * 2 + 1;

    /* Unproject to get direction */
    const cam = cameraR.current;
    const vec = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(cam).sub(cam.position).normalize();

    /* Convert to yaw/pitch */
    const pitch = THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, vec.y))));
    const yaw   = THREE.MathUtils.radToDeg(Math.atan2(vec.x, -vec.z));

    onViewerClick?.(yaw, pitch);
  }, [onViewerClick, editMode, activeTool]);

  const hasNext = currentIndex < allScenes.length - 1;
  const hasPrev = currentIndex > 0;

  const filterStr = lightingToFilter(scene.lighting);

  return (
    <div
      ref={mountRef}
      className="relative w-full h-full select-none overflow-hidden touch-none"
      style={{ cursor: cursorStyle }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
    >
      {/* Lighting filter wrapper covers canvas */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ filter: filterStr, zIndex: 0 }}
      />

      {/* Fade transition */}
      <div
        className="absolute inset-0 bg-black pointer-events-none z-50 transition-opacity duration-300"
        style={{ opacity: fading ? 1 : 0 }}
      />

      {/* ── HOTSPOT OVERLAYS ── */}
      {projectedHotspots.map(({ id, x, y, behind, hotspot }) => {
        if (behind) return null;
        const color   = hotspot.color || HOTSPOT_COLORS[hotspot.type] || '#00d4ff';
        const iconDef = getHotspotIcon(hotspot.icon, hotspot.type);
        const isPin   = iconDef.anchor === 'bottom';
        const isActive = id === activeHotspotId;
        const sizePx  = hotspot.size === 'lg' ? 52 : hotspot.size === 'sm' ? 32 : 42;
        return (
          <div
            key={id}
            className="absolute pointer-events-auto flex flex-col items-center group"
            style={{
              left: x,
              top: y,
              // A pin's tip marks the spot, so anchor its base at the point
              // rather than centring the whole marker on it.
              transform: isPin ? 'translate(-50%, -100%)' : 'translate(-50%, -50%)',
              zIndex: 30,
            }}
            onClick={e => { e.stopPropagation(); onHotspotClick?.(hotspot); }}
          >
            {/* Pulse ring — sits at the tip for pins, at the centre otherwise */}
            {hotspot.animation !== 'none' && (
              <div
                className="absolute rounded-full animate-ping"
                style={{
                  width: sizePx + 14,
                  height: sizePx + 14,
                  background: `${color}30`,
                  border: `1px solid ${color}50`,
                  top: isPin ? '100%' : '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              />
            )}

            {isPin ? (
              // Map-pin silhouette: the shape itself is the marker.
              <div
                className="transition-all duration-200"
                style={{
                  width: sizePx * 1.15,
                  height: sizePx * 1.15,
                  filter: isActive
                    ? `drop-shadow(0 0 8px ${color}) drop-shadow(0 2px 3px rgba(0,0,0,.5))`
                    : 'drop-shadow(0 2px 3px rgba(0,0,0,.5))',
                  transform: isActive ? 'scale(1.15)' : 'scale(1)',
                }}
                dangerouslySetInnerHTML={{
                  __html: iconToSvg(iconDef, color, '#ffffff', sizePx * 1.15),
                }}
              />
            ) : (
              <div
                className="flex items-center justify-center rounded-full transition-all duration-200 shadow-lg"
                style={{
                  width: sizePx,
                  height: sizePx,
                  background: isActive ? `${color}` : `${color}cc`,
                  border: isActive ? `3px solid #fff` : `2px solid ${color}`,
                  boxShadow: isActive
                    ? `0 0 0 4px ${color}40, 0 0 20px ${color}80`
                    : `0 0 12px ${color}60`,
                  transform: isActive ? 'scale(1.15)' : 'scale(1)',
                }}
                dangerouslySetInnerHTML={{
                  __html: iconToSvg(iconDef, '#ffffff', color, sizePx * 0.56),
                }}
              />
            )}
            {/* Label on hover */}
            <div
              className="absolute top-full mt-2 px-2 py-1 rounded text-xs font-semibold whitespace-nowrap
                opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{
                background: 'rgba(2,8,23,0.9)',
                border: `1px solid ${color}60`,
                color: '#fff',
                boxShadow: `0 0 10px ${color}40`,
              }}
            >
              {hotspot.label}
            </div>
          </div>
        );
      })}

      {/* ── TEXT LABEL OVERLAYS ── */}
      {projectedLabels.map(({ id, x, y, behind, label }) => {
        if (behind || !label.visible) return null;
        const isActive = id === activeLabelId;
        return (
          <div
            key={id}
            className="absolute pointer-events-auto cursor-pointer transition-all"
            style={{
              left: x, top: y,
              transform: 'translate(-50%, -50%)',
              zIndex: 35,
            }}
            onClick={e => { e.stopPropagation(); onLabelClick?.(label); }}
          >
            <div
              className="px-3 py-1.5 rounded-lg select-none"
              style={{
                fontSize: label.fontSize,
                color: label.color || '#ffffff',
                background: label.bgColor || 'rgba(0,0,0,0.6)',
                opacity: label.opacity ?? 1,
                fontWeight: label.bold ? 700 : 400,
                border: isActive ? '2px solid #00d4ff' : '1px solid rgba(255,255,255,0.15)',
                boxShadow: isActive ? '0 0 12px #00d4ff80' : '0 2px 8px rgba(0,0,0,0.5)',
                backdropFilter: 'blur(6px)',
                padding: `${label.padding ?? 6}px ${(label.padding ?? 6) + 6}px`,
                borderRadius: label.borderRadius ?? 8,
                whiteSpace: 'nowrap',
              }}
            >
              {label.text}
            </div>
          </div>
        );
      })}

      {/* ── HUD: Scanlines ── */}
      <div className="absolute inset-0 pointer-events-none z-10"
        style={{ background: 'repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.04) 3px,rgba(0,0,0,0.04) 4px)' }}
      />

      {/* ── HUD: Compass ── */}
      <div className="absolute top-3 right-3 z-20 pointer-events-none flex flex-col items-center gap-1">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center relative"
          style={{
            background: 'rgba(2,8,23,0.8)',
            border: '1px solid rgba(0,212,255,0.3)',
            transform: `rotate(${-compassDeg}deg)`,
            transition: 'transform 0.12s ease-out',
          }}
        >
          <span className="absolute top-0.5 text-[7px] font-black text-red-400 left-1/2 -translate-x-1/2">N</span>
          <div className="w-px h-3 bg-red-400 absolute top-1 left-1/2 -translate-x-1/2" />
        </div>
        <div className="text-[8px] text-white/40">{compassDeg.toFixed(0)}°</div>
      </div>

      {/* ── HUD: Edit mode hint ── */}
      {editMode && activeTool !== 'select' && activeTool !== 'lighting' && activeTool !== 'transition' && activeTool !== 'settings' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none
          bg-slate-900/85 border border-cyan-500/40 text-cyan-300 text-[10px] font-bold
          px-3 py-1.5 rounded-full backdrop-blur shadow tracking-wide">
          {activeTool === 'label' ? '🏷️ Click anywhere to place a text label' : `📍 Click anywhere to place ${activeTool} hotspot`}
        </div>
      )}

      {/* Clicking with the Select tool does nothing; explain rather than no-op. */}
      {toolPrompt && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none
          bg-amber-500/95 text-slate-900 text-[11px] font-bold
          px-4 py-2 rounded-full shadow-lg backdrop-blur">
          👉 Pick a tool on the right toolbar first — then click here to place it
        </div>
      )}

      {/* ── Navigation arrows ── */}
      {!editMode && hasPrev && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-1 pointer-events-auto group"
          onClick={e => { e.stopPropagation(); onNavigate?.(currentIndex - 1); }}
        >
          <span className="text-3xl text-cyan-400 group-hover:text-white transition-colors drop-shadow-lg"
            style={{ transform: 'rotate(-90deg)', display: 'block', textShadow: '0 0 16px #00d4ff' }}>▲</span>
          <span className="text-[9px] text-cyan-400/70 tracking-widest">PREV</span>
        </button>
      )}
      {!editMode && hasNext && (
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-1 pointer-events-auto group"
          onClick={e => { e.stopPropagation(); onNavigate?.(currentIndex + 1); }}
        >
          <span className="text-3xl text-cyan-400 group-hover:text-white transition-colors drop-shadow-lg"
            style={{ transform: 'rotate(90deg)', display: 'block', textShadow: '0 0 16px #00d4ff' }}>▲</span>
          <span className="text-[9px] text-cyan-400/70 tracking-widest">NEXT</span>
        </button>
      )}
    </div>
  );
});

ThreeViewer.displayName = 'ThreeViewer';
