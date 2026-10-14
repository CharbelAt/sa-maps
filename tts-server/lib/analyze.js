// Objective voice measurements used for casting (scripts/cast.js):
// fundamental frequency via a normalised-autocorrelation pitch tracker, plus speech duration.

/**
 * Per-frame F0 estimates (Hz) over voiced frames.
 * @param {Float32Array} x samples
 * @param {number} sr sample rate the samples were rendered at
 */
export function trackPitch(x, sr, { fmin = 55, fmax = 350, frameMs = 40, hopMs = 10, voicedCorr = 0.6 } = {}) {
  const N = Math.round((frameMs / 1000) * sr);
  const hop = Math.round((hopMs / 1000) * sr);
  const minLag = Math.floor(sr / fmax);
  const maxLag = Math.min(Math.ceil(sr / fmin), N - 1);

  // Energy gate relative to the loud part of the utterance.
  const rmsList = [];
  for (let s = 0; s + N <= x.length; s += hop) {
    let e = 0;
    for (let i = 0; i < N; i++) e += x[s + i] * x[s + i];
    rmsList.push(Math.sqrt(e / N));
  }
  const sorted = [...rmsList].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const gate = loud * 0.12;

  const f0s = [];
  const frame = new Float64Array(N);
  const r = new Float64Array(maxLag + 2);
  for (let fi = 0, s = 0; s + N <= x.length; s += hop, fi++) {
    if (rmsList[fi] < gate) continue;
    let mean = 0;
    for (let i = 0; i < N; i++) mean += x[s + i];
    mean /= N;
    for (let i = 0; i < N; i++) frame[i] = x[s + i] - mean;

    // Normalised cross-correlation of the frame with itself shifted by `lag`.
    let best = -1;
    for (let lag = minLag; lag <= maxLag + 1; lag++) {
      let num = 0, e1 = 0, e2 = 0;
      for (let i = 0; i + lag < N; i++) {
        const a = frame[i], b = frame[i + lag];
        num += a * b; e1 += a * a; e2 += b * b;
      }
      r[lag] = e1 > 0 && e2 > 0 ? num / Math.sqrt(e1 * e2) : 0;
      if (lag <= maxLag && r[lag] > best) best = r[lag];
    }
    if (best < voicedCorr) continue; // unvoiced / noisy

    // Avoid octave-down errors: take the shortest-lag local peak close to the global best.
    let pick = -1;
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if (r[lag] >= 0.88 * best && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) { pick = lag; break; }
    }
    if (pick < 0) continue;
    // Parabolic interpolation around the peak for sub-sample precision.
    const a = r[pick - 1], b = r[pick], c = r[pick + 1];
    const denom = a - 2 * b + c;
    const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    f0s.push(sr / (pick + Math.max(-0.5, Math.min(0.5, shift))));
  }
  return f0s;
}

export function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function percentile(arr, q) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/** Duration (s) of the region between first and last sample above `threshold`. */
export function speechSeconds(x, sr, threshold = 0.01) {
  let a = 0, b = x.length - 1;
  while (a < x.length && Math.abs(x[a]) < threshold) a++;
  while (b > a && Math.abs(x[b]) < threshold) b--;
  return b > a ? (b - a + 1) / sr : 0;
}

export function peakAndRms(x) {
  let peak = 0, e = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v > peak) peak = v;
    e += x[i] * x[i];
  }
  return { peak, rms: Math.sqrt(e / Math.max(1, x.length)) };
}

export function wordCount(text) {
  return text.trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}
