// App wiring: the generation loop, HUD, controls, lock rotation, offline support.

import { createWorld, generation, newLock, progress, POPULATION, SURVIVORS, TARGET_GAP } from './evolve.js';
import { AMINO, CLASSES, POCKET, contact, formatKd, sequence } from './chem.js';
import { randomSeed } from './rng.js';
import { Renderer, TIMING } from './render.js';
import { SoundEngine } from './audio.js';
import { summarizeLock, addHistory, loadHistory, saveHistory } from './history.js';
import { VERSION, BUILT } from './version.js';

const END_PAUSE = 6; // seconds the "lock opened" banner shows before the next lock
const SPEEDS = [0.5, 1, 2, 4, 8];
const LABELS_KEY = 'affinity.labels';

const $ = (id) => document.getElementById(id);
const el = {
  canvas: $('view'), hud: $('hud'), cards: $('cards'), lockCard: $('card-lock'), bestCard: $('card-best'),
  genNo: $('gen-no'), clock: $('clock'), meta: $('meta'), seed: $('seed'), feed: $('feed'), banner: $('banner'),
  pause: $('btn-pause'), speed: $('btn-speed'), next: $('btn-next'), controls: $('controls'),
  pocket: $('pocket'), history: $('history'), settings: $('settings'),
  sound: $('set-sound'), labels: $('set-labels'), full: $('set-full'), hide: $('set-hide'), install: $('set-install'),
  version: $('version'),
};
// Side panels: at most one is open at a time, toggled by its control-bar button.
const panels = {
  pocket: { panel: el.pocket, button: $('btn-pocket'), onOpen: () => buildPocket() },
  history: { panel: el.history, button: $('btn-history'), onOpen: () => buildHistory() },
  settings: { panel: el.settings, button: $('btn-settings') },
};

const useIcon = (button, name) => button.querySelector('use').setAttribute('href', `#i-${name}`);

const renderer = new Renderer(el.canvas);
const sound = new SoundEngine();
let world = null;
let paused = false;
let speedIndex = 1;
let endTimer = -1; // ≥ 0 while the "lock opened" banner is up
let hudTimer = 0;
let lockTime = 0;
let history = loadHistory();
let lastLeader = null;

try {
  renderer.showLabels = localStorage.getItem(LABELS_KEY) !== 'off';
} catch { /* keep the default */ }

function seedFromHash(hash = location.hash) {
  const m = hash.match(/seed=([0-9a-f]+)/i);
  return m ? parseInt(m[1], 16) >>> 0 : null;
}

const hex = (seed) => seed.toString(16).padStart(8, '0');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function newRun(seed = randomSeed()) {
  world = createWorld(seed);
  window.history.replaceState(null, '', `#seed=${hex(seed)}`);
  el.seed.textContent = `seed ${hex(seed)}`;
  el.feed.replaceChildren();
  startLock();
}

function startLock() {
  endTimer = -1;
  lockTime = 0;
  lastLeader = world.pop[0].clade;
  el.banner.hidden = true;
  renderer.reset(world);
  buildLockCard();
  updateHud();
  if (!el.pocket.hidden) buildPocket();
  const lock = world.lock;
  feed(`<b>Lock ${lock.number}</b> · ${escapeHtml(lock.family)} ${escapeHtml(lock.tag)} <span class="w">· ${lock.mood} pocket · best possible ${formatKd(lock.best)}</span>`, '#8fd8ff');
  placePanels();
}

function nextLock() {
  newLock(world);
  startLock();
}

// Panels open just below the header, whose height depends on the width.
function placePanels() {
  const top = Math.ceil(el.meta.getBoundingClientRect().bottom) + 10;
  el.hud.style.setProperty('--hud-top', `${top}px`);
  // The feed and controls share a band along the bottom; the grid stays above it.
  const band = Math.min(el.controls.getBoundingClientRect().top, el.feed.getBoundingClientRect().top);
  const bottom = window.innerHeight - band + 8;
  renderer.setInsets(top, bottom);
}

// --- HUD ---------------------------------------------------------------------------

function buildLockCard() {
  const lock = world.lock;
  el.lockCard.querySelector('.name').textContent = `${lock.family} ${lock.tag}`;
  el.lockCard.querySelector('.mood').textContent = `Lock ${lock.number} · ${lock.mood} pocket`;
  el.lockCard.querySelector('.seq').innerHTML = lock.sites
    .map((s) => `<span style="color:${AMINO[s.residue].color}">${AMINO[s.residue].code}</span>`).join('');
}

