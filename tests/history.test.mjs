import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addHistory, loadHistory, saveHistory, summarizeLock, HISTORY_MAX } from '../js/history.js';
import { createWorld, generation } from '../js/evolve.js';

function memory() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
}

test('an opened lock is summarised with its binder', () => {
  const w = createWorld(12);
  while (!w.solved) generation(w);
  const s = summarizeLock(w);
  assert.equal(s.seed, 12);
  assert.equal(s.binder.length, 14);
  assert.ok(s.gens > 0);
});

test('history is newest first, de-duplicated and capped', () => {
  let list = [];
  for (let i = 0; i < HISTORY_MAX + 3; i++) list = addHistory(list, { seed: 1, lock: i, name: 'x', binder: 'A', gens: 1 });
  assert.equal(list.length, HISTORY_MAX);
  assert.equal(list[0].lock, HISTORY_MAX + 2);
  list = addHistory(list, { seed: 1, lock: list[3].lock, name: 'again', binder: 'A', gens: 2 });
  assert.equal(list.filter((e) => e.name === 'again').length, 1);
});

test('history round-trips through storage and ignores junk', () => {
  const s = memory();
  saveHistory([{ seed: 1, lock: 2, name: 'n', binder: 'AC', gens: 3 }, { nope: true }], s);
  assert.equal(loadHistory(s).length, 1);
  s.setItem('affinity.history', '{bad json');
  assert.deepEqual(loadHistory(s), []);
});
