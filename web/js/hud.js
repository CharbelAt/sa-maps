// San Andreas style HUD: clock, "weapon" slot (= next maneuver), health (= trip
// progress), armor (= battery), money, wanted stars, mission timers, help box,
// subtitles, zone name and the big mission passed/failed text.

import { clockTime } from './util.js';
import { sfx } from './sfx.js';

const $ = (id) => document.getElementById(id);
const NAMES = { cj: 'CJ', smoke: 'Big Smoke' };

export class Hud {
  constructor() {
    this.el = {
      clock: $('clock'), weaponIcon: $('weapon-icon'), ammo: $('ammo'),
      health: $('bar-health'), armor: $('bar-armor'), money: $('money'), wanted: $('wanted'),
      timers: $('timers'), tTime: $('t-time'), tEta: $('t-eta'),
      help: $('helpbox'), helpMain: $('help-main'), helpSub: $('help-sub'), helpIcon: $('help-icon'),
      sub: $('subtitle'), subText: $('subtitle-text'), subAvatar: $('subtitle-avatar'), subName: $('subtitle-name'),
      zone: $('zone'), zoneName: $('zone-name'), zoneVehicle: $('zone-vehicle'),
      title: $('mission-title'), mission: $('mission-text'), missionBig: $('mission-big'), missionSmall: $('mission-small'),
      toast: $('toast'),
    };
    this.money = 0;
    this.wantedLevel = 0;
    this.icon = null;
    for (let i = 0; i < 6; i++) {
      const s = document.createElement('i');
      this.el.wanted.appendChild(s);
    }
    this.tickClock();
    setInterval(() => this.tickClock(), 5000);
    this.watchBattery();
  }

  tickClock() { this.el.clock.textContent = clockTime(new Date()); }

  setManeuver(icon, distText) {
    const src = icon ? `assets/maneuver/${icon}.svg` : 'assets/hud/fist.svg';
    if (src !== this.icon) {
      this.icon = src;
      this.el.weaponIcon.src = src;
    }
    this.el.ammo.textContent = distText || '';
  }

  setProgress(frac) {
    this.el.health.style.setProperty('--v', frac == null ? 1 : Math.max(0.02, Math.min(1, frac)));
  }

  async watchBattery() {
    try {
      const b = await navigator.getBattery?.();
      if (!b) throw new Error('no battery api');
      const upd = () => {
        this.el.armor.hidden = false;
        this.el.armor.style.setProperty('--v', b.level);
      };
      b.addEventListener('levelchange', upd);
      upd();
    } catch {
      this.el.armor.hidden = true;
    }
  }

  setMoney(n, { animate = false } = {}) {
    n = Math.max(0, Math.min(99999999, Math.round(n)));
    cancelAnimationFrame(this.moneyRaf);
    if (!animate) {
      this.money = n;
      this.el.money.textContent = `$${String(n).padStart(8, '0')}`;
      return;
    }
    const from = this.money, t0 = performance.now(), dur = 1800;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      this.money = Math.round(from + (n - from) * k);
      this.el.money.textContent = `$${String(this.money).padStart(8, '0')}`;
      if (k < 1) this.moneyRaf = requestAnimationFrame(step);
    };
    this.moneyRaf = requestAnimationFrame(step);
  }

  setWanted(level, flashing = false) {
    if (level > this.wantedLevel) sfx.wanted();
    this.wantedLevel = level;
    [...this.el.wanted.children].forEach((s, i) => s.classList.toggle('on', i < level));
    this.el.wanted.classList.toggle('flash', flashing);
  }

  setTimers(t) {
    this.el.timers.hidden = !t;
    if (!t) return;
    this.el.tTime.textContent = t.time;
    this.el.tEta.textContent = t.eta;
  }

  help(main, sub, icon) {
    const changed = main !== this.el.helpMain.textContent;
    this.el.helpMain.textContent = main;
    this.el.helpSub.textContent = sub || '';
    this.el.helpSub.hidden = !sub;
    if (icon) this.el.helpIcon.src = `assets/maneuver/${icon}.svg`;
    this.el.helpIcon.hidden = !icon;
    if (this.el.help.hidden || changed) {
      this.el.help.hidden = false;
      if (changed) sfx.beep();
    }
  }

  hideHelp() { this.el.help.hidden = true; this.el.helpMain.textContent = ''; }

  subtitle(speaker, text) {
    clearTimeout(this.subTimer);
    this.el.subAvatar.src = `assets/avatars/${speaker}.svg`;
    this.el.subAvatar.alt = NAMES[speaker] || speaker;
    this.el.subName.textContent = NAMES[speaker] || speaker;
    this.el.sub.dataset.speaker = speaker;
    this.el.subText.textContent = text;
    this.el.sub.classList.add('show');
  }

  subtitleDone() {
    clearTimeout(this.subTimer);
    this.subTimer = setTimeout(() => this.el.sub.classList.remove('show'), 1400);
  }

  zone(name, vehicle) {
    if (!name && !vehicle) return;
    clearTimeout(this.zoneTimer);
    this.el.zoneName.textContent = name || '';
    this.el.zoneVehicle.textContent = vehicle || '';
    this.el.zoneVehicle.hidden = !vehicle;
    this.el.zone.classList.remove('show');
    void this.el.zone.offsetWidth;
    this.el.zone.classList.add('show');
    this.zoneTimer = setTimeout(() => this.el.zone.classList.remove('show'), 4500);
  }

  missionTitle(text) {
    clearTimeout(this.titleTimer);
    this.el.title.textContent = text;
    this.el.title.classList.add('show');
    this.titleTimer = setTimeout(() => this.el.title.classList.remove('show'), 4200);
  }

  missionText(kind, small) {
    clearTimeout(this.missionTimer);
    const m = this.el.mission;
    m.dataset.kind = kind;
    this.el.missionBig.textContent = kind === 'passed' ? 'Mission passed!' : 'Mission failed!';
    this.el.missionSmall.textContent = small || '';
    m.classList.remove('show');
    void m.offsetWidth;
    m.classList.add('show');
    if (kind === 'passed') sfx.passed(); else sfx.failed();
    this.missionTimer = setTimeout(() => m.classList.remove('show'), 5200);
  }

  toast(msg, ms = 2600) {
    clearTimeout(this.toastTimer);
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove('show'), ms);
  }
}
