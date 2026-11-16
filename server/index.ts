import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import { aiRouter, aiEnabled } from './ai.ts';
import { attachUser, authRouter, currentUser, requireAuth } from './auth.ts';
import { leadsRouter } from './leads.ts';
import { grantAccess, renderGate, verifyPasscode } from './tourAuth.ts';
import {
  buildUrls,
  mountTourPathRoutes,
  mountTourRootRoutes,
  publishRouter,
  subdomainTourMiddleware,
  zipTour,
} from './publish.ts';
import {
  APP_ROOT,
  PUBLISHED_DIR,
  UPLOADS_DIR,
  projects,
  publications,
  type StoredProject,
} from './store.ts';

const PORT = Number(process.env.PORT || 5000);
const app = express();

// Credentials must be allowed for the session cookie to survive; a wildcard
// origin would make the browser drop it.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));
app.use(attachUser);

/**
 * Published tours resolve before anything else, so a request to
 * `my-hotel.example.com` never falls through to the studio single-page app.
 */
app.use(subdomainTourMiddleware);
mountTourPathRoutes(app);

app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1h' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 11)}${ext}`);
    },
  }),
  limits: { fileSize: 64 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

/* ────────────────────────────── projects ────────────────────────────── */

app.use('/api/auth', authRouter);

/**
 * Everything below is the studio and requires a session. Published tours are
 * mounted above this line and stay public — that is the whole point of them.
 */
app.get('/api/projects', requireAuth, (req, res) => {
  const me = currentUser(req)!;
  res.json(projects.all().filter((p) => p.ownerId === me.id));
});

/** Fetches a project only if the caller owns it. */
function ownedProject(req: express.Request, id: string): StoredProject | null {
  const me = currentUser(req);
  if (!me) return null;
  const project = projects.find(id);
  // Same null for "missing" and "someone else's", so the API can't be used to
  // probe which project ids exist.
  return project && project.ownerId === me.id ? project : null;
}

app.get('/api/projects/:id', requireAuth, (req, res) => {
  const project = ownedProject(req, req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

app.post('/api/projects', requireAuth, (req, res) => {
  const list = projects.all();
  const me = currentUser(req)!;
  const now = new Date().toISOString();
  const id = req.body?.id || `proj_${Date.now().toString(36)}`;

  /*
   * Upsert rather than blind insert.
   *
   * This used to unshift unconditionally, so re-sending an existing id created
   * a second record sharing that id. Every later lookup uses find()/findIndex()
   * and resolves to whichever copy happens to sit first, which meant edits were
   * saved to one copy and published from another — the tour appeared to ignore
   * changes entirely.
   */
  const existing = list.findIndex((p) => p.id === id);
  if (existing >= 0) {
    if (list[existing].ownerId && list[existing].ownerId !== me.id) {
      // Someone else already owns this id; never let a POST take it over.
      return res.status(409).json({ error: 'A project with that id already exists' });
    }
    const merged: StoredProject = {
      ...list[existing],
      ...req.body,
      id,
      ownerId: list[existing].ownerId ?? me.id,
      createdAt: list[existing].createdAt ?? now,
      updatedAt: now,
    };
    list[existing] = merged;
    projects.save(list);
    return res.status(200).json(merged);
  }

  const project: StoredProject = {
    ...req.body,
    id,
    // Never trust a client-supplied owner.
    ownerId: me.id,
    createdAt: now,
    updatedAt: now,
  };
  list.unshift(project);
  projects.save(list);
  res.status(201).json(project);
});

app.put('/api/projects/:id', requireAuth, (req, res) => {
  if (!ownedProject(req, req.params.id)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const list = projects.all();
  const index = list.findIndex((p) => p.id === req.params.id);

  const updated: StoredProject = {
    ...list[index],
    ...req.body,
    id: list[index].id,
    // Ownership is not editable through the API.
    ownerId: list[index].ownerId,
    updatedAt: new Date().toISOString(),
  };
  list[index] = updated;
  projects.save(list);
  res.json(updated);
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
  if (!ownedProject(req, req.params.id)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const list = projects.all();
  projects.save(list.filter((p) => p.id !== req.params.id));

  // Take the tour offline too — leaving it live after the project is deleted
  // would strand content the user believes they removed.
  const published = publications.byProject(req.params.id);
  if (published) {
    fs.rmSync(path.join(PUBLISHED_DIR, published.slug), { recursive: true, force: true });
    publications.remove(published.slug);
  }
  res.json({ message: 'Project deleted', unpublished: Boolean(published) });
});

app.post('/api/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  res.json({
    url: `/uploads/${req.file.filename}`,
    fileName: req.file.filename,
    fileSize: req.file.size,
  });
});

/* ─────────────────────────── AI + publishing ────────────────────────── */

app.use('/api/ai', requireAuth, aiRouter);
app.use('/api/publish', publishRouter);
// Note: the POST route inside is intentionally public (visitors submit
// enquiries); the read routes enforce ownership themselves.
app.use('/api/leads', leadsRouter);

/**
 * Unlock a passcode-protected tour. Posted to by the gate page, which is a
 * plain HTML form, so this accepts urlencoded bodies and redirects rather
 * than returning JSON.
 */
app.post('/api/tour-auth/:slug', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const record = publications.bySlug(slug) as { passcodeHash?: string } | undefined;
  if (!record) return res.status(404).send('Unknown tour');

  const supplied = String(req.body?.passcode ?? '');
  if (!record.passcodeHash || !verifyPasscode(supplied, record.passcodeHash)) {
    return res.status(401).type('html').send(renderGate(slug, 'Incorrect passcode. Try again.'));
  }

  grantAccess(res, slug);
  // Back to wherever they came from; the bare path always resolves.
  res.redirect(303, `/${slug}/`);
});

/** Download the tour as a self-contained ZIP — the same bundle we host. */
app.post('/api/export/:projectId', requireAuth, async (req, res) => {
  const project = ownedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const zip = await zipTour(project, `${proto}://${req.get('host')}`);
    const base =
      String(project.name || 'virtual')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'virtual';

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-tour.zip"`);
    res.setHeader('Content-Length', String(zip.length));
    res.send(zip);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to build the tour package',
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    ai: aiEnabled(),
    publishedTours: publications.all().length,
    exampleUrls: buildUrls(req, 'your-tour-name'),
  });
});

/* ───────────────────────── studio app (production) ──────────────────── */

const CLIENT_DIST = path.join(APP_ROOT, 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
}

// Bare `/<slug>/` tours resolve after the studio's own static assets (so a
// tour can never shadow index.html or /assets) but before the SPA catch-all
// (so an unknown slug still lands in the studio).
mountTourRootRoutes(app);

if (fs.existsSync(CLIENT_DIST)) {
  app.get('*', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(
    `[server] AI authoring: ${aiEnabled() ? 'enabled' : 'disabled (set ANTHROPIC_API_KEY)'}`,
  );
  console.log(`[server] published tours: http://<slug>.localhost:${PORT}/  or  /t/<slug>/`);
});
