// Crew voices with a small priority queue.
// 1. Neural voices from tts-server (natural Kokoro voices cast for CJ and Smoke),
//    played natively in the Android app (SANative.playClip) or via <audio> in the browser.
// 2. Fallback: device text-to-speech (SANative.speak or the Web Speech API).

import { CONFIG } from '../config.js';

const MALE_HINTS = /(male|david|mark|guy|ryan|christopher|eric|roger|steffan|andrew|brian|davis|tony|jason|james|daniel|thomas|aaron|fred|alex|-x-iom|-x-iol|-x-tpd|-x-ioq)/i;
const FEMALE_HINTS = /(female|zira|aria|jenny|samantha|susan|hazel|libby|sonia|emma|michelle|ana|karen|moira|tessa|victoria|-x-sfg|-x-iob|-x-tpc|-x-tpf)/i;
const PREFETCH_MAX = 30;

let seq = 0;

export class Voice {
  constructor(getSettings) {
    this.getSettings = getSettings;
    this.queue = [];
    this.current = null;
    this.native = typeof window.SANative !== 'undefined';
    this.nativeClips = this.native && typeof window.SANative.playClip === 'function';
    this.webVoices = [];
    this.nativeVoices = [];
    this.watchdog = null;
    this.clips = new Map(); // url -> Promise<objectURL>
    this.audio = null;
    this.serverDown = 0;    // timestamp of last server failure (back off for a minute)
    if (!this.native && 'speechSynthesis' in window) {
      const load = () => { this.webVoices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)); };
      load();
      speechSynthesis.addEventListener?.('voiceschanged', load);
    }
    if (this.native) {
      try { this.nativeVoices = JSON.parse(window.SANative.getVoices() || '[]'); } catch { this.nativeVoices = []; }
      this.pushNativePrefs();
    }
  }

  get muted() { return this.getSettings().crew === 'mute'; }

  get server() {
    const s = this.getSettings();
    if (s.voiceEngine === 'device') return '';
    return (s.ttsUrl || CONFIG.ttsUrl || '').replace(/\/+$/, '');
  }

  get neural() { return !!this.server && Date.now() - this.serverDown > 60000; }

  clipUrl(text, speaker) {
    return `${this.server}/speak?speaker=${encodeURIComponent(speaker)}&text=${encodeURIComponent(text)}`;
  }

  /** Device voices for the options menu. */
  voices() {
    if (this.native) return this.nativeVoices.map((v) => ({ name: v.name, label: `${v.name} (${v.locale})` }));
    return this.webVoices.map((v) => ({ name: v.name, label: `${v.name} (${v.lang})` }));
  }

  pushNativePrefs() {
    if (!this.native) return;
    try { window.SANative.setVoicePrefs(JSON.stringify(this.getSettings().voices)); } catch { /* old app */ }
  }

  /** Warm the clip so a time-critical line starts instantly. */
  prefetch(text, speaker) {
    if (!this.neural || this.muted) return;
    const url = this.clipUrl(text, speaker);
    if (this.nativeClips) {
      // Warms the server cache; the app then streams it by URL.
      fetch(url, { mode: 'cors' }).then((r) => r.arrayBuffer()).catch(() => {});
      return;
    }
    this.loadClip(url);
  }

  loadClip(url, timeoutMs = 8000) {
    let p = this.clips.get(url);
    if (!p) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      p = fetch(url, { signal: ctrl.signal })
        .then((r) => { if (!r.ok) throw new Error(`TTS ${r.status}`); return r.blob(); })
        .then((b) => URL.createObjectURL(b))
        .finally(() => clearTimeout(t));
      p.catch(() => this.clips.delete(url));
      this.clips.set(url, p);
      while (this.clips.size > PREFETCH_MAX) {
        const [oldUrl, oldP] = this.clips.entries().next().value;
        this.clips.delete(oldUrl);
        oldP.then((o) => URL.revokeObjectURL(o)).catch(() => {});
      }
    }
    return p;
  }

  autoWebVoice(speaker) {
    const all = this.webVoices;
    if (!all.length) return null;
    const males = all.filter((v) => MALE_HINTS.test(v.name) && !FEMALE_HINTS.test(v.name));
    const pool = males.length ? males : all.filter((v) => !FEMALE_HINTS.test(v.name));
    const list = pool.length ? pool : all;
    const us = list.filter((v) => /en[-_]US/i.test(v.lang));
    const ordered = [...us, ...list.filter((v) => !us.includes(v))];
    return speaker === 'smoke' ? ordered[1] || ordered[0] : ordered[0];
  }

  /**
   * item: {text, speaker, priority (0 banter .. 3 urgent), onstart, onend}
   * Higher priority interrupts lower priority speech and drops queued lower items.
   */
  say(item) {
    item = { id: `u${++seq}`, priority: 1, ...item };
    if (this.current && item.priority >= 3 && this.current.priority < 3) {
      this.queue = this.queue.filter((q) => q.priority >= item.priority);
      this.cancelCurrent();
    } else if (item.priority >= 2) {
      this.queue = this.queue.filter((q) => q.priority >= 1);
    }
    if (item.priority === 0 && this.queue.length > 2) return; // don't pile up chatter
    if (item.priority < 3 && this.current) this.prefetch(item.text, item.speaker); // overlap fetch with current speech
    this.queue.push(item);
    this.queue.sort((a, b) => b.priority - a.priority);
    if (!this.current) this.next();
  }

  stop() {
    this.queue = [];
    this.cancelCurrent();
  }

  get busy() { return !!this.current || this.queue.length > 0; }

  cancelCurrent() {
    const cur = this.current;
    this.current = null;
    clearTimeout(this.watchdog);
    if (this.native) { try { window.SANative.stopSpeaking(); } catch { /* ignore */ } }
    else if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (this.audio) { this.audio.onended = this.audio.onerror = null; this.audio.pause(); }
    cur?.onend?.(cur, true);
  }

  next() {
    const item = this.queue.shift();
    if (!item) return;
    this.current = item;
    item.onstart?.(item);
    // Safety net only: engines normally report 'end'. Generous enough for slow clips.
    const est = 1500 + item.text.length * 80;
    this.watchdog = setTimeout(() => this.finish(item.id), this.muted ? 900 + item.text.length * 45 : est + 6000);
    if (this.muted) return;
    if (item.clip) { this.playBlob(item); return; }
    if (this.neural) {
      if (this.nativeClips) {
        try { window.SANative.playClip(this.clipUrl(item.text, item.speaker), item.text, item.speaker, item.id); }
        catch { this.speakDevice(item); }
      } else {
        this.playWebClip(item);
      }
      return;
    }
    this.speakDevice(item);
  }

  async playWebClip(item) {
    const url = this.clipUrl(item.text, item.speaker);
    try {
      const objUrl = await Promise.race([
        this.loadClip(url),
        new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), item.priority >= 3 ? 2500 : 7000)),
      ]);
      if (this.current?.id !== item.id) return;
      if (!this.audio) this.audio = new Audio();
      const a = this.audio;
      a.onended = () => this.finish(item.id);
      a.onerror = () => { if (this.current?.id === item.id) this.speakDevice(item); };
      a.src = objUrl;
      await a.play();
    } catch (err) {
      if (err?.message !== 'slow') this.serverDown = Date.now();
      if (this.current?.id === item.id) this.speakDevice(item);
    }
  }

  /** A user-supplied clip (Blob) — falls back to the normal voice path if it won't play. */
  async playBlob(item) {
    const url = URL.createObjectURL(item.clip);
    if (!this.audio) this.audio = new Audio();
    const a = this.audio;
    const fallback = () => {
      URL.revokeObjectURL(url);
      if (this.current?.id !== item.id) return;
      const rest = { ...item, clip: null };
      if (this.neural && this.nativeClips) {
        try { window.SANative.playClip(this.clipUrl(rest.text, rest.speaker), rest.text, rest.speaker, rest.id); return; } catch { /* fall through */ }
      }
      if (this.neural && !this.native) this.playWebClip(rest); else this.speakDevice(rest);
    };
    a.onended = () => { URL.revokeObjectURL(url); this.finish(item.id); };
    a.onerror = fallback;
    a.src = url;
    try { await a.play(); } catch { fallback(); }
  }

  speakDevice(item) {
    if (this.native) {
      try { window.SANative.speak(item.text, item.speaker, item.id); } catch { this.finish(item.id); }
      return;
    }
    if (!('speechSynthesis' in window)) return;
    const prefs = this.getSettings().voices[item.speaker] || {};
    const u = new SpeechSynthesisUtterance(item.text);
    const chosen = prefs.voice && this.webVoices.find((v) => v.name === prefs.voice);
    const v = chosen || this.autoWebVoice(item.speaker);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
    u.pitch = prefs.pitch ?? 1;
    u.rate = prefs.rate ?? 1;
    u.onend = () => this.finish(item.id);
    u.onerror = () => this.finish(item.id);
    speechSynthesis.speak(u);
  }

  finish(id) {
    if (!this.current || this.current.id !== id) return;
    const cur = this.current;
    this.current = null;
    clearTimeout(this.watchdog);
    cur.onend?.(cur, false);
    setTimeout(() => { if (!this.current) this.next(); }, 180);
  }

  /** Native TTS / clip callback (SA.onTtsEvent) */
  onNativeEvent(id, event) {
    if (event === 'done' || event === 'error') this.finish(id);
  }
}