function updateHud() {
  const best = world.pop[0];
  const lock = world.lock;
  el.bestCard.querySelector('.name').innerHTML = `<span class="lbl">Best binder · </span>Kd ${formatKd(best.dG)}`;
  el.bestCard.querySelector('.target').textContent = `target ${formatKd(lock.target)} · ΔG ${best.dG.toFixed(1)} kcal/mol`;
  const div = world.last?.diversity;
  el.bestCard.querySelector('.div').textContent = div === undefined ? '' : `diversity ${Math.round(div * 100)}%`;
  el.bestCard.querySelector('.bar > i').style.width = `${(progress(world) * 100).toFixed(1)}%`;
  const g = world.gen - lock.startGen;
  el.genNo.textContent = `Lock ${lock.number} · generation ${g}`;
  const t = Math.floor(lockTime);
  el.clock.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function feed(html, color) {
  const li = document.createElement('li');
  li.style.setProperty('--c', color);
  li.innerHTML = html;
  el.feed.append(li);
  while (el.feed.children.length > 6) el.feed.firstElementChild.remove();
}

const cladeColor = (c) => `hsl(${150 + ((c * 137.508) % 140)}, 70%, 65%)`;
const lineage = (c) => `lineage ${String.fromCharCode(65 + (c % 26))}${Math.floor(c / 26) || ''}`;

// What's worth narrating about the generation that just happened.
function narrate(record) {
  const g = world.gen - world.lock.startGen;
  if (record.hyper) {
    feed(`Gen ${g} · <b>stalled</b> <span class="w">· stress response: mutation rate ×4 this generation</span>`, '#ffb36b');
  }
  if (record.improved) {
    const best = record.best;
    const how = best.parents?.length === 2
      ? `crossover of #${best.parents[0]} × #${best.parents[1]}${best.mutations.length ? ` + ${best.mutations.map((m) => `${AMINO[m.from].code}${m.pos + 1}${AMINO[m.to].code}`).join(', ')}` : ''}`
      : best.mutations.length
        ? `mutant ${best.mutations.map((m) => `${AMINO[m.from].code}${m.pos + 1}${AMINO[m.to].code}`).join(', ')}`
        : 'survivor';
    feed(`Gen ${g} · new best <b>#${best.id}</b> Kd ${formatKd(best.dG)} <span class="w">· ${how}</span>`, cladeColor(best.clade));
  }
  // A lineage taking over most of the population is worth a mention.
  const counts = new Map();
  for (const k of world.pop) counts.set(k.clade, (counts.get(k.clade) ?? 0) + 1);
  const [lead, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (lead !== lastLeader && n >= POPULATION / 2) {
    feed(`Gen ${g} · <b>${lineage(lead)}</b> now makes up ${Math.round((n / POPULATION) * 100)}% of the population`, cladeColor(lead));
    lastLeader = lead;
  }
}

function showBanner() {
  const s = summarizeLock(world);
  el.banner.style.setProperty('--c', s.opened ? '#78ffd2' : '#ffb36b');
  el.banner.querySelector('.kicker').textContent = s.opened ? 'LOCK OPENED' : 'LOCK RETIRED';
  el.banner.querySelector('.title').textContent = `Kd ${s.kd} after ${s.gens} generations`;
  el.banner.querySelector('.sub').textContent = `${s.name} · binder ${s.binder} · best possible ${s.best}`;
  el.banner.hidden = false;
  feed(`<b>${s.opened ? 'Opened' : 'Retired'}</b> ${escapeHtml(s.name)} <span class="w">· ${s.gens} generations · Kd ${s.kd}</span>`, s.opened ? '#78ffd2' : '#ffb36b');
  history = addHistory(history, { ...s, at: Date.now() });
  saveHistory(history);
  if (!el.history.hidden) buildHistory();
  sound.opened();
}

// --- panels ------------------------------------------------------------------------

function buildPocket() {
  const lock = world.lock;
  const best = world.pop[0];
  const rows = lock.sites.map((s, i) => {
    const p = AMINO[s.residue];
    const k = AMINO[best.seq[best.offset + i]];
    const e = contact(k, p, s.cavity);
    const why = [];
    if (e.clash) why.push('clash');
    if (e.elec < -0.3) why.push('salt bridge');
    if (e.elec > 0.3) why.push('charge repulsion');
    if (e.hbond < 0) why.push('H-bond');
    if (e.stack < 0) why.push(k.cls === 'aromatic' && p.cls === 'aromatic' ? 'π-stacking' : 'cation-π');
    if (e.hyd < -0.4) why.push('hydrophobic');
    if (e.hyd > 0.4) why.push('desolvation');
    return `<tr>
      <td>${i + 1}</td>
      <td><span class="chip" style="--cc:${p.color}">${p.code}</span> ${p.abbr}</td>
      <td class="r">${Math.round(s.cavity)} Å³</td>
      <td><span class="chip" style="--cc:${k.color}">${k.code}</span></td>
      <td class="r ${e.total < -0.5 ? 'good' : e.total > 0.3 ? 'bad' : ''}">${e.total.toFixed(1)}</td>
      <td>${why.join(', ')}</td>
    </tr>`;
  }).join('');
  const legend = Object.values(CLASSES).map((c) => `<span style="--cc:${c.color}">${c.label}</span>`).join('');
  el.pocket.innerHTML = `
    <h2>${escapeHtml(lock.family)} ${escapeHtml(lock.tag)}</h2>
    <p>A <b>${lock.mood}</b> binding groove of ${POCKET} sites. Each site is lined by a residue and leaves a cavity of some size.
      The best possible key would bind at <b>${formatKd(lock.best)}</b>; the lock opens at <b>${formatKd(lock.target)}</b>
      (within ${TARGET_GAP} kcal/mol of perfect).</p>
    <table>
      <tr><th>site</th><th>lining</th><th class="r">cavity</th><th>best key</th><th class="r">ΔG</th><th></th></tr>
      ${rows}
    </table>
    <p>Best key #${best.id}: <b>${sequence(best.seq)}</b>, register ${best.offset + 1}–${best.offset + POCKET} in the groove.</p>
    <div class="legend">${legend}</div>
    <h3>How binding is scored</h3>
    <p>Keys are 14-residue peptides. Each one is docked in every register along the groove and scored where it binds best.
      Every key residue in the groove contacts one site, and the contact energy adds up the usual suspects:
      <b>electrostatics</b> (opposite charges attract), the <b>hydrophobic effect</b> (grease buried against grease is good,
      grease against a charged wall is not), <b>hydrogen bonds</b>, <b>aromatic stacking</b> and <b>cation-π</b> contacts,
      and <b>shape</b>: a side chain bigger than its cavity clashes, one far smaller leaves a void.
      Neighbouring residues interact too (bulky pairs crowd each other, like charges repel, proline kinks the chain),
      so the best residue at one site depends on its neighbours. Binding also costs a fixed amount of entropy.
      The total is a free energy ΔG, and Kd = e<sup>ΔG/RT</sup>.</p>
    <p>It is a toy model: real binding isn't additive, and real proteins fold. But the terms pull in the same directions,
      which is why the evolved keys tend to look like real binders, with charges paired up and big hydrophobics in the deep pockets.</p>
    <h3>How the population evolves</h3>
    <p>${POPULATION} keys per generation. The top <b>${SURVIVORS}</b> survive unchanged and breed; the rest die.
      Each child takes the start of one parent and the end of another (single-point crossover), fitter parents are picked more often,
      and about one residue per child mutates, usually to a chemically similar one. If the best key stops improving for ten
      generations, the mutation rate spikes for one generation, a bit like the SOS stress response in bacteria.
      When a lock opens, a new one appears and the same population has to adapt to it.</p>
    <p>Tiles are coloured by lineage, so you can watch one family take over. Gold rims mark the survivors chosen to breed,
      red tiles are dying, white flashes are fresh mutations and the gold line is a crossover point.</p>`;
}

function seedUrl(seed) {
  return `${location.origin}${location.pathname}#seed=${hex(seed)}`;
}

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function buildHistory() {
  if (!history.length) {
    el.history.innerHTML = '<h2>Opened locks</h2><p class="empty">Locks the population cracks will appear here, with the winning binder and a link to replay the run.</p>';
    return;
  }
  el.history.innerHTML = '<h2>Opened locks</h2>' + history.map((e) => `
    <article class="past" style="--c:${e.opened ? '#78ffd2' : '#ffb36b'}">
      <div class="kicker">${e.opened ? 'OPENED' : 'RETIRED'} · LOCK ${e.lock} · ${ago(e.at)}</div>
      <div class="title">${escapeHtml(e.name)}</div>
      <div class="binder">${[...e.binder].map((c, i) => `<span style="color:${AMINO.find((a) => a.code === c)?.color ?? '#ccc'};opacity:${i >= e.offset && i < e.offset + POCKET ? 1 : 0.45}">${c}</span>`).join('')}</div>
      <div class="sub">${escapeHtml(e.mood)} pocket · Kd ${escapeHtml(e.kd)} in ${e.gens} generations · best possible ${escapeHtml(e.best)}</div>
      <div class="actions">
        <button data-replay="${e.seed}"><svg class="icon"><use href="#i-play"/></svg>Replay run</button>
        <button data-copy="${e.seed}"><svg class="icon"><use href="#i-link"/></svg><span>Copy link</span></button>
        <a href="#seed=${hex(e.seed)}" class="seed-link">seed ${hex(e.seed)}</a>
      </div>
    </article>`).join('');
}

async function copyText(button, text) {
  const target = button.querySelector('span') ?? button;
  const label = target.textContent;
  try {
    await navigator.clipboard.writeText(text);
    target.textContent = 'Link copied';
  } catch {
    target.textContent = 'Copy failed';
  }
  setTimeout(() => (target.textContent = label), 1200);
}

el.history.addEventListener('click', (e) => {
  const replay = e.target.closest('[data-replay]');
  const copy = e.target.closest('[data-copy]');
  const link = e.target.closest('.seed-link');
  if (replay) newRun(Number(replay.dataset.replay));
  else if (copy) copyText(copy, seedUrl(Number(copy.dataset.copy)));
  else if (link) {
    e.preventDefault();
    newRun(seedFromHash(link.getAttribute('href')) ?? world.seed);
  }
});

// --- loop --------------------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const speed = SPEEDS[speedIndex];
  let simDt = 0;
  if (!paused) {
    simDt = realDt * speed;
    if (endTimer >= 0) {
      endTimer += realDt;
      if (endTimer > END_PAUSE) nextLock();
    } else {
      lockTime += realDt;
      if (!renderer.busy) {
        if (world.solved) {
          endTimer = 0;
          showBanner();
        } else {
          const record = generation(world);
          renderer.startGeneration(world, record);
          narrate(record);
          if (!el.pocket.hidden && record.improved) buildPocket();
          const fits = record.children.map((id) => progress(world, world.pop.find((k) => k.id === id).dG));
          sound.generation(record, fits, TIMING, speed);
        }
      }
    }
  }
  renderer.update(simDt, realDt);
  renderer.draw();

  hudTimer -= realDt;
  if (hudTimer <= 0) {
    updateHud();
    hudTimer = 0.25;
  }
  requestAnimationFrame(frame);
}

// --- controls ----------------------------------------------------------------------

function setPaused(p) {
  paused = p;
  sound.setPaused(p);
  useIcon(el.pause, paused ? 'play' : 'pause');
  el.pause.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  el.pause.setAttribute('aria-pressed', String(paused));
}
function changeSpeed(delta) {
  speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, speedIndex + delta));
  el.speed.textContent = `${SPEEDS[speedIndex]}×`;
}
function cycleSpeed() {
  speedIndex = (speedIndex + 1) % SPEEDS.length;
  changeSpeed(0);
}
function showPanel(name) {
  for (const [key, p] of Object.entries(panels)) {
    p.panel.hidden = key !== name;
    p.button.setAttribute('aria-pressed', String(key === name));
  }
  if (name) panels[name].onOpen?.();
}
const togglePanel = (name) => showPanel(panels[name].panel.hidden ? name : null);
const anyPanelOpen = () => Object.values(panels).some((p) => !p.panel.hidden);

