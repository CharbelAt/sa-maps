// Geometry + formatting helpers.

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function haversine(a, b) {
  // a, b = [lng, lat]
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export const angleDiff = (a, b) => {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
};

// Shortest signed rotation from a to b, in degrees.
export const angleDelta = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

// Project point p onto segment a-b using a local equirectangular frame (metres).
export function projectOnSegment(p, a, b) {
  const kx = Math.cos(rad(p[1])) * 111320;
  const ky = 110540;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const px = ax + t * dx, py = ay + t * dy;
  return { t, dist: Math.hypot(px, py), point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpLngLat = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

// ---- formatting -----------------------------------------------------------

const FT = 3.28084;
const MI = 1609.344;

function roundTo(v, step) { return Math.max(step, Math.round(v / step) * step); }

export function spokenDistance(m, units) {
  if (units === 'imperial') {
    const ft = m * FT;
    if (ft < 1000) return `${roundTo(ft, ft < 300 ? 50 : 100)} feet`;
    const mi = m / MI;
    if (mi < 0.35) return 'a quarter mile';
    if (mi < 0.65) return 'half a mile';
    if (mi < 0.9) return 'three quarters of a mile';
    const v = mi < 10 ? Math.round(mi * 10) / 10 : Math.round(mi);
    return `${v} ${v === 1 ? 'mile' : 'miles'}`;
  }
  if (m < 1000) return `${roundTo(m, m < 200 ? 10 : 50)} meters`;
  const km = m / 1000;
  const v = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  return `${v} ${v === 1 ? 'kilometer' : 'kilometers'}`;
}

export function shortDistance(m, units) {
  if (units === 'imperial') {
    const ft = m * FT;
    if (ft < 1000) return `${roundTo(ft, ft < 300 ? 10 : 50)} ft`;
    const mi = m / MI;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  if (m < 1000) return `${roundTo(m, m < 200 ? 10 : 50)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function spokenDuration(s) {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} ${min === 1 ? 'minute' : 'minutes'}`;
  const h = Math.floor(min / 60), m = min % 60;
  const hs = `${h} ${h === 1 ? 'hour' : 'hours'}`;
  return m ? `${hs} ${m} ${m === 1 ? 'minute' : 'minutes'}` : hs;
}

export function shortDuration(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export const clockTime = (date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
