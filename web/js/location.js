// Location provider: native bridge (Android app), browser geolocation, or the simulator.
// Emits 'fix' events with {lng, lat, accuracy, heading, speed, time, source}.

import { haversine, bearing } from './util.js';

export class LocationProvider extends EventTarget {
  constructor() {
    super();
    this.last = null;      // last emitted fix
    this.lastReal = null;  // last fix from a real source (kept while simulating)
    this.simulating = false;
    this.watchId = null;
    this.error = null;
  }

  get native() { return typeof window.SANative !== 'undefined'; }

  start() {
    if (this.native || this.watchId != null || !('geolocation' in navigator)) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.push({
        lng: pos.coords.longitude,
        lat: pos.coords.latitude,
        accuracy: pos.coords.accuracy,
        heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
        speed: Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
        time: pos.timestamp || Date.now(),
      }, 'browser'),
      (err) => {
        this.error = err;
        this.dispatchEvent(new CustomEvent('error', { detail: err }));
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
  }

  /** Called by SA.onNativeLocation (Android) */
  pushNative(loc) {
    this.push({
      lng: loc.lng, lat: loc.lat, accuracy: loc.accuracy ?? 20,
      heading: loc.heading ?? null, speed: loc.speed ?? null, time: loc.time || Date.now(),
    }, 'native');
  }

  push(fix, source) {
    if (source !== 'sim') {
      this.lastReal = this.fill(fix, this.lastReal);
      if (this.simulating) return;
      this.emit(this.lastReal, source);
    } else {
      this.emit(fix, source);
    }
  }

  // Derive heading / speed from movement when the source doesn't give them.
  fill(fix, prev) {
    const out = { ...fix };
    if (prev) {
      const d = haversine([prev.lng, prev.lat], [fix.lng, fix.lat]);
      const dt = Math.max(0.2, (fix.time - prev.time) / 1000);
      if (out.speed == null) out.speed = d / dt;
      if (out.heading == null) out.heading = d > 2.5 ? bearing([prev.lng, prev.lat], [fix.lng, fix.lat]) : prev.heading;
    }
    if (out.speed != null && out.speed < 0.8 && prev?.heading != null && fix.heading == null) out.heading = prev.heading;
    return out;
  }

  emit(fix, source) {
    this.last = { ...fix, source };
    this.dispatchEvent(new CustomEvent('fix', { detail: this.last }));
  }

  setSimulating(on) {
    this.simulating = on;
    if (!on && this.lastReal) this.emit(this.lastReal, 'resume');
  }
}
