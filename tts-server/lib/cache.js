// In-memory LRU + optional on-disk cache of rendered WAV files (<dir>/<key>.wav).
import fs from 'node:fs/promises';
import path from 'node:path';

export class Lru {
  constructor(max) {
    this.max = Math.max(0, max | 0);
    this.map = new Map();
  }
  get(key) {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v); // mark most-recently used
    }
    return v;
  }
  set(key, value) {
    if (this.max === 0) return;
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  get size() {
    return this.map.size;
  }
}

export class DiskCache {
  /**
   * @param {string} dir
   * @param {number} maxBytes prune oldest files (by mtime) beyond this size; 0 = unbounded
   */
  constructor(dir, maxBytes, log = console.log) {
    this.dir = path.resolve(dir);
    this.maxBytes = maxBytes;
    this.log = log;
    this.bytes = 0;
    this.pruning = null;
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
    const files = await this.#list();
    this.bytes = files.reduce((s, f) => s + f.size, 0);
    this.log(`[cache] disk cache at ${this.dir}: ${files.length} files, ${(this.bytes / 1e6).toFixed(1)} MB`);
    await this.prune();
  }

  #file(key) {
    return path.join(this.dir, `${key}.wav`);
  }

  async get(key) {
    const file = this.#file(key);
    try {
      const buf = await fs.readFile(file);
      if (buf.length <= 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
        await fs.rm(file, { force: true });
        return null;
      }
      const now = new Date();
      fs.utimes(file, now, now).catch(() => {}); // keep recently used files on prune
      return buf;
    } catch (e) {
      if (e.code !== 'ENOENT') this.log(`[cache] read ${key} failed: ${e.message}`);
      return null;
    }
  }

  async put(key, buf) {
    const file = this.#file(key);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, file);
    this.bytes += buf.length;
    if (this.maxBytes > 0 && this.bytes > this.maxBytes) this.prune().catch((e) => this.log(`[cache] prune failed: ${e.message}`));
  }

  async #list() {
    const names = await fs.readdir(this.dir).catch(() => []);
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.wav') && !name.endsWith('.tmp')) continue;
      const full = path.join(this.dir, name);
      try {
        const st = await fs.stat(full);
        if (st.isFile()) out.push({ full, size: st.size, mtime: st.mtimeMs, tmp: name.endsWith('.tmp') });
      } catch { /* raced with a delete */ }
    }
    return out;
  }

  /** Delete least-recently-used files until the cache is under 90% of maxBytes. */
  prune() {
    if (this.pruning) return this.pruning;
    this.pruning = (async () => {
      const files = await this.#list();
      // Stale temp files from a crash are always removed.
      for (const f of files.filter((f) => f.tmp && Date.now() - f.mtime > 60_000)) await fs.rm(f.full, { force: true });
      const wavs = files.filter((f) => !f.tmp).sort((a, b) => a.mtime - b.mtime);
      let total = wavs.reduce((s, f) => s + f.size, 0);
      if (this.maxBytes > 0 && total > this.maxBytes) {
        const target = this.maxBytes * 0.9;
        let removed = 0;
        for (const f of wavs) {
          if (total <= target) break;
          await fs.rm(f.full, { force: true });
          total -= f.size;
          removed++;
        }
        this.log(`[cache] pruned ${removed} files, disk cache now ${(total / 1e6).toFixed(1)} MB`);
      }
      this.bytes = total;
    })().finally(() => {
      this.pruning = null;
    });
    return this.pruning;
  }
}
