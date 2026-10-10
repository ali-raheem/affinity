// Procedural sound, synthesised with Web Audio (no files, works offline). A soft
// ambient pad underneath; each generation gets a hush as the unfit dissolve, a
// scatter of plucks as children are born (pitched by how well they bind), a chime when
// the best binder improves, and an arpeggio when a lock opens.

const PREF_KEY = 'affinity.sound';
// A pentatonic scale over two octaves, so random plucks always sound consonant.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const ROOT = 220;

function loadPref() {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

function savePref(on) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch { /* storage unavailable; preference just won't persist */ }
}

const note = (step) => ROOT * 2 ** (SCALE[Math.max(0, Math.min(SCALE.length - 1, step))] / 12);

export class SoundEngine {
  constructor() {
    this.enabled = loadPref();
    this.paused = false;
    this.ctx = null;
  }

  // Browsers only allow audio to start from a user gesture; call this from one.
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state !== 'running' && !this.paused) this.ctx.resume();
  }

  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(comp);

    // A short synthetic reverb tail so plucks bloom instead of clicking.
    const len = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.verb.connect(wet).connect(this.master);

    const nlen = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;

    this.startPad();
  }

  startPad() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.028;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.connect(out).connect(this.master);
    out.connect(this.verb);
    for (const [f, detune] of [[ROOT / 2, -6], [ROOT * 0.75, 5], [ROOT, 0]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(lp);
      o.start();
    }
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 0.05;
    depth.gain.value = 250;
    lfo.connect(depth).connect(lp.frequency);
    lfo.start();
  }

  setEnabled(on) {
    this.enabled = on;
    savePref(on);
    if (on) this.unlock();
    else this.ctx?.suspend();
  }

  setPaused(p) {
    this.paused = p;
    if (!this.ctx) return;
    if (p || !this.enabled) this.ctx.suspend();
    else this.ctx.resume();
  }

  ready() {
    return this.enabled && !this.paused && this.ctx && this.ctx.state === 'running';
  }

  pluck(f, t, peak = 0.08, dur = 0.5) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    g.connect(this.verb);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  hush(t, dur = 0.6) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(1800, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // One generation's worth of sound. fit: 0..1 for each child, in birth order.
  generation(record, fits, timing, speed) {
    if (!this.ready() || speed > 4) return;
    const t0 = this.ctx.currentTime;
    this.hush(t0 + 0.15 / speed);
    // Only a handful of births are voiced, or it turns to mush.
    const voiced = fits.map((f, i) => [f, i]).sort((a, b) => b[0] - a[0]).slice(0, 5);
    for (const [f, i] of voiced) {
      const at = t0 + (timing.breedStart + (i / fits.length) * timing.breedSpread) / speed;
      this.pluck(note(Math.round(f * (SCALE.length - 1))), at, 0.05);
    }
    if (record.improved) {
      const at = t0 + timing.sortStart / speed;
      this.pluck(note(7), at, 0.06, 1.2);
      this.pluck(note(9), at + 0.09, 0.05, 1.2);
    }
  }

  opened() {
    if (!this.ready()) return;
    const t0 = this.ctx.currentTime;
    [0, 2, 4, 5, 7, 10].forEach((s, i) => this.pluck(note(s), t0 + i * 0.11, 0.08, 1.6));
  }
}
