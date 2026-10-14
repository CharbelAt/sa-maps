// SA Maps controller: wires location -> navigator -> radar/HUD/crew, the browse
// UI (search, mission briefing, options) and the Android bridge (window.SA).

import {
  getSettings, setSetting, onSettingsChange, getPlaces, setHome, setWork, toggleFavorite,
  isFavorite, addRecent, getStats, addMission, ROUTE_COLORS,
} from './settings.js';
import { Radar } from './radar.js';
import { Hud } from './hud.js';
import { Voice } from './voice.js';
import { Crew, linesReady } from './crew.js';
import { LocationProvider } from './location.js';
import { Navigator, fetchRoute } from './nav.js';
import { Simulator } from './sim.js';
import { search, reverse } from './geo.js';
import { sfx, unlockAudio } from './sfx.js';
import { CLIP_SLOTS, loadClips, setClip, clearClip, getClip } from './clips.js';
import {
  haversine, shortDistance, spokenDistance, spokenDuration, shortDuration, clockTime, debounce,
} from './util.js';

const $ = (id) => document.getElementById(id);
const native = typeof window.SANative !== 'undefined';
const params = new URLSearchParams(location.search);
const MODE = params.get('mode') || (native ? safe(() => window.SANative.getMode(), 'phone') : 'web');
const isCar = MODE === 'car';
const LAST_POS_KEY = 'samaps.lastpos';
const DEFAULT_CENTER = [-118.2437, 34.0522]; // Los Santos... er, Los Angeles

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }

const settings = getSettings();
const hud = new Hud();
const voice = new Voice(getSettings);
const crew = new Crew({ voice, hud, getSettings });
const loc = new LocationProvider();
const nav = new Navigator();
const sim = new Simulator(loc);
const radar = new Radar(settings);

const state = {
  selected: null,
  preview: null,        // route for the briefing
  previewFrom: null,
  dest: null,
  rerouting: false,
  lastRerouteAt: 0,
  lastFixAt: 0,
  gpsLost: false,
  carActive: false,
  insets: { left: 0, top: 0, right: 0, bottom: 0 },
  zone: null,
  zoneCheckAt: 0,
  foodCheckAt: 0,
  foodSaid: new Set(),
  straightSaid: new Set(),
  routeDrawAt: 0,
  navState: { navigating: false },
  navStateSentAt: 0,
  centeredOnce: false,
  wakeLock: null,
};

// ------------------------------------------------------------------ layout ---

function layout() {
  const W = innerWidth, H = innerHeight;
  const body = document.body;
  const landscape = W > H * 1.15;
  const circle = settings.radarShape === 'circle' && !isCar;
  body.classList.toggle('landscape', landscape);
  body.classList.toggle('radar-circle', circle);
  if (body.classList.contains('mode-browse')) return;

  if (!circle) {
    // Full-screen radar: player low in the frame so you see more road ahead.
    let safe;
    if (isCar) {
      // Visible-area rect from the Android Auto host, in surface px.
      const dpr = window.devicePixelRatio || 1;
      const v = state.insets;
      const l = v.left / dpr, t = v.top / dpr;
      const r = v.right ? v.right / dpr : W, b = v.bottom ? v.bottom / dpr : H;
      safe = { left: l + 14, top: t + 14, right: r - 14, bottom: b - 14 };
      const s = body.style;
      s.setProperty('--il', `${l}px`); s.setProperty('--it', `${t}px`);
      s.setProperty('--ir', `${W - r}px`); s.setProperty('--ib', `${H - b}px`);
    } else if (landscape) {
      safe = { left: 18, top: 120, right: W - 18, bottom: H - 78 };
    } else {
      safe = { left: 16, top: 178, right: W - 16, bottom: H - 84 };
    }
    const anchor = [(safe.left + safe.right) / 2, safe.top + (safe.bottom - safe.top) * 0.66];
    radar.setView({ shape: 'full', safe, anchor });
    radar.resize();
    return;
  }

  radar.setView({ shape: 'circle' });
  let D, x, y;
  if (landscape) {
    D = Math.min(H - 24, W * 0.56);
    x = 12;
    y = (H - D) / 2;
  } else {
    // Between the top cluster (help box / HUD) and the bottom buttons.
    const top = 170, bottom = H - 76;
    D = Math.max(220, Math.min(W - 20, bottom - top));
    x = (W - D) / 2;
    y = Math.max(top, top + (bottom - top - D) / 2);
  }
  body.style.setProperty('--D', `${Math.round(D)}px`);
  body.style.setProperty('--rx', `${Math.round(x)}px`);
  body.style.setProperty('--ry', `${Math.round(y)}px`);
  radar.resize();
}

