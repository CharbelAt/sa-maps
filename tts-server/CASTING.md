# Casting

CJ and Big Smoke are played by two **stock** Kokoro-82M voices. Nobody's voice is cloned and
no reference audio of any actor is used; the voices were chosen from measurements only.

| role | voice | grade | speed | pitch | effective median F0 | s/word |
|---|---|---|---|---|---|---|
| CJ | `am_fenrir` | C+ | 1.05 | 1.00 | 144.9 Hz | 0.318 |
| Big Smoke | `am_michael` | C+ | 0.92 | 0.92 | 109.3 Hz (24.6% below CJ) | 0.399 (25% slower) |

## Method

`npm run cast` (`scripts/cast.js`) renders the same two lines with every American and British
male voice:

- "Yo, in three hundred meters, turn left onto Grove Street."
- "Listen to me, CJ. Take the second exit at the roundabout."

For each voice it measures the median fundamental frequency (normalised-autocorrelation pitch
tracker, 40 ms frames / 10 ms hop, voiced frames only) and seconds of speech per word (leading
and trailing silence trimmed). Grades are Kokoro's published "overall grade" from
[VOICES.md](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md).

## All male voices at speed 1.0, pitch 1.0

Sorted by F0. `fp32` model. The `q8` column is the same measurement on the quantised model.
The ranking is the same, and the values are within about 3%.

| voice | grade | median F0 (Hz) | F0 p10-p90 | s/word | F0 on q8 |
|---|---|---|---|---|---|
| am_onyx | D | 86.2 | 75-107 | 0.307 | 83.0 |
| bm_lewis | D+ | 87.5 | 68-125 | 0.365 | 83.3 |
| am_echo | D | 111.0 | 90-149 | 0.346 | 108.4 |
| am_puck | C+ | 117.2 | 88-150 | 0.305 | 116.0 |
| **am_michael** | C+ | 118.8 | 94-149 | 0.367 | 115.8 |
| bm_fable | C | 123.6 | 84-170 | 0.373 | 120.0 |
| am_liam | D | 124.1 | 95-182 | 0.305 | 122.5 |
| am_adam | F+ | 124.1 | 91-144 | 0.321 | 120.0 |
| bm_daniel | D | 130.0 | 94-147 | 0.326 | 127.6 |
| bm_george | C | 145.5 | 100-174 | 0.374 | 142.3 |
| **am_fenrir** | C+ | 145.7 | 99-193 | 0.330 | 143.1 |
| am_eric | D | 157.6 | 114-207 | 0.279 | 156.4 |
| am_santa | D- | 185.1 | 118-266 | 0.380 | 178.8 |

## Why these two

- **Only C+ voices were considered.** Every voice graded C+ or better is American:
  `am_fenrir`, `am_michael` and `am_puck`. The deepest voices (`am_onyx`, `bm_lewis`) are
  graded D/D+.
- **Smoke is `am_michael`.** Michael and Puck tie for the deepest good voice. Their F0 is
  117-119 Hz, inside the tracker's run-to-run noise, and the order flips between q8 and fp32.
  Michael has by far the slower natural pace: 0.367 s/word against Puck's 0.305. That matches
  Smoke's slower delivery.
- **CJ is `am_fenrir`.** Puck is the closest to the median male F0 (124 Hz), so it would be
  the natural "mid pitch" pick. Its F0 is the same as Michael's, though. Pushing Smoke 15% below
  Puck would need a pitch factor of 0.84 or lower, the floor where it starts to sound like a
  slowed tape. Fenrir (C+, 146 Hz) is still within the normal adult-male speaking range. It
  leaves room for Smoke to sit about 25% lower with only light processing.
- **Smoke's pitch is 0.92.** This is the pitch factor nearest the 0.88 target that keeps him
  inside the 15-25% band (0.90 lands 26.4% lower). Final numbers: CJ 144.9 Hz at 0.318 s/word,
  Smoke 109.3 Hz at 0.399 s/word.

| Smoke pitch | 0.96 | 0.94 | 0.92 | 0.90 | 0.88 | 0.86 | 0.84 |
|---|---|---|---|---|---|---|---|
| F0 below CJ | 22.0% | 23.7% | **24.6%** | 26.4% | 27.1% | 28.8% | 30.9% |

**Alternative:** `CJ_VOICE=am_puck`, with Smoke unchanged except `SMOKE_PITCH=0.84`. CJ is
then closer to mid pitch, but Smoke is only about 14% lower than CJ.

## Recasting

Run `npm run cast -- <outDir>` (add `--cj <voice> --smoke <voice>` to force a pair). Listen to
the WAVs it writes, then set `CJ_*` / `SMOKE_*` in `.env`. The server checks the voice ids at
startup. Changing a voice or setting never serves stale audio, because those settings are
part of every cache key.
