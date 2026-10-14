#!/usr/bin/env node
// Objective casting helper: you can't "listen" from a script, so measure instead.
//
//   node scripts/cast.js [outDir] [--cj <voice>] [--smoke <voice>]
//
// 1. Renders two test lines with every American/British male Kokoro voice (am_*, bm_*) at
//    speed 1.0 and measures median F0 (autocorrelation pitch tracker over voiced frames),
//    seconds of speech per word, and lists Kokoro's published quality grade.
// 2. Suggests CJ (good grade, mid pitch) and Big Smoke (good grade, deepest), then renders the
//    final configs (CJ speed 1.05; Smoke speed 0.92 at several pitch factors) and reports the
//    effective F0 after the sample-rate pitch trick, so Smoke's pitch can be tuned to sit
//    ~15-25% below CJ.
// WAVs are written to outDir (default: OS temp dir) so a human can audition them.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadKokoro, render, VOICES } from '../lib/engine.js';
import { encodeWav } from '../lib/audio.js';
import { trackPitch, median, percentile, speechSeconds, wordCount, peakAndRms } from '../lib/analyze.js';

const LINES = [
  'Yo, in three hundred meters, turn left onto Grove Street.',
  'Listen to me, CJ. Take the second exit at the roundabout.',
];
const GOOD = new Set(['A', 'A-', 'B+', 'B', 'B-', 'C+']); // "C+ or better"
const GRADE_ORDER = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F+', 'F'];

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outDir = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(os.tmpdir(), 'sa-tts-casting'));
await fs.mkdir(outDir, { recursive: true });

const tts = await loadKokoro({ modelDir: process.env.MODEL_DIR || './models', dtype: process.env.MODEL_DTYPE || 'q8' });

async function measure(voice, speed, pitch, tag) {
  const f0s = [];
  let secs = 0, words = 0, genMs = 0, audioSec = 0, peak = 0, rms = 0;
  for (let i = 0; i < LINES.length; i++) {
    const t0 = performance.now();
    const { samples, renderRate, sampleRate } = await render(tts, LINES[i], { voice, speed, pitch });
    genMs += performance.now() - t0;
    // Pitch measured on the rendered samples, then scaled by the playback-rate factor.
    for (const f of trackPitch(samples, renderRate)) f0s.push(f * (sampleRate / renderRate));
    secs += speechSeconds(samples, sampleRate);
    audioSec += samples.length / sampleRate;
    words += wordCount(LINES[i]);
    const pr = peakAndRms(samples);
    peak = Math.max(peak, pr.peak); rms += pr.rms / LINES.length;
    await fs.writeFile(path.join(outDir, `${tag}_${i + 1}.wav`), encodeWav(samples, sampleRate));
  }
  return {
    voice, speed, pitch,
    grade: VOICES[voice]?.overallGrade ?? '?',
    f0: median(f0s), f0p10: percentile(f0s, 0.1), f0p90: percentile(f0s, 0.9), voicedFrames: f0s.length,
    secPerWord: secs / words, rtf: genMs / 1000 / audioSec, genMs: genMs / LINES.length, peak, rms,
  };
}

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');

// ---- Phase 1: every American/British male voice, neutral settings ----
const males = Object.keys(VOICES).filter((v) => /^(am|bm)_/.test(v));
const base = [];
for (const v of males) {
  const m = await measure(v, 1.0, 1.0, `base_${v}`);
  base.push(m);
  console.error(`measured ${v}: F0 ${fmt(m.f0)} Hz, ${fmt(m.secPerWord, 3)} s/word, gen ${fmt(m.genMs, 0)} ms/line`);
}
base.sort((a, b) => a.f0 - b.f0);
console.log('\n## Phase 1 - all am_/bm_ voices at speed 1.0, pitch 1.0 (sorted by median F0)\n');
console.log('| voice | grade | median F0 (Hz) | F0 p10-p90 | s/word | peak | gen ms/line |');
console.log('|---|---|---|---|---|---|---|');
for (const m of base) {
  console.log(`| ${m.voice} | ${m.grade} | ${fmt(m.f0)} | ${fmt(m.f0p10, 0)}-${fmt(m.f0p90, 0)} | ${fmt(m.secPerWord, 3)} | ${fmt(m.peak, 2)} | ${fmt(m.genMs, 0)} |`);
}

