// SA Maps neural voice server.
// CJ and Big Smoke read directions with two *stock* Kokoro-82M voices (open weights,
// Apache-2.0) cast to fit the characters. No voice cloning, no reference audio of anyone.
import http from 'node:http';
import crypto from 'node:crypto';
import { VOICES, isVoice, MODEL_ID } from './lib/engine.js';
import { SynthWorker } from './lib/synth.js';
import { Lru, DiskCache } from './lib/cache.js';
import { RateLimiter, SerialQueue, HttpError } from './lib/limits.js';
import { cleanText, hasWords } from './lib/text.js';

// ---------------------------------------------------------------- config
const env = process.env;
const num = (v, def) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : def);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;

const SPEED_RANGE = [0.5, 2.0];
const PITCH_RANGE = [0.75, 1.25];

// Casting defaults come from scripts/cast.js measurements (see CASTING.md).
const CASTING = {
  cj: {
    voice: env.CJ_VOICE || 'am_fenrir',
    speed: round2(clamp(num(env.CJ_SPEED, 1.05), ...SPEED_RANGE)),
    pitch: round2(clamp(num(env.CJ_PITCH, 1.0), ...PITCH_RANGE)),
  },
  smoke: {
    voice: env.SMOKE_VOICE || 'am_michael',
    speed: round2(clamp(num(env.SMOKE_SPEED, 0.92), ...SPEED_RANGE)),
    pitch: round2(clamp(num(env.SMOKE_PITCH, 0.92), ...PITCH_RANGE)),
  },
};

const CONFIG = {
  port: num(env.PORT, 8787),
  host: env.HOST || '0.0.0.0',
  allowedOrigins: (env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean),
  modelDir: env.MODEL_DIR || './models',
  dtype: env.MODEL_DTYPE || 'q8',
  cacheEntries: num(env.CACHE_ENTRIES, 500),
  cacheDir: env.CACHE_DIR ?? './cache', // empty string disables the disk cache
  cacheDiskMaxMb: num(env.CACHE_DISK_MAX_MB, 2048),
  maxText: Math.max(1, num(env.MAX_TEXT, 280)),
  rateLimit: num(env.RATE_LIMIT_PER_MIN, 40),
  maxQueue: Math.max(1, num(env.MAX_QUEUE, 64)),
  trustProxy: /^(1|true|yes)$/i.test(env.TRUST_PROXY || ''),
  readyTimeoutMs: 60_000,
};
const ANY_ORIGIN = CONFIG.allowedOrigins.length === 0 || CONFIG.allowedOrigins.includes('*');

for (const [who, c] of Object.entries(CASTING)) {
  if (!isVoice(c.voice)) {
    console.error(`Invalid ${who.toUpperCase()}_VOICE "${c.voice}". Available: ${Object.keys(VOICES).join(', ')}`);
    process.exit(1);
  }
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------------------------------------------------------------- state
const lru = new Lru(CONFIG.cacheEntries);
const disk = CONFIG.cacheDir ? new DiskCache(CONFIG.cacheDir, CONFIG.cacheDiskMaxMb * 1e6, log) : null;
const limiter = new RateLimiter(CONFIG.rateLimit);
const queue = new SerialQueue(CONFIG.maxQueue);
const inflight = new Map(); // key -> Promise<Buffer>

// The model lives in a worker thread so rendering never blocks the HTTP event loop.
const synth = new SynthWorker({
  modelDir: CONFIG.modelDir,
  dtype: CONFIG.dtype,
  log,
  onCrash: (err) => {
    if (shuttingDown) return;
    setReady(false);
    loadError = `synthesis worker crashed: ${err?.message || err}`;
    log(`[model] ${loadError}; restarting`);
    setTimeout(() => boot().catch((e) => log(`[boot] ${e?.stack || e}`)), 2000).unref();
  },
});
let ready = false;
let loadError = null;
let shuttingDown = false;
const readyWaiters = new Set();

function setReady(value) {
  ready = value;
  if (value) {
    for (const wake of readyWaiters) wake();
    readyWaiters.clear();
  }
}

/** Resolves when the model is ready; rejects with 503 after CONFIG.readyTimeoutMs. */
function waitReady() {
  if (ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const wake = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      readyWaiters.delete(wake);
      reject(new HttpError(503, 'voice model is still loading, try again shortly', { 'Retry-After': '10' }));
    }, CONFIG.readyTimeoutMs);
    readyWaiters.add(wake);
  });
}

