// User-supplied audio clips for specific moments (wrong turn, mission start/passed).
// Stored on this device only (IndexedDB) — never uploaded anywhere.

const DB = 'samaps-clips';
const STORE = 'clips';

export const CLIP_SLOTS = [
  ['wrong_turn', 'Wrong-turn clip'],
  ['start', 'Mission-start clip'],
  ['arrived', 'Mission-passed clip'],
];

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out.result);
    t.onerror = () => reject(t.error);
  });
}

const cache = new Map();

export async function loadClips() {
  try {
    for (const [slot] of CLIP_SLOTS) {
      const blob = await tx('readonly', (s) => s.get(slot));
      if (blob) cache.set(slot, blob); else cache.delete(slot);
    }
  } catch { /* storage unavailable */ }
}

export const getClip = (slot) => cache.get(slot) || null;

export async function setClip(slot, file) {
  await tx('readwrite', (s) => s.put(file, slot));
  cache.set(slot, file);
}

export async function clearClip(slot) {
  await tx('readwrite', (s) => s.delete(slot));
  cache.delete(slot);
}
