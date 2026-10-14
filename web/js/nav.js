// Routing (OSRM) + route following: snapping, progress, off-route detection and
// deciding when each maneuver gets announced.

import { describeStep } from './instructions.js';
import { haversine, bearing, projectOnSegment, angleDiff, clamp } from './util.js';

const FOSSGIS = { car: 'routed-car', bike: 'routed-bike', foot: 'routed-foot' };

function routeBases(profile, customBase) {
  const bases = [];
  if (customBase) bases.push(`${customBase.replace(/\/+$/, '')}/route/v1/driving`);
  bases.push(`https://routing.openstreetmap.de/${FOSSGIS[profile] || FOSSGIS.car}/route/v1/driving`);
  if (profile === 'car') bases.push('https://router.project-osrm.org/route/v1/driving');
  return bases;
}

async function fetchJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** from/to = [lng, lat]. heading (deg) biases the start direction when rerouting. */
export async function fetchRoute(from, to, { profile = 'car', heading = null, customBase = '' } = {}) {
  const coords = `${from[0].toFixed(6)},${from[1].toFixed(6)};${to[0].toFixed(6)},${to[1].toFixed(6)}`;
  const attempts = heading != null ? [heading, null] : [null];
  let lastErr = new Error('No routing server reachable');
  for (const h of attempts) {
    const params = new URLSearchParams({ overview: 'false', steps: 'true', geometries: 'geojson' });
    if (h != null) params.set('bearings', `${Math.round(h) % 360},60;`);
    for (const base of routeBases(profile, customBase)) {
      try {
        const json = await fetchJson(`${base}/${coords}?${params}`);
        if (json.code === 'Ok' && json.routes?.length) return buildRoute(json.routes[0], profile);
        lastErr = Object.assign(new Error(json.message || json.code || 'Routing failed'), {
          noRoute: json.code === 'NoRoute' || json.code === 'NoSegment',
        });
        if (lastErr.noRoute) break; // same answer from every server; try without heading
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr;
}

function buildRoute(r, profile) {
  const coords = [];
  const cum = [];
  const steps = [];
  for (const s of r.legs.flatMap((l) => l.steps)) {
    const g = s.geometry?.coordinates || [s.maneuver.location];
    const startIndex = Math.max(0, coords.length - 1);
    for (const p of g) {
      const last = coords.at(-1);
      if (last && last[0] === p[0] && last[1] === p[1]) continue;
      cum.push(last ? cum.at(-1) + haversine(last, p) : 0);
      coords.push(p);
    }
    steps.push({
      ...describeStep(s),
      distance: s.distance,
      duration: s.duration,
      startDist: cum[startIndex] ?? 0,
      loc: s.maneuver.location,
    });
  }
  // Remaining-duration suffix sums.
  const after = new Array(steps.length).fill(0);
  for (let i = steps.length - 2; i >= 0; i--) after[i] = after[i + 1] + steps[i + 1].duration;
  steps.forEach((s, i) => { s.index = i; s.durationAfter = after[i]; });
  const maneuvers = steps.filter((s, i) => i > 0 && (s.speakable || s.kind === 'arrive'));
  return { coords, cum, steps, maneuvers, total: cum.at(-1) || 0, duration: r.duration, profile };
}

/** Point + bearing at a distance along the route. */
export function pointAlong(route, d) {
  const { coords, cum } = route;
  d = clamp(d, 0, route.total);
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const seg = Math.max(cum[hi] - cum[lo], 1e-6);
  const t = clamp((d - cum[lo]) / seg, 0, 1);
  const a = coords[lo], b = coords[hi] || a;
  return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing: bearing(a, b), index: lo };
}

const FAR_KINDS = new Set(['merge', 'ramp', 'exit', 'fork', 'keep', 'generic']);

export class Navigator extends EventTarget {
  constructor() {
    super();
    this.route = null;
    this.dest = null;
    this.reset();
  }

  reset() {
    this.idx = 0;
    this.along = 0;
    this.offCount = 0;
    this.offSince = 0;
    this.offRoute = false;
    this.phases = new Map();
    this.arrived = false;
    this.arriveSoonSaid = false;
  }

  get active() { return !!this.route && !this.arrived; }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  start(route, dest) {
    this.route = route;
    this.dest = dest;
    this.speed = 0;
    this.reset();
    this.emit('started', { route, dest });
  }

  replaceRoute(route) {
    this.route = route;
    this.reset();
    this.emit('rerouted', { route });
  }

  stop() {
    this.route = null;
    this.dest = null;
    this.reset();
  }

  snap(p, heading, speed, from, to) {
    const { coords, cum } = this.route;
    let best = null;
    for (let i = from; i < to; i++) {
      const pr = projectOnSegment(p, coords[i], coords[i + 1]);
      let score = pr.dist;
      if (heading != null && speed > 3) {
        if (angleDiff(bearing(coords[i], coords[i + 1]), heading) > 100) score += 40;
      }
      if (!best || score < best.score) {
        best = { score, dist: pr.dist, index: i, along: cum[i] + pr.t * (cum[i + 1] - cum[i]), point: pr.point };
      }
    }
    return best;
  }

  /** fix = {lng, lat, accuracy, heading, speed, time}. Returns progress state or null. */
  update(fix) {
    if (!this.route || this.arrived) return null;
    const r = this.route;
    const p = [fix.lng, fix.lat];
    const n = r.coords.length;
    if (n < 2) return null;

    const sp = fix.speed ?? 0;
    this.speed = this.speed ? this.speed * 0.6 + sp * 0.4 : sp;

    // Local search ahead of the last match; global search if that fails.
    let end = this.idx;
    while (end < n - 1 && r.cum[end] - this.along < 2500) end++;
    let m = this.snap(p, fix.heading, this.speed, Math.max(0, this.idx - 3), Math.max(end, Math.min(this.idx + 2, n - 1)));
    const threshold = clamp((fix.accuracy || 15) * 1.2 + 25, 35, 90);
    if (!m || m.dist > threshold) {
      const g = this.snap(p, fix.heading, this.speed, 0, n - 1);
      if (g && g.dist <= threshold) m = g;
    }

    const now = fix.time || Date.now();
    if (m && m.dist <= threshold) {
      this.idx = m.index;
      this.along = m.along;
      this.offCount = 0;
      if (this.offRoute) { this.offRoute = false; this.emit('onroute'); }
    } else {
      if (this.offCount++ === 0) this.offSince = now;
      if (!this.offRoute && this.offCount >= 3 && now - this.offSince >= 3000) {
        this.offRoute = true;
        this.emit('offroute', { fix });
      }
    }

    const remaining = Math.max(0, r.total - this.along);
    const step = this.stepAt(this.along);
    const stepFrac = step.distance > 0 ? clamp((this.along - step.startDist) / step.distance, 0, 1) : 1;
    const remainingS = step.duration * (1 - stepFrac) + step.durationAfter;
    const nextIdx = r.maneuvers.findIndex((mv) => mv.startDist > this.along + 1);
    const next = nextIdx >= 0 ? r.maneuvers[nextIdx] : r.maneuvers.at(-1);
    const distToNext = next ? Math.max(0, next.startDist - this.along) : remaining;
    const follow = nextIdx >= 0 ? r.maneuvers[nextIdx + 1] : null;

    const state = {
      along: this.along,
      remaining,
      remainingS,
      eta: Date.now() + remainingS * 1000,
      next,
      distToNext,
      then: null,
      offRoute: this.offRoute,
      speed: this.speed,
      snapped: m && m.dist <= threshold ? m.point : null,
      routeBearing: m ? bearing(r.coords[m.index], r.coords[m.index + 1]) : null,
      progress: r.total > 0 ? this.along / r.total : 0,
    };

    if (!this.offRoute) this.schedule(state, next, follow);

    // Arrival
    const destDist = this.dest ? haversine(p, [this.dest.lng, this.dest.lat]) : Infinity;
    if (!this.offRoute && (remaining < 20 || (remaining < 120 && destDist < 30))) {
      this.arrived = true;
      this.emit('arrived', state);
    } else if (!this.arriveSoonSaid && remaining < 600 && remaining > 250 && r.total > 1500) {
      this.arriveSoonSaid = true;
      this.emit('arrivesoon', state);
    }
    return state;
  }

  stepAt(d) {
    const steps = this.route.steps;
    let s = steps[0];
    for (const st of steps) { if (st.startDist <= d + 0.5) s = st; else break; }
    return s;
  }

  schedule(state, next, follow) {
    if (!next) return;
    const foot = this.route.profile === 'foot';
    const v = Math.max(this.speed || 0, foot ? 1.4 : 8);
    const nowD = clamp(v * 5, foot ? 10 : 25, 120);
    const prepD = clamp(v * 16, foot ? 40 : 150, 600);
    const farD = v > 20 ? clamp(v * 60, 1200, 2500) : 0;
    const prevIdx = this.route.maneuvers.indexOf(next) - 1;
    const prevStart = prevIdx >= 0 ? this.route.maneuvers[prevIdx].startDist : 0;
    const gap = next.startDist - prevStart;
    const d = state.distToNext;
    const fired = this.phases.get(next.index) || new Set();
    this.phases.set(next.index, fired);

    const chained = follow && follow.startDist - next.startDist < Math.max(nowD * 2.5, 120) ? follow : null;
    if (chained) state.then = chained;

    let phase = null;
    if (!fired.has('now') && d <= nowD) {
      phase = 'now';
      fired.add('now').add('prepare').add('far');
      if (chained) {
        const f2 = this.phases.get(chained.index) || new Set();
        f2.add('prepare').add('far');
        this.phases.set(chained.index, f2);
      }
    } else if (!fired.has('prepare') && d <= prepD && d > nowD * 1.5 && (gap > nowD * 2 || this.along < 1)) {
      phase = 'prepare';
      fired.add('prepare').add('far');
    } else if (farD && !fired.has('far') && d <= farD && d > prepD * 1.6 && FAR_KINDS.has(next.kind) && gap > farD * 0.8) {
      phase = 'far';
      fired.add('far');
    }
    if (phase) this.emit('announce', { phase, maneuver: next, distance: d, then: phase === 'now' ? chained : null, state });
  }
}
