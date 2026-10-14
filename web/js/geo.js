// Geocoding via Photon (OSM data, keyless, CORS-enabled).
// Search results stay in your country when there are any there, closest first.

import { haversine } from './util.js';

const PHOTON = 'https://photon.komoot.io';

function placeFromFeature(f) {
  const p = f.properties || {};
  const [lng, lat] = f.geometry.coordinates;
  const streetLine = [p.housenumber, p.street].filter(Boolean).join(' ');
  const name = p.name || streetLine || p.city || p.state || 'Unnamed place';
  const parts = [
    streetLine && streetLine !== name ? streetLine : '',
    p.district || p.locality || '',
    p.city && p.city !== name ? p.city : '',
    p.state && p.state !== name ? p.state : '',
    p.country && p.country !== name ? p.country : '',
  ];
  const address = [...new Set(parts.filter(Boolean))].join(', ');
  return { lat, lng, name, address, kind: p.osm_value || p.type || '', country: p.countrycode || '' };
}

// Country of the current position (cached until you move ~50 km).
let countryCache = null;
async function countryAt(near) {
  if (countryCache && haversine(countryCache.at, near) < 50000) return countryCache.code;
  try {
    const res = await fetch(`${PHOTON}/reverse?lat=${near[1]}&lon=${near[0]}&limit=1`);
    const code = (await res.json()).features?.[0]?.properties?.countrycode || '';
    if (code) countryCache = { code, at: near };
    return code;
  } catch {
    return '';
  }
}

const COORDS_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** near = [lng, lat] of you (or the map center). */
export async function search(q, near, signal) {
  const m = q.match(COORDS_RE);
  if (m) {
    const lat = +m[1], lng = +m[2];
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return [{ lat, lng, name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, address: 'Coordinates', kind: 'coords' }];
    }
  }
  const params = new URLSearchParams({ q, limit: '20' });
  if (near) {
    params.set('lat', near[1].toFixed(4));
    params.set('lon', near[0].toFixed(4));
    params.set('zoom', '12');                 // focus radius ~ a city
    params.set('location_bias_scale', '0.1'); // distance matters more than fame
  }
  const [res, country] = await Promise.all([
    fetch(`${PHOTON}/api/?${params}`, { signal }),
    near ? countryAt(near) : Promise.resolve(''),
  ]);
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  let places = ((await res.json()).features || []).map(placeFromFeature);
  if (country) {
    const local = places.filter((p) => p.country === country);
    if (local.length) places = local;
  }
  if (near) {
    for (const p of places) p.dist = haversine(near, [p.lng, p.lat]);
    places.sort((a, b) => a.dist - b.dist);
  }
  return places.slice(0, 8);
}

// ---- place details (OpenStreetMap tags via Nominatim) -----------------------

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const RELIGION = { christian: 'Church', muslim: 'Mosque', jewish: 'Synagogue', buddhist: 'Temple', hindu: 'Temple' };
const pretty = (s) => String(s || '').replace(/_/g, ' ').replace(/;/g, ', ').trim();

/** Human category like "Restaurant · Lebanese" from OSM tags. */
export function categoryOf(tags = {}) {
  if (tags.amenity === 'place_of_worship') return RELIGION[tags.religion] || 'Place of worship';
  const kind = tags.amenity || tags.shop || tags.tourism || tags.leisure || tags.office || tags.healthcare
    || tags.historic || tags.railway || tags.public_transport || '';
  const base = pretty(kind === 'yes' ? '' : kind);
  const cuisine = tags.cuisine ? pretty(tags.cuisine) : '';
  const label = [base, cuisine].filter(Boolean).join(' · ');
  return label ? label[0].toUpperCase() + label.slice(1) : '';
}

async function nominatim(path, signal) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  signal?.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(`${NOMINATIM}${path}&format=jsonv2&extratags=1&namedetails=1&addressdetails=1&accept-language=en`, { signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Looks up the OSM object for a place (the one at its coordinates, or by name close by)
 * and returns {category, address, hours, phone, website, wheelchair} — whatever is mapped.
 * One or two Nominatim requests per tap, well within its usage policy.
 */
export async function placeDetails(place, signal) {
  const name = place.name && place.name !== 'Dropped pin' ? place.name : '';
  const sameName = (hit) => !name || [hit?.name, ...Object.values(hit?.namedetails || {})].includes(name);
  const POI = new Set(['amenity', 'shop', 'tourism', 'leisure', 'healthcare', 'office', 'historic', 'craft', 'club']);
  const atSpot = await nominatim(`/reverse?lat=${place.lat}&lon=${place.lng}&zoom=18`, signal);
  let hit = atSpot && !atSpot.error && sameName(atSpot) ? atSpot : null;
  if (!hit && name) {
    const d = 0.002; // ~200 m box around the place
    const box = [place.lng - d, place.lat + d, place.lng + d, place.lat - d].map((v) => v.toFixed(5)).join(',');
    hit = (await nominatim(`/search?q=${encodeURIComponent(name)}&viewbox=${box}&bounded=1&limit=1`, signal))?.[0];
  }
  // Names differ between sources (e.g. Arabic vs English): accept the business at that spot.
  if (!hit && atSpot && !atSpot.error && POI.has(atSpot.category)) hit = atSpot;
  if (!hit || hit.error) return null;
  const t = { ...(hit.extratags || {}), [hit.category]: hit.type };
  const a = hit.address || {};
  const address = [[a.house_number, a.road].filter(Boolean).join(' '), a.suburb || a.neighbourhood, a.city || a.town]
    .filter(Boolean).join(', ');
  return {
    category: categoryOf(t),
    address,
    hours: t.opening_hours || '',
    phone: t.phone || t['contact:phone'] || '',
    website: t.website || t['contact:website'] || t.url || '',
    wheelchair: t.wheelchair || '',
  };
}

export async function reverse(lng, lat) {
  try {
    const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lng}&limit=1`);
    const json = await res.json();
    const f = json.features?.[0];
    if (f) return { ...placeFromFeature(f), lat, lng };
  } catch { /* fall through */ }
  return { lat, lng, name: 'Dropped pin', address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
}
