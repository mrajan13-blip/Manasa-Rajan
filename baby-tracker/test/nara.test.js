import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, mapNaraRows, naraProfile } from '../lib/nara.js';

// Synthetic export with Nara's real column layout (see test/fixtures/nara-sample.csv).
const csv = readFileSync(new URL('./fixtures/nara-sample.csv', import.meta.url), 'utf8');

test('parses quoted fields, embedded newlines and BOM', () => {
  const rows = parseCsv(csv);
  assert.equal(rows.length, 20);
  assert.equal(rows[0].Type, 'Breastfeed');
  assert.equal(rows[1].Note, 'Fussy, then "happy"\nslept after');
  assert.deepEqual(naraProfile(rows), { birthDate: '2025-06-01', sex: 'female' });
});

test('maps each Nara activity type', () => {
  const { events, skipped, problems } = mapNaraRows(parseCsv(csv));
  const byKey = Object.fromEntries(events.map((e) => [e.sourceKey, e]));

  const bf = byKey['nara:a1'];
  assert.equal(bf.type, 'feed');
  assert.deepEqual(bf.data, { method: 'breast', leftSeconds: 600, rightSeconds: 420, lastSide: 'right' });
  assert.equal(bf.startAt, '2025-09-12T18:00:00.000Z');
  assert.equal(new Date(bf.endAt) - new Date(bf.startAt), 1020 * 1000);
  assert.equal(bf.caregiver, 'Mom Smith');

  assert.deepEqual(byKey['nara:a2'].data, { method: 'bottle', amountMl: 90, contents: 'formula', formulaName: 'Enfamil', note: 'Fussy, then "happy"\nslept after' });
  // FLOZ (Nara's fluid ounces) is converted to ml.
  assert.deepEqual(byKey['nara:a3'].data, { method: 'bottle', amountMl: 89.6, contents: 'mixed', breastMilkMl: 29.6, formulaMl: 60 });

  // Combo feed becomes a breastfeed plus a bottle; with no bottle amount, just the breastfeed.
  assert.equal(byKey['nara:a4#breast'].data.rightSeconds, 300);
  assert.equal(byKey['nara:a4#bottle'].data.amountMl, 59.1);
  assert.equal(byKey['nara:a4b#breast'].data.leftSeconds, 240);
  assert.equal(byKey['nara:a4b#bottle'], undefined);

  assert.deepEqual(byKey['nara:a5'].data, { kind: 'both', color: 'brown, yellow', texture: 'mushy, runny', blowout: true });
  assert.equal(byKey['nara:a6'].data.kind, 'wet');
  assert.equal(byKey['nara:a7'].data.kind, 'dry');

  assert.deepEqual(byKey['nara:a8'].data, { leftMl: 59.1, rightMl: 70 });
  assert.equal(new Date(byKey['nara:a8'].endAt) - new Date(byKey['nara:a8'].startAt), 900 * 1000);
  assert.deepEqual(byKey['nara:a8b'].data, { totalMl: 100 });

  assert.deepEqual(byKey['nara:a9'].data, { weightKg: 5.67, lengthCm: 61, headCm: 40.5 });

  const sleep = byKey['nara:a10'];
  assert.equal(sleep.type, 'sleep');
  assert.equal(new Date(sleep.endAt) - new Date(sleep.startAt), 5400 * 1000);

  assert.deepEqual(byKey['nara:a12'].data, { medication: "Children's Tylenol, 3.75 (ML)", temperature: 100.4, tempUnit: 'F' });
  assert.deepEqual(byKey['nara:a12b'].data, { note: 'Pediatrician call' });
  assert.deepEqual(byKey['nara:a13'].data, { foods: 'Applesauce, Moong Dal', meal: 'lunch' });
  assert.deepEqual(byKey['nara:a14'].data, { title: 'Sits without support', kind: 'milestone' });
  assert.deepEqual(byKey['nara:a15'].data, { title: 'First smile', kind: 'first' });

  assert.deepEqual(skipped, {});
  assert.deepEqual(problems.map((p) => p.type), ['Sleep', 'Diaper']);
  assert.match(problems[0].reason, /no end time/);
  assert.match(problems[1].reason, /Sparkly/);
});
