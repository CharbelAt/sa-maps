# SA Maps — architecture & contracts

A Google-Maps-style navigator reskinned as the GTA San Andreas radar/HUD, with CJ and
Big Smoke reading the turn-by-turn directions.

```
web/                  Static PWA (GitHub Pages root). No build step, ES modules.
  index.html
  manifest.webmanifest, sw.js
  css/sa.css
  js/main.js          bootstrap + controller; defines window.SA (native -> web API)
  js/mapstyle.js      MapLibre style for the SA radar look (OpenFreeMap vector tiles)
  js/radar.js         map, camera modes, blips, route line, rim-clamped blips
  js/hud.js           clock, maneuver "weapon slot", bars, money, wanted stars, timers,
                      help box, subtitles, zone name, mission passed/failed text
  js/nav.js           OSRM routing, snapping/progress, off-route + reroute, announcements
  js/instructions.js  OSRM step -> neutral instruction text + icon key
  js/geo.js           Photon geocoding (search + reverse)
  js/location.js      location provider: browser geolocation | native bridge | simulator
  js/sim.js           "test drive" route simulator
  js/crew.js          dialogue engine (picks + fills lines from lines.js)
  js/lines.js         CJ & Big Smoke line bank (original writing, see schema below)
  js/voice.js         TTS: SANative bridge if present, else Web Speech API
  js/sfx.js           WebAudio-synthesized UI sounds (original, no game audio)
  js/settings.js      settings + places (localStorage)
  assets/             SVG icons, blips, avatars, app icons (all original art)
android/              Android app: phone WebView + Android Auto (Car App Library)
.github/workflows/    pages.yml (deploy web/), android.yml (build APK)
```

External services (all keyless, CORS-enabled, verified):
- Tiles: OpenFreeMap `https://tiles.openfreemap.org/planet` (OpenMapTiles schema),
  glyphs `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`
  (fonts: `Noto Sans Regular|Bold|Italic`).
- Routing: OSRM. Primary `https://routing.openstreetmap.de/routed-{car|bike|foot}/route/v1/driving/...`,
  fallback `https://router.project-osrm.org/route/v1/driving/...` (car only).
  Base URL is overridable in settings (for a self-hosted OSRM on a VPS).
- Geocoding: Photon `https://photon.komoot.io/api/?q=` and `/reverse?lat=&lon=`.

## Icon keys (shared by web HUD, assets, and Android maneuver mapping)

`depart, arrive, straight, turn-left, turn-right, slight-left, slight-right, sharp-left,
sharp-right, uturn-left, uturn-right, merge-left, merge-right, ramp-left, ramp-right,
fork-left, fork-right, keep-left, keep-right, roundabout-cw, roundabout-ccw`

(`roundabout-ccw` = right-hand traffic, `roundabout-cw` = left-hand traffic.)

## Web <-> Android bridge

### JS -> native: `window.SANative` (Android `addJavascriptInterface`)
All arguments are strings/numbers/booleans; JSON is passed as a string.

| method | notes |
|---|---|
| `speak(text, speaker, id)` | speaker `"cj"` or `"smoke"`. Native TTS, navigation-guidance audio attributes, transient ducking focus. Native reports progress via `SA.onTtsEvent`. |
| `playClip(url, text, speaker, id)` | Play a neural-voice clip (`url` = GET on the TTS server, audio/wav) through the same nav-guidance audio path and queue. Falls back to native TTS of `text` if the clip fails or doesn't start within 4 s. Reports via `SA.onTtsEvent`. |
| `stopSpeaking()` | flush queue (TTS and clips) |
| `getVoices()` | returns JSON string `[{name, locale, quality, network}]` (English voices) |
| `setVoicePrefs(json)` | `{"cj":{"voice":name|null,"pitch":0.95,"rate":1.05},"smoke":{...}}` |
| `onNavState(json)` | NavState (below). Sent on change, throttled to <= 2/s. |
| `onWebReady()` | web app finished init; native may now push mode/insets/location |
| `getMode()` | `"car"` or `"phone"` |
| `isCarActive()` | true when an Android Auto session currently owns navigation |
| `sendToCar(json)` | place JSON; native forwards to the car WebView's `SA.navigateTo`. Returns `"ok"` or `"no-car"` |
| `setKeepScreenOn(bool)` | phone only |
| `log(msg)` | logcat |

### Native -> JS: `window.SA` (defined by `web/js/main.js`)
Native calls these with `evaluateJavascript`.

| method | notes |
|---|---|
| `SA.onNativeLocation(loc)` | `{lat, lng, accuracy, heading|null (deg), speed|null (m/s), time (epoch ms)}` |
| `SA.onTtsEvent(id, event)` | event `"start"|"done"|"error"` |
| `SA.setDisplayMode(opts)` | `{mode:"car"|"phone", carActive:bool}` |
| `SA.setCarInsets(insets)` | `{visible:{left,top,right,bottom}, stable:{...}}` in **physical surface px**; web divides by `devicePixelRatio` |
| `SA.onCarGesture(g)` | `{type:"scroll",dx,dy}` / `{type:"fling",vx,vy}` / `{type:"scale",x,y,factor}` (px). Clicks are delivered as real MotionEvents to the WebView instead. |
| `SA.onCarCommand(cmd, arg)` | `zoomIn, zoomOut, recenter, overview, stopNav, toggleMute` |
| `SA.navigateTo(place)` | `{lat, lng, name, address?}` -> start navigation from current location |
| `SA.getPlaces()` | returns JSON string `{home, work, favorites:[place], recents:[place]}` |
| `SA.getState()` | returns JSON string of the latest NavState |
| `SA.ready` | `true` once initialized |

### NavState
```json
{
  "navigating": true,
  "arrived": false,
  "offRoute": false,
  "rerouting": false,
  "muted": false,
  "units": "metric",
  "destination": {"name": "Ganton", "lat": 34.0, "lng": -118.2},
  "next": {
    "type": "turn", "modifier": "left", "exit": null, "drivingSide": "right",
    "icon": "turn-left", "street": "Grove Street",
    "instruction": "Turn left onto Grove Street", "distanceM": 230.5
  },
  "then": null,
  "remainingM": 4520, "remainingS": 610, "etaEpochMs": 1760000000000,
  "speedMps": 12.3
}
```
When idle: `{"navigating": false, "muted": false, "units": "metric"}`.
`then` has the same shape as `next` minus `distanceM` (present only when the following
maneuver comes right after `next`).

## Line bank schema (`web/js/lines.js`)

```js
export const LINES = {
  // Instruction events: key = `${kind}_${phase}`, phase in far|prepare|now
  // kinds: depart, turn, sharp, slight, uturn, merge, ramp, exit, fork, keep,
  //        roundabout, endofroad, straight, arrive, generic
  turn_prepare: { cj: ["..."], smoke: ["..."] },
  ...
  // Situational events
  start, reroute, rerouted, arrive_soon, arrived, cancel, gps_lost, gps_back,
  long_straight, fast_food, night_drive, long_trip, route_failed, welcome, quip
};
export const BANTER = [ [["smoke","..."],["cj","..."]], ... ];  // 2-4 line exchanges
```

Template placeholders (engine fills them; a template whose placeholder has no value for
the current maneuver is skipped automatically):
`{action}` neutral instruction ("turn left onto Grove Street"), `{dist}` spoken distance
("300 meters"), `{street}`, `{dir}` ("left", "slight right"), `{exit}` ("third"),
`{dest}`, `{time}` ("12 minutes"), `{name}` (POI name, fast_food only).

Every instruction template must contain `{action}` or enough placeholders to be
unambiguous — the joke can't replace the direction.
