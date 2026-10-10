import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, generation, newLock, POPULATION, SURVIVORS, GIVE_UP } from '../js/evolve.js';
import { sequence } from '../js/chem.js';

test('a seed replays exactly the same evolution', () => {
  const a = createWorld(42);
  const b = createWorld(42);
  for (let i = 0; i < 15; i++) {
    generation(a);
    generation(b);
  }
  assert.deepEqual(a.pop.map((k) => sequence(k.seq)), b.pop.map((k) => sequence(k.seq)));
});

test('population size is constant, survivors persist, the best never gets worse', () => {
  const w = createWorld(7);
  let best = w.pop[0].dG;
  for (let i = 0; i < 30 && !w.solved; i++) {
    const before = w.pop.slice(0, SURVIVORS).map((k) => k.id);
    const rec = generation(w);
    assert.equal(w.pop.length, POPULATION);
    assert.deepEqual(rec.survivors, before);
    assert.equal(rec.dead.length + rec.survivors.length, POPULATION);
    for (const id of before) assert.ok(w.pop.some((k) => k.id === id));
    assert.ok(w.pop[0].dG <= best + 1e-9);
    best = w.pop[0].dG;
    for (let j = 1; j < w.pop.length; j++) assert.ok(w.pop[j - 1].dG <= w.pop[j].dG);
  }
});

test('children record their parents, crossover point and mutations', () => {
  const w = createWorld(3);
  const rec = generation(w);
  const kids = w.pop.filter((k) => rec.children.includes(k.id));
  assert.equal(kids.length, POPULATION - SURVIVORS);
  for (const k of kids) {
    assert.ok(k.parents.every((p) => rec.survivors.includes(p)));
    if (k.parents.length === 2) assert.ok(k.cut > 0);
    for (const m of k.mutations) assert.equal(k.seq[m.pos], m.to);
  }
});

test('locks get opened, and the population carries over to the next one', () => {
  const w = createWorld(99);
  for (let lock = 0; lock < 3; lock++) {
    while (!w.solved) generation(w);
    assert.ok(w.solved.gen <= GIVE_UP);
    const carried = w.pop.map((k) => k.id).sort();
    newLock(w);
    assert.deepEqual(w.pop.map((k) => k.id).sort(), carried);
    assert.equal(w.solved, null);
  }
});