function setUiMode(mode) {
  const body = document.body;
  body.classList.toggle('mode-browse', mode === 'browse');
  body.classList.toggle('mode-nav', mode !== 'browse');
  radar.setMode(isCar ? 'car' : mode);
  layout();
}

// ------------------------------------------------------------------ money ----

function idleMoney() { hud.setMoney(getStats().meters); }
const moneyUnits = (m) => (settings.units === 'imperial' ? m * 1.09361 : m);

// ------------------------------------------------------------------ nav state

function mv(m, dist) {
  if (!m) return null;
  const o = {
    type: m.type, modifier: m.modifier, exit: m.exitNumber, drivingSide: m.drivingSide,
    icon: m.icon, street: m.street, instruction: m.instruction,
  };
  if (dist != null) o.distanceM = Math.round(dist);
  return o;
}

function publishNavState(s, force = false) {
  const base = { muted: settings.crew === 'mute', units: settings.units };
  let ns;
  if (!nav.route || !state.dest) {
    ns = { navigating: false, ...base };
  } else {
    ns = {
      navigating: true, arrived: nav.arrived, offRoute: nav.offRoute, rerouting: state.rerouting, ...base,
      destination: { name: state.dest.name, lat: state.dest.lat, lng: state.dest.lng },
      next: s ? mv(s.next, s.distToNext) : mv(nav.route.maneuvers[0], nav.route.maneuvers[0]?.startDist),
      then: s?.then ? mv(s.then) : null,
      remainingM: Math.round(s ? s.remaining : nav.route.total),
      remainingS: Math.round(s ? s.remainingS : nav.route.duration),
      etaEpochMs: Math.round(s ? s.eta : Date.now() + nav.route.duration * 1000),
      speedMps: s ? +s.speed.toFixed(1) : 0,
    };
  }
  state.navState = ns;
  const now = Date.now();
  if (!native || (!force && now - state.navStateSentAt < 500)) return;
  state.navStateSentAt = now;
  safe(() => window.SANative.onNavState(JSON.stringify(ns)));
}

// ------------------------------------------------------------------ fixes ----

function onFix(fix) {
  const now = Date.now();
  state.lastFixAt = now;
  const p = [fix.lng, fix.lat];
  if (fix.source !== 'sim') {
    safe(() => localStorage.setItem(LAST_POS_KEY, JSON.stringify(p)));
  }
  if (state.gpsLost) {
    state.gpsLost = false;
    if (nav.active) crew.event('gps_back');
  }

  let s = null;
  if (nav.active) s = nav.update(fix);
  radar.updatePlayer(fix, s?.snapped, s?.routeBearing);

  if (!state.centeredOnce && fix.source !== 'sim') {
    state.centeredOnce = true;
    if (radar.mode === 'browse' && !state.selected) radar.map.jumpTo({ center: p, zoom: 15 });
  }

  if (s && nav.active) updateNavUi(s, fix);

  // Zone name (SA shows the district when you enter it)
  if (radar.mode !== 'browse' && now - state.zoneCheckAt > 4000) {
    state.zoneCheckAt = now;
    const z = radar.zoneName(p);
    if (z && z !== state.zone) {
      const first = state.zone == null;
      state.zone = z;
      if (!first || !nav.active) hud.zone(z);
    }
  }

  // Off-route: keep trying to reroute.
  if (nav.active && nav.offRoute && !state.rerouting && now - state.lastRerouteAt > 10000) reroute(fix);
}

