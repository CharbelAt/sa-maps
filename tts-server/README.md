# SA Maps voice server

This is the neural text-to-speech backend for SA Maps. It speaks turn-by-turn directions as
"CJ" and "Big Smoke" with natural-sounding voices instead of the phone's robotic system TTS.

It runs [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), an open-weight model under
Apache-2.0, through [kokoro-js](https://www.npmjs.com/package/kokoro-js) and ONNX Runtime on
the CPU. No GPU and no Python are needed.

> **No voice cloning.** The characters are played by two of Kokoro's stock voices. They were
> picked by measurement to fit the roles: CJ is relaxed and mid-pitched, Big Smoke is deeper
> and slower. The server never clones or imitates any real person's voice, and it uses no
> recordings of the original actors. See [CASTING.md](CASTING.md).

| speaker | voice | speed | pitch |
|---|---|---|---|
| `cj` | `am_fenrir` | 1.05 | 1.00 |
| `smoke` | `am_michael` | 0.92 | 0.92 |

## API

Every endpoint sends CORS headers for the origins in `ALLOWED_ORIGINS` and answers `OPTIONS`
preflights. Every response also carries `Cross-Origin-Resource-Policy: cross-origin`.

| endpoint | returns |
|---|---|
| `GET /health` | `{ok, ready, voices:{cj, smoke}, model, dtype, queue, cached, rssMb}`. `ready` is false until the model is loaded and warmed up. |
| `GET /voices` | Every Kokoro voice id (name, language, gender, grade) plus the current casting. |
| `GET /speak?speaker=cj\|smoke&text=...` | `audio/wav`, 16-bit mono PCM. Optional overrides: `voice=<kokoro id>`, `speed=` (0.5-2), `pitch=` (0.75-1.25). |
| `POST /v1/audio/speech` | OpenAI-style. Takes `{"input": "...", "voice": "cj"\|"smoke"\|"<kokoro id>", "speed": 1.0}` and returns `audio/wav`. |

The main endpoint is `/speak`. The Android app streams it directly by URL, and the web app
fetches it.

### Audio responses

- **Caching headers.** Responses carry `Cache-Control: public, max-age=31536000, immutable`,
  an `ETag` (`If-None-Match` gets a `304`), `Content-Length`, and `Accept-Ranges: bytes`
  (single ranges get a `206`).
- **Cache status.** The `X-Cache` header says `HIT` or `MISS`.
- **Long text.** Text is trimmed, control characters are stripped and whitespace is
  collapsed. Anything longer than `MAX_TEXT` is cut at a word boundary, and the response then
  includes `X-Text-Truncated: 1`.
- **Errors.** Errors are JSON `{error}`:
  - `400`: empty text or a bad parameter.
  - `403`: the browser origin isn't allowed.
  - `429`: rate limited (comes with a `Retry-After` header).
  - `503`: the model is still loading after 60 s, or the render queue is full.
- **Pitch.** Kokoro has no pitch control. To lower pitch by a factor `p` with no DSP, the
  server renders at `speed / p` and labels the WAV with sample rate `24000 * p`. Playback then
  lowers the pitch by `p` and restores the requested tempo. A `pitch=0.92` clip therefore
  reports 22080 Hz.

### Caching and limits

- **Cache key.** Each clip is keyed by `sha1(dtype|voice|speed|pitch|text)`.
- **Cache layers.** Clips are kept in an in-memory LRU (`CACHE_ENTRIES`) and in an on-disk
  cache (`CACHE_DIR/<key>.wav`). The disk cache is pruned to `CACHE_DISK_MAX_MB`, so it
  survives restarts without growing forever.
- **Shared renders.** Identical concurrent requests share one render.
- **One render at a time.** Renders run one after another, because they are CPU-bound. They
  run in a worker thread. ONNX Runtime's Node binding renders synchronously, so on the main
  thread every render would also stall cached clips and `/health`.
- **Rate limit.** Only new (uncached) phrases count against the limit:
  `RATE_LIMIT_PER_MIN` per client IP. Cached clips are always served.
- **Logging.** The server logs one line per request: IP, method, path, status, ms,
  cache=`hit|disk|join|miss|etag`, speaker/voice and character count. The text itself is
  never logged.

### Latency and memory

These numbers are from the dev laptop (i7-13620H) for a typical 10-15 word line. The higher
figures were measured while the machine was busy with other work.

| model | real-time factor | 12-word line, uncached | process RSS (idle / peak) |
|---|---|---|---|
| fp32 | ~0.22-0.44 | ~1.0-1.9 s | ~0.6 GB / ~1.0 GB |
| q8 | ~0.73 | ~3.3 s | ~0.33 GB / ~0.65 GB |

- **Cached clips.** A cached clip is served in about 2 ms.
- **Long phrases.** A 280-character phrase renders in about 5 s with fp32.
- **Which model to use.** Prefer `MODEL_DTYPE=fp32` (the `.env.example` value). On a 1 GB VPS,
  use `q8` or add swap.
- **Slower hardware.** A small VPS CPU will be slower, which is why the web app prefetches
  upcoming lines.

## Run locally

Requires Node 20 or newer.

```sh
cd tts-server
npm ci
cp .env.example .env            # optional; edit as needed
node --env-file=.env server.js  # or: npm start  (built-in defaults, q8 model)
```

On Windows PowerShell without a `.env`, run:
`$env:MODEL_DTYPE='fp32'; $env:ALLOWED_ORIGINS='*'; npm start`.

The first start downloads the model from Hugging Face into `./models`: 92 MB for q8, 326 MB
for fp32. Then try it:

```sh
curl http://localhost:8787/health
curl -o cj.wav "http://localhost:8787/speak?speaker=cj&text=In%20300%20meters,%20turn%20left%20onto%20Grove%20Street."
curl -o smoke.wav -H "Content-Type: application/json" -d '{"input":"Take the second exit at the roundabout.","voice":"smoke"}' http://localhost:8787/v1/audio/speech
```

## Deploy to a VPS

These steps are for Ubuntu or Debian. Port 80 and port 443 must be reachable from the
internet. Copy this folder to the server (for example by cloning the repo), then run:

```sh
cd tts-server
sudo bash setup-vps.sh                     # -> https://<a-b-c-d>.sslip.io (no DNS needed)
# or with your own domain (A record -> this server) and CORS origins:
sudo bash setup-vps.sh tts.example.com https://charbelat.github.io,https://appassets.androidplatform.net
```

The script does the following:

1. Installs Docker Engine and the compose plugin from Docker's apt repository. It does not use
   `curl | sh`.
2. Detects the public IPv4 address.
3. Writes `.env` from `.env.example`.
4. Opens ports 80 and 443 if ufw is active.
5. Runs `docker compose up -d --build`, then waits for `/health`.
6. Prints the final `https://.../health` URL.

It is safe to re-run.

The stack has two services:

- **`tts`**: this server. It is not published on the host. Its model and clip cache live in
  the `tts-data` volume.
- **`caddy`**: terminates HTTPS with an automatic Let's Encrypt certificate for
  `TTS_DOMAIN` and reverse-proxies to `tts:8787`.

Put the printed `https://...` URL into the app's voice-server setting.

Day-to-day commands:

```sh
docker compose logs -f tts           # request log
docker compose up -d --build         # after pulling changes / editing .env
docker compose down                  # stop (volumes keep the model + cache)
```

### Configuration

Every variable is documented in [.env.example](.env.example):

- `TTS_DOMAIN`, `ALLOWED_ORIGINS` and `TRUST_PROXY`
- `MODEL_DTYPE` and `MODEL_DIR`
- `CJ_VOICE`, `CJ_SPEED`, `CJ_PITCH`, `SMOKE_VOICE`, `SMOKE_SPEED` and `SMOKE_PITCH`
- `CACHE_ENTRIES`, `CACHE_DIR` and `CACHE_DISK_MAX_MB`
- `MAX_TEXT`, `RATE_LIMIT_PER_MIN` and `MAX_QUEUE`

`ALLOWED_ORIGINS` should include the following (the code default is `*`):

- `https://charbelat.github.io`, for the web app.
- `https://appassets.androidplatform.net`, for the Android WebView.

The Android app's native player sends no `Origin` header, so it always works.

## Recasting voices

1. Run `npm run cast -- /tmp/casting`, or `npm run cast -- /tmp/casting --cj am_puck --smoke am_michael`.
   It renders test lines with every American and British male voice and prints these tables:
   - median F0, s/word and quality grade for each voice
   - Smoke's effective F0 at several pitch factors, against CJ's
2. Listen to the WAVs in that folder.
3. Set `CJ_VOICE` / `CJ_SPEED` / `CJ_PITCH` and `SMOKE_*` in `.env`, then restart:
   `docker compose up -d`.

A new setting creates new cache keys, so stale audio is never served. Any voice id from
`GET /voices` can also be auditioned ad hoc, for example `/speak?speaker=cj&voice=am_puck`.

## Files

```
server.js         HTTP server (node:http): routing, CORS, caching, queue, warm-up, shutdown
lib/synth.js      main-thread handle on the synthesis worker (lib/synth-worker.js)
lib/engine.js     Kokoro loading + render (pitch via sample-rate trick)
lib/audio.js      silence trim, peak normalise, 16-bit PCM WAV encoder
lib/cache.js      LRU + disk cache      lib/limits.js  rate limiter, serial queue
lib/text.js       text hygiene          lib/analyze.js pitch tracker used by casting
scripts/cast.js   casting measurements (npm run cast)
Dockerfile, docker-compose.yml, Caddyfile, setup-vps.sh, .env.example
```