// ---------------------------------------------------------------- synthesis
function cacheKey(p, text) {
  // Model precision is part of the key so switching MODEL_DTYPE never serves stale audio.
  return crypto.createHash('sha1').update([CONFIG.dtype, p.voice, p.speed.toFixed(2), p.pitch.toFixed(2), text].join('|')).digest('hex');
}

function produce(key, text, params) {
  return queue.run(async () => {
    const buf = await synth.render(text, params);
    lru.set(key, buf);
    disk?.put(key, buf).catch((e) => log(`[cache] write ${key} failed: ${e.message}`));
    return buf;
  });
}

/** Memory -> in-flight -> disk -> (rate limit) -> generate. */
async function getAudio(key, text, params, ip) {
  const mem = lru.get(key);
  if (mem) return { buf: mem, cache: 'hit' };
  let fly = inflight.get(key);
  if (fly) return { buf: await fly, cache: 'join' };
  if (disk) {
    const d = await disk.get(key);
    if (d) {
      lru.set(key, d);
      return { buf: d, cache: 'disk' };
    }
    fly = inflight.get(key); // another request may have started generating meanwhile
    if (fly) return { buf: await fly, cache: 'join' };
  }
  const r = limiter.take(ip); // only uncached generations count against the limit
  if (!r.ok) throw new HttpError(429, 'too many new phrases, slow down', { 'Retry-After': String(r.retryAfter) });
  const job = (async () => {
    await waitReady(); // requests that arrive before warm-up finishes wait (max 60 s)
    return produce(key, text, params);
  })();
  inflight.set(key, job);
  const clear = () => inflight.delete(key);
  job.then(clear, clear);
  return { buf: await job, cache: 'miss' };
}

/** Resolve speaker casting + optional overrides into validated synthesis params. */
function resolveParams({ speaker, voice, speed, pitch }) {
  const who = speaker == null || speaker === '' ? 'cj' : String(speaker).toLowerCase();
  if (!Object.hasOwn(CASTING, who)) throw new HttpError(400, 'speaker must be "cj" or "smoke"');
  const base = CASTING[who];
  const v = voice == null || voice === '' ? base.voice : String(voice);
  if (!isVoice(v)) throw new HttpError(400, `unknown voice "${v}" (see /voices)`);
  const parse = (val, def, name, [lo, hi]) => {
    if (val == null || val === '') return def;
    const n = Number(val);
    if (!Number.isFinite(n)) throw new HttpError(400, `${name} must be a number`);
    return round2(clamp(n, lo, hi));
  };
  return {
    speaker: who,
    voice: v,
    speed: parse(speed, base.speed, 'speed', SPEED_RANGE),
    pitch: parse(pitch, base.pitch, 'pitch', PITCH_RANGE),
  };
}

// ---------------------------------------------------------------- http helpers
function clientIp(req) {
  if (CONFIG.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1]; // the hop our own proxy appended
    }
  }
  return (req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
}

/** Apply CORS/CORP headers; returns false when the request's Origin is not allowed. */
function applyCors(req, res) {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const origin = req.headers.origin;
  if (ANY_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    res.setHeader('Vary', 'Origin');
    if (origin) {
      if (!CONFIG.allowedOrigins.includes(origin.toLowerCase())) return false;
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  }
  res.setHeader('Access-Control-Expose-Headers', 'ETag, Content-Length, Content-Range, X-Cache, X-Text-Truncated');
  return true;
}

function sendJson(res, status, obj, headers = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', ...headers });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

function sendAudio(req, res, buf, etag, extra) {
  const headers = {
    'Content-Type': 'audio/wav',
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: etag,
    'Accept-Ranges': 'bytes',
    ...extra,
  };
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range).trim());
  if (range && (range[1] !== '' || range[2] !== '')) {
    const len = buf.length;
    let start, end;
    if (range[1] === '') {
      start = Math.max(0, len - Number(range[2])); // suffix range: last N bytes
      end = len - 1;
    } else {
      start = Number(range[1]);
      end = range[2] === '' ? len - 1 : Math.min(len - 1, Number(range[2]));
    }
    if (start >= len || start > end) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${len}`, 'Content-Length': 0 });
      return res.end();
    }
    const part = buf.subarray(start, end + 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${len}`, 'Content-Length': part.length });
    return res.end(req.method === 'HEAD' ? undefined : part);
  }
  res.writeHead(200, { ...headers, 'Content-Length': buf.length });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

