// The genetic algorithm. No DOM.
//
// Each generation: every key is docked against the lock and ranked by binding free
// energy. The best SURVIVORS live on unchanged (elitism) and become the breeding pool;
// everyone else dies. The empty slots are refilled with children of two survivors
// (single-point crossover, fitter parents chosen more often) carrying a few point
// mutations. Mutations favour chemically similar residues. If the best binder hasn't
// improved for a while, the mutation rate spikes for a generation (stress-induced
// mutagenesis), which is how stuck populations escape a local optimum.
//
// A lock is opened once the best key binds within TARGET_GAP kcal/mol of the best
// possible key for that pocket. Then a new lock appears and the same population has to
// adapt to it, which is roughly how receptors and their ligands co-evolve.

import { createRng } from './rng.js';
import { KEY_LEN, dock, makeLock, mutateResidue, randomKey, kd } from './chem.js';

export const POPULATION = 96;
export const SURVIVORS = 16;
export const TARGET_GAP = 0.35; // kcal/mol above the pocket's optimum
const CROSSOVER = 0.85;
const MUTATION = 1.1 / KEY_LEN; // per residue: about one mutation per child
const STALL = 10; // generations without improvement before a hypermutation burst
const HYPER = 4;
export const GIVE_UP = 400; // generations before an unsolved lock is retired anyway

export function createWorld(seed) {
  const rng = createRng(seed);
  const world = { seed, rng, nextId: 1, gen: 0, lockCount: 0, lock: null, pop: [], last: null, stall: 0, bestEver: Infinity, solved: null };
  for (let i = 0; i < POPULATION; i++) world.pop.push(makeKey(world, randomKey(rng), { clade: i }));
  newLock(world);
  return world;
}

function makeKey(world, seq, extra) {
  return { id: world.nextId++, seq, dG: 0, offset: 0, parents: null, cut: -1, mutations: [], ...extra };
}

function score(world, key) {
  const { dG, offset } = dock(key.seq, world.lock);
  key.dG = dG;
  key.offset = offset;
}

const byFitness = (a, b) => a.dG - b.dG || a.id - b.id;

// A fresh lock. The population carries over and is re-ranked against it.
export function newLock(world) {
  world.lockCount++;
  world.lock = makeLock(world.rng, world.lockCount);
  world.lock.target = world.lock.best + TARGET_GAP;
  world.lock.startGen = world.gen;
  world.stall = 0;
  world.bestEver = Infinity;
  world.solved = null;
  for (const k of world.pop) {
    score(world, k);
    k.parents = null;
    k.mutations = [];
    k.cut = -1;
  }
  world.pop.sort(byFitness);
  world.bestEver = world.pop[0].dG;
  world.last = null;
}

function pickParent(rng, pool) {
  // Rank-weighted: the best survivor is picked about 3× as often as the last.
  return rng.weighted(pool.map((k, i) => [k, 1 + 2 * (1 - i / (pool.length - 1))]));
}

// Advance one generation; returns what happened so the renderer can animate it.
export function generation(world) {
  const { rng } = world;
  const ranked = world.pop; // sorted best first
  const survivors = ranked.slice(0, SURVIVORS);
  const dead = ranked.slice(SURVIVORS);
  const hyper = world.stall >= STALL;
  const rate = hyper ? MUTATION * HYPER : MUTATION;
  if (hyper) world.stall = 0;

  const children = [];
  while (children.length < POPULATION - SURVIVORS) {
    const a = pickParent(rng, survivors);
    let b = a;
    let cut = -1;
    let seq = a.seq.slice();
    if (rng.chance(CROSSOVER)) {
      b = pickParent(rng, survivors.filter((k) => k !== a));
      cut = rng.int(1, KEY_LEN - 1);
      seq = a.seq.slice(0, cut).concat(b.seq.slice(cut));
    }
    const mutations = [];
    for (let i = 0; i < KEY_LEN; i++) {
      if (rng.chance(rate)) {
        const from = seq[i];
        seq[i] = mutateResidue(rng, from);
        mutations.push({ pos: i, from, to: seq[i] });
      }
    }
    // The clade (lineage colour) follows whichever parent gave more of the sequence.
    const clade = cut < 0 || cut >= KEY_LEN / 2 ? a.clade : b.clade;
    const child = makeKey(world, seq, { clade, parents: cut < 0 ? [a.id] : [a.id, b.id], cut, mutations, born: world.gen + 1 });
    score(world, child);
    children.push(child);
  }

  for (const k of survivors) {
    k.parents = null;
    k.mutations = [];
    k.cut = -1;
  }
  world.gen++;
  world.pop = survivors.concat(children).sort(byFitness);
  const best = world.pop[0];
  const improved = best.dG < world.bestEver - 1e-9;
  if (improved) {
    world.bestEver = best.dG;
    world.stall = 0;
  } else {
    world.stall++;
  }
  if (best.dG <= world.lock.target) world.solved = { gen: world.gen - world.lock.startGen, key: best, reason: 'opened' };
  else if (world.gen - world.lock.startGen >= GIVE_UP) world.solved = { gen: world.gen - world.lock.startGen, key: best, reason: 'retired' };

  world.last = {
    gen: world.gen,
    survivors: survivors.map((k) => k.id),
    dead: dead.map((k) => k.id),
    children: children.map((k) => k.id),
    best,
    improved,
    hyper,
    mean: world.pop.reduce((s, k) => s + k.dG, 0) / world.pop.length,
    diversity: diversity(world.pop),
  };
  return world.last;
}

// Mean fraction of positions that differ between random pairs: 0 = clones, ~0.9 = random.
export function diversity(pop) {
  let diff = 0;
  let n = 0;
  for (let i = 0; i < pop.length; i += 3) {
    for (let j = i + 1; j < pop.length; j += 7) {
      for (let p = 0; p < KEY_LEN; p++) if (pop[i].seq[p] !== pop[j].seq[p]) diff++;
      n += KEY_LEN;
    }
  }
  return n ? diff / n : 0;
}

// 0 (random-ish) .. 1 (lock opened), on a log-affinity scale.
export function progress(world, dG = world.pop[0].dG) {
  const start = 0; // ~ the best of a random population
  const t = (start - dG) / (start - world.lock.target);
  return Math.max(0, Math.min(1, t));
}

export { kd };
