import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { DATA_DIR, projects, publications } from './store.ts';

/**
 * Studio accounts.
 *
 * Until now every API route was open: anyone who could reach the server could
 * publish, edit or delete any tour and read every captured lead. This closes
 * that, and adds the ownership needed for multiple people to use one instance.
 *
 * Deliberately narrow: email + password, no third-party identity providers, no
 * password reset email (there is no mail service yet — an operator resets via
 * the CLI). Published tours stay public; only the studio is protected.
 */

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'session-secret');
const COOKIE = 'zoomio_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface User {
  id: string;
  email: string;
  name: string;
  /** scrypt, stored as `salt:hash`. */
  passwordHash: string;
  role: 'owner' | 'member';
  createdAt: string;
}

/** What the client is allowed to see — never the hash. */
export type SafeUser = Omit<User, 'passwordHash'>;

function readUsers(): User[] {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')) as User[];
  } catch {
    return [];
  }
}

function writeUsers(list: User[]) {
  const tmp = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, USERS_FILE);
}

function sessionSecret(): string {
  try {
    return fs.readFileSync(SECRET_FILE, 'utf-8');
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    return secret;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  // Constant time: a plain === leaks how much of the hash matched via timing.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sign(userId: string, expiresAt: number): string {
  const sig = crypto
    .createHmac('sha256', sessionSecret())
    .update(`${userId}.${expiresAt}`)
    .digest('hex');
  return `${userId}.${expiresAt}.${sig}`;
}

function readSession(req: Request): User | null {
  const raw = req.headers.cookie;
  if (!raw) return null;

  let token: string | undefined;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) token = decodeURIComponent(v.join('='));
  }
  if (!token) return null;

  const [userId, expiresRaw, sig] = token.split('.');
  const expiresAt = Number(expiresRaw);
  if (!userId || !expiresAt || !sig || Date.now() > expiresAt) return null;

  const expected = crypto
    .createHmac('sha256', sessionSecret())
    .update(`${userId}.${expiresAt}`)
    .digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return readUsers().find((u) => u.id === userId) ?? null;
}

function setSession(res: Response, user: User) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${sign(user.id, expiresAt)}; Path=/; Max-Age=${Math.floor(
      SESSION_TTL_MS / 1000,
    )}; HttpOnly; SameSite=Lax`,
  );
}

function clearSession(res: Response) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

function safe(user: User): SafeUser {
  const { passwordHash, ...rest } = user;
  return rest;
}

/* ── request helpers ── */

export interface AuthedRequest extends Request {
  user?: User;
}

/** Attaches `req.user` when a valid session cookie is present. */
export function attachUser(req: AuthedRequest, _res: Response, next: NextFunction) {
  req.user = readSession(req) ?? undefined;
  next();
}

/** Blocks the request unless signed in. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue' });
  next();
}

export function currentUser(req: Request): User | null {
  return (req as AuthedRequest).user ?? null;
}

export function userCount(): number {
  return readUsers().length;
}

/* ── brute-force throttle ── */

const attempts = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const hits = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  attempts.set(key, hits);
  return hits.length > MAX_ATTEMPTS;
}

/* ── routes ── */

export const authRouter = Router();

/** Lets the UI decide between a first-run setup screen and a login screen. */
authRouter.get('/status', (req, res) => {
  const user = currentUser(req);
  res.json({
    needsSetup: readUsers().length === 0,
    signedIn: Boolean(user),
    user: user ? safe(user) : null,
  });
});

authRouter.post('/signup', (req, res) => {
  const users = readUsers();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const name = String(req.body?.name ?? '').trim() || email.split('@')[0];

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  /*
   * Only the very first account can self-register — that is the operator
   * setting up their own instance. After that, open signup would let anyone
   * on the internet create an account on someone else's studio, so further
   * accounts must be created by a signed-in owner.
   */
  const isFirst = users.length === 0;
  if (!isFirst) {
    const actor = currentUser(req);
    if (!actor || actor.role !== 'owner') {
      return res.status(403).json({ error: 'Only the account owner can add users' });
    }
  }

  if (users.some((u) => u.email === email)) {
    return res.status(409).json({ error: 'That email is already registered' });
  }

  const user: User = {
    id: `usr_${crypto.randomBytes(8).toString('hex')}`,
    email,
    name,
    passwordHash: hashPassword(password),
    role: isFirst ? 'owner' : 'member',
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeUsers(users);

  if (isFirst) {
    // Adopt anything created before accounts existed, so upgrading an existing
    // instance doesn't strand the operator's own projects behind a login they
    // can never satisfy.
    const owned = projects.all().map((p) => (p.ownerId ? p : { ...p, ownerId: user.id }));
    projects.save(owned);

    const pubs = publications.all().map((p) => (p.ownerId ? p : { ...p, ownerId: user.id }));
    publications.save(pubs);

    setSession(res, user);
  }
  res.status(201).json({ user: safe(user) });
});

authRouter.post('/login', (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';

  if (tooManyAttempts(`${ip}:${email}`)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }

  const user = readUsers().find((u) => u.email === email);
  // Same message and roughly the same work either way, so this cannot be used
  // to discover which emails have accounts.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }

  setSession(res, user);
  res.json({ user: safe(user) });
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ message: 'Signed out' });
});

authRouter.get('/users', requireAuth, (req, res) => {
  const actor = currentUser(req)!;
  if (actor.role !== 'owner') return res.status(403).json({ error: 'Owners only' });
  res.json(readUsers().map(safe));
});