function updateNavUi(s, fix) {
  const units = settings.units;
  const next = localize(s.next);
  localize(s.then);
  hud.setManeuver(next?.icon, shortDistance(s.distToNext, units));
  const sub = s.then ? `Then ${s.then.action}` : (next?.kind !== 'arrive' && s.distToNext > 0 ? shortDistance(s.distToNext, units) : '');
  if (next) hud.help(next.instruction, sub, next.icon);
  hud.setProgress(s.progress);
  hud.setMoney(moneyUnits(s.remaining));
  hud.setTimers({ time: shortDuration(s.remainingS), eta: clockTime(new Date(s.eta)) });

  const now = Date.now();
  if (now - state.routeDrawAt > 900 && s.snapped) {
    state.routeDrawAt = now;
    radar.setRoute([s.snapped, ...nav.route.coords.slice(nav.idx + 1)]);
  }
  publishNavState(s);

  // Chatter
  const p = [fix.lng, fix.lat];
  const secondsToNext = s.distToNext / Math.max(s.speed, 5);
  if (now - state.foodCheckAt > 2000 && settings.chatty !== 'quiet') {
    state.foodCheckAt = now;
    const food = radar.nearbyFood(p);
    if (food && !state.foodSaid.has(food.id) && !voice.busy) {
      state.foodSaid.add(food.id);
      crew.event('fast_food', { name: food.name });
    }
  }
  if (next && s.distToNext > 3000 && s.speed > 10 && !state.straightSaid.has(next.index) && !voice.busy
      && now - crew.lastTalk > 60000) {
    state.straightSaid.add(next.index);
    crew.event('long_straight', { dist: spokenDistance(s.distToNext, units) });
  } else {
    crew.maybeBanter(secondsToNext);
  }
}

// ------------------------------------------------------------------ street names
// Routing returns local names (e.g. Arabic in Beirut). The English voices can't read
// those, so swap in the Latin-script name from the map tiles when we have it, and
// leave the name out of the spoken line when we don't.

const NON_LATIN = /[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F]/;
const latinCache = new Map();

function localize(m) {
  if (!m || m.localized || !m.street || !NON_LATIN.test(m.street)) return m;
  let latin = latinCache.get(m.street);
  if (!latin) {
    latin = radar.latinName(m.street);
    if (latin) latinCache.set(m.street, latin);
  }
  if (latin) {
    m.action = m.action.split(m.street).join(latin);
    m.instruction = m.instruction.split(m.street).join(latin);
    m.street = latin;
    m.localized = true;
    delete m.speech;
  }
  return m;
}

/** Version of the maneuver that's safe to read aloud. */
function speakable(m) {
  if (!m) return m;
  localize(m);
  if (!NON_LATIN.test(m.action)) return m;
  if (!m.speech) {
    const action = m.action
      .replace(/\s+(onto|on|towards|at)\s+[^,]*$/u, (seg) => (NON_LATIN.test(seg) ? '' : seg))
      .replace(new RegExp(`${NON_LATIN.source}+`, 'gu'), '')
      .replace(/\s+/g, ' ').trim();
    m.speech = { ...m, action, street: '' };
  }
  return m.speech;
}

// ------------------------------------------------------------------ navigator events

nav.addEventListener('announce', (e) => {
  const { phase, maneuver, distance, then } = e.detail;
  crew.instruction(phase, speakable(maneuver), { distance, then: speakable(then), units: settings.units, dest: state.dest?.name });
});
nav.addEventListener('offroute', (e) => {
  hud.setWanted(1, true);
  // Smoke's classic, then CJ deals with it.
  if (settings.crew !== 'cj') crew.event('wrong_turn', {}, { speaker: 'smoke' });
  crew.event('reroute', {}, { speaker: settings.crew === 'smoke' ? 'smoke' : 'cj' });
  publishNavState(null, true);
  reroute(e.detail.fix);
});
nav.addEventListener('onroute', () => { hud.setWanted(0); publishNavState(null, true); });
nav.addEventListener('arrivesoon', () => crew.event('arrive_soon', { dest: state.dest?.name }));
nav.addEventListener('arrived', () => finishNav('passed'));

async function reroute(fix) {
  if (state.rerouting || !state.dest) return;
  state.rerouting = true;
  state.lastRerouteAt = Date.now();
  hud.setWanted(2, true);
  publishNavState(null, true);
  try {
    const route = await fetchRoute([fix.lng, fix.lat], [state.dest.lng, state.dest.lat], {
      profile: settings.profile, heading: fix.heading, customBase: settings.routerUrl,
    });
    if (!state.dest) return;
    nav.replaceRoute(route);
    radar.setRoute(route.coords);
    hud.setWanted(0);
    sfx.cleared();
    crew.event('rerouted', { time: spokenDuration(route.duration) });
    sim.follow(route);
  } catch (err) {
    hud.toast(`Reroute failed: ${err.message}`);
  } finally {
    state.rerouting = false;
    publishNavState(null, true);
  }
}

// ------------------------------------------------------------------ start/stop

function origin() {
  const f = loc.lastReal || loc.last;
  return f ? [f.lng, f.lat] : null;
}