async function readJsonBody(req, limit = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'request body too large', { Connection: 'close' });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not an object');
    return obj;
  } catch {
    throw new HttpError(400, 'body must be a JSON object');
  }
}

// ---------------------------------------------------------------- handlers
async function speak(req, res, ctx, rawText, params) {
  const { text, truncated } = cleanText(rawText, CONFIG.maxText);
  if (!text || !hasWords(text)) throw new HttpError(400, 'text is required');
  ctx.info = `speaker=${params.speaker} voice=${params.voice} chars=${text.length}${truncated ? ' truncated' : ''}`;
  const key = cacheKey(params, text);
  const etag = `"${key}"`;
  const extra = truncated ? { 'X-Text-Truncated': '1' } : {};
  const inm = req.headers['if-none-match'];
  if (inm && String(inm).split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) {
    ctx.cache = 'etag';
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'public, max-age=31536000, immutable', ...extra });
    return res.end();
  }
  const { buf, cache } = await getAudio(key, text, params, ctx.ip);
  ctx.cache = cache;
  sendAudio(req, res, buf, etag, { 'X-Cache': cache === 'miss' || cache === 'join' ? 'MISS' : 'HIT', ...extra });
}

function castingJson() {
  return { cj: { ...CASTING.cj }, smoke: { ...CASTING.smoke } };
}

async function route(req, res, ctx, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const isGet = req.method === 'GET' || req.method === 'HEAD';

  if (p === '/health') {
    if (!isGet) throw new HttpError(405, 'method not allowed', { Allow: 'GET, HEAD' });
    return sendJson(res, 200, {
      ok: true,
      ready,
      voices: castingJson(),
      model: MODEL_ID,
      dtype: CONFIG.dtype,
      queue: queue.pending,
      cached: lru.size,
      rssMb: Math.round(process.memoryUsage().rss / 1e6),
      ...(loadError && !ready ? { error: loadError } : {}),
    });
  }
  if (p === '/voices') {
    if (!isGet) throw new HttpError(405, 'method not allowed', { Allow: 'GET, HEAD' });
    return sendJson(res, 200, {
      voices: Object.entries(VOICES).map(([id, v]) => ({
        id, name: v.name, language: v.language, gender: v.gender, grade: v.overallGrade, targetQuality: v.targetQuality,
      })),
      casting: castingJson(),
    });
  }
  if (p === '/speak') {
    if (!isGet) throw new HttpError(405, 'method not allowed', { Allow: 'GET, HEAD' });
    const q = url.searchParams;
    const params = resolveParams({ speaker: q.get('speaker'), voice: q.get('voice'), speed: q.get('speed'), pitch: q.get('pitch') });
    return speak(req, res, ctx, q.get('text'), params);
  }
  if (p === '/v1/audio/speech') {
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed', { Allow: 'POST' });
    const body = await readJsonBody(req);
    if (body.response_format != null && !['wav'].includes(String(body.response_format).toLowerCase())) {
      throw new HttpError(400, 'response_format must be "wav"');
    }
    // voice: "cj" | "smoke" (cast settings) or any Kokoro voice id (neutral speed/pitch).
    const v = body.voice == null || body.voice === '' ? 'cj' : String(body.voice).toLowerCase();
    const params = Object.hasOwn(CASTING, v)
      ? resolveParams({ speaker: v, speed: body.speed, pitch: body.pitch })
      : resolveParams({ speaker: 'cj', voice: v, speed: body.speed ?? 1, pitch: body.pitch ?? 1 });
    if (typeof body.input !== 'string') throw new HttpError(400, 'input must be a string');
    return speak(req, res, ctx, body.input, params);
  }
  if (p === '/') {
    if (!isGet) throw new HttpError(405, 'method not allowed', { Allow: 'GET, HEAD' });
    return sendJson(res, 200, {
      name: 'SA Maps voice server',
      note: 'Stock Kokoro-82M voices cast as CJ and Big Smoke; no voice cloning.',
      endpoints: ['GET /health', 'GET /voices', 'GET /speak?speaker=cj|smoke&text=...[&voice=&speed=&pitch=]', 'POST /v1/audio/speech'],
    });
  }
  throw new HttpError(404, 'not found');
}

