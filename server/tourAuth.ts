import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request, Response } from 'express';
import { DATA_DIR, publications } from './store.ts';

/**
 * Passcode protection for published tours.
 *
 * The realistic use case is a developer who wants to send a tour of an unsold
 * property to specific buyers without it being publicly guessable — so this is
 * a shared per-tour passcode, not user accounts.
 *
 * The gate wraps *every* route that serves a tour, not just its index page.
 * Protecting only the HTML would be theatre: `tour.json` lists every scene and
 * the panoramas sit at predictable asset URLs, so anyone could reconstruct the
 * whole tour by fetching those directly.
 */

const SECRET_FILE = path.join(DATA_DIR, 'cookie-secret');
const COOKIE_PREFIX = 'zoomio_tour_';
/** How long a visitor stays unlocked after entering the passcode. */
const TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Persisted so unlocking survives a restart. Generated on first use rather
 * than shipped as a default, so two deployments never share a signing key.
 */
function serverSecret(): string {
  try {
    return fs.readFileSync(SECRET_FILE, 'utf-8');
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    return secret;
  }
}

/** scrypt with a per-passcode salt; stored as `salt:hash`. */
export function hashPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPasscode(passcode: string, stored: string): boolean {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(passcode, salt, 64).toString('hex');
  // Constant-time compare so response timing doesn't leak the passcode.
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signToken(slug: string, expiresAt: number): string {
  const payload = `${slug}.${expiresAt}`;
  const sig = crypto.createHmac('sha256', serverSecret()).update(payload).digest('hex');
  return `${expiresAt}.${sig}`;
}

function tokenValid(slug: string, token: string | undefined): boolean {
  if (!token) return false;
  const [expiresRaw, sig] = token.split('.');
  const expiresAt = Number(expiresRaw);
  if (!expiresAt || !sig || Date.now() > expiresAt) return false;
  const expected = crypto
    .createHmac('sha256', serverSecret())
    .update(`${slug}.${expiresAt}`)
    .digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Minimal cookie reader — avoids pulling in cookie-parser for one header. */
function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function grantAccess(res: Response, slug: string) {
  const expiresAt = Date.now() + TTL_MS;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_PREFIX}${slug}=${signToken(slug, expiresAt)}; Path=/; Max-Age=${Math.floor(
      TTL_MS / 1000,
    )}; HttpOnly; SameSite=Lax`,
  );
}

export function hasAccess(req: Request, slug: string): boolean {
  return tokenValid(slug, readCookie(req, `${COOKIE_PREFIX}${slug}`));
}

/** True when this tour requires a passcode the caller hasn't supplied yet. */
export function isLocked(req: Request, slug: string): boolean {
  const record = publications.bySlug(slug) as { passcodeHash?: string } | undefined;
  if (!record?.passcodeHash) return false;
  return !hasAccess(req, slug);
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/**
 * The unlock screen. Self-contained HTML so it works before any tour asset has
 * loaded, and deliberately reveals only the tour's title.
 */
export function renderGate(slug: string, error?: string): string {
  const record = publications.bySlug(slug);
  const title = escapeHtml(record?.title || 'Private tour');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title} — protected</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
    background:radial-gradient(ellipse at center,#151d2e,#070a11 70%);
    font:400 15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff}
  .card{width:100%;max-width:380px;padding:34px 30px;border-radius:20px;
    background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.12);
    box-shadow:0 18px 50px rgba(0,0,0,.45);text-align:center}
  .lock{font-size:34px;margin-bottom:14px}
  h1{margin:0 0 6px;font-size:19px;font-weight:650;letter-spacing:-.01em}
  p{margin:0 0 22px;font-size:13.5px;opacity:.6}
  input{width:100%;padding:13px 15px;font-size:16px;text-align:center;letter-spacing:.14em;
    color:#fff;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);
    border-radius:11px;outline:none}
  input:focus{border-color:#6366f1}
  button{width:100%;margin-top:12px;padding:13px;font-size:14px;font-weight:650;color:#fff;
    background:#6366f1;border:0;border-radius:11px;cursor:pointer}
  button:hover{filter:brightness(1.1)}
  .err{margin-bottom:14px;padding:9px 12px;font-size:13px;border-radius:9px;
    background:rgba(244,63,94,.16);border:1px solid rgba(244,63,94,.4)}
</style></head><body>
  <form class="card" method="POST" action="/api/tour-auth/${encodeURIComponent(slug)}">
    <div class="lock">&#128274;</div>
    <h1>${title}</h1>
    <p>This tour is private. Enter the passcode to continue.</p>
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
    <input name="passcode" type="password" placeholder="Passcode" autofocus
           autocomplete="off" aria-label="Passcode">
    <button type="submit">Unlock tour</button>
  </form>
</body></html>`;
}
