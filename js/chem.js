// Toy biophysics: amino acids, a receptor's binding pocket, and the free energy of a
// peptide "key" docked into it. No DOM.
//
// A lock is a pocket of POCKET sites. Each site is lined by one residue and leaves a
// cavity of some volume. A key is a peptide of KEY_LEN residues; it docks in whichever
// register (offset along the groove) binds best, and each key residue in the groove
// contacts one site. The contact energy is a sum of familiar terms: electrostatics,
// the hydrophobic effect, hydrogen bonds, aromatic stacking / cation-π, and shape
// (steric clashes and empty voids). Real binding is not additive like this, but the
// terms pull in the same directions, so evolution has to discover the same things a
// medicinal chemist would: fill the deep holes, don't overfill the shallow ones, put
// opposite charges together and grease against grease.

export const POCKET = 10;
export const KEY_LEN = 14;
export const REGISTERS = KEY_LEN - POCKET + 1;
const RT = 0.593; // kcal/mol at 298 K
// Rigidifying a flexible peptide in the groove costs entropy, whatever it binds.
const ENTROPY_COST = 4;

export const CLASSES = {
  hydrophobic: { label: 'hydrophobic', color: '#f2b84b' },
  aromatic: { label: 'aromatic', color: '#b48cff' },
  positive: { label: 'positive', color: '#4f9dff' },
  negative: { label: 'negative', color: '#ff6464' },
  polar: { label: 'polar', color: '#4fd6a0' },
  special: { label: 'small / kink', color: '#a3acc2' },
};

// Kyte–Doolittle hydropathy, net charge at pH 7 (His partly protonated), side-chain
// volume (Å³), hydrogen-bond donor / acceptor side chains, natural abundance (%).
const RAW = [
  ['A', 'Ala', 'Alanine', 1.8, 0, 88.6, 0, 0, 'hydrophobic', 8.3],
  ['R', 'Arg', 'Arginine', -4.5, 1, 173.4, 1, 0, 'positive', 5.5],
  ['N', 'Asn', 'Asparagine', -3.5, 0, 114.1, 1, 1, 'polar', 4.1],
  ['D', 'Asp', 'Aspartate', -3.5, -1, 111.1, 0, 1, 'negative', 5.5],
  ['C', 'Cys', 'Cysteine', 2.5, 0, 108.5, 0, 0, 'hydrophobic', 1.4],
  ['Q', 'Gln', 'Glutamine', -3.5, 0, 143.8, 1, 1, 'polar', 3.9],
  ['E', 'Glu', 'Glutamate', -3.5, -1, 138.4, 0, 1, 'negative', 6.8],
  ['G', 'Gly', 'Glycine', -0.4, 0, 60.1, 0, 0, 'special', 7.1],
  ['H', 'His', 'Histidine', -3.2, 0.3, 153.2, 1, 1, 'positive', 2.3],
  ['I', 'Ile', 'Isoleucine', 4.5, 0, 166.7, 0, 0, 'hydrophobic', 5.9],
  ['L', 'Leu', 'Leucine', 3.8, 0, 166.7, 0, 0, 'hydrophobic', 9.7],
  ['K', 'Lys', 'Lysine', -3.9, 1, 168.6, 1, 0, 'positive', 5.8],
  ['M', 'Met', 'Methionine', 1.9, 0, 162.9, 0, 0, 'hydrophobic', 2.4],
  ['F', 'Phe', 'Phenylalanine', 2.8, 0, 189.9, 0, 0, 'aromatic', 3.9],
  ['P', 'Pro', 'Proline', -1.6, 0, 112.7, 0, 0, 'special', 4.7],
  ['S', 'Ser', 'Serine', -0.8, 0, 89.0, 1, 1, 'polar', 6.6],
  ['T', 'Thr', 'Threonine', -0.7, 0, 116.1, 1, 1, 'polar', 5.3],
  ['W', 'Trp', 'Tryptophan', -0.9, 0, 227.8, 1, 0, 'aromatic', 1.1],
  ['Y', 'Tyr', 'Tyrosine', -1.3, 0, 193.6, 1, 1, 'aromatic', 2.9],
  ['V', 'Val', 'Valine', 4.2, 0, 140.0, 0, 0, 'hydrophobic', 6.9],
];

