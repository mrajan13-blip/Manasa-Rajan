// Growth-chart math on top of the WHO LMS tables.
// Shared by the browser (charts) and the Node tests.
import { WHO_LMS } from './growth-data.js';

export const METRICS = {
  weight: { label: 'Weight', unit: 'kg' },
  length: { label: 'Length / height', unit: 'cm' },
  head: { label: 'Head circumference', unit: 'cm' },
};

// The percentile curves drawn on the charts (same set as the CDC/WHO 0-2 charts).
export const CHART_PERCENTILES = [3, 15, 50, 85, 97];

export const MAX_CHART_MONTHS = 36;
const DAYS_PER_MONTH = 365.25 / 12;

export function ageInMonths(birthDate, atDate) {
  const ms = new Date(atDate) - new Date(birthDate);
  return ms / 86400000 / DAYS_PER_MONTH;
}

// LMS parameters at a (possibly fractional) age, linearly interpolated.
export function lmsAt(metric, sex, months) {
  const rows = WHO_LMS[metric]?.[sex];
  if (!rows) throw new Error(`No WHO data for ${metric}/${sex}`);
  if (months < 0 || months > rows[rows.length - 1][0]) return null;
  const i = Math.min(Math.floor(months), rows.length - 2);
  const [m0, L0, M0, S0] = rows[i];
  const [, L1, M1, S1] = rows[i + 1];
  const t = months - m0;
  return { L: L0 + (L1 - L0) * t, M: M0 + (M1 - M0) * t, S: S0 + (S1 - S0) * t };
}

export function zScore(value, { L, M, S }) {
  if (Math.abs(L) < 1e-9) return Math.log(value / M) / S;
  return (Math.pow(value / M, L) - 1) / (L * S);
}

export function valueAtZ(z, { L, M, S }) {
  if (Math.abs(L) < 1e-9) return M * Math.exp(S * z);
  return M * Math.pow(1 + L * S * z, 1 / L);
}

// Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7).
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// Inverse of normalCdf (Acklam's rational approximation).
export function normalQuantile(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Percentile (0-100) of a measurement, or null when outside the 0-36 month range.
export function percentileFor(metric, sex, months, value) {
  const lms = lmsAt(metric, sex, months);
  if (!lms || !(value > 0)) return null;
  return normalCdf(zScore(value, lms)) * 100;
}

// Points for one percentile curve, sampled every half month.
export function percentileCurve(metric, sex, percentile, maxMonths = MAX_CHART_MONTHS) {
  const z = normalQuantile(percentile / 100);
  const points = [];
  for (let m = 0; m <= maxMonths; m += 0.5) points.push([m, valueAtZ(z, lmsAt(metric, sex, m))]);
  return points;
}

export function formatPercentile(p) {
  if (p == null) return '—';
  if (p < 1) return '<1st';
  if (p > 99) return '>99th';
  const n = Math.round(p);
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${suffix}`;
}
