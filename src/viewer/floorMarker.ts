import * as THREE from 'three';
import type { PanoHotspot } from './types';

/**
 * Floor navigation markers — the flat discs you step onto in Google Street
 * View.
 *
 * These sit on the panorama's floor plane rather than floating at eye level,
 * which is what makes a tour feel like walking rather than clicking menus. A
 * visitor reads "there is a route that way" from the disc's position without
 * having to interpret an icon.
 *
 * Direction comes from the hotspot's own yaw, which the author placed while
 * looking at the actual doorway. Deriving it from floor-plan geometry instead
 * would need each scene's true compass heading — unknown unless the author
 * supplies it — so a plan-derived bearing risks pointing confidently at a wall.
 * The author's placement is correct by construction.
 */

/**
 * How far below eye level the floor sits, and how far ahead the disc lands.
 * Together these put the marker at roughly -38° pitch: far enough down to read
 * as "on the floor", high enough to stay clear of the bottom-edge distortion
 * where equirectangular projection smears badly.
 */
const FLOOR_DROP = 118;
const FLOOR_REACH = 150;

function buildTexture(accent: string, hovered: boolean): THREE.CanvasTexture {
  const SIZE = 256;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const c = SIZE / 2;

  // Soft shadow so the disc reads as resting on the floor rather than
  // floating above it.
  const glow = ctx.createRadialGradient(c, c, 20, c, c, c);
  glow.addColorStop(0, 'rgba(0,0,0,0.30)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.beginPath();
  ctx.arc(c, c, hovered ? 104 : 94, 0, Math.PI * 2);
  ctx.fillStyle = hovered ? `${accent}` : 'rgba(255,255,255,0.30)';
  ctx.globalAlpha = hovered ? 0.85 : 1;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.lineWidth = 7;
  ctx.strokeStyle = hovered ? '#ffffff' : accent;
  ctx.stroke();

  // Chevron pointing away from the viewer — the direction of travel.
  ctx.save();
  ctx.translate(c, c);
  ctx.strokeStyle = hovered ? '#ffffff' : accent;
  ctx.lineWidth = 15;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-34, 20);
  ctx.lineTo(0, -22);
  ctx.lineTo(34, 20);
  ctx.stroke();
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export interface FloorMarker {
  mesh: THREE.Mesh;
  hotspot: PanoHotspot;
  setHovered: (hovered: boolean) => void;
  dispose: () => void;
}

/**
 * Creates one disc lying flat on the floor, `yaw` degrees around from the
 * panorama's origin direction.
 */
export function createFloorMarker(hotspot: PanoHotspot, accent: string): FloorMarker {
  const normal = buildTexture(accent, false);
  const hover = buildTexture(accent, true);

  const material = new THREE.MeshBasicMaterial({
    map: normal,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // A plane laid horizontally. Circle geometry would work too, but a plane
  // keeps the texture's shadow gradient intact around the disc's edge.
  const geometry = new THREE.PlaneGeometry(96, 96);
  const mesh = new THREE.Mesh(geometry, material);

  const theta = THREE.MathUtils.degToRad(hotspot.yaw);
  mesh.position.set(
    Math.cos(theta) * FLOOR_REACH,
    -FLOOR_DROP,
    Math.sin(theta) * FLOOR_REACH,
  );

  // Lie flat, then spin so the chevron points away from the centre.
  mesh.rotation.set(-Math.PI / 2, 0, 0);
  mesh.rotateZ(-theta + Math.PI);

  mesh.renderOrder = 9; // under the eye-level hotspot sprites
  mesh.userData.hotspotId = hotspot.id;

  return {
    mesh,
    hotspot,
    setHovered(on: boolean) {
      material.map = on ? hover : normal;
      material.needsUpdate = true;
    },
    dispose() {
      normal.dispose();
      hover.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}