async function startNav(place, { route = null, test = false } = {}) {
  if (!isCar && state.carActive && native) {
    const res = safe(() => window.SANative.sendToCar(JSON.stringify(place)), 'no-car');
    if (res === 'ok') { hud.toast('Sent to your car'); closeBriefing(); return; }
  }
  let from = test ? state.previewFrom || origin() : origin();
  if (!from && test) {
    const c = radar.map.getCenter();
    from = [c.lng, c.lat];
  }
  if (!from) { hud.toast('Waiting for GPS…'); return; }
  try {
    if (!route) {
      route = await fetchRoute(from, [place.lng, place.lat], { profile: settings.profile, customBase: settings.routerUrl });
    }
  } catch (err) {
    crew.event('route_failed');
    hud.toast(err.noRoute ? 'No route found' : `Routing failed: ${err.message}`);
    return;
  }
  if (sim.running) sim.stop();
  state.dest = place;
  state.foodSaid.clear();
  state.straightSaid.clear();
  state.zone = null;
  addRecent(place);
  closeBriefing();
  radar.removeBlip('sel');
  radar.addBlip('dest', [place.lng, place.lat], 'assets/blips/destination.svg');
  radar.setRoute(route.coords);
  nav.start(route, place);
  setUiMode('nav');
  hud.setWanted(0);
  hud.missionTitle(place.name);
  setTimeout(() => { if (state.dest) hud.zone(radar.zoneName(from), settings.vehicle); }, 4600);
  sfx.start();

  await linesReady;
  voice.stop(); // drop any idle chatter
  crew.event('start', { dest: place.name, dist: spokenDistance(route.total, settings.units), time: spokenDuration(route.duration) });
  const hour = new Date().getHours();
  if (route.duration > 3600) crew.event('long_trip', { time: spokenDuration(route.duration) });
  else if (hour >= 22 || hour < 5) crew.event('night_drive');
  const depart = route.steps[0];
  if (depart?.action) crew.instruction('now', speakable({ ...depart, index: 0 }), { distance: 0, then: null, units: settings.units, dest: place.name, priority: 2 });

  keepAwake(true);
  publishNavState(null, true);
  if (test) sim.start(route);
}

function finishNav(kind) {
  const dest = state.dest;
  const total = nav.route?.total || 0;
  if (kind === 'passed') {
    addMission(total);
    hud.missionText('passed', 'Respect +');
    crew.event('arrived', { dest: dest?.name });
    setTimeout(() => hud.setMoney(getStats().meters, { animate: true }), 600);
  } else if (kind === 'failed') {
    voice.stop();
    hud.missionText('failed');
    crew.event('cancel');
  }
  sim.stop();
  nav.stop();
  state.dest = null;
  radar.setRoute(null);
  radar.removeBlip('dest');
  hud.hideHelp();
  hud.setTimers(null);
  hud.setManeuver(null);
  hud.setProgress(null);
  hud.setWanted(0);
  if (kind !== 'passed') idleMoney();
  keepAwake(false);
  publishNavState(null, true);
  if (!isCar) setTimeout(() => { if (!state.dest) setUiMode('browse'); }, kind === 'passed' ? 4500 : 1500);
}

async function keepAwake(on) {
  if (native) { safe(() => window.SANative.setKeepScreenOn(on)); return; }
  try {
    if (on && 'wakeLock' in navigator) state.wakeLock = await navigator.wakeLock.request('screen');
    else { await state.wakeLock?.release(); state.wakeLock = null; }
  } catch { /* not allowed */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.dest && !native) keepAwake(true);
});

// GPS watchdog
setInterval(() => {
  if (!nav.active || sim.running || state.gpsLost) return;
  if (state.lastFixAt && Date.now() - state.lastFixAt > 12000) {
    state.gpsLost = true;
    crew.event('gps_lost');
    hud.toast('GPS signal lost');
  }
}, 2000);

// ------------------------------------------------------------------ browse UI

const searchEl = $('search');
const resultsEl = $('results');
let searchCtrl = null;

function placeRow(p, icon, onClick) {
  const b = document.createElement('button');
  b.className = 'result';
  const o = origin();
  const dist = o ? shortDistance(haversine(o, [p.lng, p.lat]), settings.units) : '';
  b.innerHTML = `<img alt="" src="${icon}"><span class="r-text"><div class="r-name"></div><div class="r-addr"></div></span><span class="r-dist"></span>`;
  b.querySelector('.r-name').textContent = p.name;
  b.querySelector('.r-addr').textContent = p.address || '';
  b.querySelector('.r-dist').textContent = dist;
  b.addEventListener('click', onClick || (() => selectPlace(p)));
  return b;
}