function setSwitch(row, on) {
  row.setAttribute('aria-checked', String(on));
}
function toggleLabels() {
  renderer.showLabels = !renderer.showLabels;
  setSwitch(el.labels, renderer.showLabels);
  try {
    localStorage.setItem(LABELS_KEY, renderer.showLabels ? 'on' : 'off');
  } catch { /* won't persist */ }
}
function renderSound() {
  setSwitch(el.sound, sound.enabled);
  useIcon(el.sound, sound.enabled ? 'sound' : 'sound-off');
}
function toggleSound() {
  sound.setEnabled(!sound.enabled);
  renderSound();
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
function setHudHidden(hidden) {
  el.hud.classList.toggle('hidden', hidden);
}

el.pause.addEventListener('click', () => setPaused(!paused));
el.speed.addEventListener('click', cycleSpeed);
el.next.addEventListener('click', () => nextLock());
for (const [name, p] of Object.entries(panels)) p.button.addEventListener('click', () => togglePanel(name));
el.sound.addEventListener('click', toggleSound);
el.labels.addEventListener('click', toggleLabels);
el.full.addEventListener('click', toggleFullscreen);
el.hide.addEventListener('click', () => {
  showPanel(null);
  setHudHidden(true);
});
el.seed.addEventListener('click', () => copyText(el.seed, seedUrl(world.seed)));
document.addEventListener('fullscreenchange', () => setSwitch(el.full, !!document.fullscreenElement));
el.full.hidden = !document.documentElement.requestFullscreen;
renderSound();
setSwitch(el.labels, renderer.showLabels);
setSwitch(el.full, false);
el.version.textContent = `v${VERSION} · built ${new Date(BUILT).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
el.version.title = BUILT;

// Install: Chromium hands us a deferred prompt; iOS Safari has no install API, so the
// row explains Share → Add to Home Screen instead. Hidden when already installed.
let installPrompt = null;
const runningInstalled = navigator.standalone === true ||
  matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function renderInstall() {
  const hint = el.install.querySelector('small');
  if (installPrompt) hint.textContent = 'adds it to your home screen or desktop; works offline';
  else if (isIOS) hint.textContent = 'in Safari, tap Share, then Add to Home Screen';
  el.install.hidden = runningInstalled || (!installPrompt && !isIOS);
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  renderInstall();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  el.install.hidden = true;
});
el.install.addEventListener('click', async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  if (outcome === 'accepted') el.install.hidden = true;
  else renderInstall();
});
renderInstall();

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case ' ': setPaused(!paused); break;
    case 'n': case 'N': nextLock(); break;
    case '+': case '=': changeSpeed(1); break;
    case '-': case '_': changeSpeed(-1); break;
    case 'p': case 'P': togglePanel('pocket'); break;
    case 'l': case 'L': togglePanel('history'); break;
    case 's': case 'S': togglePanel('settings'); break;
    case 'k': case 'K': toggleLabels(); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case 'm': case 'M': toggleSound(); break;
    case 'h': case 'H': setHudHidden(!el.hud.classList.contains('hidden')); break;
    case 'Escape': if (!anyPanelOpen()) return; showPanel(null); break;
    default: return;
  }
  e.preventDefault();
  wakeHud();
});

// Auto-hide the controls after a few idle seconds so it works as a screensaver. A tap
// while they're hidden only brings them back; the click that follows it is swallowed.
let idleTimer = null;
let swallowClick = false;
function wakeHud() {
  el.hud.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!anyPanelOpen()) el.hud.classList.add('idle');
  }, 4000);
}
window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') wakeHud(); });
window.addEventListener('pointerdown', () => {
  swallowClick = el.hud.classList.contains('idle') || el.hud.classList.contains('hidden');
  setHudHidden(false);
  wakeHud();
}, { capture: true });
window.addEventListener('click', (e) => {
  if (swallowClick) {
    e.preventDefault();
    e.stopPropagation();
  }
  swallowClick = false;
}, { capture: true });

for (const type of ['pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(type, () => sound.unlock(), { capture: true });
}

window.addEventListener('resize', () => {
  renderer.resize();
  placePanels();
});
window.addEventListener('hashchange', () => {
  const seed = seedFromHash();
  if (seed !== null && seed !== world.seed) newRun(seed);
});

// Keep the screen awake while the tab is visible.
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { /* not allowed; fine */ }
}
document.addEventListener('visibilitychange', () => {
  sound.setPaused(document.visibilityState !== 'visible' || paused);
  if (document.visibilityState === 'visible') {
    last = performance.now();
    if (!wakeLock || wakeLock.released) requestWakeLock();
  }
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register(`./sw.js?v=${VERSION}`).catch(() => {});
}

newRun(seedFromHash() ?? randomSeed());
wakeHud();
requestWakeLock();
requestAnimationFrame(frame);
