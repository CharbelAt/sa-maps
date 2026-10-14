// Main-thread handle on the synthesis worker (lib/synth-worker.js).
import { Worker } from 'node:worker_threads';

export class SynthWorker {
  constructor({ modelDir, dtype, log = console.log, onCrash = () => {} }) {
    this.opts = { modelDir, dtype };
    this.log = log;
    this.onCrash = onCrash;
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  /** Spawn the worker and resolve once the model is loaded (rejects if loading fails). */
  start() {
    return new Promise((resolve, reject) => {
      let loaded = false;
      let failure = null;
      const w = new Worker(new URL('./synth-worker.js', import.meta.url), { workerData: this.opts });
      this.worker = w;
      w.on('message', (m) => {
        if (m.type === 'log') this.log(m.msg);
        else if (m.type === 'ready') {
          loaded = true;
          resolve();
        } else if (m.type === 'result') {
          const p = this.pending.get(m.id);
          if (!p) return;
          this.pending.delete(m.id);
          if (m.ok) p.resolve(Buffer.from(m.buf.buffer, m.buf.byteOffset, m.buf.byteLength));
          else p.reject(new Error(m.error));
        }
      });
      w.on('error', (e) => {
        failure = e;
        this.log(`[worker] ${loaded ? 'crashed' : 'failed to load'}: ${e?.message || e}`);
      });
      w.on('exit', (code) => {
        if (this.worker === w) this.worker = null;
        const err = failure || new Error(`synthesis worker exited with code ${code}`);
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        if (!loaded) reject(err);
        else if (!this.stopping) this.onCrash(err);
      });
    });
  }

  /** @returns {Promise<Buffer>} WAV file */
  render(text, params) {
    if (!this.worker) return Promise.reject(new Error('synthesis worker is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'render', id, text, params });
    });
  }

  async stop() {
    this.stopping = true;
    await this.worker?.terminate();
  }
}