function head(text) {
  const d = document.createElement('div');
  d.className = 'results-head';
  d.textContent = text;
  return d;
}

function showResults(nodes) {
  resultsEl.replaceChildren(...nodes);
  resultsEl.hidden = nodes.length === 0;
  document.body.classList.toggle('has-results', nodes.length > 0);
}

function showQuick() {
  const pl = getPlaces();
  const nodes = [];
  if (pl.home || pl.work) {
    nodes.push(head('Safehouses'));
    if (pl.home) nodes.push(placeRow({ ...pl.home, name: 'Home', address: pl.home.name }, 'assets/blips/home.svg', () => selectPlace(pl.home)));
    if (pl.work) nodes.push(placeRow({ ...pl.work, name: 'Work', address: pl.work.name }, 'assets/blips/work.svg', () => selectPlace(pl.work)));
  }
  if (pl.favorites.length) {
    nodes.push(head('Saved'));
    pl.favorites.slice(0, 8).forEach((p) => nodes.push(placeRow(p, 'assets/blips/favorite.svg')));
  }
  if (pl.recents.length) {
    nodes.push(head('Recent missions'));
    pl.recents.slice(0, 6).forEach((p) => nodes.push(placeRow(p, 'assets/blips/result.svg')));
  }
  showResults(nodes);
}

const runSearch = debounce(async (q) => {
  searchCtrl?.abort();
  searchCtrl = new AbortController();
  try {
    const c = radar.map.getCenter();
    const res = await search(q, origin() || [c.lng, c.lat], searchCtrl.signal);
    if (searchEl.value.trim() !== q) return;
    if (!res.length) {
      const d = document.createElement('div');
      d.className = 'results-empty';
      d.textContent = 'Nothing out here, homie. Try another name.';
      showResults([d]);
      return;
    }
    showResults(res.map((p) => placeRow(p, 'assets/blips/result.svg')));
  } catch (err) {
    if (err.name !== 'AbortError') hud.toast(`Search failed: ${err.message}`);
  }
}, 350);

searchEl.addEventListener('input', () => {
  const q = searchEl.value.trim();
  $('btn-clear').hidden = !searchEl.value;
  if (q.length < 2) { showQuick(); return; }
  runSearch(q);
});
searchEl.addEventListener('focus', () => { if (!searchEl.value.trim()) showQuick(); });
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') resultsEl.querySelector('.result')?.click();
  if (e.key === 'Escape') { searchEl.blur(); showResults([]); }
});
$('btn-clear').addEventListener('click', () => {
  searchEl.value = '';
  $('btn-clear').hidden = true;
  showResults([]);
  closeBriefing();
});
radar.addEventListener('longpress', async (e) => {
  if (radar.mode !== 'browse') return;
  const { lng, lat } = e.detail;
  selectPlace({ lng, lat, name: 'Dropped pin', address: '' });
  const p = await reverse(lng, lat);
  if (state.selected && state.selected.lng === lng && state.selected.lat === lat) {
    state.selected = { ...p, lng, lat };
    renderBriefing();
  }
});

$('btn-locate').addEventListener('click', () => {
  if (!loc.last) { hud.toast(loc.error ? 'Location is blocked — allow it in the browser' : 'Waiting for GPS…'); loc.start(); return; }
  radar.recenter();
});

// ---- briefing

function renderBriefing() {
  const p = state.selected;
  if (!p) return;
  $('brief-title').textContent = p.name;
  $('brief-addr').textContent = p.address || '';
  $('btn-fav').classList.toggle('on', isFavorite(p));
  $('btn-fav').textContent = isFavorite(p) ? '★ Saved' : '★ Save';
  for (const b of document.querySelectorAll('.brief-modes button')) {
    b.setAttribute('aria-checked', String(b.dataset.profile === settings.profile));
  }
}

async function selectPlace(p) {
  state.selected = p;
  state.preview = null;
  searchEl.blur();
  showResults([]);
  if (p.name && p.name !== 'Dropped pin') searchEl.value = p.name;
  $('btn-clear').hidden = !searchEl.value;
  $('briefing').hidden = false;
  document.body.classList.add('has-briefing');
  renderBriefing();
  radar.addBlip('sel', [p.lng, p.lat], 'assets/blips/destination.svg');
  sfx.select();
  await previewRoute();
}

