// MapLibre style that imitates the San Andreas radar: muted olive land, navy water,
// pale flat roads, no clutter. Data: OpenFreeMap (OpenMapTiles schema).

export const PALETTE = {
  land: '#5d6a55',
  residential: '#58644f',
  grass: '#4f6b3f',
  wood: '#405d36',
  farmland: '#677152',
  sand: '#a69469',
  rock: '#77725f',
  ice: '#c8d2d4',
  wetland: '#4e6650',
  water: '#2c4a6e',
  waterLine: '#3a5c84',
  building: '#4d5747',
  runway: '#8a8c82',
  casing: '#23271f',
  minor: '#9da092',
  secondary: '#bdbfb2',
  primary: '#d6d4c5',
  motorway: '#e4ddc2',
  rail: '#363a32',
  label: '#ffffff',
  labelHalo: '#111111',
  // gang turf tints (Grove / Ballas / Vagos)
  grove: 'rgba(46, 140, 58, 0.30)',
  ballas: 'rgba(150, 62, 178, 0.24)',
  vagos: 'rgba(226, 196, 40, 0.20)',
};

const P = PALETTE;
const FONT = ['Noto Sans Bold'];

const w = (stops) => ['interpolate', ['exponential', 1.45], ['zoom'], ...stops.flat()];

const ROADS = [
  // id, class filter, color, width stops, minzoom
  ['path', ['in', 'class', 'path', 'track'], '#7f8574', [[14, 0.4], [16, 1.2], [18, 3]], 14],
  ['service', ['==', 'class', 'service'], P.minor, [[13, 0.3], [15, 1.6], [16, 3], [18, 9]], 13],
  ['minor', ['==', 'class', 'minor'], P.minor, [[11, 0.3], [13, 0.9], [14, 2.2], [16, 6], [18, 17]], 11],
  ['secondary', ['in', 'class', 'secondary', 'tertiary'], P.secondary, [[8, 0.4], [10, 0.9], [12, 1.6], [14, 4.2], [16, 9.5], [18, 23]], 8],
  ['primary', ['in', 'class', 'primary', 'trunk'], P.primary, [[6, 0.4], [8, 0.8], [10, 1.5], [12, 2.6], [14, 5.6], [16, 12], [18, 28]], 6],
  ['motorway', ['==', 'class', 'motorway'], P.motorway, [[5, 0.5], [8, 1.1], [10, 2], [12, 3.2], [14, 7], [16, 14], [18, 34]], 5],
];

function roadLayers(brunnel) {
  const layers = [];
  const brunnelFilter = brunnel === 'tunnel'
    ? ['==', 'brunnel', 'tunnel']
    : brunnel === 'bridge' ? ['==', 'brunnel', 'bridge'] : ['!in', 'brunnel', 'tunnel', 'bridge'];
  const opacity = brunnel === 'tunnel' ? 0.45 : 1;
  for (const [id, filter, color, stops, minzoom] of ROADS) {
    if (id === 'path' && brunnel) continue;
    const f = ['all', ['==', '$type', 'LineString'], filter, brunnelFilter];
    const casingStops = stops.map(([z, v]) => [z, v + (z >= 14 ? 2.2 : 0.8)]);
    if (id !== 'path') {
      layers.push({
        id: `road-${brunnel || 'surface'}-${id}-casing`, type: 'line', source: 'omt', 'source-layer': 'transportation',
        minzoom: Math.max(minzoom, 10), filter: f,
        layout: { 'line-cap': brunnel === 'bridge' ? 'butt' : 'round', 'line-join': 'round' },
        paint: { 'line-color': P.casing, 'line-width': w(casingStops), 'line-opacity': opacity },
      });
    }
    layers.push({
      id: `road-${brunnel || 'surface'}-${id}`, type: 'line', source: 'omt', 'source-layer': 'transportation',
      minzoom, filter: f,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': color, 'line-width': w(stops), 'line-opacity': opacity,
        ...(id === 'path' ? { 'line-dasharray': [2, 1.5] } : {}),
      },
    });
  }
  return layers;
}

