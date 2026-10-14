// The map: SA radar style, circular in navigation mode, camera that follows the
// player and zooms out with speed (like the game), and blips that stick to the
// radar rim when they're off-screen.

import { buildStyle, LABEL_LAYERS } from './mapstyle.js';
import { ROUTE_COLORS } from './settings.js';
import { angleDelta, clamp, haversine, lerp } from './util.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

// Where a ray from (ox, oy) in direction (dx, dy) leaves the rectangle.
function rayToRect(ox, oy, dx, dy, r) {
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (r.right - ox) / dx);
  if (dx < -1e-6) t = Math.min(t, (r.left - ox) / dx);
  if (dy > 1e-6) t = Math.min(t, (r.bottom - oy) / dy);
  if (dy < -1e-6) t = Math.min(t, (r.top - oy) / dy);
  if (!Number.isFinite(t) || t < 0) t = 0;
  return [ox + dx * t, oy + dy * t];
}
const lineFeature = (coords) => ({
  type: 'FeatureCollection',
  features: coords.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }] : [],
});

function loadSvgImage(url, size) {
  return new Promise((resolve, reject) => {
    const img = new Image(size, size);
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      c.getContext('2d').drawImage(img, 0, 0, size, size);
      resolve(c.getContext('2d').getImageData(0, 0, size, size));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export class Radar extends EventTarget {
  constructor(settings) {
    super();
    this.settings = settings;
    this.wrap = document.getElementById('radar');
    this.blipLayer = document.getElementById('blips');
    this.mode = 'browse';
    this.following = false;
    this.zoomBias = 0;
    this.player = null;      // displayed {pos, heading}
    this.target = null;      // latest fix target
    this.blips = new Map();  // id -> {el, lngLat, clamp}
    this.camBearing = 0;
    this.speed = 0;
  }

  init(center) {
    const s = this.settings;
    this.map = new maplibregl.Map({
      container: 'map',
      style: buildStyle({ labels: true, turf: s.turf }),
      center,
      zoom: 13,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: true,
      maxPitch: 0,
      fadeDuration: 0,
    });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    this.map.touchZoomRotate.disableRotation();

    const playerEl = document.createElement('div');
    playerEl.className = 'player-blip';
    this.playerMarker = new maplibregl.Marker({ element: playerEl, rotationAlignment: 'map', pitchAlignment: 'map' });

    this.north = this.addBlip('north', null, 'assets/blips/north.svg', { clamp: false, cls: 'north' });

    // User interaction stops auto-follow.
    const stopFollow = (e) => {
      if (!e.originalEvent) return;
      if (this.following) {
        this.following = false;
        this.dispatchEvent(new Event('followchange'));
      }
      clearTimeout(this.refollowTimer);
      if (this.mode !== 'browse') this.refollowTimer = setTimeout(() => this.recenter(), 12000);
    };
    this.map.on('dragstart', stopFollow);
    this.map.on('zoomstart', (e) => { if (e.originalEvent && this.mode !== 'browse') this.zoomBias = 0; stopFollow(e); });

    this.setupLongPress();

    return new Promise((resolve) => {
      this.map.on('load', async () => {
        this.map.addSource('route', { type: 'geojson', data: EMPTY });
        this.map.addLayer({
          id: 'route-casing', type: 'line', source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#000', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 13, 18, 22], 'line-opacity': 0.85 },
        }, 'label-road');
        this.map.addLayer({
          id: 'route-line', type: 'line', source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ROUTE_COLORS[s.routeColor] || ROUTE_COLORS.gold, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 8, 18, 15] },
        }, 'label-road');
        try {
          this.map.addImage('blip-food', await loadSvgImage('assets/blips/food.svg', 48), { pixelRatio: 2 });
          this.map.addLayer({
            id: 'poi-food', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 14,
            filter: ['==', 'class', 'fast_food'],
            layout: { 'icon-image': 'blip-food', 'icon-size': 1, 'icon-allow-overlap': false },
          });
        } catch { /* icon missing: skip food blips */ }
        this.ready = true;
        this.applyMode();
        this.loop();
        resolve();
      });
    });
  }

  setupLongPress() {
    const map = this.map;
    let timer = null, start = null;
    const fire = (point) => {
      const ll = map.unproject(point);
      this.dispatchEvent(new CustomEvent('longpress', { detail: { lng: ll.lng, lat: ll.lat } }));
    };
    map.on('contextmenu', (e) => fire(e.point));
    map.on('touchstart', (e) => {
      if (e.originalEvent.touches.length !== 1) return;
      start = e.point;
      clearTimeout(timer);
      timer = setTimeout(() => fire(start), 600);
    });
    const cancel = () => clearTimeout(timer);
    map.on('touchend', cancel);
    map.on('touchcancel', cancel);
    map.on('touchmove', (e) => { if (start && Math.hypot(e.point.x - start.x, e.point.y - start.y) > 10) cancel(); });
    map.on('movestart', (e) => { if (e.originalEvent?.type !== 'touchstart') cancel(); });
  }

  // ---- modes ---------------------------------------------------------------

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.applyMode();
  }

  applyMode() {
    if (!this.ready) return;
    const nav = this.mode !== 'browse';
    const showLabels = !nav || this.settings.radarLabels;
    for (const id of LABEL_LAYERS) this.map.setLayoutProperty(id, 'visibility', showLabels ? 'visible' : 'none');
    this.north.el.hidden = !nav;
    if (nav) {
      this.following = true;
      this.map.dragRotate.disable();
      // keep the attribution as the small (i) button while driving
      this.wrap.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    } else {
      this.map.dragRotate.enable();
      this.map.easeTo({ bearing: 0, padding: NO_PADDING, duration: 500 });
    }
    // container size changes with the mode
    requestAnimationFrame(() => this.map.resize());
    setTimeout(() => this.map.resize(), 450);
  }

  applySettings() {
    if (!this.ready) return;
    this.map.setLayoutProperty('turf', 'visibility', this.settings.turf ? 'visible' : 'none');
    this.map.setPaintProperty('route-line', 'line-color', ROUTE_COLORS[this.settings.routeColor] || ROUTE_COLORS.gold);
    this.applyMode();
  }

  resize() { this.map?.resize(); }

  /**
   * How the nav camera is framed:
   *  {shape: 'circle'} — classic round radar, player in the middle.
   *  {shape: 'full', safe: {left, top, right, bottom}, anchor: [x, y]} — full-screen radar;
   *  the player sits at `anchor` and off-screen blips stick to the `safe` rectangle.
   */
  setView(view) { this.view = view; }

  get shape() { return this.mode === 'browse' ? 'browse' : this.view?.shape || 'full'; }

  cameraPadding() {
    if (this.shape !== 'full' || !this.view?.anchor) return NO_PADDING;
    const W = this.wrap.clientWidth, H = this.wrap.clientHeight;
    const [x, y] = this.view.anchor;
    return {
      top: Math.max(0, 2 * y - H), bottom: Math.max(0, H - 2 * y),
      left: Math.max(0, 2 * x - W), right: Math.max(0, W - 2 * x),
    };
  }

  // ---- player + camera -------------------------------------------------------

  /** fix: {lng, lat, heading, speed}; snapped: [lng, lat] | null; routeBearing for smoothing */
  updatePlayer(fix, snapped, routeBearing) {
    const pos = snapped || [fix.lng, fix.lat];
    let heading = fix.heading;
    if (snapped && routeBearing != null && (fix.speed ?? 0) > 2) heading = routeBearing;
    if (heading == null) heading = this.target?.heading ?? 0;
    const now = performance.now();
    const from = this.player ? { ...this.player } : { pos, heading };
    const interval = this.target ? clamp(now - this.target.t, 150, 1500) : 1000;
    this.target = { from, pos, heading, t: now, dur: interval * 1.05 };
    this.speed = fix.speed ?? 0;
    if (!this.player) {
      this.player = { pos, heading };
      this.playerMarker.setLngLat(pos).setRotation(heading).addTo(this.map);
    }
  }

  autoZoom() {
    // SA radar zooms out the faster you go.
    const kmh = (this.speed || 0) * 3.6;
    const z = this.mode === 'car' || this.mode === 'nav' ? 17.2 - clamp(kmh, 0, 130) / 130 * 2.4 : 15.5;
    return clamp(z + this.zoomBias, 3, 19);
  }

  loop() {
    const frame = () => {
      this.raf = requestAnimationFrame(frame);
      if (this.target && this.player) {
        const k = clamp((performance.now() - this.target.t) / this.target.dur, 0, 1);
        const f = this.target.from;
        this.player.pos = [lerp(f.pos[0], this.target.pos[0], k), lerp(f.pos[1], this.target.pos[1], k)];
        this.player.heading = f.heading + angleDelta(f.heading, this.target.heading) * k;
        this.playerMarker.setLngLat(this.player.pos).setRotation(this.player.heading);
        if (this.following && this.mode !== 'browse') {
          const wantBearing = this.settings.trackUp ? this.player.heading : 0;
          this.camBearing += angleDelta(this.camBearing, wantBearing) * 0.12;
          const zoom = this.map.getZoom();
          this.map.jumpTo({
            center: this.player.pos,
            bearing: this.camBearing,
            zoom: zoom + (this.autoZoom() - zoom) * 0.05,
            padding: this.cameraPadding(),
          });
        }
      }
      this.updateBlips();
    };
    frame();
  }

  recenter() {
    clearTimeout(this.refollowTimer);
    this.following = true;
    this.dispatchEvent(new Event('followchange'));
    if (this.mode === 'browse' && this.player) {
      this.map.easeTo({ center: this.player.pos, zoom: Math.max(this.map.getZoom(), 15), duration: 600 });
      this.following = false;
    }
  }

  overview(coords) {
    if (!coords?.length) return;
    this.following = false;
    this.dispatchEvent(new Event('followchange'));
    clearTimeout(this.refollowTimer);
    if (this.mode !== 'browse') this.refollowTimer = setTimeout(() => this.recenter(), 15000);
    this.fit(coords);
  }

  fit(coords, padding) {
    const b = coords.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    const size = Math.min(this.wrap.clientWidth, this.wrap.clientHeight);
    let pad = padding;
    if (!pad) {
      if (this.mode === 'browse') pad = { top: 90, bottom: 260, left: 40, right: 40 };
      else if (this.shape === 'full' && this.view?.safe) {
        const s = this.view.safe;
        pad = { top: s.top + 20, left: s.left + 20, right: this.wrap.clientWidth - s.right + 20, bottom: this.wrap.clientHeight - s.bottom + 20 };
      } else pad = size * 0.18;
    }
    this.map.fitBounds(b, { padding: pad, bearing: this.mode === 'browse' ? 0 : this.map.getBearing(), maxZoom: 17, duration: 700 });
  }

  zoomBy(delta) {
    if (this.mode !== 'browse' && this.following) this.zoomBias = clamp(this.zoomBias + delta, -6, 3);
    else this.map.easeTo({ zoom: this.map.getZoom() + delta, duration: 250 });
  }

  panBy(dx, dy) {
    if (this.following) {
      this.following = false;
      this.dispatchEvent(new Event('followchange'));
    }
    clearTimeout(this.refollowTimer);
    this.refollowTimer = setTimeout(() => this.recenter(), 12000);
    this.map.panBy([dx, dy], { duration: 0 });
  }

  // ---- route + blips -----------------------------------------------------------

  setRoute(coords) { this.map.getSource('route')?.setData(coords ? lineFeature(coords) : EMPTY); }

  addBlip(id, lngLat, icon, { clamp: clampToRim = true, cls = '', onClick = null } = {}) {
    this.removeBlip(id);
    const el = document.createElement('img');
    el.className = `blip ${cls}`;
    el.src = icon;
    el.alt = '';
    if (onClick) { el.classList.add('clickable'); el.addEventListener('click', onClick); }
    this.blipLayer.appendChild(el);
    const blip = { el, lngLat, clamp: clampToRim };
    this.blips.set(id, blip);
    return blip;
  }

  removeBlip(id) {
    const b = this.blips.get(id);
    if (b) { b.el.remove(); this.blips.delete(id); }
  }

  updateBlips() {
    if (!this.map) return;
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    const shape = this.shape;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
    const safe = this.view?.safe || { left: 16, top: 16, right: w - 16, bottom: h - 16 };
    const [ax, ay] = this.view?.anchor || [cx, cy];
    const bearing = this.map.getBearing();
    const place = (el, x, y) => { el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`; };
    for (const [id, b] of this.blips) {
      if (id === 'north') {
        if (shape === 'browse') continue;
        const a = (-bearing * Math.PI) / 180;
        if (shape === 'circle') {
          place(b.el, cx + Math.sin(a) * R * 0.94, cy - Math.cos(a) * R * 0.94);
        } else {
          const [x, y] = rayToRect(ax, ay, Math.sin(a), -Math.cos(a), safe);
          place(b.el, x, y);
        }
        continue;
      }
      if (!b.lngLat) { b.el.hidden = true; continue; }
      const p = this.map.project(b.lngLat);
      let x = p.x, y = p.y, onRim = false;
      if (shape === 'circle') {
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), max = R * 0.86;
        if (d > max) {
          if (!b.clamp) { b.el.hidden = true; continue; }
          x = cx + (dx / d) * max; y = cy + (dy / d) * max; onRim = true;
        }
      } else if (shape === 'full') {
        if (x < safe.left || x > safe.right || y < safe.top || y > safe.bottom) {
          if (!b.clamp) { b.el.hidden = true; continue; }
          [x, y] = rayToRect(ax, ay, x - ax, y - ay, safe);
          onRim = true;
        }
      } else if (x < -20 || y < -20 || x > w + 20 || y > h + 20) {
        b.el.hidden = true;
        continue;
      }
      b.el.hidden = false;
      b.el.classList.toggle('rim', onRim);
      place(b.el, x, y);
    }
  }

  // ---- queries on loaded tiles -------------------------------------------------

  zoneName(lngLat) {
    if (!this.ready) return null;
    const feats = this.map.querySourceFeatures('omt', {
      sourceLayer: 'place',
      filter: ['in', 'class', 'neighbourhood', 'quarter', 'suburb', 'hamlet', 'village', 'town', 'city'],
    });
    const reach = { neighbourhood: 900, quarter: 1500, suburb: 2500, hamlet: 1500, village: 3000, town: 6000, city: 15000 };
    let best = null;
    for (const f of feats) {
      const name = f.properties['name:latin'] || f.properties.name;
      const c = f.geometry.coordinates;
      if (!name || f.geometry.type !== 'Point') continue;
      const d = haversine(lngLat, c);
      const r = reach[f.properties.class] || 1000;
      if (d > r) continue;
      const score = d / r;
      if (!best || score < best.score) best = { name, score };
    }
    return best?.name || null;
  }

  /** Latin-script name for a street (OSM `name:latin` from the tiles), if loaded. */
  latinName(name) {
    if (!this.ready || !name) return null;
    const feats = this.map.querySourceFeatures('omt', {
      sourceLayer: 'transportation_name',
      filter: ['==', ['get', 'name'], name],
    });
    for (const f of feats) {
      const p = f.properties;
      const latin = p['name:latin'] || p.name_int || p['name:en'];
      if (latin && !/[^\u0000-\u024F\u1E00-\u1EFF]/.test(latin)) return latin;
    }
    return null;
  }

  nearbyFood(lngLat, radius = 70) {
    if (!this.ready || this.map.getZoom() < 14) return null;
    const feats = this.map.querySourceFeatures('omt', { sourceLayer: 'poi', filter: ['==', 'class', 'fast_food'] });
    for (const f of feats) {
      if (f.geometry.type !== 'Point') continue;
      if (haversine(lngLat, f.geometry.coordinates) < radius) {
        return { id: `${f.properties.name || ''}@${f.geometry.coordinates.map((v) => v.toFixed(4))}`, name: f.properties.name || '' };
      }
    }
    return null;
  }
}
