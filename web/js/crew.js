// CJ & Big Smoke: picks a short in-character line, fills it, sends it to the voice
// queue and the subtitle box. Directions only, plus a handful of key moments.

import { capitalize, pick, spokenDistance } from './util.js';
import { getClip } from './clips.js';

let LINES = {};
export const linesReady = import('./lines.js')
  .then((m) => { LINES = m.LINES || {}; })
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
const EVENT_PRIORITY = { arrived: 3, wrong_turn: 2, reroute: 2, route_failed: 2, gps_lost: 2, cancel: 2 };
const PLACEHOLDER = /\{(\w+)\}/g;

export class Crew {
  constructor({ voice, hud, getSettings }) {
    this.voice = voice;
    this.hud = hud;
    this.getSettings = getSettings;
    this.recent = new Map();
  }

  get settings() { return this.getSettings(); }

  speakerFor(hint) {
    const crew = this.settings.crew;
    if (crew === 'cj' || crew === 'smoke') return crew;
    return hint || (Math.random() < 0.5 ? 'cj' : 'smoke');
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
    this.recent.set(recentKey, [line, ...recent].slice(0, Math.floor(usable.length / 2)));
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
    const speaker = this.speakerFor(m.index % 2 ? 'smoke' : 'cj');
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
    return text;
  }

  /** Key moment (wrong turn, arrival, ...). Returns the spoken text or null. */
  event(key, ctx = {}, { speaker: hint } = {}) {
    let speaker = this.speakerFor(hint);
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
}