export const AMINO = RAW.map(([code, abbr, name, hyd, charge, volume, donor, acceptor, cls, freq], index) => ({
  index, code, abbr, name, hyd, charge, volume, donor: !!donor, acceptor: !!acceptor, cls, freq,
  color: CLASSES[cls].color,
}));
export const BY_CODE = Object.fromEntries(AMINO.map((a) => [a.code, a]));
const ABUNDANCE = AMINO.map((a) => [a.index, a.freq]);

export const MIN_VOLUME = 60;
export const MAX_VOLUME = 228;

// Energy (kcal/mol) of key residue k sitting in a site lined by residue p with a cavity
// of `cavity` Å³. Returns the parts too, so the renderer can show why a contact is good.
export function contact(k, p, cavity) {
  const elec = 1.5 * k.charge * p.charge;

  const hk = k.hyd / 4.5;
  const hp = p.hyd / 4.5;
  let hyd;
  if (hk > 0 && hp > 0) hyd = -1.4 * hk * hp; // grease buried against grease
  else if (hk < 0 && hp < 0) hyd = -0.25 * hk * hp; // polar meets polar: mildly fine
  else hyd = -0.9 * hk * hp; // grease against a polar or charged wall: desolvation penalty

  const hbond = (k.donor && p.acceptor) || (k.acceptor && p.donor) ? -0.7 : 0;

  let stack = 0;
  if (k.cls === 'aromatic' && p.cls === 'aromatic') stack = -0.9;
  else if ((k.cls === 'aromatic' && p.charge > 0.5) || (p.cls === 'aromatic' && k.charge > 0.5)) stack = -0.7;

  const d = k.volume - cavity;
  let shape;
  if (d > 12) shape = 0.07 * (d - 12); // steric clash: too big for the hole
  else if (d < -12) shape = 0.014 * (-d - 12) - 0.25; // rattles in a hole that's too deep
  else shape = -0.8 * (1 - Math.abs(d) / 40); // snug van der Waals contact

  const total = elec + hyd + hbond + stack + shape;
  return { total, elec, hyd, hbond, stack, shape, clash: d > 12 ? d - 12 : 0 };
}

// Neighbouring key residues in the groove also interact, which makes the landscape
// epistatic: the best residue at one site depends on its neighbours. Two bulky side
// chains side by side crowd each other, like charges next to each other repel, and a
// proline kinks the backbone out of the groove.
export function neighbour(a, b) {
  let e = 0;
  if (a.volume > 150 && b.volume > 150) e += 0.06 * (Math.min(a.volume, b.volume) - 150) / 4;
  if (a.charge * b.charge > 0.5) e += 0.8;
  if (a.charge * b.charge < -0.5) e -= 0.4; // salt bridge along the chain
  if (a.code === 'P' || b.code === 'P') e += 0.6;
  return e;
}
const PAIR = AMINO.map((a) => AMINO.map((b) => neighbour(a, b)));

// Precomputed contact energy for every (key residue, site) pair of a lock: dock() is
// called ~100× per generation, so it only does lookups.
export function contactTable(lock) {
  return lock.sites.map((s) => AMINO.map((a) => contact(a, AMINO[s.residue], s.cavity).total));
}

// Best binding register for a key: the free energy there, and which offset it was.
export function dock(key, lock) {
  const table = lock.table ?? (lock.table = contactTable(lock));
  let best = Infinity;
  let bestOffset = 0;
  for (let o = 0; o < REGISTERS; o++) {
    let g = ENTROPY_COST;
    for (let i = 0; i < POCKET; i++) g += table[i][key[o + i]];
    for (let i = 1; i < POCKET; i++) g += PAIR[key[o + i - 1]][key[o + i]];
    if (g < best) {
      best = g;
      bestOffset = o;
    }
  }
  return { dG: best, offset: bestOffset };
}

// The best any key could do, and that key's groove sequence: dynamic programming
// along the groove (each site's choice only interacts with its neighbours).
export function optimum(lock) {
  const table = lock.table ?? (lock.table = contactTable(lock));
  const n = AMINO.length;
  let cost = table[0].slice();
  const from = [];
  for (let i = 1; i < POCKET; i++) {
    const next = new Array(n);
    const back = new Array(n);
    for (let r = 0; r < n; r++) {
      let best = Infinity;
      for (let q = 0; q < n; q++) {
        const c = cost[q] + PAIR[q][r];
        if (c < best) { best = c; back[r] = q; }
      }
      next[r] = best + table[i][r];
    }
    from.push(back);
    cost = next;
  }
  let r = cost.indexOf(Math.min(...cost));
  const g = ENTROPY_COST + cost[r];
  const groove = [r];
  for (let i = from.length - 1; i >= 0; i--) groove.unshift(r = from[i][r]);
  return { dG: g, groove };
}

