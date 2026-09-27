// Inline-SVG growth chart: WHO percentile curves plus the child's measurements.
import { CHART_PERCENTILES, MAX_CHART_MONTHS, percentileCurve } from './growth.js';

const W = 420;
const H = 320;
const PAD = { top: 12, right: 32, bottom: 32, left: 36 };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// points: [{ months, value }] in chart units. toDisplay converts metric -> display units.
export function growthChartSvg({ metric, sex, points, toDisplay, unitLabel, title }) {
  const lastMonth = points.reduce((m, p) => Math.max(m, p.months), 0);
  // Zoom to the child's age (min 6 months, 3 months of headroom) so early weeks stay readable.
  const maxX = Math.min(MAX_CHART_MONTHS, Math.max(6, Math.ceil((lastMonth + 3) / 3) * 3));
  const curves = CHART_PERCENTILES.map((p) => ({
    p,
    pts: percentileCurve(metric, sex, p, maxX).map(([m, v]) => [m, toDisplay(v)]),
  }));
  const shown = points.filter((p) => p.months <= maxX).map((p) => ({ ...p, value: toDisplay(p.value) }));

  const allY = curves.flatMap((c) => c.pts.map(([, v]) => v)).concat(shown.map((p) => p.value));
  const [minY, maxY] = niceRange(Math.min(...allY), Math.max(...allY));
  const x = (m) => PAD.left + (m / maxX) * (W - PAD.left - PAD.right);
  const y = (v) => H - PAD.bottom - ((v - minY) / (maxY - minY)) * (H - PAD.top - PAD.bottom);
  const path = (pts) => pts.map(([m, v], i) => `${i ? 'L' : 'M'}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join('');

  const xStep = maxX <= 12 ? 1 : maxX <= 24 ? 3 : 6;
  const yStep = niceStep((maxY - minY) / 6);
  let grid = '';
  for (let m = 0; m <= maxX; m += xStep) {
    grid += `<line class="grid" x1="${x(m)}" x2="${x(m)}" y1="${PAD.top}" y2="${H - PAD.bottom}"/>`;
    grid += `<text x="${x(m)}" y="${H - PAD.bottom + 16}" text-anchor="middle">${m}</text>`;
  }
  for (let v = minY; v <= maxY + 1e-9; v += yStep) {
    grid += `<line class="grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}"/>`;
    grid += `<text x="${PAD.left - 6}" y="${y(v) + 4}" text-anchor="end">${+v.toFixed(1)}</text>`;
  }

  // Shade the 15th-85th band (the "typical" range).
  const p15 = curves.find((c) => c.p === 15).pts;
  const p85 = curves.find((c) => c.p === 85).pts;
  const band = `${path(p15)}L${[...p85].reverse().map(([m, v]) => `${x(m).toFixed(1)},${y(v).toFixed(1)}`).join('L')}Z`;

  const curveEls = curves.map(({ p, pts }) => {
    const [lm, lv] = pts[pts.length - 1];
    return `<path class="curve${p === 50 ? ' mid' : ''}" d="${path(pts)}"/>` +
      `<text class="pct-label" x="${x(lm) + 4}" y="${y(lv) + 3}">${p}th</text>`;
  }).join('');

  const childLine = shown.length > 1 ? `<path class="line" d="${path(shown.map((p) => [p.months, p.value]))}"/>` : '';
  const dots = shown.map((p) =>
    `<circle class="pt" cx="${x(p.months)}" cy="${y(p.value)}" r="5"><title>${esc(p.label)}</title></circle>`).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
    ${grid}
    <path class="band" d="${band}"/>
    ${curveEls}
    ${childLine}${dots}
    <text x="${(PAD.left + W - PAD.right) / 2}" y="${H - 4}" text-anchor="middle">Age (months)</text>
    <text x="12" y="${PAD.top + (H - PAD.top - PAD.bottom) / 2}" text-anchor="middle" transform="rotate(-90 12 ${PAD.top + (H - PAD.top - PAD.bottom) / 2})">${esc(unitLabel)}</text>
  </svg>`;
}

function niceStep(raw) {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function niceRange(min, max) {
  const step = niceStep((max - min) / 6);
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}
