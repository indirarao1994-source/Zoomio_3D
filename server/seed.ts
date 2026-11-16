import fs from 'fs';
import path from 'path';
import { APP_ROOT, projects, publications, type StoredProject } from './store.ts';

/**
 * First-boot demo content.
 *
 * A freshly deployed instance has no database, so it comes up as an empty
 * studio behind a setup screen — fine for a real install, useless when the
 * first thing someone does is open the link you sent them. This seeds one
 * complete tour so a new deployment is immediately explorable.
 *
 * Runs only when there are no projects at all, so it can never overwrite real
 * work or reappear after someone deletes it.
 */

const ROOMS = [
  { id: 'sc_living', name: 'Living Room',    file: 'lounge.jpg',        x: 30, y: 68 },
  { id: 'sc_hall',   name: 'Wooden Hallway', file: 'wooden-lounge.jpg', x: 52, y: 42 },
  { id: 'sc_bed',    name: 'Bedroom',        file: 'bedroom.jpg',       x: 76, y: 22 },
];

/** Simple north-up plan drawn inline so the seed needs no binary asset. */
const FLOOR_PLAN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="440" viewBox="0 0 640 440">
<rect width="640" height="440" fill="#f8fafc"/>
<g fill="#eef2f7" stroke="#94a3b8" stroke-width="3">
  <rect x="60" y="250" width="250" height="150"/>
  <rect x="250" y="130" width="160" height="130"/>
  <rect x="400" y="40" width="190" height="140"/>
</g>
<g fill="#fff" stroke="#cbd5e1" stroke-width="2">
  <rect x="300" y="248" width="34" height="6"/>
  <rect x="398" y="150" width="6" height="34"/>
</g>
<g font-family="sans-serif" font-size="16" fill="#475569" text-anchor="middle">
  <text x="185" y="330">Living Room</text>
  <text x="330" y="200">Hallway</text>
  <text x="495" y="115">Bedroom</text>
</g>
<text x="20" y="28" font-family="sans-serif" font-size="12" fill="#94a3b8">N &#8593;</text>
</svg>`;

/**
 * Doorway bearings, derived from the plan coordinates above rather than
 * hand-tuned, so each arrow points at the room it leads to. Reverse bearings
 * are exactly 180° apart — you walk back through the same door.
 */
function connections() {
  const bearing = (a: typeof ROOMS[0], b: typeof ROOMS[0]) => {
    const deg = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
    return ((((deg % 360) + 360) % 360) + 180) % 360 - 180;
  };
  const pairs: Array<[number, number]> = [[0, 1], [1, 2]];
  const out = new Map<string, Array<{ to: string; yaw: number; name: string }>>();
  for (const [i, j] of pairs) {
    const a = ROOMS[i], b = ROOMS[j];
    if (!out.has(a.id)) out.set(a.id, []);
    if (!out.has(b.id)) out.set(b.id, []);
    out.get(a.id)!.push({ to: b.id, yaw: bearing(a, b), name: b.name });
    out.get(b.id)!.push({ to: a.id, yaw: bearing(b, a), name: a.name });
  }
  return out;
}

export function seedIfEmpty(): void {
  if (projects.all().length > 0) return;

  // Without the sample panoramas there is nothing to seed; a published tour
  // pointing at missing images is worse than no tour at all.
  const samples = path.join(APP_ROOT, 'public', 'samples', 'interiors');
  const missing = ROOMS.filter((r) => !fs.existsSync(path.join(samples, r.file)));
  if (missing.length > 0) {
    console.log(
      `[seed] skipped — missing sample panoramas: ${missing.map((m) => m.file).join(', ')}`,
    );
    return;
  }

  const links = connections();
  const scenes = ROOMS.map((room, index) => ({
    id: room.id,
    name: room.name,
    imageUrl: `/samples/interiors/${room.file}`,
    order: index + 1,
    isEntrance: index === 0,
    initialView: { yaw: 0, pitch: 0 },
    hotspots: (links.get(room.id) ?? []).map((link) => ({
      id: `hs_seed_${room.id}_${link.to}`,
      type: 'navigation',
      yaw: link.yaw,
      pitch: -10,
      label: `To ${link.name}`,
      icon: 'arrow',
      actionValue: link.to,
      animation: 'pulse',
    })),
    textLabels: [],
  }));

  const now = new Date().toISOString();
  const project: StoredProject = {
    id: 'proj_demo_house',
    name: 'Green Valley Residence',
    category: 'real-estate',
    description: 'A three-room walkthrough demonstrating hotspots, floor plan navigation and video export.',
    location: 'Bengaluru, India',
    primaryColor: '#0d9488',
    theme: {
      preset: 'modern',
      primaryColor: '#0d9488',
      secondaryColor: '#0f172a',
      textColor: '#ffffff',
      fontFamily: 'Inter',
      borderRadius: '14px',
      showWatermark: true,
      watermarkText: 'Created with Zoomio',
    },
    scenes,
    floorPlans: [
      {
        id: 'fp_ground',
        name: 'Ground Floor',
        imageUrl: `data:image/svg+xml;base64,${Buffer.from(FLOOR_PLAN_SVG).toString('base64')}`,
        markers: ROOMS.map((r) => ({ sceneId: r.id, x: r.x, y: r.y })),
      },
    ],
    // Left unowned on purpose: the first account created adopts it, so the
    // operator signs up and finds the demo already in their studio.
    createdAt: now,
    updatedAt: now,
  };

  projects.save([project]);
  console.log('[seed] created demo project "Green Valley Residence"');
}

/**
 * Publishes the seeded tour so the deployment has a working public link before
 * anyone signs in. Separate from seedIfEmpty because publishing needs the
 * player bundle, which may legitimately be absent in a partial build.
 */
export async function publishSeedIfNeeded(
  assemble: (project: StoredProject, apiBase?: string, slug?: string) => { files: Array<{ name: string; body: Buffer | string }>; sceneCount: number; coverPath: string | null },
  writeBundle: (slug: string, files: Array<{ name: string; body: Buffer | string }>) => number,
): Promise<void> {
  const project = projects.find('proj_demo_house');
  if (!project) return;
  if (publications.bySlug('green-valley')) return;

  try {
    const { files, sceneCount, coverPath } = assemble(project, undefined, 'green-valley');
    const sizeBytes = writeBundle('green-valley', files);
    publications.upsert({
      slug: 'green-valley',
      projectId: project.id,
      title: String(project.name),
      description: String(project.description ?? ''),
      sceneCount,
      coverImage: coverPath ?? undefined,
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sizeBytes,
      views: 0,
    });
    console.log('[seed] published demo tour at /green-valley/');
  } catch (err) {
    // A missing player bundle should not stop the server from starting.
    console.log(
      `[seed] demo tour not published: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }
}
