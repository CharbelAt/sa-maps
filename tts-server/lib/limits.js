// Per-IP token-bucket rate limiter and a one-at-a-time job queue.

export class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

export class RateLimiter {
  /** @param {number} perMinute tokens per minute per key (also the burst size); <= 0 disables */
  constructor(perMinute) {
    this.cap = perMinute;
    this.ratePerMs = perMinute / 60_000;
    this.buckets = new Map();
    if (this.cap > 0) setInterval(() => this.#sweep(), 60_000).unref();
  }

  /** @returns {{ok: true} | {ok: false, retryAfter: number}} */
  take(key) {
    if (!(this.cap > 0)) return { ok: true };
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.cap, t: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.cap, b.tokens + (now - b.t) * this.ratePerMs);
    b.t = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true };
    }
    return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - b.tokens) / this.ratePerMs / 1000)) };
  }

  #sweep() {
    const now = Date.now();
    for (const [k, b] of this.buckets) {
      if (b.tokens + (now - b.t) * this.ratePerMs >= this.cap) this.buckets.delete(k);
    }
  }
}

/** Runs jobs strictly one after another (synthesis is CPU-bound; parallel runs only thrash). */
export class SerialQueue {
  constructor(maxPending = 64) {
    this.maxPending = maxPending;
    this.pending = 0;
    this.tail = Promise.resolve();
  }

  /** @template T @param {() => Promise<T>} job @returns {Promise<T>} */
  run(job) {
    if (this.pending >= this.maxPending) {
      return Promise.reject(new HttpError(503, 'server busy, try again shortly', { 'Retry-After': '5' }));
    }
    this.pending++;
    const p = this.tail.then(job);
    const done = () => {
      this.pending--;
    };
    this.tail = p.then(done, done);
    return p;
  }

  /** Resolves once everything queued so far has finished. */
  idle() {
    return this.tail;
  }
}