async function previewRoute() {
  const p = state.selected;
  if (!p) return;
  const stats = $('brief-stats');
  const startBtn = $('btn-start');
  stats.textContent = 'Plotting route…';
  radar.setRoute(null);
  let from = origin();
  const usingGps = !!from;
  if (!from) { const c = radar.map.getCenter(); from = [c.lng, c.lat]; }
  state.previewFrom = from;
  startBtn.disabled = !usingGps && !(state.carActive && native);
  try {
    const route = await fetchRoute(from, [p.lng, p.lat], { profile: settings.profile, customBase: settings.routerUrl });
    if (state.selected !== p) return;
    state.preview = route;
    stats.textContent = `${shortDistance(route.total, settings.units)} · ${spokenDuration(route.duration)}`;
    if (!usingGps) {
      const note = document.createElement('small');
      note.textContent = 'From the map center — no GPS fix yet. Test drive works anyway.';
      stats.appendChild(note);
    }
    radar.setRoute(route.coords);
    const brief = $('briefing').getBoundingClientRect();
    radar.fit(route.coords, { top: 130, bottom: innerHeight - brief.top + 24, left: 36, right: 36 });
  } catch (err) {
    if (state.selected !== p) return;
    stats.textContent = err.noRoute ? 'No route — try another way to travel' : 'Routing server unreachable';
    radar.map.easeTo({ center: [p.lng, p.lat], zoom: 15, duration: 600 });
  }
}

function closeBriefing() {
  state.selected = null;
  state.preview = null;
  $('briefing').hidden = true;
  document.body.classList.remove('has-briefing');
  radar.removeBlip('sel');
  if (!nav.route) radar.setRoute(null);
}

$('brief-close').addEventListener('click', closeBriefing);
$('btn-start').addEventListener('click', () => {
  unlockAudio();
  const p = state.selected;
  if (p) startNav(p, { route: state.preview && origin() && haversine(origin(), state.previewFrom) < 50 ? state.preview : null });
});
$('btn-test').addEventListener('click', () => {
  unlockAudio();
  const p = state.selected;
  if (p) startNav(p, { route: state.preview, test: true });
});
$('btn-fav').addEventListener('click', () => {
  if (!state.selected) return;
  const on = toggleFavorite(state.selected);
  hud.toast(on ? 'Saved' : 'Removed from saved');
  renderBriefing();
});
$('btn-home').addEventListener('click', () => { if (state.selected) { setHome(state.selected); hud.toast('Home safehouse set'); refreshPlaceBlips(); } });
$('btn-work').addEventListener('click', () => { if (state.selected) { setWork(state.selected); hud.toast('Work set'); } });
for (const b of document.querySelectorAll('.brief-modes button')) {
  b.addEventListener('click', () => {
    setSetting('profile', b.dataset.profile);
    renderBriefing();
    previewRoute();
  });
}

function refreshPlaceBlips() {
  const home = getPlaces().home;
  if (home) radar.addBlip('home', [home.lng, home.lat], 'assets/blips/home.svg');
  else radar.removeBlip('home');
}

// ---- nav buttons

$('btn-end').addEventListener('click', () => { if (state.dest) finishNav('failed'); });
$('btn-overview').addEventListener('click', () => {
  if (nav.route) radar.overview(nav.route.coords.slice(nav.idx));
});
$('btn-recenter').addEventListener('click', () => radar.recenter());
$('btn-mute').addEventListener('click', () => toggleMute());
radar.addEventListener('followchange', () => { $('btn-recenter').hidden = radar.following || radar.mode === 'browse'; });

let crewBeforeMute = settings.crew === 'mute' ? 'both' : settings.crew;
function toggleMute() {
  if (settings.crew === 'mute') setSetting('crew', crewBeforeMute);
  else { crewBeforeMute = settings.crew; setSetting('crew', 'mute'); voice.stop(); }
  hud.toast(settings.crew === 'mute' ? 'Crew muted (subtitles only)' : 'Crew unmuted');
}

// ------------------------------------------------------------------ options --

