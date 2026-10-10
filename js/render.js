// Canvas renderer: the receptor with the best key docked in it, and the ranked grid of
// the whole population. It animates each generation in phases (select → breed → sort)
// on a timeline the app advances; it never changes the world.

import { AMINO, KEY_LEN, POCKET, MIN_VOLUME, MAX_VOLUME, contact, formatKd } from './chem.js';
import { POPULATION } from './evolve.js';

// Phase timings within one generation, in sim seconds at 1×.
export const GEN_TIME = 3.2;
const SELECT_END = 0.8;
const BREED_START = 0.8;
const BREED_SPREAD = 1.0; // children appear staggered over this long
const BIRTH = 0.45; // each child's arrival animation
const SORT_START = 2.15;
const SORT_END = 2.8;
export const TIMING = { breedStart: BREED_START, breedSpread: BREED_SPREAD, sortStart: SORT_START };

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (t) => Math.max(0, Math.min(1, t));
// Lineage hues skip the reds, which mean "dying".
const cladeHue = (c) => 150 + ((c * 137.508) % 140);
const cladeColor = (c, l = 62, a = 1) => `hsla(${cladeHue(c)}, 70%, ${l}%, ${a})`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.top = 120; // canvas y below the DOM header; set by the app
    this.bottom = 70;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.showLabels = true;
    this.tiles = new Map();
    this.particles = [];
    this.t = GEN_TIME; // position within the current generation's timeline
    this.time = 0; // free-running clock for idle motion
    this.dock = { id: 0, offset: 0, shownOffset: 0, insert: 1, flash: 0 };
    this.history = [];
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout();
  }

  setInsets(top, bottom) {
    this.top = top;
    this.bottom = bottom;
    this.layout();
  }

  layout() {
    const { w, h } = this;
    const pad = Math.max(12, Math.min(24, w * 0.02));
    const usable = h - this.top - this.bottom;
    const sw = w - 2 * pad;
    const chartW = sw > 760 ? Math.min(300, sw * 0.28) : 0;
    const areaW = sw - (chartW ? chartW + 20 : 0);
    // Site width: limited by the width, and so the receptor takes at most ~38% of the height.
    const u = Math.max(8, Math.min(46, areaW / (KEY_LEN + 1.5), (usable * 0.38 - 24) / 4.8));
    const depth = u * 2.6;
    const stageH = 8 + u * 1.2 + depth * 1.18 + u * 0.5 + 18;
    this.stage = { x: pad, y: this.top, w: sw, h: stageH, u, depth, chartW, areaW };

    const gy = this.top + stageH + 6;
    const grid = { x: pad, y: gy, w: w - 2 * pad, h: Math.max(80, h - gy - this.bottom) };
    // Pick the column count that gives the biggest key glyphs (they're ~2.4:1).
    let best = null;
    for (const cols of [4, 6, 8, 12, 16, 24]) {
      const rows = Math.ceil(POPULATION / cols);
      const tw = grid.w / cols;
      const th = grid.h / rows;
      const scale = Math.min(tw / 2.4, th);
      if (!best || scale > best.scale) best = { cols, rows, tw, th, scale };
    }
    this.grid = { ...grid, ...best };
    for (const tile of this.tiles.values()) {
      const p = this.slot(tile.slot);
      tile.x = tile.tx = p.x;
      tile.y = tile.ty = p.y;
    }
  }

  slot(i) {
    const g = this.grid;
    return { x: g.x + (i % g.cols) * g.tw, y: g.y + Math.floor(i / g.cols) * g.th };
  }

  // --- world events ---------------------------------------------------------------------

  // New lock (or first start): every key takes its rank slot; no generation animation.
  reset(world) {
    this.tiles.clear();
    this.particles.length = 0;
    world.pop.forEach((key, i) => this.tiles.set(key.id, this.makeTile(key, i, 'alive')));
    this.t = GEN_TIME;
    this.history = [{ best: world.pop[0].dG, mean: mean(world.pop) }];
    this.dock = { id: world.pop[0].id, offset: world.pop[0].offset, shownOffset: world.pop[0].offset, insert: 0, flash: 0 };
    this.lockIn = 0;
    this.world = world;
  }

  makeTile(key, slot, state) {
    const p = this.slot(slot);
    return { key, slot, state, x: p.x, y: p.y, fx: p.x, fy: p.y, tx: p.x, ty: p.y, birth: 0, rank: slot, prevRank: slot };
  }

  // A generation just happened in the world: animate from the old ranking to the new.
  startGeneration(world, record) {
    this.world = world;
    const dead = new Set(record.dead);
    const freeSlots = [];
    for (const tile of this.tiles.values()) {
      if (dead.has(tile.key.id)) {
        tile.state = 'dying';
        freeSlots.push(tile.slot);
      } else {
        tile.state = 'survivor';
      }
    }
    freeSlots.sort((a, b) => a - b);
    const byId = new Map(world.pop.map((k) => [k.id, k]));
    record.children.forEach((id, i) => {
      const tile = this.makeTile(byId.get(id), freeSlots[i], 'born');
      tile.birth = BREED_START + (i / record.children.length) * BREED_SPREAD;
      this.tiles.set(id, tile);
    });
    // Where everyone ends up once the new ranking is sorted.
    world.pop.forEach((key, rank) => {
      const tile = this.tiles.get(key.id);
      tile.rank = rank;
      const p = this.slot(rank);
      tile.tx = p.x;
      tile.ty = p.y;
    });
    this.record = record;
    this.t = 0;
    this.deadIds = dead;
    this.history.push({ best: world.pop[0].dG, mean: record.mean });
  }

  get busy() {
    return this.t < GEN_TIME;
  }

  // dt: sim seconds (already scaled by speed); realDt drives idle motion.
  update(dt, realDt) {
    this.time += realDt;
    const was = this.t;
    if (this.t < GEN_TIME) this.t = Math.min(GEN_TIME, this.t + dt);
    const t = this.t;

    // Deaths: shed a few residues as particles at the moment a key starts to dissolve.
    if (was < 0.25 && t >= 0.25 && !this.reducedMotion) {
      for (const tile of this.tiles.values()) if (tile.state === 'dying') this.shatter(tile);
    }
    // Sorting: glide from the old slot to the new rank.
    if (t >= SORT_START) {
      const k = ease((t - SORT_START) / (SORT_END - SORT_START));
      for (const tile of this.tiles.values()) {
        if (tile.state === 'dying') continue;
        if (tile.fx === undefined || was < SORT_START) {
          tile.fx = tile.x;
          tile.fy = tile.y;
        }
        tile.x = tile.fx + (tile.tx - tile.fx) * k;
        tile.y = tile.fy + (tile.ty - tile.fy) * k;
      }
    }
    if (was < SORT_START && t >= SORT_START) {
      for (const tile of this.tiles.values()) {
        tile.fx = tile.x;
        tile.fy = tile.y;
      }
      this.redock();
    }
    if (t >= GEN_TIME && was < GEN_TIME) {
      for (const [id, tile] of this.tiles) {
        if (tile.state === 'dying') this.tiles.delete(id);
        else {
          tile.state = 'alive';
          tile.slot = tile.rank;
          tile.x = tile.tx;
          tile.y = tile.ty;
        }
      }
    }

    for (const p of this.particles) {
      p.vy += 260 * realDt;
      p.x += p.vx * realDt;
      p.y += p.vy * realDt;
      p.life -= realDt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    // Docking animation for the best key in the receptor.
    const d = this.dock;
    d.insert = Math.min(1, d.insert + realDt * 1.6);
    d.shownOffset += (d.offset - d.shownOffset) * Math.min(1, realDt * 6);
    d.flash = Math.max(0, d.flash - realDt);
    this.lockIn = Math.min(1, (this.lockIn ?? 0) + realDt * 1.2);
  }

  redock() {
    const best = this.world.pop[0];
    if (best.id !== this.dock.id) {
      this.dock.id = best.id;
      this.dock.offset = best.offset;
      this.dock.insert = 0.35;
      this.dock.flash = 1;
    }
  }

  shatter(tile) {
    const g = this.grid;
    const glyph = this.glyphBox(tile.x, tile.y);
    for (let i = 0; i < KEY_LEN; i += 3) {
      const a = AMINO[tile.key.seq[i]];
      this.particles.push({
        x: glyph.x + (i + 0.5) * glyph.u, y: glyph.y + glyph.h * 0.5,
        vx: (Math.random() - 0.5) * 50, vy: -Math.random() * 60, life: 0.6 + Math.random() * 0.5,
        size: Math.max(1.5, g.scale * 0.06), color: a.color,
      });
    }
  }

  // --- drawing ----------------------------------------------------------------------------

  draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createRadialGradient(w * 0.5, this.stage.y + this.stage.h * 0.4, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
    bg.addColorStop(0, '#0a1a1c');
    bg.addColorStop(1, '#020507');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (!this.world) return;
    this.drawStage();
    this.drawGrid();
  }

  glyphBox(x, y) {
    const g = this.grid;
    const w = Math.min(g.tw * 0.86, g.scale * 2.2);
    const h = Math.min(g.th * 0.62, w / 2.6);
    const gx = x + (g.tw - w) / 2;
    const gy = y + (g.th - h) / 2 - g.th * 0.04;
    return { x: gx, y: gy, w, h, u: w / KEY_LEN };
  }

  drawGrid() {
    const { ctx } = this;
    const g = this.grid;
    const t = this.t;
    const lock = this.world.lock;
    const top = this.world.pop[0].dG;
    const record = this.busy ? this.record : null;
    const tilesById = this.tiles;

    // Breeding arcs from parents to each child, while it arrives.
    if (record && t >= BREED_START && t < SORT_START + 0.2) {
      ctx.save();
      ctx.lineWidth = 1;
      for (const id of record.children) {
        const child = tilesById.get(id);
        const k = (t - child.birth) / BIRTH;
        if (k < 0 || k > 1.6) continue;
        const fade = k < 1 ? 0.55 : 0.55 * (1 - (k - 1) / 0.6);
        const c = this.center(child);
        for (const pid of child.key.parents) {
          const parent = tilesById.get(pid);
          if (!parent) continue;
          const p = this.center(parent);
          const reach = ease(Math.min(1, k * 1.6));
          const mx = (p.x + c.x) / 2 + (c.y - p.y) * 0.12;
          const my = (p.y + c.y) / 2 - Math.abs(c.x - p.x) * 0.08;
          ctx.strokeStyle = cladeColor(parent.key.clade, 65, fade);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          // Draw the curve only up to `reach` along it (de Casteljau split).
          const ax = p.x + (mx - p.x) * reach;
          const ay = p.y + (my - p.y) * reach;
          const bx = mx + (c.x - mx) * reach;
          const by = my + (c.y - my) * reach;
          ctx.quadraticCurveTo(ax, ay, ax + (bx - ax) * reach, ay + (by - ay) * reach);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    for (const tile of tilesById.values()) this.drawTile(tile, t, lock, top);

    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  center(tile) {
    return { x: tile.x + this.grid.tw / 2, y: tile.y + this.grid.th / 2 };
  }

  drawTile(tile, t, lock, top) {
    const { ctx } = this;
    const g = this.grid;
    const key = tile.key;
    let alpha = 1;
    let grow = 1;
    let deathTint = 0;
    let survivorGlow = 0;

    if (tile.state === 'dying') {
      deathTint = clamp01(t / 0.3);
      alpha = 1 - clamp01((t - 0.25) / (SELECT_END - 0.25));
      grow = 1 - 0.25 * clamp01((t - 0.25) / (SELECT_END - 0.25));
      if (alpha <= 0) return;
    } else if (tile.state === 'born') {
      const k = (t - tile.birth) / BIRTH;
      if (k <= 0) return;
      alpha = ease(k);
      grow = 0.6 + 0.4 * ease(k);
    } else if (tile.state === 'survivor') {
      survivorGlow = t < SORT_END ? Math.sin(Math.PI * clamp01(t / SORT_END)) : 0;
    }

    const pad = Math.max(1.5, g.scale * 0.05);
    const x = tile.x + pad;
    const y = tile.y + pad;
    const w = g.tw - 2 * pad;
    const h = g.th - 2 * pad;
    const cx = x + w / 2;
    const cy = y + h / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(grow, grow);
    ctx.translate(-cx, -cy);

    // Tile: tinted by lineage, red while dying, gold rim while selected to breed.
    const r = Math.min(6, h * 0.15);
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = deathTint ? `rgba(${40 + 120 * deathTint}, 14, 18, 0.7)` : cladeColor(key.clade, 16, 0.55);
    ctx.fill();
    if (survivorGlow > 0) {
      ctx.shadowColor = 'rgba(255, 210, 110, 0.9)';
      ctx.shadowBlur = 12 * survivorGlow;
      ctx.strokeStyle = `rgba(255, 210, 110, ${0.35 + 0.6 * survivorGlow})`;
      ctx.lineWidth = 1.5;
    } else if (tile.rank === 0 && tile.state !== 'dying') {
      ctx.strokeStyle = 'rgba(120, 255, 210, 0.85)';
      ctx.lineWidth = 1.5;
    } else {
      ctx.strokeStyle = deathTint ? `rgba(255, 90, 90, ${0.6 * deathTint})` : cladeColor(key.clade, 50, 0.35);
      ctx.lineWidth = 1;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    const glyph = this.glyphBox(tile.x, tile.y);
    const born = tile.state === 'born' ? (t - tile.birth) / BIRTH : 2;
    this.drawKey(key, glyph, { born, dim: !!deathTint });

    // Affinity bar along the bottom: full = lock opened.
    const fit = clamp01(-key.dG / -lock.target);
    const by = y + h - Math.max(2, h * 0.08) - 1;
    const bh = Math.max(1.5, h * 0.06);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(x + 4, by, w - 8, bh);
    ctx.fillStyle = deathTint ? '#ff6464' : key.dG === top ? '#78ffd2' : cladeColor(key.clade, 60, 0.9);
    ctx.fillRect(x + 4, by, (w - 8) * fit, bh);

    if (this.showLabels && g.th > 34 && g.tw > 70) {
      ctx.font = `${Math.min(11, g.th * 0.2)}px ${FONT}`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(214, 230, 235, 0.55)';
      ctx.fillText(`${(this.busy && t < SORT_START ? tile.slot : tile.rank) + 1}`, x + 4, y + 3);
      ctx.textAlign = 'right';
      ctx.fillText(formatKd(key.dG), x + w - 4, y + 3);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  // A key glyph: a backbone with one tooth per residue, height by side-chain volume and
  // colour by chemistry. The docked register is bright; overhangs are dim. Children show
  // their crossover point and flash where they mutated.
  drawKey(key, box, { born = 2, dim = false } = {}) {
    const { ctx } = this;
    const { x, y, w, h, u } = box;
    const base = y + h;
    const flash = born < 1.4 ? 1 - clamp01((born - 0.4) / 1) : 0;
    ctx.fillStyle = dim ? 'rgba(255,120,120,0.35)' : 'rgba(200, 225, 230, 0.35)';
    ctx.fillRect(x, base - Math.max(1, h * 0.07), w, Math.max(1, h * 0.07));
    const baseAlpha = ctx.globalAlpha;
    for (let i = 0; i < KEY_LEN; i++) {
      const a = AMINO[key.seq[i]];
      const th = toothHeight(a.volume, h * 0.9);
      const inGroove = i >= key.offset && i < key.offset + POCKET;
      ctx.globalAlpha = baseAlpha * (dim ? 0.45 : 1) * (inGroove ? 1 : 0.35);
      ctx.fillStyle = a.color;
      ctx.fillRect(x + i * u + u * 0.14, base - th, u * 0.72, th);
    }
    ctx.globalAlpha = baseAlpha;
    if (flash > 0 && key.mutations.length) {
      ctx.fillStyle = `rgba(255,255,255,${0.9 * flash})`;
      for (const m of key.mutations) {
        const th = toothHeight(AMINO[m.to].volume, h * 0.9);
        ctx.fillRect(x + m.pos * u, base - th - u * 0.2, u, th + u * 0.2);
      }
    }
    if (flash > 0 && key.cut > 0) {
      ctx.strokeStyle = `rgba(255, 220, 140, ${flash})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + key.cut * u, y - 2);
      ctx.lineTo(x + key.cut * u, base + 2);
      ctx.stroke();
    }
  }

  // --- the receptor ----------------------------------------------------------------------

  drawStage() {
    const { ctx } = this;
    const s = this.stage;
    const lock = this.world.lock;
    const best = this.world.pop.find((k) => k.id === this.dock.id) ?? this.world.pop[0];

    const { u, depth, chartW, areaW } = s; // depth: notch depth for the largest residue
    const lockW = (POCKET + 2) * u;
    const lx = s.x + (areaW - lockW) / 2;
    const gx = lx + u; // first site
    const slabTop = s.y + 8;
    const mouth = slabTop + u * 1.2 + depth; // bottom face of the receptor
    const lockAppear = ease(this.lockIn);

    // Receptor body: a slab with the binding groove cut into its underside.
    ctx.save();
    ctx.globalAlpha = lockAppear;
    ctx.translate(0, (1 - lockAppear) * -20);
    ctx.beginPath();
    ctx.moveTo(lx, slabTop + 10);
    ctx.quadraticCurveTo(lx, slabTop, lx + 10, slabTop);
    ctx.lineTo(lx + lockW - 10, slabTop);
    ctx.quadraticCurveTo(lx + lockW, slabTop, lx + lockW, slabTop + 10);
    ctx.lineTo(lx + lockW, mouth);
    for (let i = POCKET - 1; i >= 0; i--) {
      const site = lock.sites[i];
      const d = toothHeight(site.cavity, depth);
      const x0 = gx + i * u;
      ctx.lineTo(x0 + u, mouth);
      ctx.lineTo(x0 + u * 0.92, mouth - d);
      ctx.lineTo(x0 + u * 0.08, mouth - d);
      ctx.lineTo(x0, mouth);
    }
    ctx.lineTo(lx, mouth);
    ctx.closePath();
    const body = ctx.createLinearGradient(0, slabTop, 0, mouth);
    body.addColorStop(0, '#173238');
    body.addColorStop(1, '#0d1f24');
    ctx.fillStyle = body;
    ctx.shadowColor = 'rgba(80, 220, 190, 0.25)';
    ctx.shadowBlur = 24;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(120, 240, 210, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // A couple of decorative helices running through the protein.
    ctx.save();
    ctx.clip();
    ctx.lineWidth = Math.max(2, u * 0.12);
    for (let r = 0; r < 2; r++) {
      const yy = slabTop + (r + 1) * (mouth - slabTop - depth) / 3;
      ctx.strokeStyle = r ? 'rgba(120, 200, 255, 0.10)' : 'rgba(120, 255, 200, 0.10)';
      ctx.beginPath();
      for (let xx = lx; xx <= lx + lockW; xx += 3) {
        const yv = yy + Math.sin((xx - lx) / (u * 0.45) + this.time * 0.6 + r * 2) * u * 0.18;
        if (xx === lx) ctx.moveTo(xx, yv);
        else ctx.lineTo(xx, yv);
      }
      ctx.stroke();
    }
    ctx.restore();

    ctx.restore();

    // The best key, docked from below at its register.
    const d = this.dock;
    const insert = ease(d.insert);
    const kx = gx - d.shownOffset * u;
    const gap = (1 - insert) * depth * 0.5;
    const base = mouth + depth * 0.18 + gap; // backbone y
    const reach = depth * 1.0 + depth * 0.18; // a tooth exactly fills a cavity of its own size
    let total = 0;
    const contacts = [];
    for (let i = 0; i < KEY_LEN; i++) {
      const a = AMINO[best.seq[i]];
      const th = toothHeight(a.volume, depth) + depth * 0.18;
      const site = i - Math.round(d.shownOffset);
      const inGroove = site >= 0 && site < POCKET;
      const x0 = kx + i * u;
      ctx.globalAlpha = inGroove ? 1 : 0.35;
      ctx.fillStyle = a.color;
      ctx.shadowColor = a.color;
      ctx.shadowBlur = inGroove ? 8 : 0;
      ctx.fillRect(x0 + u * 0.18, base - th, u * 0.64, th);
      ctx.shadowBlur = 0;
      if (u > 18) {
        ctx.font = `600 ${Math.min(13, u * 0.36)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = inGroove ? '#d6e6eb' : 'rgba(214,230,235,0.4)';
        ctx.fillText(a.code, x0 + u / 2, base + 6);
      }
      if (inGroove && insert > 0.95) contacts.push({ i, site, x0, th, a });
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(200, 230, 235, 0.6)';
    ctx.fillRect(kx, base, KEY_LEN * u, Math.max(2, u * 0.08));

    // The lining of each pocket site, coloured by its residue, drawn over the teeth.
    ctx.globalAlpha = lockAppear;
    for (let i = 0; i < POCKET; i++) {
      const site = lock.sites[i];
      const a = AMINO[site.residue];
      const d = toothHeight(site.cavity, depth);
      const x0 = gx + i * u;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = Math.max(2, u * 0.09);
      ctx.beginPath();
      ctx.moveTo(x0 + u * 0.04, mouth);
      ctx.lineTo(x0 + u * 0.1, mouth - d);
      ctx.lineTo(x0 + u * 0.9, mouth - d);
      ctx.lineTo(x0 + u * 0.96, mouth);
      ctx.stroke();
      if (u > 18) {
        ctx.font = `600 ${Math.min(13, u * 0.36)}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = a.color;
        ctx.fillText(a.code, x0 + u / 2, mouth - d - Math.min(13, u * 0.36));
      }
    }
    ctx.globalAlpha = 1;

    // Contacts: clashes red, snug fits green, voids dim, plus the chemistry that's working.
    for (const c of contacts) {
      const site = lock.sites[c.site];
      const p = AMINO[site.residue];
      const e = contact(c.a, p, site.cavity);
      total += e.total;
      const tipY = base - c.th;
      const ceil = mouth - toothHeight(site.cavity, depth);
      const cx = c.x0 + u / 2;
      if (e.clash > 0) {
        ctx.fillStyle = `rgba(255, 70, 70, ${0.55 + 0.25 * Math.sin(this.time * 12)})`;
        ctx.fillRect(c.x0 + u * 0.18, tipY, u * 0.64, Math.max(2, ceil - tipY));
      } else if (tipY - ceil < depth * 0.1) {
        ctx.fillStyle = 'rgba(120, 255, 190, 0.8)';
        ctx.fillRect(c.x0 + u * 0.18, tipY - 1, u * 0.64, 2);
      }
      const glow = (color, a) => {
        ctx.fillStyle = color;
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(cx, Math.max(ceil, tipY) - u * 0.05, u * 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      };
      if (e.elec < -0.3) glow('#9fd0ff', 0.35);
      if (e.elec > 0.3) glow('#ff5050', 0.4);
      if (e.hyd < -0.4) glow('#ffd36b', 0.3);
      if (e.stack < 0) glow('#c9a6ff', 0.35);
      if (e.hbond < 0) {
        ctx.strokeStyle = 'rgba(140, 240, 255, 0.85)';
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - u * 0.25, tipY);
        ctx.lineTo(c.x0 + u * 0.1, ceil);
        ctx.moveTo(cx + u * 0.25, tipY);
        ctx.lineTo(c.x0 + u * 0.9, ceil);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (d.flash > 0) {
      ctx.fillStyle = `rgba(120, 255, 210, ${0.18 * d.flash})`;
      ctx.fillRect(lx - u * 0.3, mouth - depth, lockW + u * 0.6, depth * 1.4);
    }

    if (chartW) this.drawChart(s.x + s.w - chartW, s.y + 6, chartW, s.h - 12, lock);
  }

  // Best and mean binding energy per generation for this lock, with the target line.
  drawChart(x, y, w, h, lock) {
    const { ctx } = this;
    const hist = this.history;
    ctx.save();
    roundRect(ctx, x, y, w, h, 8);
    ctx.fillStyle = 'rgba(6, 18, 20, 0.6)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 240, 210, 0.18)';
    ctx.stroke();
    const px = x + 34;
    const py = y + 32;
    const pw = w - 46;
    const ph = h - 48;
    const lo = lock.best - 0.5;
    const hi = Math.max(2, ...hist.map((p) => Math.min(8, p.mean)));
    const Y = (g) => py + ph * (1 - (hi - g) / (hi - lo));
    const X = (i) => px + (hist.length < 2 ? 0 : (i / Math.max(20, hist.length - 1)) * pw);

    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = 'rgba(160, 190, 200, 0.75)';
    ctx.textBaseline = 'top';
    ctx.fillText('binding ΔG per generation', x + 10, y + 7);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const g of [0, Math.round((lo + 0) / 2), Math.round(lo)]) {
      ctx.fillText(`${g}`, px - 6, Y(g));
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(px, Y(g), pw, 1);
      ctx.fillStyle = 'rgba(160, 190, 200, 0.75)';
    }
    ctx.strokeStyle = 'rgba(120, 255, 210, 0.5)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px, Y(lock.target));
    ctx.lineTo(px + pw, Y(lock.target));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(120, 255, 210, 0.75)';
    ctx.fillText('target', px + 4, Y(lock.target) - 7);

    const line = (field, color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      hist.forEach((p, i) => {
        const yy = Y(Math.min(hi, p[field]));
        if (i) ctx.lineTo(X(i), yy);
        else ctx.moveTo(X(i), yy);
      });
      ctx.stroke();
    };
    line('mean', 'rgba(160, 190, 200, 0.45)', 1);
    line('best', '#78ffd2', 1.8);
    ctx.restore();
  }
}

export const FONT = "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace";

function toothHeight(volume, max) {
  return max * (0.22 + 0.78 * (volume - MIN_VOLUME) / (MAX_VOLUME - MIN_VOLUME));
}

function mean(pop) {
  return pop.reduce((s, k) => s + k.dG, 0) / pop.length;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
