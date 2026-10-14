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

export async function reverse(lng, lat) {
  try {
    const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lng}&limit=1`);
    const json = await res.json();
    const f = json.features?.[0];
    if (f) return { ...placeFromFeature(f), lat, lng };
  } catch { /* fall through */ }
  return { lat, lng, name: 'Dropped pin', address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
}
