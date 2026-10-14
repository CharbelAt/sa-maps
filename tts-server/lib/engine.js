// Kokoro-82M (ONNX, open weights, Apache-2.0) wrapper.
// Stock voices only — nothing here clones or imitates a real person's voice.
import path from 'node:path';
import { env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import { trimSilence, normalizePeak, encodeWav } from './audio.js';

export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const NATIVE_RATE = 24000; // Kokoro always renders at 24 kHz

/** Static voice table shipped with kokoro-js (id -> {name, language, gender, overallGrade, ...}). */
export const VOICES = Object.getOwnPropertyDescriptor(KokoroTTS.prototype, 'voices').get.call(null);

export function isVoice(id) {
  return typeof id === 'string' && Object.hasOwn(VOICES, id);
}

/**
 * Load the model, caching files under modelDir (downloaded from Hugging Face on first run).
 * @returns {Promise<KokoroTTS>}
 */
export async function loadKokoro({ modelDir = './models', dtype = 'q8', log = console.log } = {}) {
  env.cacheDir = path.resolve(modelDir);
  env.allowLocalModels = false; // only the cache dir + HF hub; avoids probing /models/
  const seen = new Map();
  return KokoroTTS.from_pretrained(MODEL_ID, {
    dtype,
    device: 'cpu',
    progress_callback: (p) => {
      if (p.status !== 'progress' || !p.total || p.total < 5e6) return;
      const step = Math.floor(p.progress / 25) * 25;
      if ((seen.get(p.file) ?? -1) >= step) return;
      seen.set(p.file, step);
      log(`[model] downloading ${p.file}: ${step}% of ${(p.total / 1e6).toFixed(0)} MB`);
    },
  });
}

/**
 * Render text to raw samples.
 * Pitch without DSP: to lower pitch by factor p while keeping tempo, ask Kokoro for
 * speed/p and declare the WAV at 24000*p Hz — the player slows it back down by p, which
 * lowers every frequency by p and restores the requested tempo.
 * @returns {Promise<{samples: Float32Array, renderRate: number, sampleRate: number}>}
 */
export async function render(tts, text, { voice, speed = 1, pitch = 1 }) {
  const raw = await tts.generate(text, { voice, speed: speed / pitch });
  return { samples: raw.audio, renderRate: raw.sampling_rate || NATIVE_RATE, sampleRate: Math.round((raw.sampling_rate || NATIVE_RATE) * pitch) };
}

/** Render + tidy (trim, normalise) + encode as WAV. */
export async function synthesizeWav(tts, text, opts) {
  const { samples, renderRate, sampleRate } = await render(tts, text, opts);
  const tidy = normalizePeak(trimSilence(samples, renderRate));
  return encodeWav(tidy, sampleRate);
}
