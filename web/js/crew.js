// CJ & Big Smoke dialogue engine: picks a line, fills it, sends it to the voice
// queue and the subtitle box.

import { capitalize, pick, spokenDistance } from './util.js';
import { getClip } from './clips.js';

let LINES = {};
let BANTER = [];
export const linesReady = import('./lines.js')
  .then((m) => { LINES = m.LINES || {}; BANTER = m.BANTER || []; })
  .catch(() => { /* fallback templates below still work */ });

const FALLBACK = {
  far: '{Action} in {dist}.',
  prepare: 'In {dist}, {action}.',
  now: '{Action}.',
};

const CLEAN = [
  [/\bshit(ty)?\b/gi, 'shoot'],
  [/\bdamn(ed)?\b/gi, 'dang'],
  [/\bhell\b/gi, 'heck'],
  [/\bass\b/gi, 'butt'],
  [/\bcrap(py)?\b/gi, 'crud'],
];

const PRIORITY = { now: 3, prepare: 2, far: 2 };
const EVENT_PRIORITY = {
  arrived: 3, wrong_turn: 2, reroute: 2, rerouted: 2, route_failed: 2, gps_lost: 2, gps_back: 1, cancel: 2,
  start: 2, arrive_soon: 1, long_trip: 1, night_drive: 1, welcome: 1,
  long_straight: 0, fast_food: 0, quip: 0,
};
const CHATTY_ONLY = new Set(['long_straight', 'fast_food', 'night_drive', 'long_trip', 'arrive_soon', 'welcome', 'gps_back']);
const PLACEHOLDER = /\{(\w+)\}/g;

export class Crew {
  constructor({ voice, hud, getSettings }) {
    this.voice = voice;
    this.hud = hud;
    this.getSettings = getSettings;
    this.recent = new Map();
    this.lastTalk = 0;
    this.lastBanter = Date.now();
    this.alt = 0;
  }

  get settings() { return this.getSettings(); }

  speakerFor(key, hint) {
    const crew = this.settings.crew;
    if (crew === 'cj' || crew === 'smoke') return crew;
    if (hint) return hint;
    if (key === 'fast_food') return Math.random() < 0.75 ? 'smoke' : 'cj';
    return Math.random() < 0.5 ? 'cj' : 'smoke';
  }

  choose(key, speaker, ctx) {
    const pool = LINES[key]?.[speaker] || [];
    const usable = pool.filter((t) => [...t.matchAll(PLACEHOLDER)].every(([, k]) => {
      const v = ctx[k.toLowerCase()];
      return v != null && v !== '';
    }));
    if (!usable.length) return null;
    const recentKey = `${key}:${speaker}`;
    const recent = this.recent.get(recentKey) || [];
    const fresh = usable.filter((t) => !recent.includes(t));
    const line = pick(fresh.length ? fresh : usable);
    this.recent.set(recentKey, [line, ...recent].slice(0, Math.min(6, Math.floor(usable.length / 2))));
    return line;
  }

  fill(template, ctx) {
    let text = template.replace(PLACEHOLDER, (_, k) => {
      const v = ctx[k.toLowerCase()] ?? '';
      return k[0] === k[0].toUpperCase() ? capitalize(String(v)) : String(v);
    });
    if (this.settings.clean) for (const [re, rep] of CLEAN) text = text.replace(re, rep);
    return capitalize(text.replace(/\s+/g, ' ').trim());
  }

  emit(text, speaker, priority, clip = null) {
    this.lastTalk = Date.now();
    this.voice.say({
      text, speaker, priority, clip,
      onstart: () => this.hud.subtitle(speaker, text),
      onend: () => this.hud.subtitleDone(),
    });
  }

  compose(phase, m, ctx, speaker) {
    let tpl = this.choose(`${m.kind}_${phase}`, speaker, ctx) || this.choose(`generic_${phase}`, speaker, ctx);
    if (!tpl) tpl = FALLBACK[phase] || FALLBACK.now;
    return this.fill(tpl, ctx);
  }

  /** Turn-by-turn instruction. m = maneuver from nav.js */
  instruction(phase, m, { distance, then, units, dest, priority }) {
    const speaker = this.speakerFor(null, m.index % 2 ? 'smoke' : 'cj');
    const ctx = {
      action: m.action, dist: spokenDistance(distance, units), street: m.street,
      dir: m.dir, exit: m.exit, dest,
    };
    // The "now" line was composed (and its audio prefetched) when "prepare" fired.
    let text = phase === 'now' && m.nowLine?.speaker === speaker ? m.nowLine.text : this.compose(phase, m, ctx, speaker);
    if (then) text += ` Then ${then.action}.`;
    this.emit(text, speaker, priority ?? PRIORITY[phase] ?? 2);
    if (phase === 'prepare' || phase === 'far') {
      m.nowLine = { speaker, text: this.compose('now', m, ctx, speaker) };
      this.voice.prefetch(m.nowLine.text, speaker);
    }
    if (phase === 'now') this.maybeQuip(speaker, distance);
    return text;
  }

  /** Situational line. Returns the spoken text or null. */
  event(key, ctx = {}, { speaker: hint } = {}) {
    const chatty = this.settings.chatty;
    if (chatty === 'quiet' && CHATTY_ONLY.has(key)) return null;
    let speaker = this.speakerFor(key, hint);
    let tpl = this.choose(key, speaker, ctx);
    if (!tpl) {
      // Only the other character has a line for this: let them say it when both ride along.
      const other = speaker === 'cj' ? 'smoke' : 'cj';
      tpl = this.choose(key, other, ctx);
      if (tpl && (this.settings.crew === 'both' || this.settings.crew === 'mute')) speaker = other;
    }
    if (!tpl) return null;
    const text = this.fill(tpl, ctx);
    this.emit(text, speaker, EVENT_PRIORITY[key] ?? 1, getClip(key));
    return text;
  }

  maybeQuip(prevSpeaker, distance) {
    const { chatty, crew } = this.settings;
    if (crew !== 'both' && crew !== 'mute') return;
    const p = chatty === 'hood' ? 0.4 : chatty === 'normal' ? 0.15 : 0;
    if (Math.random() >= p || distance > 400) return;
    const other = prevSpeaker === 'cj' ? 'smoke' : 'cj';
    const tpl = this.choose('quip', other, {});
    if (tpl) this.emit(this.fill(tpl, {}), other, 0);
  }

  /** Called periodically while driving; plays a banter exchange when there's room. */
  maybeBanter(secondsToNext) {
    const { chatty, crew } = this.settings;
    if (chatty === 'quiet' || (crew !== 'both' && crew !== 'mute') || !BANTER.length) return false;
    const gap = chatty === 'hood' ? 100 : 260;
    const now = Date.now();
    if (this.voice.busy || now - this.lastBanter < gap * 1000 || now - this.lastTalk < 25000) return false;
    if (secondsToNext < 45) return false;
    this.lastBanter = now;
    const recent = this.recent.get('banter') || [];
    const options = BANTER.map((_, i) => i).filter((i) => !recent.includes(i));
    const i = pick(options.length ? options : BANTER.map((_, j) => j));
    this.recent.set('banter', [i, ...recent].slice(0, Math.floor(BANTER.length / 2)));
    for (const [speaker, line] of BANTER[i]) this.emit(this.fill(line, {}), speaker, 0);
    return true;
  }
}
