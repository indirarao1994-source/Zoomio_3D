import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { DATA_DIR, publications } from './store.ts';
import { currentUser, requireAuth } from './auth.ts';

/**
 * Enquiry capture for published tours.
 *
 * A virtual tour for a property, school, or hotel exists to produce enquiries,
 * so the tour itself collects them rather than sending visitors off to a
 * separate contact page.
 *
 * This handles personal data (name, phone, email), so a few things are
 * deliberate: consent is recorded with each lead, fields are length-capped,
 * submissions are rate limited per IP, and nothing is echoed back publicly.
 */

const LEADS_FILE = path.join(DATA_DIR, 'leads.json');

export interface Lead {
  id: string;
  slug: string;
  name: string;
  phone: string;
  email: string;
  message: string;
  /** Scene the visitor was viewing when they submitted. */
  sceneName: string;
  /** Explicit consent to be contacted — required, and stored for the record. */
  consent: boolean;
  createdAt: string;
  /** Coarse source info; deliberately not storing full IP or fingerprints. */
  referrer: string;
}

function readLeads(): Lead[] {
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8')) as Lead[];
  } catch {
    return [];
  }
}

function writeLeads(list: Lead[]) {
  const tmp = `${LEADS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, LEADS_FILE);
}

/** Trim + hard cap so a hostile submitter can't bloat the store. */
function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Simple in-memory throttle: a published tour is public, so the endpoint is
// unauthenticated by necessity. Resets on restart, which is acceptable for the
// abuse level this attracts.
const recent = new Map<string, number[]>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 8;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  recent.set(key, hits);
  // Keep the map from growing without bound on a long-running server.
  if (recent.size > 5000) {
    for (const [k, v] of recent) {
      if (v.every((t) => now - t >= WINDOW_MS)) recent.delete(k);
    }
  }
  return hits.length > MAX_PER_WINDOW;
}

export const leadsRouter = Router();

/** Public: a visitor submits an enquiry from a published tour. */
leadsRouter.post('/:slug', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!publications.bySlug(slug)) {
    return res.status(404).json({ error: 'Unknown tour' });
  }

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
  if (rateLimited(`${slug}:${ip}`)) {
    return res.status(429).json({ error: 'Too many enquiries from here. Please try later.' });
  }

  const name = clean(req.body?.name, 120);
  const phone = clean(req.body?.phone, 32);
  const email = clean(req.body?.email, 160);
  const consent = req.body?.consent === true;

  if (!name) return res.status(400).json({ error: 'Please enter your name' });
  if (!phone && !email) {
    return res.status(400).json({ error: 'Please give a phone number or an email address' });
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'That email address does not look right' });
  }
  if (!consent) {
    return res.status(400).json({ error: 'Please agree to be contacted' });
  }

  const lead: Lead = {
    id: `ld_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    slug,
    name,
    phone,
    email,
    message: clean(req.body?.message, 1000),
    sceneName: clean(req.body?.sceneName, 120),
    consent,
    createdAt: new Date().toISOString(),
    referrer: clean(req.headers.referer, 200),
  };

  const list = readLeads();
  list.unshift(lead);
  writeLeads(list);

  res.status(201).json({ message: 'Thanks — we will be in touch shortly.' });
});

/**
 * Studio: list enquiries for a tour.
 *
 * Signed-in and owner-scoped: these are names, phone numbers and email
 * addresses supplied by members of the public, so only the person who owns the
 * tour may read them.
 */
leadsRouter.get('/:slug', requireAuth, (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const me = currentUser(req)!;
  const tour = publications.bySlug(slug);
  if (!tour || tour.ownerId !== me.id) {
    return res.status(404).json({ error: 'Tour not found' });
  }
  res.json(readLeads().filter((l) => l.slug === slug));
});

leadsRouter.delete('/:slug/:id', requireAuth, (req, res) => {
  const me = currentUser(req)!;
  const tour = publications.bySlug(String(req.params.slug || '').toLowerCase());
  if (!tour || tour.ownerId !== me.id) {
    return res.status(404).json({ error: 'Tour not found' });
  }
  const list = readLeads();
  const next = list.filter((l) => !(l.slug === req.params.slug && l.id === req.params.id));
  if (next.length === list.length) return res.status(404).json({ error: 'Lead not found' });
  writeLeads(next);
  res.json({ message: 'Lead deleted' });
});

/** Counts per slug, so the dashboard can badge tours without loading everything. */
export function leadCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const lead of readLeads()) counts[lead.slug] = (counts[lead.slug] ?? 0) + 1;
  return counts;
}
