import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express, { Router, type Request, type Response, type NextFunction } from 'express';
import JSZip from 'jszip';
import { grantAccess, hashPasscode, isLocked, renderGate, verifyPasscode } from './tourAuth.ts';
import { currentUser, requireAuth } from './auth.ts';
import {
  APP_ROOT,
  PLAYER_DIST,
  PUBLISHED_DIR,
  UPLOADS_DIR,
  dirSize,
  projects,
  publications,
  slugAvailable,
  uniqueSlug,
  type Publication,
  type StoredProject,
} from './store.ts';

/**
 * A published tour and a downloaded tour are byte-for-byte the same bundle.
 * That is the whole point of assembling once here: whatever a visitor sees on
 * the hosted subdomain is exactly what lands in the customer's ZIP, so the
 * download can never silently drift into a broken or stubbed-out player.
 */

const PUBLIC_DIR = path.join(APP_ROOT, 'public');

interface Scene {
  id: string;
  name: string;
  imageUrl: string;
  hotspots?: unknown[];
  narrationText?: string;
  [key: string]: unknown;
}

type BundleFile = { name: string; body: Buffer | string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Resolves a scene image to raw bytes regardless of how it was supplied. */
function readSceneImage(imageUrl: string): { buffer: Buffer; ext: string } | null {
  if (imageUrl.startsWith('data:')) {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(imageUrl);
    if (!match) return null;
    const ext = (match[1].split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    return { buffer: Buffer.from(match[2], 'base64'), ext };
  }

  let diskPath: string | null = null;
  if (imageUrl.startsWith('/uploads/')) {
    diskPath = path.join(UPLOADS_DIR, path.basename(imageUrl));
  } else if (imageUrl.startsWith('/')) {
    // Sample panoramas and anything else served from the app's public folder.
    const candidate = path.normalize(path.join(PUBLIC_DIR, imageUrl));
    if (candidate.startsWith(PUBLIC_DIR)) diskPath = candidate;
  }

  if (!diskPath || !fs.existsSync(diskPath)) return null;
  return {
    buffer: fs.readFileSync(diskPath),
    ext: (path.extname(diskPath).slice(1) || 'jpg').replace('jpeg', 'jpg'),
  };
}

function playerAssets(): BundleFile[] {
  if (!fs.existsSync(PLAYER_DIST)) {
    throw new Error(
      'Player bundle is missing. Run `npm run build:player` before publishing.',
    );
  }
  const files: BundleFile[] = [];
  for (const name of fs.readdirSync(PLAYER_DIST)) {
    const full = path.join(PLAYER_DIST, name);
    if (fs.statSync(full).isFile()) files.push({ name, body: fs.readFileSync(full) });
  }
  if (!files.some((f) => f.name === 'player.js')) {
    throw new Error('Player bundle is incomplete (player.js not found).');
  }
  return files;
}

function buildIndexHtml(project: StoredProject, coverPath: string | null): string {
  const title = String(project.name || 'Virtual Tour');
  const description = String(
    project.description || `Explore ${title} in an interactive 360° virtual tour.`,
  );
  const theme = (project.theme ?? {}) as Record<string, string>;
  const primary = theme.primaryColor || String(project.primaryColor || '#2563eb');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)} — 360° Virtual Tour</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="${escapeHtml(primary)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${coverPath ? `<meta property="og:image" content="${escapeHtml(coverPath)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="./player.css">
<script type="application/ld+json">
${JSON.stringify(
  {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: title,
    description,
    ...(project.location ? { address: String(project.location) } : {}),
  },
  null,
  2,
)}
</script>
</head>
<body>
<div id="tour"></div>
<noscript>
  <p style="font:16px/1.5 system-ui;padding:2rem;text-align:center">
    This 360° virtual tour needs JavaScript enabled.
  </p>
</noscript>
<script src="./player.js"></script>
</body>
</html>`;
}

/** Produces the complete static tour: HTML, player, data, and image assets. */
export function assembleTour(
  project: StoredProject,
  /**
   * Absolute origin this tour should send enquiries back to. Baked in at
   * publish time so a downloaded ZIP hosted on someone else's server still
   * delivers leads here, instead of posting to a relative path that doesn't
   * exist there.
   */
  apiBase?: string,
  slug?: string,
): {
  files: BundleFile[];
  sceneCount: number;
  coverPath: string | null;
} {
  const files: BundleFile[] = [];
  const scenes = ((project.scenes as Scene[]) ?? []).map((s) => ({ ...s }));

  let coverPath: string | null = null;
  const seen = new Map<string, string>();

  scenes.forEach((scene, index) => {
    const original = scene.imageUrl;
    if (!original) return;

    // Two scenes can legitimately share one panorama; store the bytes once.
    const cached = seen.get(original);
    if (cached) {
      scene.imageUrl = cached;
      return;
    }

    if (/^https?:\/\//i.test(original)) return; // already remote, leave it alone

    const image = readSceneImage(original);
    if (!image) return;

    // The content hash is what makes immutable caching safe: swap a scene's
    // panorama and the filename changes, so no visitor can be served the old
    // image from cache after a republish.
    const hash = crypto.createHash('sha1').update(image.buffer).digest('hex').slice(0, 10);
    const assetName = `assets/scene-${index + 1}-${scene.id}-${hash}.${image.ext}`.replace(
      /[^a-zA-Z0-9._/-]/g,
      '',
    );
    files.push({ name: assetName, body: image.buffer });
    seen.set(original, assetName);
    scene.imageUrl = assetName;
    if (!coverPath) coverPath = assetName;
  });

  // Floor plan images live outside the scene list, so they need the same
  // copy-and-rewrite treatment — otherwise a published tour points its minimap
  // at an /uploads/ path that does not exist inside the bundle.
  interface PlanLike { id?: string; name?: string; imageUrl?: string; markers?: unknown[] }
  const floorPlans = ((project.floorPlans as PlanLike[]) ?? []).map((plan, index) => {
    const original = plan?.imageUrl;
    if (!original || /^https?:\/\//i.test(original)) return plan;

    const cached = seen.get(original);
    if (cached) return { ...plan, imageUrl: cached };

    const image = readSceneImage(original);
    if (!image) return plan;

    const hash = crypto.createHash('sha1').update(image.buffer).digest('hex').slice(0, 10);
    const assetName = `assets/floorplan-${index + 1}-${hash}.${image.ext}`.replace(
      /[^a-zA-Z0-9._/-]/g,
      '',
    );
    files.push({ name: assetName, body: image.buffer });
    seen.set(original, assetName);
    return { ...plan, imageUrl: assetName };
  });

  const tourData = {
    id: project.id,
    name: project.name,
    description: project.description ?? '',
    location: project.location ?? '',
    category: project.category ?? 'other',
    logo: project.logo ?? null,
    theme: project.theme ?? { primaryColor: project.primaryColor ?? '#2563eb' },
    accessibility: project.accessibility ?? null,
    floorPlans,
    scenes,
    // Enquiry capture. Disabled unless the tour was published (a ZIP built
    // before first publish has nowhere to send leads).
    leads:
      apiBase && slug
        ? {
            enabled: (project.leadCapture as { enabled?: boolean })?.enabled !== false,
            endpoint: `${apiBase}/api/leads/${slug}`,
            headline:
              (project.leadCapture as { headline?: string })?.headline ||
              'Interested in this property?',
            buttonText:
              (project.leadCapture as { buttonText?: string })?.buttonText || 'Enquire now',
          }
        : null,
    generatedAt: new Date().toISOString(),
  };

  files.push({ name: 'tour.json', body: JSON.stringify(tourData, null, 2) });
  files.push({ name: 'index.html', body: buildIndexHtml(project, coverPath) });
  files.push(...playerAssets());

  return { files, sceneCount: scenes.length, coverPath };
}

export async function zipTour(project: StoredProject, apiBase?: string): Promise<Buffer> {
  // A downloaded tour can still deliver enquiries back here, but only once the
  // project has a published slug to attribute them to.
  const published = publications.byProject(project.id);
  const { files } = assembleTour(project, published ? apiBase : undefined, published?.slug);
  const zip = new JSZip();
  for (const file of files) zip.file(file.name, file.body);

  zip.file(
    'README.txt',
    [
      `${project.name} — 360° Virtual Tour`,
      '='.repeat(48),
      '',
      'HOW TO VIEW',
      '  This tour needs to be served over http(s); opening index.html straight',
      '  from the file system will fail because browsers block fetch() on file://.',
      '',
      '  Quickest local check (Python 3):',
      '    cd into this folder, then:  python -m http.server 8000',
      '    open http://localhost:8000',
      '',
      'HOW TO HOST',
      '  Upload the entire folder to any static host — Netlify, Vercel, GitHub',
      '  Pages, S3, or plain nginx/Apache. No server-side code is required.',
      '',
      'CONTROLS',
      '  Drag            look around',
      '  Scroll / pinch  zoom',
      '  Arrow keys      look around      +/-  zoom',
      '  Page Up/Down    previous / next scene',
      '  Click a marker  travel or open its content',
      '',
      `Generated ${new Date().toLocaleString()}`,
    ].join('\n'),
  );

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Every file path under `dir`, relative to it and using forward slashes. */
function listRelativeFiles(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listRelativeFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/**
 * Writes the bundle directly into its live directory rather than staging and
 * renaming. Directory renames on Windows intermittently fail with EPERM when a
 * virus scanner still holds a handle on a just-written file, which would make
 * publishing randomly unreliable on the machine this runs on. Writing in place
 * and then pruning whatever is no longer part of the bundle keeps republishes
 * clean without depending on rename succeeding.
 */
function writeBundle(slug: string, files: BundleFile[]): number {
  const target = path.join(PUBLISHED_DIR, slug);
  fs.mkdirSync(target, { recursive: true });

  const written = new Set<string>();
  for (const file of files) {
    const rel = file.name.split(path.sep).join('/');
    const dest = path.join(target, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, file.body);
    written.add(rel);
  }

  // Drop assets from a previous publish that this one no longer references,
  // so a renamed or deleted scene doesn't leave its panorama on disk forever.
  for (const rel of listRelativeFiles(target)) {
    if (!written.has(rel)) fs.rmSync(path.join(target, rel), { force: true });
  }

  return dirSize(target);
}

/* ─────────────────────────── routes ─────────────────────────── */

/**
 * Strips secrets before a publication record leaves the server.
 *
 * The passcode hash must never be returned: scrypt is not reversible, but
 * handing an attacker the salt and hash lets them brute-force offline at their
 * own pace. Callers get a boolean instead, which is all the UI needs.
 */
function publicRecord(record: Publication & { passcodeHash?: string }) {
  const { passcodeHash, ...rest } = record;
  return { ...rest, protected: Boolean(passcodeHash) };
}

export const publishRouter = Router();

publishRouter.get('/slug-available/:slug', requireAuth, (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
  res.json({ slug, available: slugAvailable(slug, projectId) });
});

// Both read endpoints attach the live URLs. They depend on the request's host,
// so they can't be stored on the record — and without them the studio can only
// show the /t/<slug> fallback rather than the subdomain meant for sharing.
publishRouter.get('/', requireAuth, (req, res) => {
  const me = currentUser(req)!;
  res.json(
    publications
      .all()
      .filter((p) => p.ownerId === me.id)
      .map((p) => ({ ...publicRecord(p), urls: buildUrls(req, p.slug) })),
  );
});

publishRouter.get('/project/:projectId', requireAuth, (req, res) => {
  const me = currentUser(req)!;
  const record = publications.byProject(req.params.projectId);
  if (!record || record.ownerId !== me.id) {
    return res.status(404).json({ error: 'This project is not published' });
  }
  res.json({ ...publicRecord(record), urls: buildUrls(req, record.slug) });
});

/** Publishes (or re-publishes) a project and returns its shareable URLs. */
publishRouter.post('/:projectId', requireAuth, async (req, res) => {
  const me = currentUser(req)!;
  const project = projects.find(req.params.projectId);
  if (!project || project.ownerId !== me.id) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const existing = publications.byProject(project.id);
  const requested = String(req.body?.slug || '').toLowerCase().trim();

  let slug: string;
  if (requested) {
    if (!slugAvailable(requested, project.id)) {
      return res.status(409).json({
        error: 'That address is already taken or not allowed',
        suggestion: uniqueSlug(requested, project.id),
      });
    }
    slug = requested;
  } else {
    slug = existing?.slug ?? uniqueSlug(String(project.name || 'tour'), project.id);
  }

  try {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const apiBase = `${proto}://${req.get('host')}`;
    const { files, sceneCount, coverPath } = assembleTour(project, apiBase, slug);
    const sizeBytes = writeBundle(slug, files);

    // A renamed tour should not leave its old address serving stale content.
    if (existing && existing.slug !== slug) {
      fs.rmSync(path.join(PUBLISHED_DIR, existing.slug), { recursive: true, force: true });
      publications.remove(existing.slug);
    }

    const record: Publication = {
      slug,
      projectId: project.id,
      ownerId: me.id,
      title: String(project.name || 'Virtual Tour'),
      description: String(project.description || ''),
      sceneCount,
      coverImage: coverPath ?? undefined,
      publishedAt: existing?.publishedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sizeBytes,
      views: existing?.views ?? 0,
    };
    publications.upsert(record);

    res.status(201).json({ ...publicRecord(record), urls: buildUrls(req, slug) });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to publish tour',
    });
  }
});