const OPTIONS = [
  { key: 'crew', label: 'Crew', options: [['both', 'CJ + Smoke'], ['cj', 'CJ only'], ['smoke', 'Smoke only'], ['mute', 'Subtitles']] },
  { key: 'chatty', label: 'Chatter', options: [['quiet', 'Directions'], ['normal', 'Normal'], ['hood', 'Hood mode']] },
  { key: 'clean', label: 'Language', options: [[false, 'Uncut'], [true, 'Clean']] },
  { key: 'units', label: 'Units', options: [['metric', 'Metric'], ['imperial', 'Imperial']] },
  { key: 'routeColor', label: 'Route line', options: Object.keys(ROUTE_COLORS).map((k) => [k, k]) },
  { key: 'radarShape', label: 'Radar', options: [['full', 'Full screen'], ['circle', 'Classic radar']] },
  { key: 'trackUp', label: 'Radar turns', options: [[true, 'With you'], [false, 'North up']] },
  { key: 'radarLabels', label: 'Street names on radar', options: [[false, 'Off'], [true, 'On']] },
  { key: 'turf', label: 'Gang turf', options: [[true, 'On'], [false, 'Off']] },
  { key: 'vehicle', label: 'Your ride', type: 'text', placeholder: 'Greenwood' },
  { key: 'voiceEngine', label: 'Voices', options: [['neural', 'Neural'], ['device', 'Device']] },
  { key: 'ttsUrl', label: 'Voice server', type: 'text', placeholder: 'https://your-vps (tts-server)' },
  { key: 'voices.cj.voice', label: 'CJ fallback voice', type: 'voice' },
  { key: 'voices.smoke.voice', label: 'Smoke fallback voice', type: 'voice' },
  { key: 'routerUrl', label: 'Routing server', type: 'text', placeholder: 'Public OSM (default)' },
];

const getPath = (path) => path.split('.').reduce((o, k) => o?.[k], settings);

function renderOptions() {
  const list = $('options-list');
  list.replaceChildren();
  for (const opt of OPTIONS) {
    const row = document.createElement('div');
    row.className = 'opt';
    const label = document.createElement('div');
    label.className = 'opt-label';
    label.textContent = opt.label;
    row.appendChild(label);
    if (opt.type === 'text') {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = getPath(opt.key) || '';
      input.placeholder = opt.placeholder || '';
      input.setAttribute('aria-label', opt.label);
      input.addEventListener('change', () => setSetting(opt.key, input.value.trim()));
      row.appendChild(input);
    } else if (opt.type === 'voice') {
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', opt.label);
      const voices = voice.voices();
      sel.append(new Option('Automatic', ''));
      for (const v of voices) sel.append(new Option(v.label, v.name));
      sel.value = getPath(opt.key) || '';
      sel.addEventListener('change', () => { setSetting(opt.key, sel.value || null); voice.pushNativePrefs(); });
      row.appendChild(sel);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'opt-value';
      const val = document.createElement('span');
      val.className = 'val';
      const cur = () => opt.options.findIndex(([v]) => v === getPath(opt.key));
      const show = () => { val.textContent = (opt.options[cur()] || opt.options[0])[1]; };
      const step = (d) => {
        const i = (Math.max(0, cur()) + d + opt.options.length) % opt.options.length;
        setSetting(opt.key, opt.options[i][0]);
        sfx.select();
        show();
      };
      const mk = (txt, d, aria) => {
        const b = document.createElement('button');
        b.className = 'arrow';
        b.textContent = txt;
        b.setAttribute('aria-label', `${aria} ${opt.label}`);
        b.addEventListener('click', () => step(d));
        return b;
      };
      wrap.append(mk('◀', -1, 'Previous'), val, mk('▶', 1, 'Next'));
      show();
      row.appendChild(wrap);
    }
    list.appendChild(row);
  }
  for (const [slot, label] of CLIP_SLOTS) list.appendChild(clipRow(slot, label));
}

function clipRow(slot, label) {
  const row = document.createElement('div');
  row.className = 'opt';
  const l = document.createElement('div');
  l.className = 'opt-label';
  l.textContent = label;
  const wrap = document.createElement('div');
  wrap.className = 'opt-clip';
  const pickBtn = document.createElement('button');
  pickBtn.className = 'chip';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*';
  input.hidden = true;
  const clear = document.createElement('button');
  clear.className = 'chip';
  clear.textContent = 'Remove';
  const sync = () => {
    const has = !!getClip(slot);
    pickBtn.textContent = has ? 'Replace' : 'Choose file';
    pickBtn.classList.toggle('on', has);
    clear.hidden = !has;
  };
  pickBtn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { hud.toast('Keep clips under 4 MB'); return; }
    try { await setClip(slot, f); hud.toast(`${label} saved on this device`); } catch { hud.toast('Could not save clip'); }
    sync();
  });
  clear.addEventListener('click', async () => { await clearClip(slot); sync(); });
  sync();
  wrap.append(pickBtn, clear, input);
  row.append(l, wrap);
  return row;
}

