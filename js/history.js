// Opened locks: a short, persisted log of receptors the population has cracked, with
// the winning binder and the run seed so the run can be replayed or shared.
// DOM-free apart from the storage handle, which callers may pass in (tests do).

import { formatKd, sequence } from './chem.js';

const KEY = 'affinity.history';
export const HISTORY_MAX = 12;

export function summarizeLock(world) {
  const { lock, solved } = world;
  return {
    seed: world.seed,
    lock: lock.number,
    name: `${lock.family} ${lock.tag}`,
    mood: lock.mood,
    opened: solved.reason === 'opened',
    gens: solved.gen,
    kd: formatKd(solved.key.dG),
    best: formatKd(lock.best),
    binder: sequence(solved.key.seq),
    offset: solved.key.offset,
  };
}

// Newest first; the same lock of the same run replaces its older entry.
export function addHistory(list, entry, max = HISTORY_MAX) {
  return [entry, ...list.filter((e) => e.seed !== entry.seed || e.lock !== entry.lock)].slice(0, max);
}

function isValid(e) {
  return e && Number.isInteger(e.seed) && e.seed >= 0 && Number.isInteger(e.lock) &&
    typeof e.name === 'string' && typeof e.binder === 'string' && Number.isInteger(e.gens);
}

export function loadHistory(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage.getItem(KEY));
    return Array.isArray(list) ? list.filter(isValid).slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

export function saveHistory(list, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(list));
  } catch { /* storage unavailable; the log just won't survive a reload */ }
}
