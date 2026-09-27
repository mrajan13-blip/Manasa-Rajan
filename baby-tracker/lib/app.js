import { readFile } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transaction } from './db.js';
import {
  hashPassword, verifyPassword, newToken, hashToken, newInviteCode, parseCookies, createRateLimiter,
} from './auth.js';
import { HttpError, bad, text, isoDate, isoTime, validateEvent } from './validate.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const SESSION_COOKIE = 'bt_session';
const SESSION_DAYS = 90;
const INVITE_DAYS = 7;
const MAX_BODY = 64 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

const now = () => new Date().toISOString();
const daysFromNow = (d) => new Date(Date.now() + d * 86400000).toISOString();

export function createApp({ db, secureCookies = false, trustProxy = false }) {
  const authLimiter = createRateLimiter({ limit: 20, windowMs: 15 * 60 * 1000 });

  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userBySession: db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                               WHERE s.token_hash = ? AND s.expires_at > ?`),
    insertFamily: db.prepare('INSERT INTO families (created_at) VALUES (?)'),
    insertUser: db.prepare(`INSERT INTO users (email, name, password_hash, family_id, created_at)
                            VALUES (?, ?, ?, ?, ?)`),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    members: db.prepare('SELECT id, name, email FROM users WHERE family_id = ? ORDER BY id'),
    children: db.prepare('SELECT id, name, birth_date, sex FROM children WHERE family_id = ? ORDER BY id'),
    child: db.prepare('SELECT * FROM children WHERE id = ? AND family_id = ?'),
    insertChild: db.prepare('INSERT INTO children (family_id, name, birth_date, sex, created_at) VALUES (?, ?, ?, ?, ?)'),
    updateChild: db.prepare('UPDATE children SET name = ?, birth_date = ?, sex = ? WHERE id = ?'),
    deleteChild: db.prepare('DELETE FROM children WHERE id = ?'),
    updateUser: db.prepare('UPDATE users SET name = ?, units = ? WHERE id = ?'),
    moveUser: db.prepare('UPDATE users SET family_id = ? WHERE id = ?'),
    countChildren: db.prepare('SELECT COUNT(*) AS n FROM children WHERE family_id = ?'),
    countMembers: db.prepare('SELECT COUNT(*) AS n FROM users WHERE family_id = ?'),
    deleteFamily: db.prepare('DELETE FROM families WHERE id = ?'),
    insertInvite: db.prepare('INSERT INTO invites (code, family_id, created_by, expires_at) VALUES (?, ?, ?, ?)'),
    invite: db.prepare('SELECT * FROM invites WHERE code = ? AND used_by IS NULL AND expires_at > ?'),
    useInvite: db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?'),
    event: db.prepare(`SELECT e.* FROM events e JOIN children c ON c.id = e.child_id
                       WHERE e.id = ? AND c.family_id = ?`),
    events: db.prepare(`SELECT e.*, u.name AS created_by_name FROM events e
                        LEFT JOIN users u ON u.id = e.created_by
                        WHERE e.child_id = ? AND e.start_at >= ? AND e.start_at < ?
                          AND (? IS NULL OR e.type = ?)
                        ORDER BY e.start_at DESC LIMIT ?`),
    ongoingSleep: db.prepare(`SELECT id FROM events WHERE child_id = ? AND type = 'sleep' AND end_at IS NULL
                              AND id IS NOT ?`),
    insertEvent: db.prepare(`INSERT INTO events (child_id, type, start_at, end_at, data, created_by, created_at, updated_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    updateEvent: db.prepare('UPDATE events SET type = ?, start_at = ?, end_at = ?, data = ?, updated_at = ? WHERE id = ?'),
    deleteEvent: db.prepare('DELETE FROM events WHERE id = ?'),
  };

  const eventOut = (e) => ({
    id: e.id,
    childId: e.child_id,
    type: e.type,
    startAt: e.start_at,
    endAt: e.end_at,
    data: JSON.parse(e.data),
    createdBy: e.created_by_name ?? null,
    updatedAt: e.updated_at,
  });
  const childOut = (c) => ({ id: c.id, name: c.name, birthDate: c.birth_date, sex: c.sex });

  function startSession(res, userId) {
    const token = newToken();
    q.purgeSessions.run(now());
    q.insertSession.run(hashToken(token), userId, daysFromNow(SESSION_DAYS));
    setCookie(res, `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}`);
  }

  function setCookie(res, value) {
    res.setHeader('Set-Cookie', `${value}; Path=/; HttpOnly; SameSite=Lax${secureCookies ? '; Secure' : ''}`);
  }

  function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    return token ? q.userBySession.get(hashToken(token), now()) : undefined;
  }

  function requireChild(user, id) {
    const child = q.child.get(Number(id), user.family_id);
    if (!child) throw new HttpError(404, 'Child not found');
    return child;
  }

  function assertSingleOngoingSleep(childId, ev, eventId = null) {
    if (ev.type === 'sleep' && !ev.endAt && q.ongoingSleep.get(childId, eventId)) {
      throw new HttpError(409, 'A sleep is already in progress for this child. End it first.');
    }
  }

  // Moves a user into another family. Only allowed when their current family
  // has no children, so nobody's logs are silently orphaned or merged.
  function joinFamily(user, code) {
    const invite = q.invite.get(String(code || '').trim().toUpperCase(), now());
    if (!invite) throw bad('That invite code is invalid or has expired');
    if (invite.family_id === user.family_id) throw bad('You are already in this family');
    if (q.countChildren.get(user.family_id).n > 0) {
      throw new HttpError(409, 'You already have children in your account. Invite your partner to your family instead.');
    }
    transaction(db, () => {
      const oldFamily = user.family_id;
      q.moveUser.run(invite.family_id, user.id);
      q.useInvite.run(user.id, now(), invite.code);
      if (q.countMembers.get(oldFamily).n === 0) {
        db.prepare('DELETE FROM invites WHERE family_id = ?').run(oldFamily);
        q.deleteFamily.run(oldFamily);
      }
    });
  }

  function me(user) {
    return {
      user: { id: user.id, name: user.name, email: user.email, units: user.units },
      members: q.members.all(user.family_id),
      children: q.children.all(user.family_id).map(childOut),
    };
  }

  const routes = [
    ['POST', /^\/api\/signup$/, { auth: false, limited: true }, ({ body, res }) => {
      const name = text(body.name, 'Name', { max: 80 });
      const email = text(body.email, 'Email', { max: 200 }).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Enter a valid email address');
      const password = typeof body.password === 'string' ? body.password : '';
      if (password.length < 8) throw bad('Password must be at least 8 characters');
      if (q.userByEmail.get(email)) throw new HttpError(409, 'An account with that email already exists');
      const code = body.inviteCode ? String(body.inviteCode).trim().toUpperCase() : null;
      const invite = code ? q.invite.get(code, now()) : null;
      if (code && !invite) throw bad('That invite code is invalid or has expired');

      const userId = transaction(db, () => {
        const familyId = invite ? invite.family_id : Number(q.insertFamily.run(now()).lastInsertRowid);
        const id = Number(q.insertUser.run(email, name, hashPassword(password), familyId, now()).lastInsertRowid);
        if (invite) q.useInvite.run(id, now(), invite.code);
        return id;
      });
      startSession(res, userId);
      return [201, me(db.prepare('SELECT * FROM users WHERE id = ?').get(userId))];
    }],

    ['POST', /^\/api\/login$/, { auth: false, limited: true }, ({ body, res }) => {
      const user = q.userByEmail.get(String(body.email || '').trim().toLowerCase());
      if (!user || !verifyPassword(String(body.password || ''), user.password_hash)) {
        throw new HttpError(401, 'Incorrect email or password');
      }
      startSession(res, user.id);
      return [200, me(user)];
    }],

    ['POST', /^\/api\/logout$/, { auth: false }, ({ req, res }) => {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) q.deleteSession.run(hashToken(token));
      setCookie(res, `${SESSION_COOKIE}=; Max-Age=0`);
      return [200, { ok: true }];
    }],

    ['GET', /^\/api\/me$/, {}, ({ user }) => [200, me(user)]],

    ['PATCH', /^\/api\/me$/, {}, ({ user, body }) => {
      const name = body.name === undefined ? user.name : text(body.name, 'Name', { max: 80 });
      const units = body.units === undefined ? user.units : body.units;
      if (!['metric', 'imperial'].includes(units)) throw bad('units must be metric or imperial');
      q.updateUser.run(name, units, user.id);
      return [200, me({ ...user, name, units })];
    }],

    ['POST', /^\/api\/invites$/, {}, ({ user }) => {
      const code = newInviteCode();
      const expiresAt = daysFromNow(INVITE_DAYS);
      q.insertInvite.run(code, user.family_id, user.id, expiresAt);
      return [201, { code, expiresAt }];
    }],

    ['POST', /^\/api\/invites\/accept$/, {}, ({ user, body }) => {
      joinFamily(user, body.code);
      return [200, me(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id))];
    }],

    ['POST', /^\/api\/children$/, {}, ({ user, body }) => {
      const name = text(body.name, 'Name', { max: 80 });
      const birthDate = isoDate(body.birthDate, 'Birth date');
      if (!['male', 'female'].includes(body.sex)) throw bad('Sex is required for the WHO growth charts');
      const id = Number(q.insertChild.run(user.family_id, name, birthDate, body.sex, now()).lastInsertRowid);
      return [201, childOut(q.child.get(id, user.family_id))];
    }],

    ['PATCH', /^\/api\/children\/(\d+)$/, {}, ({ user, body, params }) => {
      const child = requireChild(user, params[0]);
      const name = body.name === undefined ? child.name : text(body.name, 'Name', { max: 80 });
      const birthDate = body.birthDate === undefined ? child.birth_date : isoDate(body.birthDate, 'Birth date');
      const sex = body.sex === undefined ? child.sex : body.sex;
      if (!['male', 'female'].includes(sex)) throw bad('Sex must be male or female');
      q.updateChild.run(name, birthDate, sex, child.id);
      return [200, childOut(q.child.get(child.id, user.family_id))];
    }],

    ['DELETE', /^\/api\/children\/(\d+)$/, {}, ({ user, params }) => {
      q.deleteChild.run(requireChild(user, params[0]).id);
      return [200, { ok: true }];
    }],

    ['GET', /^\/api\/children\/(\d+)\/events$/, {}, ({ user, params, url }) => {
      const child = requireChild(user, params[0]);
      const from = isoTime(url.searchParams.get('from') || '1970-01-01', 'from');
      const to = isoTime(url.searchParams.get('to') || '9999-12-31', 'to');
      const type = url.searchParams.get('type') || null;
      const limit = Math.min(Number(url.searchParams.get('limit')) || 500, 2000);
      const rows = q.events.all(child.id, from, to, type, type, limit);
      return [200, { events: rows.map(eventOut) }];
    }],

    ['POST', /^\/api\/children\/(\d+)\/events$/, {}, ({ user, params, body }) => {
      const child = requireChild(user, params[0]);
      const ev = validateEvent(body);
      assertSingleOngoingSleep(child.id, ev);
      const t = now();
      const id = Number(q.insertEvent.run(child.id, ev.type, ev.startAt, ev.endAt, JSON.stringify(ev.data), user.id, t, t).lastInsertRowid);
      return [201, eventOut({ ...q.event.get(id, user.family_id), created_by_name: user.name })];
    }],

    ['PATCH', /^\/api\/events\/(\d+)$/, {}, ({ user, params, body }) => {
      const existing = q.event.get(Number(params[0]), user.family_id);
      if (!existing) throw new HttpError(404, 'Entry not found');
      const merged = {
        type: existing.type,
        startAt: existing.start_at,
        endAt: existing.end_at,
        ...body,
        data: { ...JSON.parse(existing.data), ...(body.data || {}) },
      };
      if (merged.type !== existing.type) throw bad('An entry cannot change type');
      const ev = validateEvent(merged);
      assertSingleOngoingSleep(existing.child_id, ev, existing.id);
      q.updateEvent.run(ev.type, ev.startAt, ev.endAt, JSON.stringify(ev.data), now(), existing.id);
      return [200, eventOut(q.event.get(existing.id, user.family_id))];
    }],

    ['DELETE', /^\/api\/events\/(\d+)$/, {}, ({ user, params }) => {
      const existing = q.event.get(Number(params[0]), user.family_id);
      if (!existing) throw new HttpError(404, 'Entry not found');
      q.deleteEvent.run(existing.id);
      return [200, { ok: true }];
    }],
  ];

  async function readJson(req) {
    if (req.method === 'GET' || req.method === 'HEAD') return {};
    // Requiring a JSON content type blocks cross-site form posts (CSRF) because
    // browsers must preflight it, and we never answer preflights.
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      throw new HttpError(415, 'Expected application/json');
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, 'Request too large');
      chunks.push(chunk);
    }
    if (!size) return {};
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      throw bad('Invalid JSON');
    }
  }

  async function serveStatic(url, res) {
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || !extname(path)) path = '/index.html';
    const file = normalize(join(PUBLIC_DIR, path));
    if (!file.startsWith(PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : PUBLIC_DIR + sep)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  }

  function send(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(payload));
  }

  return async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
        await serveStatic(url, res);
        return;
      }
      for (const [method, pattern, opts, handler] of routes) {
        const match = url.pathname.match(pattern);
        if (!match || method !== req.method) continue;
        if (opts.limited) {
          const ip = (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
          if (!authLimiter(ip)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
        }
        const user = opts.auth === false ? null : currentUser(req);
        if (opts.auth !== false && !user) throw new HttpError(401, 'Please sign in');
        const body = await readJson(req);
        const [status, payload] = await handler({ req, res, url, body, user, params: match.slice(1) });
        send(res, status, payload);
        return;
      }
      throw new HttpError(404, 'Not found');
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, { error: err.message });
      } else {
        console.error(err);
        send(res, 500, { error: 'Something went wrong' });
      }
    }
  };
}