export const kd = (dG) => Math.exp(dG / RT); // molar
export const dGForKd = (molar) => RT * Math.log(molar);

// "4.2 µM", "310 nM", "12 pM" … Unbound is anything weaker than 10 mM.
export function formatKd(dG) {
  const m = kd(dG);
  if (m >= 1e-2) return 'no binding';
  const units = [['mM', 1e-3], ['µM', 1e-6], ['nM', 1e-9], ['pM', 1e-12], ['fM', 1e-15]];
  for (const [u, s] of units) {
    if (m >= s) {
      const v = m / s;
      return `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(0) : v.toFixed(1)} ${u}`;
    }
  }
  return `${(m / 1e-15).toPrecision(2)} fM`;
}

// Substitution weights: mutations mostly swap a residue for a chemically similar one
// (as the genetic code and BLOSUM-style matrices do), occasionally for anything.
const SIMILAR = AMINO.map((a) => AMINO.map((b) => {
  if (a === b) return 0;
  const dh = (a.hyd - b.hyd) / 9;
  const dq = a.charge - b.charge;
  const dv = (a.volume - b.volume) / 168;
  const sameClass = a.cls === b.cls ? 1 : 0;
  return Math.exp(-(dh * dh * 6 + dq * dq * 2 + dv * dv * 5)) * (1 + sameClass) + 0.04;
}));

export function mutateResidue(rng, from) {
  return rng.weighted(SIMILAR[from].map((w, i) => [i, w]));
}

export const randomResidue = (rng) => rng.weighted(ABUNDANCE);

export function randomKey(rng) {
  return Array.from({ length: KEY_LEN }, () => randomResidue(rng));
}

// Receptor families only flavour the name; the pocket chemistry is what matters.
const FAMILIES = [
  'GPCR orthosteric site', 'Kinase hinge pocket', 'Protease S1 groove', 'MHC peptide groove',
  'PDZ domain groove', 'SH2 phospho-pocket', 'Lectin binding cleft', 'Nuclear receptor pocket',
  'Antibody paratope', 'Ion channel vestibule', 'Integrin RGD cleft', 'Bromodomain pocket',
  'Chaperone substrate cleft', 'Proteasome β-site', 'Opioid receptor pocket', 'Toll-like receptor groove',
];

// A random pocket, biased towards a character (greasy, charged, mixed…) so locks feel
// distinct. Cavities are always sized for some real residue, so every lock is solvable.
export function makeLock(rng, number) {
  const mood = rng.weighted([['anionic', 2], ['cationic', 2], ['greasy', 2], ['aromatic', 1], ['polar', 1], ['mixed', 3]]);
  const bias = {
    anionic: { negative: 4 }, cationic: { positive: 4 }, greasy: { hydrophobic: 4 },
    aromatic: { aromatic: 5 }, polar: { polar: 4 }, mixed: {},
  }[mood];
  const sites = Array.from({ length: POCKET }, () => {
    const residue = rng.weighted(AMINO.map((a) => [a.index, a.freq * (bias[a.cls] ?? 1)]));
    // The hole is shaped for some residue (any), give or take a little.
    const target = AMINO[randomResidue(rng)].volume;
    const cavity = Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, target + rng.range(-10, 10)));
    return { residue, cavity };
  });
  const tag = `${'ABCDEFGHJKLMNPQRSTVWXYZ'[rng.int(0, 22)]}${rng.int(1, 9)}${'ABCDEFGHJKLMNPQRSTVWXYZ'[rng.int(0, 22)]}`;
  const lock = { number, mood, family: rng.pick(FAMILIES), tag, sites };
  const opt = optimum(lock);
  lock.best = opt.dG;
  lock.ideal = opt.groove;
  return lock;
}

export function sequence(key) {
  return key.map((i) => AMINO[i].code).join('');
}
