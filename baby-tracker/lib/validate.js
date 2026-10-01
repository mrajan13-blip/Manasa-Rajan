import { EVENT_TYPES } from './db.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (message) => new HttpError(400, message);

export function isoTime(value, field, { optional = false } = {}) {
  if (value == null || value === '') {
    if (optional) return null;
    throw bad(`${field} is required`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw bad(`${field} must be a valid date/time`);
  return d.toISOString();
}

export function isoDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(value).getTime())) {
    throw bad(`${field} must be a date like 2026-01-31`);
  }
  return value;
}

export function text(value, field, { max = 200, optional = false } = {}) {
  if (value == null || value === '') {
    if (optional) return undefined;
    throw bad(`${field} is required`);
  }
  if (typeof value !== 'string') throw bad(`${field} must be text`);
  const trimmed = value.trim();
  if (!optional && !trimmed) throw bad(`${field} is required`);
  if (trimmed.length > max) throw bad(`${field} must be at most ${max} characters`);
  return trimmed || undefined;
}

function num(value, field, { min, max, optional = true }) {
  if (value == null || value === '') {
    if (optional) return undefined;
    throw bad(`${field} is required`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${field} must be between ${min} and ${max}`);
  return n;
}

function oneOf(value, field, options) {
  if (!options.includes(value)) throw bad(`${field} must be one of: ${options.join(', ')}`);
  return value;
}

const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

// Validates and normalizes an event payload. Returns { type, startAt, endAt, data }.
export function validateEvent(input) {
  if (!input || typeof input !== 'object') throw bad('Invalid event');
  const type = oneOf(input.type, 'type', EVENT_TYPES);
  const startAt = isoTime(input.startAt, 'startAt');
  let endAt = isoTime(input.endAt, 'endAt', { optional: true });
  const raw = input.data && typeof input.data === 'object' ? input.data : {};
  const note = text(raw.note, 'note', { max: 1000, optional: true });
  let data;

  if (type === 'sleep') {
    data = clean({ note });
  } else if (type === 'feed') {
    const method = oneOf(raw.method, 'method', ['breast', 'bottle']);
    if (method === 'breast') {
      data = clean({
        method,
        leftSeconds: num(raw.leftSeconds, 'leftSeconds', { min: 0, max: 4 * 3600 }),
        rightSeconds: num(raw.rightSeconds, 'rightSeconds', { min: 0, max: 4 * 3600 }),
        lastSide: raw.lastSide == null ? undefined : oneOf(raw.lastSide, 'lastSide', ['left', 'right']),
        note,
      });
    } else {
      data = clean({
        method,
        amountMl: num(raw.amountMl, 'amountMl', { min: 0, max: 1000, optional: false }),
        contents: oneOf(raw.contents ?? 'formula', 'contents', ['breast_milk', 'formula', 'mixed']),
        breastMilkMl: num(raw.breastMilkMl, 'breastMilkMl', { min: 0, max: 1000 }),
        formulaMl: num(raw.formulaMl, 'formulaMl', { min: 0, max: 1000 }),
        formulaName: text(raw.formulaName, 'formulaName', { max: 80, optional: true }),
        note,
      });
    }
  } else if (type === 'diaper') {
    data = clean({
      kind: oneOf(raw.kind, 'kind', ['wet', 'dirty', 'both', 'dry']),
      color: text(raw.color, 'color', { max: 80, optional: true }),
      texture: text(raw.texture, 'texture', { max: 80, optional: true }),
      blowout: raw.blowout === true || undefined,
      rash: raw.rash === true || undefined,
      note,
    });
    endAt = null;
  } else if (type === 'pump') {
    data = clean({
      leftMl: num(raw.leftMl, 'leftMl', { min: 0, max: 1000 }),
      rightMl: num(raw.rightMl, 'rightMl', { min: 0, max: 1000 }),
      totalMl: num(raw.totalMl, 'totalMl', { min: 0, max: 2000 }),
      note,
    });
  } else if (type === 'medical') {
    const tempUnit = raw.temperature == null || raw.temperature === '' ? undefined : oneOf(raw.tempUnit, 'tempUnit', ['F', 'C']);
    data = clean({
      medication: text(raw.medication, 'medication', { max: 200, optional: true }),
      temperature: tempUnit && num(raw.temperature, 'temperature', tempUnit === 'F' ? { min: 85, max: 110 } : { min: 29, max: 44 }),
      tempUnit,
      note,
    });
    if (!data.medication && data.temperature == null && !data.note) throw bad('Enter a medicine or a temperature');
    endAt = null;
  } else if (type === 'solid') {
    data = clean({
      foods: text(raw.foods, 'foods', { max: 500, optional: true }),
      meal: raw.meal == null || raw.meal === '' ? undefined : oneOf(raw.meal, 'meal', ['breakfast', 'lunch', 'dinner', 'snack']),
      note,
    });
    if (!data.foods && !data.meal && !data.note) throw bad('Enter what was eaten');
    endAt = null;
  } else if (type === 'milestone') {
    data = clean({
      title: text(raw.title, 'title', { max: 300 }),
      kind: oneOf(raw.kind ?? 'first', 'kind', ['first', 'milestone']),
      note,
    });
    endAt = null;
  } else {
    data = clean({
      weightKg: num(raw.weightKg, 'weightKg', { min: 0.3, max: 40 }),
      lengthCm: num(raw.lengthCm, 'lengthCm', { min: 20, max: 130 }),
      headCm: num(raw.headCm, 'headCm', { min: 15, max: 60 }),
      note,
    });
    if (data.weightKg == null && data.lengthCm == null && data.headCm == null) {
      throw bad('Enter at least one of weight, length or head circumference');
    }
    endAt = null;
  }

  if (endAt && endAt < startAt) throw bad('End time must be after start time');
  return { type, startAt, endAt, data };
}
