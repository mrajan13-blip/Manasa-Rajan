import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lmsAt, percentileFor, valueAtZ, normalCdf, normalQuantile, formatPercentile, ageInMonths } from '../public/growth.js';

test('median at birth matches the WHO tables', () => {
  assert.equal(lmsAt('weight', 'male', 0).M, 3.3464);
  assert.equal(lmsAt('weight', 'female', 0).M, 3.2322);
  assert.equal(lmsAt('length', 'female', 0).M, 49.1477);
  assert.equal(lmsAt('head', 'male', 0).M, 34.4618);
});

test('a median measurement is the 50th percentile', () => {
  const p = percentileFor('weight', 'male', 6, lmsAt('weight', 'male', 6).M);
  assert.ok(Math.abs(p - 50) < 0.01, `got ${p}`);
});

test('WHO published SD cut-offs round-trip through the LMS math', () => {
  // WHO weight-for-age boys, month 12: -2SD = 7.7 kg, +2SD = 12.0 kg.
  const lms = lmsAt('weight', 'male', 12);
  assert.equal(Math.round(valueAtZ(-2, lms) * 10) / 10, 7.7);
  assert.equal(Math.round(valueAtZ(2, lms) * 10) / 10, 12.0);
});

test('interpolates between months and rejects out-of-range ages', () => {
  const a = lmsAt('length', 'male', 3).M;
  const b = lmsAt('length', 'male', 4).M;
  assert.ok(Math.abs(lmsAt('length', 'male', 3.5).M - (a + b) / 2) < 1e-9);
  assert.equal(lmsAt('weight', 'male', 37), null);
  assert.equal(percentileFor('weight', 'male', -1, 3), null);
});

test('normal distribution helpers are inverses', () => {
  for (const p of [0.03, 0.15, 0.5, 0.85, 0.97]) {
    assert.ok(Math.abs(normalCdf(normalQuantile(p)) - p) < 1e-6);
  }
});

test('formats percentiles with ordinal suffixes', () => {
  assert.equal(formatPercentile(1.2), '1st');
  assert.equal(formatPercentile(12), '12th');
  assert.equal(formatPercentile(22.4), '22nd');
  assert.equal(formatPercentile(99.5), '>99th');
  assert.equal(formatPercentile(null), '—');
});

test('ageInMonths', () => {
  assert.ok(Math.abs(ageInMonths('2025-01-01', '2026-01-01') - 12) < 0.01);
});
