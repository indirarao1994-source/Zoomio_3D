import * as THREE from 'three';
import type {
  LoadPhase,
  PanoEngineOptions,
  PanoHotspot,
  PanoScene,
  PanoTheme,
} from './types';
import {
  createHotspotSprite,
  sphericalToVector,
  vectorToSpherical,
  type HotspotSprite,
} from './hotspotSprite';
import { createFloorMarker, type FloorMarker } from './floorMarker';

const DEFAULT_THEME: PanoTheme = {
  primaryColor: '#2563eb',
  textColor: '#ffffff',
};

const SPHERE_OUTER = 500;
const SPHERE_INNER = 480;
const DRAG_CLICK_THRESHOLD = 6; // px of movement still treated as a click
const TRANSITION_MS = 700;

interface CachedTexture {
  preview?: THREE.Texture;
  full?: THREE.Texture;
  fullPromise?: Promise<THREE.Texture>;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * The rendering core behind both the studio canvas and every published tour.
 *
 * Design notes:
 * - Panoramas load in two passes (a fast downscaled bitmap, then full
 *   resolution) so a 6000x3000 JPEG shows something in a few hundred ms
 *   instead of blocking on the whole decode.
 * - Scene changes cross-fade between two spheres with a slight dolly, which is
 *   what gives commercial tours their "step through the door" feel.
 * - Hotspots are real objects in the 3D scene and are hit-tested with a
 *   raycaster, so they stay correctly occluded, scale with FOV, and work
 *   identically under a mouse, a touch screen, and a WebXR controller.
 */
export class PanoEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene3d = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rig = new THREE.Group();

  private sphereOuter: THREE.Mesh;
  private sphereInner: THREE.Mesh;
  private matOuter: THREE.MeshBasicMaterial;
  private matInner: THREE.MeshBasicMaterial;

  private hotspotGroup = new THREE.Group();
  private hotspotSprites: HotspotSprite[] = [];
  /** Street-View-style discs on the floor, one per navigation route. */
  private floorGroup = new THREE.Group();
  private floorMarkers: FloorMarker[] = [];
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();

  private textures = new Map<string, CachedTexture>();
  private scenes: PanoScene[];
  private currentIndex = 0;
  private opts: PanoEngineOptions;
  private theme: PanoTheme;

  /** Camera orientation in degrees. `target*` is eased toward for damping. */
  private yaw = 0;
  private pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private fov: number;
  private targetFov: number;
  private minFov: number;
  private maxFov: number;

  private dragging = false;
  private pointerDownAt = { x: 0, y: 0 };
  private lastPointer = { x: 0, y: 0 };
  private activePointers = new Map<number, { x: number; y: number }>();
  private pinchStartDistance = 0;
  private pinchStartFov = 0;
  private lastInteractionAt = performance.now();
  private hoveredId: string | null = null;
  private hoverDirty = false;

  private transition: { from: number; startedAt: number } | null = null;
  private gyroEnabled = false;
  private gyroQuat: THREE.Quaternion | null = null;

  private xrMode: 'vr' | 'ar' | null = null;
  private controllers: THREE.XRTargetRaySpace[] = [];
  private controllerRays: THREE.Line[] = [];

  private resizeObserver?: ResizeObserver;
  private disposed = false;
  /**
   * Timer rather than the deprecated Clock: it is connected to the document so
   * the Page Visibility API suppresses the huge delta that would otherwise
   * arrive when a backgrounded tab is restored and snap the camera.
   */
  private timer = new THREE.Timer();
  private readyFired = false;