export function buildStyle({ labels = true, turf = true } = {}) {
  const vis = (on) => (on ? 'visible' : 'none');
  return {
    version: 8,
    name: 'San Andreas Radar',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
        attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': P.land } },
      {
        id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover',
        paint: {
          'fill-color': ['match', ['get', 'class'],
            'grass', P.grass, 'wood', P.wood, 'farmland', P.farmland, 'sand', P.sand,
            'rock', P.rock, 'ice', P.ice, 'wetland', P.wetland, P.grass],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 0.9],
        },
      },
      {
        id: 'landuse', type: 'fill', source: 'omt', 'source-layer': 'landuse',
        filter: ['in', 'class', 'residential', 'cemetery', 'stadium', 'pitch', 'playground', 'school', 'hospital', 'military', 'railway'],
        paint: {
          'fill-color': ['match', ['get', 'class'],
            'residential', P.residential, 'cemetery', P.grass, 'pitch', P.grass, 'playground', P.grass,
            'stadium', '#626a59', 'military', '#5f5a4c', 'railway', '#565a50', '#5a6553'],
          'fill-opacity': 0.9,
        },
      },
      {
        id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park',
        paint: { 'fill-color': P.grass, 'fill-opacity': 0.75 },
      },
      {
        id: 'turf', type: 'fill', source: 'omt', 'source-layer': 'landuse', minzoom: 10,
        filter: ['in', 'class', 'residential', 'commercial', 'retail', 'industrial'],
        layout: { visibility: vis(turf) },
        paint: {
          'fill-color': ['match', ['get', 'class'],
            'residential', P.grove, 'industrial', P.vagos, P.ballas],
          'fill-outline-color': 'rgba(0,0,0,0)',
        },
      },
      {
        id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water',
        filter: ['!=', 'brunnel', 'tunnel'],
        paint: { 'fill-color': P.water },
      },
      {
        id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway',
        filter: ['!=', 'brunnel', 'tunnel'],
        paint: {
          'line-color': P.water,
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 8, 0.5, 13, 1.5, 18, 8],
        },
      },
      {
        id: 'aeroway', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 11,
        filter: ['in', 'class', 'runway', 'taxiway'],
        paint: {
          'line-color': P.runway,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, ['match', ['get', 'class'], 'runway', 3, 1], 17, ['match', ['get', 'class'], 'runway', 60, 20]],
        },
      },
      {
        id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 15,
        paint: {
          'fill-color': P.building,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 0.55],
        },
      },
      ...roadLayers('tunnel'),
      {
        id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11,
        filter: ['all', ['in', 'class', 'rail', 'transit'], ['!=', 'brunnel', 'tunnel']],
        paint: {
          'line-color': P.rail,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 18, 3],
          'line-dasharray': [3, 2],
        },
      },
      ...roadLayers(null),
      ...roadLayers('bridge'),
      {
        id: 'label-road', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13,
        filter: ['in', 'class', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'],
        layout: {
          visibility: vis(labels),
          'symbol-placement': 'line',
          'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name'], ['get', 'ref']],
          'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 17, 14],
          'text-letter-spacing': 0.04,
          'text-max-angle': 30,
        },
        paint: { 'text-color': P.label, 'text-halo-color': P.labelHalo, 'text-halo-width': 1.6 },
      },
      {
        id: 'label-water', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
        layout: {
          visibility: vis(labels),
          'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
          'text-font': ['Noto Sans Italic'],
          'text-size': 12,
        },
        paint: { 'text-color': '#a9c4e6', 'text-halo-color': P.labelHalo, 'text-halo-width': 1.2 },
      },
      {
        id: 'label-place-minor', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 12,
        filter: ['in', 'class', 'suburb', 'quarter', 'neighbourhood'],
        layout: {
          visibility: vis(labels),
          'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
          'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 15],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.08,
        },
        paint: { 'text-color': '#acc8f0', 'text-halo-color': P.labelHalo, 'text-halo-width': 1.6 },
      },
      {
        id: 'label-place', type: 'symbol', source: 'omt', 'source-layer': 'place',
        filter: ['in', 'class', 'city', 'town', 'village'],
        layout: {
          visibility: vis(labels),
          'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
          'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, ['match', ['get', 'class'], 'city', 13, 10], 12, ['match', ['get', 'class'], 'city', 22, 15]],
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': P.labelHalo, 'text-halo-width': 2 },
      },
    ],
  };
}

export const LABEL_LAYERS = ['label-road', 'label-water', 'label-place-minor', 'label-place'];
