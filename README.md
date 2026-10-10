# Affinity

Watch evolution crack a lock. A random receptor binding pocket sits at the top of the screen; below it, a
population of 96 peptide "keys" evolves to bind it. Each generation the best 16 survive and breed, the rest die,
and their children (crossovers of two survivors, plus a mutation or two) take their places. When the best key
binds within a whisker of the best possible, the lock opens and a new one appears. The same population then has
to adapt to that one.

It runs forever, needs no input, works offline once loaded, and can be installed as an app.

## What you're looking at

- **The receptor** (top): a slab of protein with a groove of 10 sites cut into its underside. Each notch is as
  deep as the cavity at that site, and its rim is coloured by the residue lining it.
- **The best key, docked**: its teeth are residues, as tall as their side chains are big and coloured by
  chemistry. Red overlap is a steric clash, a green cap is a snug fit, and glows show salt bridges (blue),
  hydrophobic contacts (amber), aromatic stacking (violet), charge repulsion (red) and hydrogen bonds (dashed cyan).
- **The population** (grid), ranked best first. Tiles are tinted by lineage, so you can watch one family take
  over. Each generation, gold rims mark the survivors, red tiles dissolve, arcs run from parents to children,
  white flashes are mutations and a gold line marks the crossover point. Then everyone re-sorts.
- **The chart** (wide screens): best and mean binding energy per generation, against the target.

## The model

A deliberately simple but recognisable binding model (`js/chem.js`):

- Real amino-acid properties: Kyte–Doolittle hydropathy, charge at pH 7, side-chain volume, hydrogen-bond
  donors/acceptors, natural abundance.
- Contact energy: electrostatics, the hydrophobic effect (with a desolvation penalty for grease against charge),
  hydrogen bonds, aromatic stacking and cation-π, and shape complementarity (clashes and voids).
- Neighbouring residues interact (crowding, like-charge repulsion, salt bridges, proline kinks), which makes the
  landscape epistatic.
- Keys are 14 residues, longer than the groove, so each docks in its best register.
- ΔG becomes a dissociation constant with Kd = e^(ΔG/RT). The best possible key for each lock is found exactly
  by dynamic programming, and a lock opens within 0.6 kcal/mol of it.
- Mutations prefer chemically similar residues. If the best key stalls for 10 generations, the mutation rate
  spikes for one generation (stress-induced mutagenesis).

## Controls

Space pause · +/− speed (½× to 8×) · N next lock · P pocket details · L opened locks · S settings · M sound ·
K key labels · F fullscreen · H hide the interface. The URL carries `#seed=…`, so a link replays the same run.

## Run it

```bash
npm run serve   # python3 -m http.server 8080
npm test        # node --test, no dependencies
```