  constructor(options: PanoEngineOptions) {
    this.opts = options;
    this.container = options.container;
    this.scenes = options.scenes;
    this.theme = options.theme ?? DEFAULT_THEME;
    this.fov = options.fov ?? 75;
    this.targetFov = this.fov;
    this.minFov = options.minFov ?? 30;
    this.maxFov = options.maxFov ?? 100;

    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.xr.enabled = options.xr !== false;
    this.renderer.domElement.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;';
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(this.fov, width / height, 0.1, 1200);
    this.rig.add(this.camera);
    this.scene3d.add(this.rig);
    this.scene3d.add(this.hotspotGroup);
    this.scene3d.add(this.floorGroup);

    // Two inverted spheres: the outer holds the current scene, the inner fades
    // the next one in over it.
    const geoOuter = new THREE.SphereGeometry(SPHERE_OUTER, 72, 40);
    geoOuter.scale(-1, 1, 1);
    this.matOuter = new THREE.MeshBasicMaterial({ color: 0x0b1120 });
    this.sphereOuter = new THREE.Mesh(geoOuter, this.matOuter);
    this.scene3d.add(this.sphereOuter);

    const geoInner = new THREE.SphereGeometry(SPHERE_INNER, 72, 40);
    geoInner.scale(-1, 1, 1);
    this.matInner = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.sphereInner = new THREE.Mesh(geoInner, this.matInner);
    this.sphereInner.visible = false;
    this.sphereInner.renderOrder = 1;
    this.scene3d.add(this.sphereInner);

    this.timer.connect(document);
    this.attachEvents();
    this.setupXRControllers();

    const startIndex = options.initialSceneId
      ? Math.max(0, this.scenes.findIndex((s) => s.id === options.initialSceneId))
      : 0;
    this.currentIndex = startIndex;

    this.renderer.setAnimationLoop(this.tick);

    if (this.scenes.length > 0) {
      void this.loadScene(startIndex, false);
    }
  }

  /* ───────────────────────── texture pipeline ───────────────────────── */

