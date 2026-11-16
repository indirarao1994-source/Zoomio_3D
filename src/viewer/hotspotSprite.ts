import * as THREE from 'three';
import type { PanoHotspot } from './types';
import { getHotspotIcon, type HotspotIconDef } from './icons';

/**
 * Hotspots are drawn as camera-facing sprites built from canvas textures, so a
 * tour with dozens of them still costs one draw call each and stays crisp at
 * any FOV. Icons come from the shared vector catalog rather than image files,
 * so a published tour makes no extra asset requests.
 */

const SIZE = 256;

/** Renders a 24x24 icon definition into the current canvas transform. */
function paintIcon(
  ctx: CanvasRenderingContext2D,
  def: HotspotIconDef,
  box: { x: number; y: number; size: number },
  accent: string,
  contrast: string,
) {
  ctx.save();
  ctx.translate(box.x, box.y);
  const scale = box.size / 24;
  ctx.scale(scale, scale);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const p of def.paths) {
    const colour = p.contrast ? contrast : accent;
    const path = new Path2D(p.d);
    if (p.fill) {
      ctx.fillStyle = colour;
      ctx.fill(path);
    } else {
      ctx.strokeStyle = colour;
      ctx.stroke(path);
    }
  }
  ctx.restore();
}

function buildTexture(
  hotspot: PanoHotspot,
  accent: string,
  hovered: boolean,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const def = getHotspotIcon(hotspot.icon, hotspot.type);
  const c = SIZE / 2;

  // A drop shadow is what keeps a marker readable over both a bright sky and
  // a dark floor without needing an opaque plate behind it.
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = hovered ? 26 : 18;
  ctx.shadowOffsetY = 4;

  if (def.anchor === 'bottom') {
    // Map-pin style: the silhouette itself is the marker, so it is drawn large
    // and filled rather than tucked inside a badge.
    const size = hovered ? SIZE * 0.94 : SIZE * 0.86;
    paintIcon(
      ctx,
      def,
      { x: (SIZE - size) / 2, y: SIZE - size, size },
      hovered ? '#ffffff' : accent,
      hovered ? accent : '#ffffff',
    );
  } else {
    // Badge style: a filled disc with the glyph centred inside it.
    const r = hovered ? 84 : 76;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = hovered ? '#ffffff' : accent;
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();

    const glyph = r * 1.15;
    paintIcon(
      ctx,
      def,
      { x: c - glyph / 2, y: c - glyph / 2, size: glyph },
      hovered ? accent : '#ffffff',
      hovered ? '#ffffff' : accent,
    );
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export interface HotspotSprite {
  sprite: THREE.Sprite;
  hotspot: PanoHotspot;
  setHovered: (hovered: boolean) => void;
  dispose: () => void;
}

/** Converts spherical hotspot coordinates to a point on the projection sphere. */
export function sphericalToVector(yaw: number, pitch: number, radius = 460): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - pitch);
  const theta = THREE.MathUtils.degToRad(yaw);
  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

/** Inverse of `sphericalToVector`, used to place hotspots from a click. */
export function vectorToSpherical(v: THREE.Vector3): { yaw: number; pitch: number } {
  const n = v.clone().normalize();
  const pitch = 90 - THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(n.y, -1, 1)));
  const yaw = THREE.MathUtils.radToDeg(Math.atan2(n.z, n.x));
  return { yaw, pitch };
}

export function createHotspotSprite(hotspot: PanoHotspot, accent: string): HotspotSprite {
  const normalTex = buildTexture(hotspot, accent, false);
  const hoverTex = buildTexture(hotspot, accent, true);

  const material = new THREE.SpriteMaterial({
    map: normalTex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.position.copy(sphericalToVector(hotspot.yaw, hotspot.pitch));
  sprite.scale.setScalar(58);
  // Draw after the panorama sphere so markers are never clipped by it.
  sprite.renderOrder = 10;
  sprite.userData.hotspotId = hotspot.id;
  sprite.userData.baseScale = 58;

  // A pin marks its spot with the tip, not its middle. Moving the sprite's
  // origin to its bottom edge puts that tip exactly on the placed coordinate
  // instead of half a marker above it.
  const def = getHotspotIcon(hotspot.icon, hotspot.type);
  if (def.anchor === 'bottom') sprite.center.set(0.5, 0);

  return {
    sprite,
    hotspot,
    setHovered(hovered: boolean) {
      material.map = hovered ? hoverTex : normalTex;
      material.needsUpdate = true;
    },
    dispose() {
      normalTex.dispose();
      hoverTex.dispose();
      material.dispose();
    },
  };
}