/**
 * Set or clear a tour's passcode. Sending an empty string removes protection.
 * Only the hash is ever stored, and it is never returned by the read routes.
 */
publishRouter.post('/:slug/passcode', requireAuth, (req, res) => {
  const me = currentUser(req)!;
  const record = publications.bySlug(req.params.slug);
  if (!record || record.ownerId !== me.id) {
    return res.status(404).json({ error: 'Not published' });
  }

  const passcode = String(req.body?.passcode ?? '');
  if (passcode && passcode.length < 4) {
    return res.status(400).json({ error: 'Use at least 4 characters' });
  }

  const list = publications.all();
  const found = list.find((p) => p.slug === record.slug) as
    | (Publication & { passcodeHash?: string })
    | undefined;
  if (!found) return res.status(404).json({ error: 'Not published' });

  if (passcode) found.passcodeHash = hashPasscode(passcode);
  else delete found.passcodeHash;
  publications.save(list);

  res.json({ slug: record.slug, protected: Boolean(passcode) });
});

publishRouter.delete('/:slug', requireAuth, (req, res) => {
  const me = currentUser(req)!;
  const record = publications.bySlug(req.params.slug);
  if (!record || record.ownerId !== me.id) {
    return res.status(404).json({ error: 'Not published' });
  }
  fs.rmSync(path.join(PUBLISHED_DIR, record.slug), { recursive: true, force: true });
  publications.remove(record.slug);
  res.json({ message: 'Tour unpublished' });
});

