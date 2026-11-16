import * as THREE from 'three';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import {
  frameAt,
  totalFrames,
  type OrientationSpec,
  type PathOptions,
  type VideoSceneRef,
} from './cameraPath';

/**
 * Offscreen video renderer.
 *
 * Builds its own WebGL context and panorama spheres rather than borrowing the
 * live editor's, so exporting never disturbs what the user is looking at and
 * the output size is independent of the on-screen canvas.
 *
 * Frames are encoded to JPEG and streamed into ffmpeg.wasm's filesystem one at
 * a time. Holding 1500+ raw RGBA frames in memory would be several gigabytes;
 * JPEG-per-frame keeps a 60-second export in the low hundreds of megabytes.
 */

export interface VideoExportOptions {
  scenes: Array<VideoSceneRef & { imageUrl: string }>;
  orientation: OrientationSpec;
  secondsPerScene: number;
  fps: number;
  tourName: string;
  /** Drawn into the opening title card. */
  subtitle?: string;
  accentColor: string;
  onProgress?: (stage: string, ratio: number) => void;
  signal?: AbortSignal;
}

const SPHERE_RADIUS = 500;

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

async function loadTexture(url: string): Promise<THREE.Texture> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load panorama (${response.status})`);
  const blob = await response.blob();

  let tex: THREE.Texture;
  let preFlipped = false;
  if (typeof createImageBitmap === 'function') {
    // Decode already flipped: three.js's flipY is unreliable for ImageBitmap,
    // which rendered exported videos upside down.
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });
    preFlipped = true;
    tex = new THREE.Texture(bitmap as unknown as HTMLImageElement);
  } else {
    const img = new Image();
    const objectUrl = URL.createObjectURL(blob);
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Panorama decode failed'));
      img.src = objectUrl;
    });
    tex = new THREE.Texture(img);
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  // Only the <img> fallback still needs three.js to do the flip.
  tex.flipY = !preFlipped;
  tex.needsUpdate = true;
  return tex;
}

/** Title card + watermark, composited over the rendered panorama. */
function drawOverlay(
  ctx: CanvasRenderingContext2D,
  opts: VideoExportOptions,
  titleOpacity: number,
  sceneName: string,
) {
  const { width, height } = ctx.canvas;

  // Scene label, bottom-left, always visible.
  const pad = Math.round(width * 0.045);
  const labelSize = Math.round(Math.min(width, height) * 0.038);
  ctx.save();
  ctx.font = `600 ${labelSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'alphabetic';
  const metrics = ctx.measureText(sceneName);
  const boxH = labelSize * 2;
  const boxW = metrics.width + labelSize * 1.6;
  const boxY = height - pad - boxH;

  ctx.fillStyle = 'rgba(10,14,22,0.62)';
  ctx.beginPath();
  const r = boxH / 2;
  ctx.roundRect(pad, boxY, boxW, boxH, r);
  ctx.fill();

  ctx.fillStyle = opts.accentColor;
  ctx.beginPath();
  ctx.arc(pad + labelSize * 0.75, boxY + boxH / 2, labelSize * 0.22, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.fillText(sceneName, pad + labelSize * 1.15, boxY + boxH / 2 + labelSize * 0.35);
  ctx.restore();

  if (titleOpacity <= 0.01) return;

  // Opening title card.
  ctx.save();
  ctx.globalAlpha = titleOpacity;
  ctx.fillStyle = 'rgba(6,10,18,0.55)';
  ctx.fillRect(0, 0, width, height);

  const titleSize = Math.round(Math.min(width, height) * 0.085);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = `800 ${titleSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText(opts.tourName, width / 2, height / 2);

  if (opts.subtitle) {
    const subSize = Math.round(titleSize * 0.36);
    ctx.font = `500 ${subSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(opts.subtitle, width / 2, height / 2 + titleSize * 0.85);
  }

  ctx.fillStyle = opts.accentColor;
  ctx.fillRect(width / 2 - titleSize, height / 2 + titleSize * 0.28, titleSize * 2, 3);
  ctx.restore();
}

export async function renderTourVideo(opts: VideoExportOptions): Promise<Blob> {
  const { orientation, scenes, signal } = opts;
  if (scenes.length === 0) throw new Error('This tour has no scenes to export');

  const path: PathOptions = {
    scenes,
    secondsPerScene: opts.secondsPerScene,
    transitionSeconds: Math.min(1, opts.secondsPerScene / 3),
    fps: opts.fps,
    sweepDegrees: 110,
  };
  const frames = totalFrames(path);

  /* ── offscreen renderer ── */
  const canvas = document.createElement('canvas');
  canvas.width = orientation.width;
  canvas.height = orientation.height;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    // Required: we read the buffer back after rendering each frame.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(orientation.width, orientation.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene3d = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    orientation.fov,
    orientation.width / orientation.height,
    0.1,
    1200,
  );

  const geo = new THREE.SphereGeometry(SPHERE_RADIUS, 64, 40);
  geo.scale(-1, 1, 1);
  const matA = new THREE.MeshBasicMaterial({ color: 0x0b1120 });
  const matB = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const sphereA = new THREE.Mesh(geo, matA);
  const sphereB = new THREE.Mesh(new THREE.SphereGeometry(SPHERE_RADIUS - 20, 64, 40), matB);
  (sphereB.geometry as THREE.SphereGeometry).scale(-1, 1, 1);
  sphereB.renderOrder = 1;
  sphereB.visible = false;
  scene3d.add(sphereA, sphereB);

  // Composite target: panorama first, then 2D overlay text.
  const out = document.createElement('canvas');
  out.width = orientation.width;
  out.height = orientation.height;
  const ctx = out.getContext('2d')!;

  const ffmpeg = new FFmpeg();
  const textures = new Map<string, THREE.Texture>();

  try {
    opts.onProgress?.('Loading video encoder', 0);
    // The core is served from our own origin (see scripts/copy-ffmpeg.mjs), but
    // it still has to go through toBlobURL: ffmpeg runs inside a worker created
    // from a blob URL, which has an opaque origin, and importScripts() of a
    // normal path from there fails with "failed to import ffmpeg-core.js".
    const base = `${window.location.origin}/ffmpeg`;
    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    assertNotAborted(signal);

    opts.onProgress?.('Loading panoramas', 0);
    for (let i = 0; i < scenes.length; i++) {
      assertNotAborted(signal);
      textures.set(scenes[i].id, await loadTexture(scenes[i].imageUrl));
      opts.onProgress?.('Loading panoramas', (i + 1) / scenes.length);
    }

    /* ── render every frame ── */
    for (let f = 0; f < frames; f++) {
      assertNotAborted(signal);
      const step = frameAt(f, path);

      const current = textures.get(scenes[step.sceneIndex].id)!;
      matA.map = current;
      matA.color.set(0xffffff);
      matA.needsUpdate = true;

      if (step.nextSceneIndex !== null) {
        const next = textures.get(scenes[step.nextSceneIndex].id);
        if (next) {
          matB.map = next;
          matB.opacity = step.transitionProgress;
          matB.needsUpdate = true;
          sphereB.visible = true;
        }
      } else {
        sphereB.visible = false;
        matB.opacity = 0;
      }

      const phi = THREE.MathUtils.degToRad(90 - step.pitch);
      const theta = THREE.MathUtils.degToRad(step.yaw);
      camera.lookAt(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      );
      renderer.render(scene3d, camera);

      ctx.drawImage(canvas, 0, 0);
      drawOverlay(ctx, opts, step.titleOpacity, scenes[step.sceneIndex].name);

      const blob = await new Promise<Blob | null>((res) =>
        out.toBlob((b) => res(b), 'image/jpeg', 0.82),
      );
      if (!blob) throw new Error('Frame capture failed');

      await ffmpeg.writeFile(
        `f${String(f).padStart(5, '0')}.jpg`,
        await fetchFile(blob),
      );
      opts.onProgress?.('Rendering frames', (f + 1) / frames);
    }

    /* ── encode ── */
    assertNotAborted(signal);
    opts.onProgress?.('Encoding MP4', 0);
    ffmpeg.on('progress', ({ progress }) => {
      opts.onProgress?.('Encoding MP4', Math.max(0, Math.min(1, progress)));
    });

    await ffmpeg.exec([
      '-framerate', String(opts.fps),
      '-i', 'f%05d.jpg',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      // yuv420p + even dimensions is what makes the file play on phones,
      // WhatsApp and Instagram rather than showing a black screen.
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      'out.mp4',
    ]);

    const data = (await ffmpeg.readFile('out.mp4')) as Uint8Array;
    // ffmpeg may hand back a SharedArrayBuffer-backed view, which Blob rejects.
    // Copy into a plain ArrayBuffer before wrapping it.
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);

    opts.onProgress?.('Done', 1);
    return new Blob([bytes], { type: 'video/mp4' });
  } finally {
    // Free the wasm heap and GPU resources whether or not we succeeded.
    for (let f = 0; f < frames; f++) {
      try {
        await ffmpeg.deleteFile(`f${String(f).padStart(5, '0')}.jpg`);
      } catch {
        /* already gone, or encoder never got this far */
      }
    }
    try {
      ffmpeg.terminate();
    } catch {
      /* not loaded */
    }
    for (const t of textures.values()) t.dispose();
    geo.dispose();
    sphereB.geometry.dispose();
    matA.dispose();
    matB.dispose();
    renderer.dispose();
  }
}
