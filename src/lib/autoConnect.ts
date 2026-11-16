import type { FloorPlan, Hotspot, Scene } from '../types/tour';

/**
 * Derives a tour's navigation graph from floor plan pin positions.
 *
 * A panorama on its own carries no information about where it sits relative to
 * the others, which is why a set of unconnected scenes feels like flipping
 * through photos. Once each scene is pinned to the plan, both missing pieces
 * are recoverable: distance says which rooms adjoin, and bearing says which
 * way to face to walk between them.
 */

export interface PlanConnection {
  fromSceneId: string;
  toSceneId: string;
  /** Degrees clockwise from plan-north. */
  bearing: number;
  /** Percentage-space distance across the plan. */
  distance: number;
}

interface Pin {
  sceneId: string;
  x: number;
  y: number;
}

/**
 * Compass bearing from `a` to `b`, in degrees clockwise from north.
 *
 * Plan images use screen coordinates where y grows *downwards*, so north is
 * -y. Getting this wrong flips the whole tour front-to-back, which is why the
 * negation is explicit rather than folded into the atan2 arguments.
 */
function bearingBetween(a: Pin, b: Pin): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

function distanceBetween(a: Pin, b: Pin): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Builds the connection set.
 *
 * Starts from a minimum spanning tree, which guarantees every room is
 * reachable — a nearest-neighbour rule alone can silently strand a room whose
 * neighbours all pair up with each other. Extra short edges are then added
 * back so the result has realistic loops (a hallway touching several rooms)
 * rather than forcing visitors down a single chain.
 */
export function planConnections(plan: FloorPlan, scenes: Scene[]): PlanConnection[] {
  const valid = new Set(scenes.map((s) => s.id));
  const pins: Pin[] = (plan?.markers ?? [])
    .filter((m) => valid.has(m.sceneId))
    .map((m) => ({ sceneId: m.sceneId, x: m.x, y: m.y }));

  if (pins.length < 2) return [];

  // ── Prim's MST ──
  const inTree = new Set<string>([pins[0].sceneId]);
  const edges: Array<{ a: Pin; b: Pin; d: number }> = [];

  while (inTree.size < pins.length) {
    let best: { a: Pin; b: Pin; d: number } | null = null;
    for (const a of pins) {
      if (!inTree.has(a.sceneId)) continue;
      for (const b of pins) {
        if (inTree.has(b.sceneId)) continue;
        const d = distanceBetween(a, b);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    if (!best) break; // defensive: cannot happen while sizes differ
    edges.push(best);
    inTree.add(best.b.sceneId);
  }

  // ── extra short edges, so the layout isn't a forced chain ──
  const spans = edges.map((e) => e.d).sort((x, y) => x - y);
  const median = spans[Math.floor(spans.length / 2)] ?? 0;
  const threshold = median * 1.35;

  const key = (a: string, b: string) => [a, b].sort().join('|');
  const have = new Set(edges.map((e) => key(e.a.sceneId, e.b.sceneId)));

  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      const d = distanceBetween(pins[i], pins[j]);
      if (d > threshold) continue;
      const k = key(pins[i].sceneId, pins[j].sceneId);
      if (have.has(k)) continue;
      have.add(k);
      edges.push({ a: pins[i], b: pins[j], d });
    }
  }

  // Every connection is walkable both ways.
  const out: PlanConnection[] = [];
  for (const e of edges) {
    out.push({
      fromSceneId: e.a.sceneId,
      toSceneId: e.b.sceneId,
      bearing: bearingBetween(e.a, e.b),
      distance: e.d,
    });
    out.push({
      fromSceneId: e.b.sceneId,
      toSceneId: e.a.sceneId,
      bearing: bearingBetween(e.b, e.a),
      distance: e.d,
    });
  }
  return out;
}

/**
 * Rewrites each scene's navigation hotspots from the plan.
 *
 * `northOffset` rotates every computed bearing by the same amount. Plan-north
 * and the panorama's 0° rarely coincide — that depends on which way the camera
 * was pointing — so a single offset aligns the whole tour at once instead of
 * correcting each scene by hand.
 *
 * Only navigation hotspots are replaced; info, image, video and audio hotspots
 * are preserved, since those mark content the author placed deliberately.
 */
export function applyPlanConnections(
  scenes: Scene[],
  plan: FloorPlan,
  northOffset = 0,
): { scenes: Scene[]; created: number } {
  const connections = planConnections(plan, scenes);
  if (connections.length === 0) return { scenes, created: 0 };

  const byScene = new Map<string, PlanConnection[]>();
  for (const c of connections) {
    const list = byScene.get(c.fromSceneId) ?? [];
    list.push(c);
    byScene.set(c.fromSceneId, list);
  }

  let created = 0;
  const next = scenes.map((scene) => {
    const links = byScene.get(scene.id);
    if (!links) return scene;

    const kept = (scene.hotspots ?? []).filter((h) => h.type !== 'navigation');
    const nav: Hotspot[] = links.map((link) => {
      const target = scenes.find((s) => s.id === link.toSceneId);
      const yaw = (((link.bearing - northOffset + 180) % 360) + 360) % 360 - 180;
      created++;
      return {
        id: `hs_auto_${scene.id}_${link.toSceneId}`,
        type: 'navigation',
        yaw,
        // Doorways sit near eye level or a little below.
        pitch: -10,
        label: `To ${target?.name ?? 'next room'}`,
        icon: 'arrow',
        actionValue: link.toSceneId,
        animation: 'pulse',
      } as Hotspot;
    });

    return { ...scene, hotspots: [...kept, ...nav] };
  });

  return { scenes: next, created };
}
