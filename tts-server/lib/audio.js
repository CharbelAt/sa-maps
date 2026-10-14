// Tiny audio helpers: silence trimming, peak normalisation and a 16-bit PCM mono WAV encoder.
// We write the WAV header ourselves so the declared sample rate can differ from the rate the
// model rendered at — that is how pitch is lowered without any DSP (see lib/engine.js).

/**
 * Trim leading/trailing near-silence, keeping a little padding so words aren't clipped.
 * @param {Float32Array} samples
 * @param {number} sampleRate rate the samples were rendered at
 */
export function trimSilence(samples, sampleRate, { threshold = 0.006, padStartMs = 40, padEndMs = 110 } = {}) {
  const n = samples.length;
  let start = 0;
  while (start < n && Math.abs(samples[start]) < threshold) start++;
  if (start >= n) return samples; // all silence: leave untouched
  let end = n - 1;
  while (end > start && Math.abs(samples[end]) < threshold) end--;
  start = Math.max(0, start - Math.round((padStartMs / 1000) * sampleRate));
  end = Math.min(n - 1, end + Math.round((padEndMs / 1000) * sampleRate));
  return samples.subarray(start, end + 1);
}

/** Scale so the absolute peak hits `target` (only ever boosts/cuts by at most `maxGain`). */
export function normalizePeak(samples, target = 0.89, maxGain = 4) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-4) return samples;
  const gain = Math.min(maxGain, target / peak);
  if (Math.abs(gain - 1) < 0.01) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

/**
 * Encode Float32 samples (-1..1) as a 16-bit PCM mono RIFF/WAVE file.
 * @param {Float32Array} samples
 * @param {number} sampleRate value written into the header (playback rate)
 * @returns {Buffer}
 */
export function encodeWav(samples, sampleRate) {
  const sr = Math.round(sampleRate);
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sr, 24); // sample rate
  buf.writeUInt32LE(sr * 2, 28); // byte rate = sr * channels * 2
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    let s = samples[i];
    if (!(s > -1)) s = s !== s ? 0 : -1; // NaN -> 0, clamp low
    else if (s > 1) s = 1;
    buf.writeInt16LE(s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), off);
  }
  return buf;
}
