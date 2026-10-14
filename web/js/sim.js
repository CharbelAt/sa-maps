// "Test drive": drives a route at believable speeds and feeds fake GPS fixes.

import { pointAlong } from './nav.js';

export class Simulator {
  constructor(location, { speedFactor = 1, interval = 250 } = {}) {
    this.location = location;
    this.speedFactor = speedFactor;
    this.interval = interval;
    this.timer = null;
    this.route = null;
  }

  get running() { return this.timer != null; }

  start(route) {
    this.stop();
    this.route = route;
    this.d = 0;
    this.v = 0;
    this.lastTick = performance.now();
    this.location.setSimulating(true);
    this.timer = setInterval(() => this.tick(), this.interval);
    this.tick();
  }

  /** Swap in a new route (after reroute) and continue from its start. */
  follow(route) {
    if (!this.running) return;
    this.route = route;
    this.d = 0;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.location.setSimulating(false);
  }

  targetSpeed() {
    const r = this.route;
    const step = r.steps.findLast((s) => s.startDist <= this.d + 0.5) || r.steps[0];
    let v = step.duration > 0 ? step.distance / step.duration : 12;
    v = Math.min(Math.max(v, r.profile === 'foot' ? 1.4 : 4), 33);
    // Slow down for upcoming turns.
    const next = r.maneuvers.find((m) => m.startDist > this.d + 1);
    if (next && next.kind !== 'arrive' && next.kind !== 'straight') {
      const dist = next.startDist - this.d;
      if (dist < 80) v = Math.min(v, r.profile === 'foot' ? 1.4 : 6 + dist * 0.08);
    }
    return v;
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const target = this.targetSpeed();
    this.v += (target - this.v) * Math.min(1, dt * 0.8);
    this.d += this.v * dt * this.speedFactor;
    const { point, bearing } = pointAlong(this.route, this.d);
    this.location.push({
      lng: point[0], lat: point[1], accuracy: 5, heading: bearing,
      speed: this.v, time: Date.now(),
    }, 'sim');
    if (this.d >= this.route.total + 5) this.stop();
  }
}
