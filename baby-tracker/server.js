import { createServer } from 'node:http';
import { openDb } from './lib/db.js';
import { createApp } from './lib/app.js';

const port = Number(process.env.PORT) || 3000;
const db = openDb(process.env.DB_PATH || './data/baby-tracker.db');
const handler = createApp({
  db,
  secureCookies: process.env.COOKIE_SECURE === '1',
  trustProxy: process.env.TRUST_PROXY === '1',
  openSignup: process.env.OPEN_SIGNUP === '1',
  allowedEmails: (process.env.ALLOWED_EMAILS || '').split(','),
});

createServer(handler).listen(port, () => {
  console.log(`Baby tracker running at http://localhost:${port}`);
});
