// Settings + saved places, persisted in localStorage (best effort).

const SETTINGS_KEY = 'samaps.settings.v1';
const PLACES_KEY = 'samaps.places.v1';
const STATS_KEY = 'samaps.stats.v1';

export const DEFAULTS = {
  crew: 'both',          // both | cj | smoke | mute
  clean: false,          // swap mild profanity
  units: 'metric',       // metric | imperial
  routeColor: 'gold',    // gold | purple | red | green
  trackUp: true,         // radar rotates with heading
  radarShape: 'full',    // full (full-screen radar) | circle (classic minimap)
  carLayout: 'left',     // Android Auto: left (big radar) | small-left (half-size radar) | panel-left (map on the left third)
  music: true,           // music controls (Android app)
  radarLabels: false,    // street names on the radar (authentic = off)
  turf: true,            // gang turf tint over landuse
  places: true,          // restaurants, shops, fuel... with names
  profile: 'car',        // car | bike | foot
  vehicle: 'Greenwood',
  routerUrl: '',         // custom OSRM base, e.g. https://osrm.example.com
  voiceEngine: 'neural', // neural (tts-server) | device (built-in TTS)
  ttsUrl: '',            // overrides CONFIG.ttsUrl
  voices: {
    cj: { voice: null, pitch: 0.95, rate: 1.05 },
    smoke: { voice: null, pitch: 0.72, rate: 0.92 },
  },
};

export const ROUTE_COLORS = {
  gold: '#f2c230',
  purple: '#c04de0',
  red: '#e0393e',
  green: '#4fc24a',
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
}

function merge(base, extra) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k]) {
      out[k] = merge(out[k], v);
    } else if (k in out) {
      out[k] = v;
    }
  }
  return out;
}

const listeners = new Set();
const LEGACY_CAR_LAYOUT = { 'small-right': 'small-left', 'panel-right': 'panel-left' };
const loadSettings = () => {
  const s = merge(DEFAULTS, load(SETTINGS_KEY, {}));
  s.carLayout = LEGACY_CAR_LAYOUT[s.carLayout] || s.carLayout;
  return s;
};
let settings = loadSettings();

export function getSettings() { return settings; }

export function setSetting(path, value) {
  const keys = path.split('.');
  let obj = settings;
  for (const k of keys.slice(0, -1)) obj = obj[k];
  obj[keys.at(-1)] = value;
  save(SETTINGS_KEY, settings);
  for (const fn of listeners) fn(path, value, settings);
}

export function onSettingsChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Another window of the app changed settings (e.g. Options on the phone while the car
// screen is running): update in place so every module's reference stays valid.
window.addEventListener('storage', (e) => {
  if (e.key !== SETTINGS_KEY) return;
  const fresh = loadSettings();
  for (const [k, v] of Object.entries(fresh)) {
    if (JSON.stringify(settings[k]) === JSON.stringify(v)) continue;
    settings[k] = v;
    for (const fn of listeners) fn(k, v, settings);
  }
});

// ---- Places -------------------------------------------------------------

let places = Object.assign({ home: null, work: null, favorites: [], recents: [] }, load(PLACES_KEY, {}));

const samePlace = (a, b) => a && b && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;
const slim = (p) => ({ lat: +p.lat, lng: +p.lng, name: p.name || 'Dropped pin', address: p.address || '' });

export function getPlaces() { return places; }

export function setHome(p) { places.home = p ? slim(p) : null; save(PLACES_KEY, places); }
export function setWork(p) { places.work = p ? slim(p) : null; save(PLACES_KEY, places); }

export function isFavorite(p) { return places.favorites.some((f) => samePlace(f, p)); }

export function toggleFavorite(p) {
  if (isFavorite(p)) places.favorites = places.favorites.filter((f) => !samePlace(f, p));
  else places.favorites = [slim(p), ...places.favorites].slice(0, 30);
  save(PLACES_KEY, places);
  return isFavorite(p);
}

export function addRecent(p) {
  places.recents = [slim(p), ...places.recents.filter((r) => !samePlace(r, p))].slice(0, 15);
  save(PLACES_KEY, places);
}

// ---- Stats (lifetime "money") -------------------------------------------

let stats = Object.assign({ meters: 0, missions: 0 }, load(STATS_KEY, {}));
export function getStats() { return stats; }
export function addMission(meters) {
  stats.meters += Math.round(meters);
  stats.missions += 1;
  save(STATS_KEY, stats);
}
