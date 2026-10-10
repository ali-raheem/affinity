import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../js/rng.js';
import { BY_CODE, KEY_LEN, POCKET, REGISTERS, contact, dock, makeLock, optimum, randomKey, formatKd, dGForKd } from '../js/chem.js';

const site = (code, cavity) => [BY_CODE[code], cavity];

test('opposite charges attract and like charges repel', () => {
  const [d, cav] = site('D', 170);
  assert.ok(contact(BY_CODE.K, d, cav).elec < 0);
  assert.ok(contact(BY_CODE.E, d, cav).elec > 0);
});

test('grease binds grease, and is penalised against a charged wall', () => {
  assert.ok(contact(BY_CODE.L, BY_CODE.I, 167).hyd < 0);
  assert.ok(contact(BY_CODE.L, BY_CODE.D, 167).hyd > 0);
});

test('a side chain too big for its cavity clashes; a snug one is rewarded', () => {
  const tight = contact(BY_CODE.W, BY_CODE.A, 90);
  const snug = contact(BY_CODE.A, BY_CODE.A, 90);
  assert.ok(tight.clash > 0 && tight.shape > 2);
  assert.ok(snug.shape < 0);
});

test('docking picks the register with the lowest free energy', () => {
  const rng = createRng(5);
  const lock = makeLock(rng, 1);
  const key = randomKey(rng);
  const { dG, offset } = dock(key, lock);
  assert.ok(offset >= 0 && offset < REGISTERS);
  // Shifting the key so its best window lands elsewhere can't beat the reported optimum.
  for (let o = 0; o < REGISTERS; o++) {
    const shifted = key.slice(o, o + POCKET).concat(key.slice(0, o), key.slice(o + POCKET));
    assert.ok(dock(shifted, lock).dG >= dG - 1e-9 || dock(shifted, lock).offset !== 0);
  }
});

test('the optimum is achievable and no random key beats it', () => {
  const rng = createRng(11);
  for (let l = 0; l < 20; l++) {
    const lock = makeLock(rng, l);
    const ideal = optimum(lock);
    const key = ideal.groove.concat(randomKey(rng).slice(0, KEY_LEN - POCKET));
    assert.ok(Math.abs(dock(key, lock).dG - lock.best) < 1e-9 || dock(key, lock).dG < lock.best + 1e-9);
    for (let i = 0; i < 200; i++) assert.ok(dock(randomKey(rng), lock).dG >= lock.best - 1e-9);
  }
});

test('Kd formatting covers the useful range', () => {
  assert.equal(formatKd(dGForKd(1)), 'no binding');
  assert.equal(formatKd(dGForKd(4.2e-6)), '4.2 µM');
  assert.equal(formatKd(dGForKd(310e-9)), '310 nM');
});
