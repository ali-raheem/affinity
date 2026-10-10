# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Affinity: a genetic algorithm evolving 96 peptide "keys" to bind random receptor "locks", shown as a ranked grid under the receptor and shipped as an offline PWA. It's a sibling of `../RSB` and `../RMB` and shares their HUD, controls, panels, seed links, idle fade, service worker and version bump. There is no build step and there are no dependencies; plain ES modules load straight from `index.html`. `README.md` explains what's on screen and the model.

(The parent `../CLAUDE.md` describes the shoryuken.me workspace and its shared-origin rules; the one above that, `~/Workspace/CLAUDE.md`, is an unrelated Rust/Fallout project. Ignore that one here.)

## Commands

```bash
npm test                            # node --test tests/*.test.mjs
node --test tests/evolve.test.mjs   # single file
npm run serve                       # python3 -m http.server 8080
npm run bump                        # bump js/version.js + package.json (-- minor|major)
npm run icons                       # regenerate icons/ from scripts/make_icons.py (Pillow)
```

## Architecture

- `js/chem.js` (no DOM): the amino-acid table, `contact()` (per-site energy terms), `neighbour()` (epistatic coupling along the groove), `dock()` (best register; uses a per-lock lookup table), `optimum()` (exact best key by dynamic programming), `makeLock()`, `mutateResidue()` (similarity-weighted), Kd formatting.
- `js/evolve.js` (no DOM): `createWorld(seed)`, `generation(world)` → a record (`survivors`, `dead`, `children`, `best`, `improved`, `hyper`, `mean`, `diversity`) the renderer animates, `newLock(world)` (the population carries over). `world.pop` is always sorted best first. Knobs: `POPULATION`, `SURVIVORS`, `TARGET_GAP`, `CROSSOVER`, `MUTATION`, `STALL`/`HYPER`, `GIVE_UP`.
- `js/render.js`: canvas. `reset(world)` for a new lock, `startGeneration(world, record)` starts a `GEN_TIME` timeline (select → breed → sort; phase constants at the top), `update(simDt, realDt)`, `draw()`. `busy` is true while a generation is animating. `layout()` sizes the receptor stage from its contents and picks the grid column count that gives the largest key glyphs.
- `js/app.js`: the loop runs one `generation()` whenever the renderer isn't `busy`, narrates the feed, shows the banner when `world.solved` is set, then calls `newLock()` after `END_PAUSE`. It also handles the HUD, panels, controls, install, wake lock and SW registration.
- `js/audio.js`: Web Audio pad, plus generation and lock-opened sounds. Starts on the first gesture; pref in `affinity.sound`.
- `js/history.js`: the opened-locks log (`affinity.history`), with injectable storage for tests.

### Randomness and pacing

`world.rng` (seeded) drives locks and evolution, so `#seed=` replays a run exactly. Cosmetic randomness (particles, reverb noise) may use `Math.random`; never use it in `chem.js` or `evolve.js`. Pacing is tuned so a lock takes ~20 generations (p90 ~40) at ~3.2 s each at 1×. Re-check with a quick Node loop over seeds after changing the energy model, `TARGET_GAP` or the GA rates.

## Conventions and gotchas

- **Adding or renaming a file:** add it to `ASSETS` in `sw.js` (`tests/assets.test.mjs` fails otherwise), then `npm run bump`.
- **Colours:** red means dying, gold means selected to breed, teal (`#78ffd2`) is the best key. Lineage hues are confined to 150–290° so they never read as either; keep `cladeHue` in `render.js` and `cladeColor` in `app.js` in step.
- **Layout:** the feed has a fixed CSS height, and `placePanels()` reserves the band above the feed and controls so the grid never runs under them.
- **Icons:** use the inline SVG sprite in `index.html`, not emoji.
- **Visual checks:** there's no screenshot test. Drive it with Playwright (`../JJUCompanion/node_modules` has it and a Chromium) against `npm run serve`, at 1440×900 and 390×844.

## Shared origin

Deployed at `/affinity/`. The manifest `id` is `/affinity/` (never change it once released). localStorage keys use the `affinity.` prefix. `sw.js` uses cache prefix `affinity-`, handles only requests inside its scope, reads only its own cache (never `caches.match()`), precaches with `cache: 'reload'` and fetches with `cache: 'no-cache'`. See `../CLAUDE.md`.

## Deployment

Live at https://shoryuken.me/affinity/ (`/var/www/shoryuken.me/affinity/`, with its own nginx `location` blocks and a card in `../webroot/index.html`; server conventions are in `../CLAUDE.md`). After `npm test` and `npm run bump`, ship only the served files:

```bash
rsync -a --delete --chmod=D755,F644 index.html manifest.webmanifest sw.js css js icons root@185.163.204.17:/var/www/shoryuken.me/affinity/
```
