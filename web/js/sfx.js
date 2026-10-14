// Tiny WebAudio synth for UI sounds. All tones are original (no game audio).

let ctx = null;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function unlockAudio() { ac(); }

function tone(freq, start, dur, { type = 'square', gain = 0.08, slideTo = null } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export const sfx = {
  // help-box blip
  beep() { tone(1320, 0, 0.07, { type: 'square', gain: 0.05 }); tone(1760, 0.075, 0.08, { type: 'square', gain: 0.04 }); },
  // menu select
  select() { tone(660, 0, 0.05, { type: 'triangle', gain: 0.07 }); },
  // mission start sting
  start() {
    [392, 523.25, 659.25].forEach((f, i) => tone(f, i * 0.09, 0.16, { type: 'sawtooth', gain: 0.05 }));
  },
  // mission passed: bright rising fanfare (original)
  passed() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 987.77, 1046.5, 1318.5];
    const times = [0, 0.12, 0.24, 0.36, 0.6, 0.72, 0.9];
    notes.forEach((f, i) => {
      tone(f, times[i], i === notes.length - 1 ? 0.9 : 0.2, { type: 'sawtooth', gain: 0.045 });
      tone(f / 2, times[i], i === notes.length - 1 ? 0.9 : 0.2, { type: 'triangle', gain: 0.06 });
    });
  },
  // mission failed: sad slide down
  failed() {
    tone(392, 0, 0.35, { type: 'sawtooth', gain: 0.05, slideTo: 330 });
    tone(330, 0.36, 0.35, { type: 'sawtooth', gain: 0.05, slideTo: 262 });
    tone(262, 0.72, 0.8, { type: 'sawtooth', gain: 0.05, slideTo: 175 });
  },
  // wanted level up
  wanted() {
    tone(880, 0, 0.12, { type: 'square', gain: 0.04, slideTo: 660 });
    tone(880, 0.16, 0.12, { type: 'square', gain: 0.04, slideTo: 660 });
  },
  // wanted level lost
  cleared() { tone(660, 0, 0.1, { type: 'triangle', gain: 0.06 }); tone(990, 0.1, 0.18, { type: 'triangle', gain: 0.06 }); },
};
