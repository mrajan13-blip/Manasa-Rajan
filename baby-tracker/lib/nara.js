// Maps a Nara Baby CSV export (Profile > Export Data) to this app's events.
//
// Nara exports one row per activity. `Type` says what it is, `Start Date/time (Epoch)`
// is epoch milliseconds, and type-specific columns are prefixed with the type, e.g.
// `[Bottle Feed] Volume`, `[Diaper] Type`, `[Growth] Weight Unit`. `_activityKey` is
// Nara's unique id for the row; we keep it so re-importing never duplicates entries.

const OZ_TO_ML = 29.5735;
const LB_TO_KG = 0.45359237;

// RFC 4180 CSV -> array of objects keyed by header. Handles quotes, escaped quotes,
// newlines inside quoted fields, CRLF, and a leading byte-order mark.
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()])));
}

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`"${v}" is not a number`);
  return n;
};

function toMl(value, unit) {
  if (value == null) return null;
  const u = (unit || 'ML').toUpperCase();
  if (u === 'ML') return value;
  if (u === 'OZ' || u === 'FL OZ') return Math.round(value * OZ_TO_ML * 10) / 10;
  throw new Error(`Unknown volume unit ${unit}`);
}
function toKg(value, unit) {
  if (value == null) return null;
  const u = (unit || '').toUpperCase();
  if (u === 'KG') return value;
  if (u === 'G') return value / 1000;
  if (u === 'LB' || u === 'LBS') return Math.round(value * LB_TO_KG * 1000) / 1000;
  if (u === 'OZ') return Math.round((value / 16) * LB_TO_KG * 1000) / 1000;
  throw new Error(`Unknown weight unit ${unit || '(blank)'}`);
}
function toCm(value, unit) {
  if (value == null) return null;
  const u = (unit || '').toUpperCase();
  if (u === 'CM') return value;
  if (u === 'MM') return value / 10;
  if (u === 'IN') return Math.round(value * 2.54 * 10) / 10;
  throw new Error(`Unknown length unit ${unit || '(blank)'}`);
}

// "Left", "Right.nonTimer" -> "left" / "right"
function side(v) {
  if (!v) return undefined;
  const s = v.replace(/\.nonTimer$/i, '').toLowerCase();
  return s === 'left' || s === 'right' ? s : undefined;
}

const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));

function breastfeed(row, prefix) {
  const leftSeconds = Math.round(num(row[`[${prefix}] Left Duration (Seconds)`]) ?? 0);
  const rightSeconds = Math.round(num(row[`[${prefix}] Right Duration (Seconds)`]) ?? 0);
  return {
    data: clean({
      method: 'breast',
      leftSeconds,
      rightSeconds,
      lastSide: side(row[`[${prefix}] End Side`]) ?? side(row[`[${prefix}] Begin Side`]),
    }),
    seconds: leftSeconds + rightSeconds,
  };
}

function bottle(row, prefix) {
  const kind = row[`[${prefix}] Type`] || '';
  const hasBreastMilk = /breast milk/i.test(kind);
  const hasFormula = /formula/i.test(kind);
  const breastMilkMl = toMl(num(row[`[${prefix}] Breast Milk Volume`]), row[`[${prefix}] Breast Milk Volume Unit`]);
  const formulaMl = toMl(num(row[`[${prefix}] Formula Volume`]), row[`[${prefix}] Formula Volume Unit`]);
  const plainMl = toMl(num(row[`[${prefix}] Volume`]), row[`[${prefix}] Volume Unit`]);
  const amountMl = breastMilkMl != null || formulaMl != null ? (breastMilkMl ?? 0) + (formulaMl ?? 0) : plainMl;
  if (amountMl == null) throw new Error('bottle has no volume');
  return clean({
    method: 'bottle',
    amountMl,
    contents: hasBreastMilk && hasFormula ? 'mixed' : hasBreastMilk ? 'breast_milk' : 'formula',
    breastMilkMl: hasBreastMilk && hasFormula ? breastMilkMl : undefined,
    formulaMl: hasBreastMilk && hasFormula ? formulaMl : undefined,
    formulaName: row[`[${prefix}] Formula Name`],
  });
}

const TEXTURES = { RUN: 'runny', MUCOUS: 'mucousy', MUSH: 'mushy', SOLID: 'solid', PEBBLE: 'pebbles' };