// ---- Suggest casting ----
// Smoke: deepest good-grade American voice; F0 values within 3% count as a tie (that's inside
// the tracker's run-to-run noise), broken in favour of the slower natural pace.
// CJ: the remaining good voice closest to the median F0 of all male voices ("mid pitch") for
// which Smoke can still land 15-25% lower with a pitch factor in [0.84, 0.96].
const PMIN = 0.84, PMAX = 0.96;
const good = base.filter((m) => GOOD.has(m.grade) && m.voice.startsWith('am_'));
good.sort((a, b) => a.f0 - b.f0);
const deepTie = good.filter((m) => m.f0 <= good[0].f0 * 1.03).sort((a, b) => b.secPerWord - a.secPerWord);
const smokeVoice = flag('--smoke') || deepTie[0]?.voice;
const smokeBase = base.find((m) => m.voice === smokeVoice);
const mid = median(base.map((m) => m.f0));
const rest = good.filter((m) => m.voice !== smokeVoice).sort((a, b) => Math.abs(a.f0 - mid) - Math.abs(b.f0 - mid));
const feasible = (c) => Math.max(PMIN, (0.75 * c.f0) / smokeBase.f0) <= Math.min(PMAX, (0.85 * c.f0) / smokeBase.f0);
for (const c of rest) {
  console.log(`  CJ candidate ${c.voice} (${fmt(c.f0)} Hz): Smoke ${smokeVoice} needs pitch ${fmt((0.75 * c.f0) / smokeBase.f0, 3)}-${fmt((0.85 * c.f0) / smokeBase.f0, 3)} for 15-25% lower -> ${feasible(c) ? 'feasible' : `not feasible within ${PMIN}-${PMAX}`}`);
}
const cjVoice = flag('--cj') || (rest.find(feasible) || rest[0])?.voice;
console.log(`\nGood American voices (grade C+ or better), deepest first: ${good.map((m) => `${m.voice} ${fmt(m.f0)}Hz ${fmt(m.secPerWord, 3)}s/w`).join(', ')}`);
console.log(`Suggested: CJ = ${cjVoice} (nearest the all-male median ${fmt(mid)} Hz that leaves room for Smoke), Smoke = ${smokeVoice} (deepest good voice; ties -> slower pace)`);

// ---- Phase 2: final configurations ----
const cj = await measure(cjVoice, 1.05, 1.0, `final_cj_${cjVoice}`);
console.log('\n## Phase 2 - final settings (effective F0 after the sample-rate pitch trick)\n');
console.log('| role | voice | speed | pitch | eff. median F0 (Hz) | vs CJ | s/word |');
console.log('|---|---|---|---|---|---|---|');
console.log(`| CJ | ${cj.voice} | 1.05 | 1.00 | ${fmt(cj.f0)} | - | ${fmt(cj.secPerWord, 3)} |`);
const smokeRows = [];
for (const p of [0.96, 0.94, 0.92, 0.9, 0.88, 0.86, 0.84]) {
  const m = await measure(smokeVoice, 0.92, p, `final_smoke_${smokeVoice}_p${p}`);
  smokeRows.push(m);
  const pct = (1 - m.f0 / cj.f0) * 100;
  console.log(`| Smoke | ${m.voice} | 0.92 | ${p.toFixed(2)} | ${fmt(m.f0)} | -${fmt(pct)}% | ${fmt(m.secPerWord, 3)} |`);
}
// Among pitch factors that land Smoke 15-25% below CJ, take the one nearest the 0.88 target
// (enough to make him sound bigger, not enough to sound like a slowed tape); if none is in
// the band, the one closest to 20% lower.
const below = (m) => 1 - m.f0 / cj.f0;
const ok = smokeRows.filter((m) => below(m) >= 0.15 && below(m) <= 0.25).sort((a, b) => Math.abs(a.pitch - 0.88) - Math.abs(b.pitch - 0.88));
const pickSmoke = ok[0] || [...smokeRows].sort((a, b) => Math.abs(below(a) - 0.2) - Math.abs(below(b) - 0.2))[0];
console.log(`\nSuggested Smoke pitch: ${pickSmoke.pitch} (eff. F0 ${fmt(pickSmoke.f0)} Hz, ${fmt((1 - pickSmoke.f0 / cj.f0) * 100)}% below CJ's ${fmt(cj.f0)} Hz)`);
console.log(`Average generation time: ${fmt(cj.genMs, 0)} ms per line (RTF ${fmt(cj.rtf, 2)}). WAVs in ${outDir}`);
console.log(`\nJSON: ${JSON.stringify({ base, cj, smoke: smokeRows }, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v))}`);