const server = http.createServer(async (req, res) => {
  const t0 = performance.now();
  const ctx = { ip: clientIp(req), cache: '-', info: '' };
  let pathname = '?';
  res.on('close', () => {
    const ms = (performance.now() - t0).toFixed(0);
    const aborted = res.writableFinished ? '' : ' aborted';
    log(`${ctx.ip} ${req.method} ${pathname} ${res.statusCode} ${ms}ms cache=${ctx.cache}${ctx.info ? ` ${ctx.info}` : ''}${aborted}`);
  });
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    pathname = url.pathname;
    if (shuttingDown) res.setHeader('Connection', 'close');
    const allowed = applyCors(req, res);
    if (!allowed && pathname !== '/health') throw new HttpError(403, 'origin not allowed');
    if (req.method === 'OPTIONS') {
      const reqHeaders = String(req.headers['access-control-request-headers'] || '').replace(/[^A-Za-z0-9\-_, ]/g, '').slice(0, 200);
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
        'Access-Control-Allow-Headers': reqHeaders || 'Content-Type, Range',
        'Access-Control-Max-Age': '86400',
        Vary: ANY_ORIGIN ? 'Access-Control-Request-Headers' : 'Origin, Access-Control-Request-Headers',
        'Content-Length': 0,
      });
      return res.end();
    }
    await route(req, res, ctx, url);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) log(`[error] ${req.method} ${pathname}: ${err?.stack || err}`);
    if (res.headersSent) return res.destroy();
    sendJson(res, status, { error: status === 500 ? 'internal error' : err.message }, err.headers || {});
  }
});
server.requestTimeout = 120_000;
server.headersTimeout = 30_000;
server.keepAliveTimeout = 65_000; // longer than typical proxy idle timeouts

// ---------------------------------------------------------------- boot
/** Load the model in the worker (retrying with backoff), warm it up, then mark ready. */
async function boot() {
  for (let attempt = 1; !shuttingDown; attempt++) {
    try {
      const t = performance.now();
      log(`[model] loading ${MODEL_ID} (${CONFIG.dtype}) from ${CONFIG.modelDir}`);
      await synth.start();
      log(`[model] loaded in ${((performance.now() - t) / 1000).toFixed(1)} s`);
      loadError = null;
      break;
    } catch (e) {
      loadError = String(e?.message || e);
      const wait = Math.min(60, 5 * attempt);
      log(`[model] load failed (attempt ${attempt}): ${loadError}; retrying in ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
  if (shuttingDown) return;
  // Warm-up: render one short phrase per speaker through the model (deliberately skipping the
  // caches, so ONNX Runtime's first-run cost isn't paid by a real request).
  for (const who of Object.keys(CASTING)) {
    const t = performance.now();
    const params = resolveParams({ speaker: who });
    const text = "Alright, let's roll.";
    try {
      await produce(cacheKey(params, text), text, params);
      log(`[warmup] ${who} (${params.voice}, speed ${params.speed}, pitch ${params.pitch}) ${(performance.now() - t).toFixed(0)} ms`);
    } catch (e) {
      log(`[warmup] ${who} failed: ${e?.message || e}`);
    }
  }
  setReady(true);
  log('[ready] accepting synthesis requests');
}

server.listen(CONFIG.port, CONFIG.host, () => {
  log(
    `SA Maps voice server on http://${CONFIG.host}:${CONFIG.port} | origins: ${ANY_ORIGIN ? '*' : CONFIG.allowedOrigins.join(', ')}` +
      ` | CJ=${CASTING.cj.voice}@${CASTING.cj.speed}/${CASTING.cj.pitch} Smoke=${CASTING.smoke.voice}@${CASTING.smoke.speed}/${CASTING.smoke.pitch}` +
      ` | cache: ${CONFIG.cacheEntries} in memory, disk ${disk ? disk.dir : 'off'} | rate ${CONFIG.rateLimit}/min/IP`,
  );
  (async () => {
    if (disk) await disk.init().catch((e) => log(`[cache] disk cache unavailable: ${e.message}`));
    await boot();
  })().catch((e) => log(`[boot] fatal: ${e?.stack || e}`));
});

// ---------------------------------------------------------------- shutdown
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`[shutdown] ${signal}: finishing in-flight work`);
  const force = setTimeout(() => {
    log('[shutdown] timeout, exiting');
    process.exit(0);
  }, 10_000);
  force.unref();
  const closed = new Promise((r) => server.close(() => r()));
  server.closeIdleConnections?.();
  (async () => {
    while (queue.pending > 0) await queue.idle();
    await new Promise((r) => setTimeout(r, 250)); // let the last responses flush
    server.closeIdleConnections?.();
    await closed;
    await synth.stop();
  })()
    .catch(() => {})
    .finally(() => {
      log('[shutdown] bye');
      process.exit(0);
    });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