  private makeTexture(source: ImageBitmap): THREE.Texture {
    const tex = new THREE.Texture(source as unknown as HTMLImageElement);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    /*
     * The bitmaps are decoded with `imageOrientation: 'flipY'`, so the pixels
     * already arrive the way WebGL wants them.
     *
     * three.js defaults flipY to true, which works for an <img> because the
     * driver honours UNPACK_FLIP_Y_WEBGL — but that flag is unreliable for
     * ImageBitmap across browsers. Relying on it rendered every published tour
     * and exported video upside down while the editor (which loads through
     * TextureLoader and a real <img>) looked correct. Flipping at decode time
     * and disabling it here is deterministic everywhere.
     */
    tex.flipY = false;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Loads a panorama in two passes. `onPreview` is invoked as soon as a cheap
   * downscaled decode is ready — usually within a few hundred milliseconds —
   * and the promise resolves with the full-resolution texture.
   */
  private async loadTexture(
    url: string,
    onPreview: (tex: THREE.Texture) => void,
    onProgress?: (p: number) => void,
  ): Promise<THREE.Texture> {
    const cached = this.textures.get(url);
    if (cached?.full) return cached.full;
    if (cached?.preview) onPreview(cached.preview);
    if (cached?.fullPromise) return cached.fullPromise;

    const entry: CachedTexture = cached ?? {};
    this.textures.set(url, entry);

    const work = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to load panorama (${response.status})`);

      // Stream so large panoramas can report real download progress.
      const total = Number(response.headers.get('content-length') || 0);
      let blob: Blob;
      if (total > 0 && response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          onProgress?.(Math.min(0.95, received / total));
        }
        blob = new Blob(chunks as BlobPart[]);
      } else {
        blob = await response.blob();
      }
      onProgress?.(0.96);

      if (typeof createImageBitmap === 'function') {
        if (!entry.preview) {
          try {
            const small = await createImageBitmap(blob, {
              resizeWidth: 1024,
              resizeHeight: 512,
              resizeQuality: 'medium',
              // Flip at decode time — see makeTexture() for why.
              imageOrientation: 'flipY',
            });
            entry.preview = this.makeTexture(small);
            onPreview(entry.preview);
          } catch {
            // Older Safari lacks resize options; fall through to full decode.
          }
        }
        const full = await createImageBitmap(blob, { imageOrientation: 'flipY' });
        entry.full = this.makeTexture(full);
      } else {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const objectUrl = URL.createObjectURL(blob);
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Panorama decode failed'));
          img.src = objectUrl;
        });
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        entry.full = tex;
      }

      onProgress?.(1);
      return entry.full!;
    })();

    entry.fullPromise = work;
    try {
      return await work;
    } catch (err) {
      this.textures.delete(url);
      throw err;
    }
  }

  /** Warms the cache for the scenes a visitor is most likely to open next. */
  private prefetchNeighbours(index: number) {
    const targets = new Set<number>();
    if (index + 1 < this.scenes.length) targets.add(index + 1);
    if (index - 1 >= 0) targets.add(index - 1);
    for (const hs of this.scenes[index]?.hotspots ?? []) {
      if (hs.type !== 'navigation') continue;
      const i = this.scenes.findIndex((s) => s.id === hs.actionValue);
      if (i >= 0) targets.add(i);
    }
    targets.delete(index);
    for (const i of targets) {
      const url = this.scenes[i]?.imageUrl;
      if (url && !this.textures.has(url)) {
        void this.loadTexture(url, () => {}).catch(() => {});
      }
    }
  }

  /* ───────────────────────────── scenes ─────────────────────────────── */

  async loadScene(index: number, animate = true): Promise<void> {
    if (this.disposed) return;
    const scene = this.scenes[index];
    if (!scene) return;

    this.currentIndex = index;
    this.opts.onSceneChange?.(scene.id, index);
    this.opts.onProgress?.(0, 'preview');

    let previewApplied = false;
    const applyToInner = (tex: THREE.Texture) => {
      this.matInner.map = tex;
      this.matInner.color.set(0xffffff);
      this.matInner.needsUpdate = true;
      this.sphereInner.visible = true;
      if (!animate) this.matInner.opacity = 1;
      previewApplied = true;
    };

    try {
      const applyDirect = (tex: THREE.Texture) => {
        if (this.currentIndex !== index) return;
        this.matOuter.map = tex;
        this.matOuter.color.set(0xffffff);
        this.matOuter.needsUpdate = true;
      };

      if (!animate) {
        const preview = (tex: THREE.Texture) => applyDirect(tex);
        const full = await this.loadTexture(scene.imageUrl, preview, (p) =>
          this.opts.onProgress?.(p, 'full'),
        );
        if (this.currentIndex !== index) return;
        applyDirect(full);
      } else {
        const full = await this.loadTexture(scene.imageUrl, applyToInner, (p) =>
          this.opts.onProgress?.(p, previewApplied ? 'full' : 'preview'),
        );
        if (this.currentIndex !== index) return;
        applyToInner(full);
        this.transition = { from: this.fov, startedAt: performance.now() };
      }

      this.opts.onProgress?.(1, 'full');
      this.setCameraTo(scene.initialYaw ?? 0, scene.initialPitch ?? 0, !animate);
      this.rebuildHotspots(scene);
      this.prefetchNeighbours(index);

      if (!this.readyFired) {
        this.readyFired = true;
        this.opts.onReady?.();
      }
    } catch (err) {
      this.opts.onProgress?.(0, 'error');
      this.opts.onError?.(err instanceof Error ? err.message : 'Failed to load panorama');
    }
  }

  /** Navigates by scene id; used by navigation hotspots and the scene rail. */
  async goToScene(sceneId: string, animate = true): Promise<void> {
    const index = this.scenes.findIndex((s) => s.id === sceneId);
    if (index >= 0) await this.loadScene(index, animate);
  }

  next() {
    if (this.currentIndex + 1 < this.scenes.length) void this.loadScene(this.currentIndex + 1);
  }

  prev() {
    if (this.currentIndex > 0) void this.loadScene(this.currentIndex - 1);
  }

  /** Replaces the scene list in place, e.g. after an edit in the studio. */
  setScenes(scenes: PanoScene[]) {
    this.scenes = scenes;
    const current = scenes[this.currentIndex];
    if (current) this.rebuildHotspots(current);
  }

  setTheme(theme: PanoTheme) {
    this.theme = theme;
    const current = this.scenes[this.currentIndex];
    if (current) this.rebuildHotspots(current);
  }

  setEditMode(editMode: boolean) {
    this.opts.editMode = editMode;
  }

  setAutoRotate(speed: number) {
    this.opts.autoRotateSpeed = speed;
  }

  /* ──────────────────────────── hotspots ────────────────────────────── */

  private rebuildHotspots(scene: PanoScene) {
    for (const s of this.hotspotSprites) {
      this.hotspotGroup.remove(s.sprite);
      s.dispose();
    }
    this.hotspotSprites = [];

    for (const m of this.floorMarkers) {
      this.floorGroup.remove(m.mesh);
      m.dispose();
    }
    this.floorMarkers = [];

    const accent = this.theme.accentColor ?? this.theme.primaryColor;
    for (const hotspot of scene.hotspots) {
      const built = createHotspotSprite(hotspot, accent);
      this.hotspotGroup.add(built.sprite);
      this.hotspotSprites.push(built);

      // Navigation gets a second, floor-level marker so a route reads as
      // somewhere to walk. Info and media hotspots stay at eye level only —
      // putting a video on the floor would just be confusing.
      if (this.opts.floorMarkers !== false && hotspot.type === 'navigation') {
        const disc = createFloorMarker(hotspot, accent);
        this.floorGroup.add(disc.mesh);
        this.floorMarkers.push(disc);
      }
    }
    this.hoveredId = null;
  }

  /**
   * Hit-tests eye-level sprites first, then floor discs. Order matters: where
   * a disc sits behind a sprite on screen, the visitor means the thing they
   * can actually see.
   */
  private hotspotAtPointer(): HotspotSprite | FloorMarker | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    if (this.hotspotSprites.length > 0) {
      const hits = this.raycaster.intersectObjects(
        this.hotspotSprites.map((h) => h.sprite),
        false,
      );
      if (hits.length > 0) {
        const id = hits[0].object.userData.hotspotId;
        const found = this.hotspotSprites.find((h) => h.hotspot.id === id);
        if (found) return found;
      }
    }

    if (this.floorMarkers.length > 0) {
      const hits = this.raycaster.intersectObjects(
        this.floorMarkers.map((m) => m.mesh),
        false,
      );
      if (hits.length > 0) {
        const id = hits[0].object.userData.hotspotId;
        const found = this.floorMarkers.find((m) => m.hotspot.id === id);
        if (found) return found;
      }
    }

    return null;
  }

  /** Where on the panorama sphere the pointer currently points, in degrees. */
  private panoramaAtPointer(): { yaw: number; pitch: number } | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.intersectObject(this.sphereOuter, false)[0];
    if (!hit) return null;
    return vectorToSpherical(hit.point);
  }

  /* ───────────────────────────── camera ─────────────────────────────── */

  setCameraTo(yaw: number, pitch: number, immediate = false) {
    this.targetYaw = yaw;
    this.targetPitch = THREE.MathUtils.clamp(pitch, -85, 85);
    if (immediate) {
      this.yaw = this.targetYaw;
      this.pitch = this.targetPitch;
    }
  }

  /** Smoothly frames a hotspot, used by the studio when one is selected. */
  lookAtHotspot(hotspot: PanoHotspot) {
    this.setCameraTo(hotspot.yaw, hotspot.pitch);
  }

  zoomBy(delta: number) {
    this.targetFov = THREE.MathUtils.clamp(this.targetFov + delta, this.minFov, this.maxFov);
    this.markInteraction();
  }

  getCamera() {
    return { yaw: this.yaw, pitch: this.pitch, fov: this.fov };
  }

  getCurrentIndex() {
    return this.currentIndex;
  }

  /* ────────────────────────────── input ─────────────────────────────── */

  private markInteraction() {
    this.lastInteractionAt = performance.now();
  }

  private updatePointerNdc(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.markInteraction();

    if (this.activePointers.size === 2) {
      const [a, b] = [...this.activePointers.values()];
      this.pinchStartDistance = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchStartFov = this.targetFov;
      this.dragging = false;
      return;
    }

    this.dragging = true;
    this.pointerDownAt = { x: e.clientX, y: e.clientY };
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.container.style.cursor = 'grabbing';
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    this.updatePointerNdc(e.clientX, e.clientY);
    this.hoverDirty = true;

    if (this.activePointers.size === 2 && this.pinchStartDistance > 0) {
      const [a, b] = [...this.activePointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = this.pinchStartDistance / Math.max(dist, 1);
      this.targetFov = THREE.MathUtils.clamp(
        this.pinchStartFov * ratio,
        this.minFov,
        this.maxFov,
      );
      this.markInteraction();
      return;
    }

    if (!this.dragging) return;

    // Scale drag sensitivity with FOV so zoomed-in panning stays precise.
    const speed = (this.fov / 75) * 0.16;
    this.targetYaw -= (e.clientX - this.lastPointer.x) * speed;
    this.targetPitch = THREE.MathUtils.clamp(
      this.targetPitch + (e.clientY - this.lastPointer.y) * speed,
      -85,
      85,
    );
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.markInteraction();
  };

  private onPointerUp = (e: PointerEvent) => {
    const wasDragging = this.dragging;
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) this.pinchStartDistance = 0;
    this.dragging = false;
    this.container.style.cursor = 'grab';
    try {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }

    const travel = Math.hypot(
      e.clientX - this.pointerDownAt.x,
      e.clientY - this.pointerDownAt.y,
    );
    if (!wasDragging || travel > DRAG_CLICK_THRESHOLD) return;

    this.updatePointerNdc(e.clientX, e.clientY);
    const hit = this.hotspotAtPointer();
    if (hit) {
      this.activateHotspot(hit.hotspot);
      return;
    }
    if (this.opts.editMode) {
      const spot = this.panoramaAtPointer();
      if (spot) this.opts.onPlace?.(spot.yaw, spot.pitch);
    }
  };

  private activateHotspot(hotspot: PanoHotspot) {
    if (hotspot.type === 'navigation' && hotspot.actionValue) {
      void this.goToScene(hotspot.actionValue);
    }
    this.opts.onHotspotClick?.(hotspot);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomBy(e.deltaY * 0.05);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const step = 5;
    switch (e.key) {
      case 'ArrowLeft':
        this.targetYaw -= step;
        break;
      case 'ArrowRight':
        this.targetYaw += step;
        break;
      case 'ArrowUp':
        this.targetPitch = THREE.MathUtils.clamp(this.targetPitch - step, -85, 85);
        break;
      case 'ArrowDown':
        this.targetPitch = THREE.MathUtils.clamp(this.targetPitch + step, -85, 85);
        break;
      case '+':
      case '=':
        this.zoomBy(-5);
        break;
      case '-':
      case '_':
        this.zoomBy(5);
        break;
      case 'PageDown':
        this.next();
        break;
      case 'PageUp':
        this.prev();
        break;
      default:
        return;
    }
    e.preventDefault();
    this.markInteraction();
  };

  private attachEvents() {
    const el = this.renderer.domElement;
    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // Focusable so arrow keys reach the canvas without stealing page scroll.
    el.tabIndex = 0;
    el.addEventListener('keydown', this.onKeyDown);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ──────────────────────────── gyroscope ───────────────────────────── */

  private onDeviceOrientation = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(e.beta),
      THREE.MathUtils.degToRad(e.alpha),
      -THREE.MathUtils.degToRad(e.gamma),
      'YXZ',
    );
    const q = new THREE.Quaternion().setFromEuler(euler);
    // Bring the device frame (screen facing user) into the viewer's frame.
    q.multiply(new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)));
    const orient = THREE.MathUtils.degToRad(-(window.orientation as number) || 0);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), orient));
    this.gyroQuat = q;
  };

  /** Returns false if the device has no gyroscope or the user declined. */
  async enableGyro(): Promise<boolean> {
    type PermissionCapable = { requestPermission?: () => Promise<PermissionState> };
    const DOE = window.DeviceOrientationEvent as unknown as PermissionCapable | undefined;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      try {
        const state = await DOE.requestPermission();
        if (state !== 'granted') return false;
      } catch {
        return false;
      }
    }
    window.addEventListener('deviceorientation', this.onDeviceOrientation, true);
    this.gyroEnabled = true;
    return true;
  }

  disableGyro() {
    window.removeEventListener('deviceorientation', this.onDeviceOrientation, true);
    this.gyroEnabled = false;
    this.gyroQuat = null;
  }

  isGyroEnabled() {
    return this.gyroEnabled;
  }

  /* ────────────────────────────── WebXR ─────────────────────────────── */

  private setupXRControllers() {
    if (!this.renderer.xr.enabled) return;
    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);

    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      controller.addEventListener('select', () => this.onXRSelect(controller));
      this.rig.add(controller);
      this.controllers.push(controller);

      const line = new THREE.Line(
        rayGeo,
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }),
      );
      line.scale.z = 8;
      controller.add(line);
      this.controllerRays.push(line);
    }
  }

  private onXRSelect(controller: THREE.XRTargetRaySpace) {
    if (this.hotspotSprites.length === 0) return;
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, -1);
    controller.getWorldPosition(origin);
    direction.applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()));
    this.raycaster.set(origin, direction);
    const hits = this.raycaster.intersectObjects(
      this.hotspotSprites.map((h) => h.sprite),
      false,
    );
    if (hits.length === 0) return;
    const id = hits[0].object.userData.hotspotId;
    const found = this.hotspotSprites.find((h) => h.hotspot.id === id);
    if (found) this.activateHotspot(found.hotspot);
  }

  static async xrSupport(): Promise<{ vr: boolean; ar: boolean }> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return { vr: false, ar: false };
    const [vr, ar] = await Promise.all([
      xr.isSessionSupported('immersive-vr').catch(() => false),
      xr.isSessionSupported('immersive-ar').catch(() => false),
    ]);
    return { vr, ar };
  }

  async enterXR(mode: 'vr' | 'ar'): Promise<void> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) throw new Error('WebXR is not available in this browser');

    const sessionMode = mode === 'vr' ? 'immersive-vr' : 'immersive-ar';
    const session = await xr.requestSession(sessionMode, {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });

    await this.renderer.xr.setSession(session);
    this.xrMode = mode;

    // In AR the panorama would occlude the passthrough feed, so the sphere is
    // hidden and only the hotspots remain, anchored around the viewer.
    if (mode === 'ar') {
      this.sphereOuter.visible = false;
      this.sphereInner.visible = false;
      this.hotspotGroup.scale.setScalar(0.004);
    }

    this.opts.onXRStateChange?.(true, mode);
    session.addEventListener('end', () => {
      this.xrMode = null;
      this.sphereOuter.visible = true;
      this.hotspotGroup.scale.setScalar(1);
      this.opts.onXRStateChange?.(false, null);
    });
  }

  exitXR() {
    const session = this.renderer.xr.getSession();
    if (session) void session.end();
  }

  isPresenting() {
    return this.renderer.xr.isPresenting;
  }

  getXRMode() {
    return this.xrMode;
  }

  /* ───────────────────────────── render ─────────────────────────────── */

  private tick = () => {
    if (this.disposed) return;
    this.timer.update();
    const delta = Math.min(this.timer.getDelta(), 0.1);
    const now = performance.now();

    // Self-heal the drawing buffer. A viewer constructed inside a hidden tab,
    // a collapsed accordion, or a display:none parent has no layout yet, so it
    // starts at 1x1 and ResizeObserver never fires while rendering is paused.
    // Checking here means the first frame after it becomes visible is correct.
    if (!this.renderer.xr.isPresenting) {
      const cw = this.container.clientWidth;
      const ch = this.container.clientHeight;
      if (cw > 0 && ch > 0) {
        const buffer = new THREE.Vector2();
        this.renderer.getSize(buffer);
        if (Math.abs(buffer.x - cw) > 1 || Math.abs(buffer.y - ch) > 1) this.resize();
      }
    }

    // Resume idle auto-rotation once the visitor has stopped interacting.
    const autoSpeed = this.opts.autoRotateSpeed ?? 0;
    const idleFor = (now - this.lastInteractionAt) / 1000;
    if (autoSpeed > 0 && !this.dragging && idleFor > (this.opts.autoRotateDelay ?? 3)) {
      this.targetYaw += autoSpeed * delta;
    }

    // Critically damped easing gives the heavy, expensive feel of a pro viewer.
    const damp = 1 - Math.pow(0.0015, delta);
    this.yaw += (this.targetYaw - this.yaw) * damp;
    this.pitch += (this.targetPitch - this.pitch) * damp;

    if (this.transition) {
      const t = Math.min(1, (now - this.transition.startedAt) / TRANSITION_MS);
      const eased = easeInOutCubic(t);
      this.matInner.opacity = eased;
      // A slight push-in during the cross-fade sells the movement between rooms.
      const dolly = Math.sin(eased * Math.PI) * 7;
      this.camera.fov = this.fov - dolly;
      this.camera.updateProjectionMatrix();

      if (t >= 1) {
        this.matOuter.map = this.matInner.map;
        this.matOuter.color.set(0xffffff);
        this.matOuter.needsUpdate = true;
        this.matInner.opacity = 0;
        this.sphereInner.visible = false;
        this.transition = null;
      }
    } else if (Math.abs(this.camera.fov - this.fov) > 0.001) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    if (Math.abs(this.targetFov - this.fov) > 0.01) {
      this.fov += (this.targetFov - this.fov) * Math.min(1, delta * 10);
      if (!this.transition) {
        this.camera.fov = this.fov;
        this.camera.updateProjectionMatrix();
      }
    }

    if (!this.renderer.xr.isPresenting) {
      this.applyCameraOrientation();
      this.opts.onCameraMove?.(this.yaw, this.pitch, this.fov);
    }

    // Hover is resolved once per frame rather than per pointermove event.
    if (this.hoverDirty && !this.dragging && !this.renderer.xr.isPresenting) {
      this.hoverDirty = false;
      const hit = this.hotspotAtPointer();
      const id = hit?.hotspot.id ?? null;
      if (id !== this.hoveredId) {
        // A navigation route has both an eye-level sprite and a floor disc;
        // highlight both so they read as one control.
        for (const s of this.hotspotSprites) s.setHovered(s.hotspot.id === id);
        for (const m of this.floorMarkers) m.setHovered(m.hotspot.id === id);
        this.hoveredId = id;
        this.renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
        this.opts.onHotspotHover?.(hit?.hotspot ?? null);
      }
    }

    // Keep markers a constant on-screen size regardless of zoom level.
    const scaleForFov = this.fov / 75;
    for (const s of this.hotspotSprites) {
      const base = s.sprite.userData.baseScale as number;
      const pulse =
        s.hotspot.animation === 'pulse'
          ? 1 + Math.sin(now * 0.004) * 0.08
          : s.hotspot.animation === 'bounce'
            ? 1 + Math.abs(Math.sin(now * 0.003)) * 0.1
            : 1;
      s.sprite.scale.setScalar(base * scaleForFov * pulse);
      if (s.hotspot.animation === 'float') {
        const p = sphericalToVector(s.hotspot.yaw, s.hotspot.pitch);
        p.y += Math.sin(now * 0.002) * 8;
        s.sprite.position.copy(p);
      }
    }

    this.renderer.render(this.scene3d, this.camera);
  };

  /**
   * Points the camera at the current yaw/pitch (or the gyroscope pose).
   * Shared by the animation loop and the on-demand render paths so a forced
   * frame reflects the same view the loop would have produced.
   */
  private applyCameraOrientation() {
    if (this.gyroEnabled && this.gyroQuat) {
      this.camera.quaternion.copy(this.gyroQuat);
      return;
    }
    const phi = THREE.MathUtils.degToRad(90 - this.pitch);
    const theta = THREE.MathUtils.degToRad(this.yaw);
    this.camera.lookAt(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta),
    );
  }

  /**
   * Forces a single frame outside the animation loop. Useful when the host
   * page drives its own scheduling, or when rendering is paused (hidden tab)
   * but a frame is still needed — e.g. before capturing a thumbnail.
   *
   * Applies the camera orientation first: without it this rendered whatever
   * pose the loop last left behind, so a `setCameraTo()` immediately followed
   * by `renderNow()` produced the *previous* view.
   */
  renderNow() {
    if (this.disposed) return;
    this.resize();
    if (!this.renderer.xr.isPresenting) this.applyCameraOrientation();
    this.renderer.render(this.scene3d, this.camera);
  }

  /** Renders the current view to a data URL, used for auto cover images. */
  captureThumbnail(width = 640, height = 360): string {
    const prevSize = new THREE.Vector2();
    this.renderer.getSize(prevSize);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (!this.renderer.xr.isPresenting) this.applyCameraOrientation();
    this.renderer.render(this.scene3d, this.camera);
    const url = this.renderer.domElement.toDataURL('image/jpeg', 0.82);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.camera.aspect = prevSize.x / prevSize.y;
    this.camera.updateProjectionMatrix();
    return url;
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.disableGyro();
    this.timer.dispose();
    this.resizeObserver?.disconnect();

    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('keydown', this.onKeyDown);

    for (const s of this.hotspotSprites) s.dispose();
    for (const m of this.floorMarkers) m.dispose();
    this.floorMarkers = [];
    this.hotspotSprites = [];
    for (const entry of this.textures.values()) {
      entry.preview?.dispose();
      entry.full?.dispose();
    }
    this.textures.clear();

    this.sphereOuter.geometry.dispose();
    this.sphereInner.geometry.dispose();
    this.matOuter.dispose();
    this.matInner.dispose();
    this.renderer.dispose();
    if (el.parentElement === this.container) this.container.removeChild(el);
  }
}