/**
 * Both addresses work everywhere; the subdomain is the nice one to share and
 * the path form is the guaranteed fallback when wildcard DNS isn't set up yet.
 */
export function buildUrls(req: Request, slug: string) {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.get('host') || 'localhost';
  const [hostname, port] = host.split(':');

  // Strip any leading tour label so re-publishing from a tour page still
  // produces the apex host rather than nesting subdomains.
  const labels = hostname.split('.');
  const apex =
    labels.length > 2 || (labels.length === 2 && labels[1] === 'localhost')
      ? labels.slice(1).join('.')
      : hostname;

  const suffix = port ? `:${port}` : '';
  return {
    subdomain: `${proto}://${slug}.${apex}${suffix}/`,
    /** Shortest link, and the one that needs no DNS setup whatsoever. */
    root: `${proto}://${host}/${slug}/`,
    path: `${proto}://${host}/t/${slug}/`,
  };
}

/* ─────────────────────── serving published tours ─────────────────────── */

function tourDir(slug: string): string | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const dir = path.join(PUBLISHED_DIR, slug);
  return fs.existsSync(dir) ? dir : null;
}

const staticCache = new Map<string, express.RequestHandler>();
function staticFor(dir: string): express.RequestHandler {
  let handler = staticCache.get(dir);
  if (!handler) {
    handler = express.static(dir, {
      etag: true,
      lastModified: true,
      setHeaders(res, filePath) {
        // Panorama filenames carry a content hash, so they can be cached
        // forever. Everything else keeps a stable name and must revalidate,
        // otherwise a republished tour would keep serving the old player and
        // the old scene list until caches expired on their own.
        const isHashedAsset = filePath.includes(`${path.sep}assets${path.sep}`);
        res.setHeader(
          'Cache-Control',
          isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
    staticCache.set(dir, handler);
  }
  return handler;
}

/**
 * Single entry point for serving a tour, used by all three URL forms.
 *
 * Centralised on purpose: the passcode check has to cover the panoramas and
 * tour.json as well as index.html, and three separate copies of this logic
 * would eventually disagree — leaving one route serving protected content.
 */
function serveTour(
  req: Request,
  res: Response,
  next: NextFunction,
  slug: string,
  dir: string,
  isIndex: boolean,
) {
  if (isLocked(req, slug)) {
    // 401 rather than 200 so crawlers and link previews don't index the gate
    // as if it were the tour.
    return res.status(401).type('html').send(renderGate(slug));
  }
  if (isIndex) publications.recordView(slug);
  return staticFor(dir)(req, res, () => {
    // Unknown path inside a tour: hand back the player rather than a 404.
    res.sendFile(path.join(dir, 'index.html'));
  });
}

/**
 * Resolves `<slug>.example.com` to a published tour. Works out of the box on
 * `<slug>.localhost:PORT`; in production point a wildcard `*.example.com`
 * A-record at this server and it serves the same content with no code change.
 */
export function subdomainTourMiddleware(req: Request, res: Response, next: NextFunction) {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  const labels = host.split('.');

  // Needs at least `<slug>.<something>`; bare `localhost` or an apex domain
  // falls through to the studio app.
  if (labels.length < 2) return next();
  const slug = labels[0];
  if (slug === 'www' || !publications.bySlug(slug)) return next();

  const dir = tourDir(slug);
  if (!dir) return next();

  return serveTour(req, res, next, slug, dir, req.path === '/' || req.path === '');
}

export function mountTourPathRoutes(app: express.Express) {
  app.get('/t/:slug', (req, res, next) => {
    if (!tourDir(req.params.slug)) return next();
    // Express matches `/t/slug` and `/t/slug/` to the same route, so redirect
    // only when the trailing slash is genuinely absent — otherwise this
    // redirects to itself forever. The slash matters because the player loads
    // ./player.js and ./tour.json relative to the current URL.
    const pathname = req.originalUrl.split('?')[0];
    if (pathname.endsWith('/')) return next();
    const query = req.originalUrl.slice(pathname.length);
    res.redirect(301, `/t/${req.params.slug}/${query}`);
  });

  app.use('/t/:slug', (req, res, next) => {
    const dir = tourDir(req.params.slug);
    if (!dir) return next();
    return serveTour(req, res, next, req.params.slug, dir, req.path === '/');
  });
}

/**
 * Serves a tour at the bare path `/<slug>/` — the shortest shareable link that
 * needs no DNS at all, e.g. `localhost:5050/my-hotel`.
 *
 * MUST be mounted after the API routes and the studio's static assets but
 * before the single-page-app catch-all: an unknown slug falls through to
 * `next()`, so the studio still handles its own routes. Slugs that would
 * shadow real paths (`api`, `assets`, `t`, …) are blocked at publish time by
 * RESERVED_SLUGS, and anything containing a dot (`favicon.svg`) fails the slug
 * pattern and is ignored here.
 */
export function mountTourRootRoutes(app: express.Express) {
  app.get('/:slug', (req, res, next) => {
    if (!tourDir(req.params.slug)) return next();
    const pathname = req.originalUrl.split('?')[0];
    if (pathname.endsWith('/')) return next();
    const query = req.originalUrl.slice(pathname.length);
    res.redirect(301, `/${req.params.slug}/${query}`);
  });

  app.use('/:slug', (req, res, next) => {
    const dir = tourDir(req.params.slug);
    if (!dir) return next();
    return serveTour(req, res, next, req.params.slug, dir, req.path === '/');
  });
}
