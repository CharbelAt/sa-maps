// Geocoding via Photon (OSM data, keyless, CORS-enabled).

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
  return { lat, lng, name, address, kind: p.osm_value || p.type || '' };
}

const COORDS_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export async function search(q, near, signal) {
  const m = q.match(COORDS_RE);
  if (m) {
    const lat = +m[1], lng = +m[2];
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return [{ lat, lng, name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, address: 'Coordinates', kind: 'coords' }];
    }
  }
  const params = new URLSearchParams({ q, limit: '8' });
  if (near) {
    params.set('lat', near[1].toFixed(4));
    params.set('lon', near[0].toFixed(4));
  }
  const res = await fetch(`${PHOTON}/api/?${params}`, { signal });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const json = await res.json();
  return (json.features || []).map(placeFromFeature);
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