$('btn-options').addEventListener('click', () => { renderOptions(); $('options').hidden = false; });
$('options-close').addEventListener('click', () => { $('options').hidden = true; });
for (const b of document.querySelectorAll('[data-test]')) {
  b.addEventListener('click', async () => {
    unlockAudio();
    await linesReady;
    const speaker = b.dataset.test;
    const prev = settings.crew;
    if (prev === 'mute') hud.toast('Crew is set to subtitles only');
    crew.instruction('prepare', { kind: 'turn', action: 'turn left onto Grove Street', street: 'Grove Street', dir: 'left', index: speaker === 'cj' ? 0 : 1 },
      { distance: 300, then: null, units: settings.units, dest: 'Grove Street' });
  });
}

onSettingsChange((path) => {
  if (['turf', 'routeColor', 'trackUp', 'radarLabels'].includes(path)) radar.applySettings();
  if (path === 'radarShape') { layout(); radar.applySettings(); }
  if (path.startsWith('voices')) voice.pushNativePrefs();
  if (path === 'crew') {
    document.body.classList.toggle('muted', settings.crew === 'mute');
    publishNavState(null, true);
  }
  if (path === 'units') { if (!nav.active) idleMoney(); publishNavState(null, true); }
});

// ------------------------------------------------------------------ Android bridge

window.SA = {
  ready: false,
  onNativeLocation: (l) => loc.pushNative(l),
  onTtsEvent: (id, ev) => voice.onNativeEvent(id, ev),
  setDisplayMode: (o) => {
    state.carActive = !!o?.carActive;
    document.body.classList.toggle('car-active', state.carActive && !isCar);
    $('car-banner').hidden = !(state.carActive && !isCar);
    if (state.carActive && !isCar && state.dest) finishNav('silent');
  },
  setCarInsets: (ins) => {
    state.insets = ins?.visible || ins?.stable || state.insets;
    layout();
  },
  onCarGesture: (g) => {
    const dpr = window.devicePixelRatio || 1;
    if (g.type === 'scroll') radar.panBy(g.dx / dpr, g.dy / dpr);
    else if (g.type === 'fling') radar.panBy(-g.vx / dpr / 8, -g.vy / dpr / 8);
    else if (g.type === 'scale' && g.factor > 0) radar.zoomBy(Math.log2(g.factor));
  },
  onCarCommand: (cmd) => {
    if (cmd === 'zoomIn') radar.zoomBy(1);
    else if (cmd === 'zoomOut') radar.zoomBy(-1);
    else if (cmd === 'recenter') radar.recenter();
    else if (cmd === 'overview' && nav.route) radar.overview(nav.route.coords.slice(nav.idx));
    else if (cmd === 'stopNav' && state.dest) finishNav('failed');
    else if (cmd === 'toggleMute') toggleMute();
  },
  navigateTo: (place) => startNav({ name: 'Destination', address: '', ...place, lat: +place.lat, lng: +place.lng }),
  getPlaces: () => JSON.stringify(getPlaces()),
  getState: () => JSON.stringify(state.navState),
  // handy for debugging in DevTools: SA.debug.nav / SA.debug.sim ...
  debug: { nav, sim, radar, loc, crew, voice, state },
};

// ------------------------------------------------------------------ boot -----

async function boot() {
  document.body.classList.toggle('car', isCar);
  document.body.classList.toggle('muted', settings.crew === 'mute');
  // UI mode + splash go up before the map loads, so nothing can start a mission
  // underneath the splash and get reset when the map finishes loading.
  setUiMode(isCar ? 'nav' : 'browse');
  if (!native) {
    $('splash').hidden = false;
    $('splash-start').addEventListener('click', async () => {
      unlockAudio();
      $('splash').hidden = true;
      loc.start();
      await linesReady;
      crew.event('welcome');
    }, { once: true });
  }
  idleMoney();
  loadClips();
  loc.addEventListener('fix', (e) => onFix(e.detail));
  loc.addEventListener('error', (e) => {
    if (e.detail?.code === 1) hud.toast('Location blocked — search still works, Test drive needs no GPS', 4000);
  });
  addEventListener('resize', layout);

  const last = safe(() => JSON.parse(localStorage.getItem(LAST_POS_KEY)), null);
  await radar.init(Array.isArray(last) ? last : DEFAULT_CENTER);
  if (Array.isArray(last) && !state.dest) radar.map.jumpTo({ center: last, zoom: 14 });
  refreshPlaceBlips();
  layout();

  window.SA.ready = true;
  if (native) {
    safe(() => window.SANative.onWebReady());
  } else if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
