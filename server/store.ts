import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository root — the folder containing `server/`, `src/`, and `dist/`. */
export const APP_ROOT = path.join(__dirname, '..');

export const DATA_DIR = path.join(__dirname, 'data');
export const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
export const PUBLISHED_DIR = path.join(__dirname, 'published');
export const PLAYER_DIST = path.join(__dirname, 'player-dist');

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const PUBLICATIONS_FILE = path.join(DATA_DIR, 'publications.json');

for (const dir of [DATA_DIR, UPLOADS_DIR, PUBLISHED_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

/**
 * Writes via a temp file + rename so a crash mid-write can never leave the
 * database truncated — the whole project list lives in this one file.
 */
function writeJson(file: string, data: unknown) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export interface StoredProject {
  id: string;
  name: string;
  /**
   * Owning account. Optional because projects created before accounts existed
   * have none — those are claimed by the first user to sign up, so an operator
   * upgrading an existing instance doesn't lose their work.
   */
  ownerId?: string;
  [key: string]: unknown;
}

export interface Publication {
  slug: string;
  projectId: string;
  /** Mirrors the project's owner so tour lists can be filtered without a join. */
  ownerId?: string;
  title: string;
  description: string;
  sceneCount: number;
  coverImage?: string;
  publishedAt: string;
  updatedAt: string;
  /** Bytes on disk, so the dashboard can show what a tour costs to host. */
  sizeBytes: number;
  views: number;
}

export const projects = {
  all: (): StoredProject[] => readJson<StoredProject[]>(PROJECTS_FILE, []),
  save: (list: StoredProject[]) => writeJson(PROJECTS_FILE, list),
  find: (id: string) => projects.all().find((p) => p.id === id),
};

export const publications = {
  all: (): Publication[] => readJson<Publication[]>(PUBLICATIONS_FILE, []),
  save: (list: Publication[]) => writeJson(PUBLICATIONS_FILE, list),
  bySlug: (slug: string) => publications.all().find((p) => p.slug === slug),
  byProject: (projectId: string) => publications.all().find((p) => p.projectId === projectId),
  upsert(record: Publication) {
    const list = publications.all();
    const i = list.findIndex((p) => p.slug === record.slug);
    if (i >= 0) list[i] = record;
    else list.push(record);
    publications.save(list);
    return record;
  },
  remove(slug: string) {
    publications.save(publications.all().filter((p) => p.slug !== slug));
  },
  recordView(slug: string) {
    const list = publications.all();
    const found = list.find((p) => p.slug === slug);
    if (!found) return;
    found.views += 1;
    publications.save(list);
  },
};

/** Words that would collide with real routes or read as officially endorsed. */
const RESERVED_SLUGS = new Set([
  'www', 'api', 'admin', 'app', 'mail', 'ftp', 'static', 'assets', 'cdn',
  'dashboard', 'studio', 'login', 'signup', 'account', 'billing', 'support',
  'help', 'docs', 'blog', 'status', 'test', 'staging', 'dev', 'localhost',
  't', 'uploads', 'published', 'tour', 'tours',
]);

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'tour';
}

export function isValidSlug(slug: string): boolean {
  // DNS label rules, since these become real subdomains.
  return /^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])?$/.test(slug) && !slug.includes('--');
}

export function slugAvailable(slug: string, exceptProjectId?: string): boolean {
  if (!isValidSlug(slug) || RESERVED_SLUGS.has(slug)) return false;
  const existing = publications.bySlug(slug);
  return !existing || existing.projectId === exceptProjectId;
}

/** Finds the first free variant of a desired slug (`lobby`, `lobby-2`, …). */
export function uniqueSlug(desired: string, exceptProjectId?: string): string {
  const base = slugify(desired);
  if (slugAvailable(base, exceptProjectId)) return base;
  for (let i = 2; i < 200; i++) {
    const candidate = `${base}-${i}`.slice(0, 48);
    if (slugAvailable(candidate, exceptProjectId)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, 48);
}

export function dirSize(dir: string): number {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
}