function diaper(row) {
  const t = row['[Diaper] Type'] || '';
  const wet = /wet/i.test(t);
  const dirty = /dirty/i.test(t);
  const kind = wet && dirty ? 'both' : wet ? 'wet' : dirty ? 'dirty' : /dry/i.test(t) ? 'dry' : null;
  if (!kind) throw new Error(`unknown diaper type "${t}"`);
  const detail = row['[Diaper] Detail'] || '';
  const tokens = (v) => (v || '').split(/\s+/).filter(Boolean);
  return clean({
    kind,
    color: tokens(row['[Diaper] Dirty Color']).map((c) => c.toLowerCase()).join(', ') || undefined,
    texture: tokens(row['[Diaper] Dirty Texture']).map((x) => TEXTURES[x.toUpperCase()] || x.toLowerCase()).join(', ') || undefined,
    blowout: /blowout/i.test(detail) || undefined,
    rash: /rash/i.test(detail) || undefined,
  });
}

function growth(row) {
  const data = clean({
    weightKg: toKg(num(row['[Growth] Weight']), row['[Growth] Weight Unit']),
    lengthCm: toCm(num(row['[Growth] Height']), row['[Growth] Height Unit']),
    headCm: toCm(num(row['[Growth] Head Size']), row['[Growth] Head Size Unit']),
  });
  if (!Object.keys(data).length) throw new Error('growth row has no measurements');
  return data;
}

// End of a timed activity: an explicit end epoch, else start + duration, else null.
function endFor(row, prefix, startMs) {
  const endEpoch = num(row[`[${prefix}] End Date/time (Epoch)`]);
  if (endEpoch) return new Date(endEpoch).toISOString();
  const secs = num(row[`[${prefix}] Duration (Seconds)`]);
  if (secs != null) return new Date(startMs + secs * 1000).toISOString();
  return null;
}

const SUPPORTED = {
  Breastfeed: 'feed', 'Bottle Feed': 'feed', 'Combo Feed': 'feed', Diaper: 'diaper', Growth: 'growth',
  Sleep: 'sleep', Nap: 'sleep', 'Night Sleep': 'sleep',
};

// Returns { events, skipped: {Type: count}, problems: [{line, type, reason}] }.
// Each event is { type, startAt, endAt, data, sourceKey, caregiver }.
export function mapNaraRows(rows) {
  const events = [];
  const skipped = {};
  const problems = [];
  rows.forEach((row, i) => {
    const type = row.Type || '';
    if (!SUPPORTED[type]) {
      if (type) skipped[type] = (skipped[type] || 0) + 1;
      return;
    }
    try {
      const startMs = num(row['Start Date/time (Epoch)']);
      if (!startMs) throw new Error('missing start time');
      const startAt = new Date(startMs).toISOString();
      const key = row._activityKey || `${type}@${startMs}`;
      const base = { startAt, caregiver: row['Created By Caregiver'] || null, note: row.Note || undefined };
      const push = (ev, suffix = '') => events.push({ ...base, ...ev, data: clean({ ...ev.data, note: base.note }), sourceKey: `nara:${key}${suffix}` });

      if (type === 'Breastfeed') {
        const b = breastfeed(row, 'Breastfeed');
        push({ type: 'feed', endAt: new Date(startMs + b.seconds * 1000).toISOString(), data: b.data });
      } else if (type === 'Bottle Feed') {
        push({ type: 'feed', endAt: null, data: bottle(row, 'Bottle Feed') });
      } else if (type === 'Combo Feed') {
        // A combo is a breastfeed and a bottle at the same sitting; this app stores them separately.
        const b = breastfeed(row, 'Combo Feed');
        push({ type: 'feed', endAt: new Date(startMs + b.seconds * 1000).toISOString(), data: b.data }, '#breast');
        push({ type: 'feed', endAt: null, data: bottle(row, 'Combo Feed') }, '#bottle');
      } else if (type === 'Diaper') {
        push({ type: 'diaper', endAt: null, data: diaper(row) });
      } else if (type === 'Growth') {
        push({ type: 'growth', endAt: null, data: growth(row) });
      } else {
        const endAt = endFor(row, type, startMs);
        if (!endAt) throw new Error('sleep has no end time or duration');
        push({ type: 'sleep', endAt, data: {} });
      }
    } catch (err) {
      problems.push({ line: i + 2, type, reason: err.message });
    }
  });
  return { events, skipped, problems };
}
