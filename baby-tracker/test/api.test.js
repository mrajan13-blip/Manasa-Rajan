import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../lib/db.js';
import { createApp } from '../lib/app.js';

let server;
let base;

before(async () => {
  server = createServer(createApp({ db: openDb(':memory:') }));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

// Minimal cookie-keeping client, one per simulated person.
function client() {
  let cookie = '';
  return async (method, path, body, { raw = false } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    if (raw) return res;
    return { status: res.status, body: await res.json() };
  };
}

let n = 0;
const email = () => `parent${++n}@example.com`;

test('signup, add child, invite spouse, and share logs', async () => {
  const mom = client();
  const dad = client();

  let r = await mom('POST', '/api/signup', { name: 'Mom', email: email(), password: 'password123' });
  assert.equal(r.status, 201);
  r = await mom('POST', '/api/children', { name: 'Baby', birthDate: '2026-06-01', sex: 'female' });
  assert.equal(r.status, 201);
  const childId = r.body.id;

  r = await mom('POST', '/api/invites');
  assert.equal(r.status, 201);
  const { code } = r.body;
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  r = await dad('POST', '/api/signup', { name: 'Dad', email: email(), password: 'password123', inviteCode: code.toLowerCase() });
  assert.equal(r.status, 201);
  assert.equal(r.body.children.length, 1);
  assert.equal(r.body.members.length, 2);

  // Dad logs a diaper; mom sees it with his name.
  r = await dad('POST', `/api/children/${childId}/events`, { type: 'diaper', startAt: '2026-09-01T10:00:00Z', data: { kind: 'both' } });
  assert.equal(r.status, 201);
  r = await mom('GET', `/api/children/${childId}/events`);
  assert.equal(r.body.events.length, 1);
  assert.equal(r.body.events[0].createdBy, 'Dad');

  // Invite codes are single use.
  const third = client();
  r = await third('POST', '/api/signup', { name: 'X', email: email(), password: 'password123', inviteCode: code });
  assert.equal(r.status, 400);
});

test('families cannot see each other’s children or events', async () => {
  const a = client();
  const b = client();
  await a('POST', '/api/signup', { name: 'A', email: email(), password: 'password123' });
  await b('POST', '/api/signup', { name: 'B', email: email(), password: 'password123' });
  const kid = (await a('POST', '/api/children', { name: 'Kid', birthDate: '2026-01-01', sex: 'male' })).body;
  const ev = (await a('POST', `/api/children/${kid.id}/events`, { type: 'diaper', startAt: new Date().toISOString(), data: { kind: 'wet' } })).body;

  assert.equal((await b('GET', `/api/children/${kid.id}/events`)).status, 404);
  assert.equal((await b('POST', `/api/children/${kid.id}/events`, { type: 'diaper', startAt: new Date().toISOString(), data: { kind: 'wet' } })).status, 404);
  assert.equal((await b('PATCH', `/api/events/${ev.id}`, { data: { kind: 'dirty' } })).status, 404);
  assert.equal((await b('DELETE', `/api/events/${ev.id}`)).status, 404);
  assert.equal((await b('DELETE', `/api/children/${kid.id}`)).status, 404);
  assert.equal((await b('GET', '/api/me')).body.children.length, 0);
});

test('sleep timer: one ongoing sleep at a time, then wake up', async () => {
  const p = client();
  await p('POST', '/api/signup', { name: 'P', email: email(), password: 'password123' });
  const kid = (await p('POST', '/api/children', { name: 'Kid', birthDate: '2026-01-01', sex: 'male' })).body;
  const url = `/api/children/${kid.id}/events`;

  const start = new Date(Date.now() - 3600e3).toISOString();
  const sleep = await p('POST', url, { type: 'sleep', startAt: start });
  assert.equal(sleep.status, 201);
  assert.equal(sleep.body.endAt, null);
  assert.equal((await p('POST', url, { type: 'sleep', startAt: new Date().toISOString() })).status, 409);

  const woke = await p('PATCH', `/api/events/${sleep.body.id}`, { endAt: new Date().toISOString() });
  assert.equal(woke.status, 200);
  assert.ok(woke.body.endAt);
  assert.equal((await p('PATCH', `/api/events/${sleep.body.id}`, { endAt: '2000-01-01T00:00:00Z' })).status, 400);
});

test('validates feeds, diapers and growth', async () => {
  const p = client();
  await p('POST', '/api/signup', { name: 'P', email: email(), password: 'password123' });
  const kid = (await p('POST', '/api/children', { name: 'Kid', birthDate: '2026-01-01', sex: 'female' })).body;
  const url = `/api/children/${kid.id}/events`;
  const t = new Date().toISOString();

  let r = await p('POST', url, { type: 'feed', startAt: t, endAt: t, data: { method: 'breast', leftSeconds: 600, rightSeconds: 300, lastSide: 'right' } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.data, { method: 'breast', leftSeconds: 600, rightSeconds: 300, lastSide: 'right' });

  r = await p('POST', url, { type: 'feed', startAt: t, data: { method: 'bottle', amountMl: 120, contents: 'breast_milk' } });
  assert.equal(r.status, 201);
  // Switching an entry from bottle to breast drops bottle-only fields.
  r = await p('PATCH', `/api/events/${r.body.id}`, { data: { method: 'breast', leftSeconds: 60 } });
  assert.deepEqual(r.body.data, { method: 'breast', leftSeconds: 60 });

  assert.equal((await p('POST', url, { type: 'feed', startAt: t, data: { method: 'bottle' } })).status, 400);
  assert.equal((await p('POST', url, { type: 'diaper', startAt: t, data: { kind: 'maybe' } })).status, 400);
  assert.equal((await p('POST', url, { type: 'growth', startAt: t, data: {} })).status, 400);
  assert.equal((await p('POST', url, { type: 'growth', startAt: t, data: { weightKg: 500 } })).status, 400);
  r = await p('POST', url, { type: 'growth', startAt: t, data: { weightKg: 6.2, headCm: 41 } });
  assert.equal(r.status, 201);

  r = await p('GET', `${url}?type=growth`);
  assert.equal(r.body.events.length, 1);
  assert.equal((await p('PATCH', `/api/events/${r.body.events[0].id}`, { type: 'diaper' })).status, 400);
});

test('auth: wrong password, logout, and unauthenticated access', async () => {
  const p = client();
  const e = email();
  await p('POST', '/api/signup', { name: 'P', email: e, password: 'password123' });
  assert.equal((await p('POST', '/api/signup', { name: 'P', email: e.toUpperCase(), password: 'password123' })).status, 409);
  assert.equal((await p('POST', '/api/logout', {})).status, 200);
  assert.equal((await p('GET', '/api/me')).status, 401);
  assert.equal((await p('POST', '/api/login', { email: e, password: 'nope' })).status, 401);
  assert.equal((await p('POST', '/api/login', { email: e, password: 'password123' })).status, 200);
  assert.equal((await p('GET', '/api/me')).status, 200);
  assert.equal((await p('POST', '/api/signup', { name: 'Q', email: email(), password: 'short' })).status, 400);
});

test('rejects non-JSON writes (CSRF guard)', async () => {
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a' });
  assert.equal(res.status, 415);
});

test('joining a family by code when already signed in', async () => {
  const a = client();
  const b = client();
  await a('POST', '/api/signup', { name: 'A', email: email(), password: 'password123' });
  await a('POST', '/api/children', { name: 'Kid', birthDate: '2026-01-01', sex: 'male' });
  const { code } = (await a('POST', '/api/invites')).body;
  await b('POST', '/api/signup', { name: 'B', email: email(), password: 'password123' });
  const r = await b('POST', '/api/invites/accept', { code });
  assert.equal(r.status, 200);
  assert.equal(r.body.children.length, 1);

  // Someone who already has children can't be moved (their logs would be orphaned).
  const c = client();
  await c('POST', '/api/signup', { name: 'C', email: email(), password: 'password123' });
  await c('POST', '/api/children', { name: 'Other', birthDate: '2026-01-01', sex: 'female' });
  const code2 = (await a('POST', '/api/invites')).body.code;
  assert.equal((await c('POST', '/api/invites/accept', { code: code2 })).status, 409);
});

test('serves the app and blocks path traversal', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Baby Tracker/);
  assert.equal((await fetch(`${base}/growth.js`)).status, 200);
  assert.equal((await fetch(`${base}/..%2Fpackage.json`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e/lib/app.js`)).status, 404);
});
