import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, mapNaraRows } from '../lib/nara.js';

// Synthetic export using Nara's column names (see test/fixtures/nara-sample.csv).
const csv = readFileSync(new URL('./fixtures/nara-sample.csv', import.meta.url), 'utf8');

test('parses quoted fields, embedded newlines, BOM and short rows', () => {
  const rows = parseCsv(csv);
  assert.equal(rows.length, 13);
  assert.equal(rows[0].Type, 'Breastfeed');
  assert.equal(rows[1].Note, 'Fussy, then "happy"\nslept after');
  assert.equal(rows[12].Type, 'Profile');
});

test('maps each Nara activity type', () => {
  const { events, skipped, problems } = mapNaraRows(parseCsv(csv));
  const byKey = Object.fromEntries(events.map((e) => [e.sourceKey, e]));

  const bf = byKey['nara:a1'];
  assert.equal(bf.type, 'feed');
  assert.deepEqual(bf.data, { method: 'breast', leftSeconds: 600, rightSeconds: 420, lastSide: 'right' });
  assert.equal(bf.startAt, '2025-09-12T18:00:00.000Z');
  assert.equal(new Date(bf.endAt) - new Date(bf.startAt), 1020 * 1000);
  assert.equal(bf.caregiver, 'Mom');

  assert.deepEqual(byKey['nara:a2'].data, { method: 'bottle', amountMl: 90, contents: 'formula', formulaName: 'Enfamil', note: 'Fussy, then "happy"\nslept after' });
  assert.deepEqual(byKey['nara:a3'].data, { method: 'bottle', amountMl: 90, contents: 'mixed', breastMilkMl: 30, formulaMl: 60 });

  // Combo feed becomes a breastfeed plus a bottle; ounces are converted to ml.
  assert.equal(byKey['nara:a4#breast'].data.rightSeconds, 300);
  assert.equal(byKey['nara:a4#bottle'].data.amountMl, 59.1);
  assert.equal(byKey['nara:a4#bottle'].data.contents, 'breast_milk');

  assert.deepEqual(byKey['nara:a5'].data, { kind: 'both', color: 'brown, yellow', texture: 'mushy, runny', blowout: true });
  assert.equal(byKey['nara:a6'].data.kind, 'wet');
  assert.equal(byKey['nara:a7'].data.kind, 'dry');

  assert.deepEqual(byKey['nara:a9'].data, { weightKg: 5.67, lengthCm: 61, headCm: 40.5 });

  const sleep = byKey['nara:a10'];
  assert.equal(sleep.type, 'sleep');
  assert.equal(new Date(sleep.endAt) - new Date(sleep.startAt), 5400 * 1000);

  assert.deepEqual(skipped, { Pump: 1, Milestone: 1, Profile: 1 });
  assert.equal(problems.length, 1);
  assert.match(problems[0].reason, /Sparkly/);
});
