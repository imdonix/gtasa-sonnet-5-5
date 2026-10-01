// =====================================================================================================
//  LOS SANTOS RISING - fully procedural WebAudio engine (no samples, no network).
//  Layout: core helpers -> one-shot SFX recipes -> loops/engines/ambience -> generative radio -> GameAudio
// =====================================================================================================
const TAU = Math.PI * 2, EPS = 1e-4;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const rr = (a, b) => a + Math.random() * (b - a);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashN(...xs) {
  let h = 2166136261 >>> 0;
  for (const x of xs) { h ^= (x | 0) + 0x9e3779b9 + ((h << 6) >>> 0) + (h >>> 2); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
const pickR = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// ---- shaper curves ----------------------------------------------------------------------------------
const _curves = {};
function satCurve(k) {
  const key = k.toFixed(2);
  if (_curves[key]) return _curves[key];
  const n = 1024, c = new Float32Array(n), th = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / th; }
  return (_curves[key] = c);
}
function clipCurve() {
  const n = 2048, c = new Float32Array(n), knee = 0.8;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    const y = a < knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    c[i] = x < 0 ? -y : y;
  }
  return c;
}

// ---- shared buffers ---------------------------------------------------------------------------------
function normRms(d, target) {
  let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  const k = target / Math.sqrt(s / d.length + 1e-12);
  for (let i = 0; i < d.length; i++) d[i] *= k;
}
function makeNoiseBuffers(ctx) {
  const sr = ctx.sampleRate, n = Math.floor(sr * 3), X = Math.floor(sr * 0.05);
  const mk = (gen) => {
    const raw = new Float32Array(n + X); gen(raw);
    const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = raw[i];
    for (let i = 0; i < X; i++) { const w = i / X; d[i] = raw[i] * Math.sqrt(w) + raw[n + i] * Math.sqrt(1 - w); } // seamless loop
    normRms(d, 0.5);
    return b;
  };
  return {
    white: mk((d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }),
    pink: mk((d) => {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
      }
    }),
    brown: mk((d) => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l; } }),
  };
}
function makeIR(ctx, secs) {
  const sr = ctx.sampleRate, n = Math.floor(sr * secs), b = ctx.createBuffer(2, n, sr), pre = Math.floor(sr * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let lp = 0;
    for (let i = 0; i < n; i++) {
      if (i < pre) { d[i] = 0; continue; }
      const k = (i - pre) / (n - pre);
      const env = Math.pow(1 - k, 2.6) * Math.exp(-k * 3.2);
      const alpha = lerp(0.85, 0.07, Math.pow(k, 0.5)); // progressive HF damping
      lp += ((Math.random() * 2 - 1) - lp) * alpha;
      d[i] = lp * env;
    }
  }
  return b;
}
// lazily generated special buffers
function makeSpecialBuffer(ctx, name) {
  const sr = ctx.sampleRate;
  if (name === 'patter') { // rain drops, 3 s
    const n = sr * 3, b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0); let env = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      if (Math.random() < 520 / sr) env = Math.max(env, 0.25 + 0.75 * Math.random() * Math.random());
      env *= 0.9965;
      lp += ((Math.random() * 2 - 1) - lp) * 0.7;
      d[i] = lp * env;
    }
    normRms(d, 0.45); return b;
  }
  if (name === 'crackle') { // fire pops, 4 s
    const n = sr * 4, b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0); let env = 0;
    for (let i = 0; i < n; i++) {
      if (Math.random() < 22 / sr) env = 0.2 + 0.8 * Math.pow(Math.random(), 2.5);
      env *= 0.9925 - (env > 0.5 ? 0.004 : 0);
      d[i] = (Math.random() * 2 - 1) * env * env;
    }
    { let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(d[i])); for (let i = 0; i < n; i++) d[i] /= m; }
    // crossfade-safe: fade last 10 ms
    const F = Math.floor(sr * 0.01); for (let i = 0; i < F; i++) d[n - 1 - i] *= i / F;
    return b;
  }
  if (name === 'chop') { // helicopter rotor, 0.8 s = 16 blade passes @ 20 Hz
    const n = Math.floor(sr * 0.8), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), per = Math.floor(sr * 0.05);
    for (let p = 0; p < 16; p++) {
      const amp = 0.75 + 0.25 * ((p % 4 === 0) ? 1 : Math.random()), off = p * per; let lp = 0, lp2 = 0;
      for (let i = 0; i < per; i++) {
        const t = i / sr;
        lp += ((Math.random() * 2 - 1) - lp) * 0.12; lp2 += (lp - lp2) * 0.3;
        const snap = lp2 * Math.exp(-t / 0.011) * 2.4;
        const thump = Math.sin(TAU * 52 * t) * Math.exp(-t / 0.02) * 0.9;
        const slap = Math.sin(TAU * 140 * t) * Math.exp(-t / 0.006) * 0.4;
        d[off + i] = (snap + thump + slap) * amp;
      }
    }
    normRms(d, 0.35); return b;
  }
  return null;
}

// ---- envelope / voice primitives --------------------------------------------------------------------
function envPerc(g, t, peak, a, hold, d) {
  a = Math.max(0.001, a);
  g.setValueAtTime(EPS, t);
  g.linearRampToValueAtTime(Math.max(EPS * 2, peak), t + a);
  if (hold > 0) g.setValueAtTime(Math.max(EPS * 2, peak), t + a + hold);
  g.exponentialRampToValueAtTime(EPS, t + a + hold + Math.max(0.005, d));
}
// oscillator voice: o = {type,f,f2,fd,det,a,hold,d,peak, ft,ff,ff2,ffd,q (optional filter)}
function tone(B, dest, t, o) {
  if ((o.f || 440) > 16000 || (o.f2 || 0) > 16000) return null;
  const c = B.ctx, osc = c.createOscillator(), g = c.createGain();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f || 440, t);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.fd || o.d || 0.2));
  if (o.det) osc.detune.value = o.det;
  const a = Math.max(0.001, o.a || 0.002), hold = o.hold || 0, d = Math.max(0.005, o.d || 0.2);
  envPerc(g.gain, t, o.peak !== undefined ? o.peak : 0.3, a, hold, d);
  let last = osc;
  if (o.ft) {
    const f = c.createBiquadFilter(); f.type = o.ft; f.frequency.setValueAtTime(o.ff || 1000, t);
    if (o.ff2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.ff2), t + (o.ffd || d));
    f.Q.value = o.q || 0.7; osc.connect(f); last = f;
  }
  last.connect(g); g.connect(dest);
  osc.start(t); osc.stop(t + a + hold + d + 0.04);
  return { osc, g };
}
// noise voice (shared buffers): o = {kind,ft,ff,ff2,ffd,q,a,hold,d,peak,rate}
function noise(B, dest, t, o) {
  const c = B.ctx, s = c.createBufferSource(), g = c.createGain();
  s.buffer = B.noise[o.kind || 'white']; s.loop = true;
  if (o.rate) s.playbackRate.value = o.rate;
  const a = Math.max(0.001, o.a || 0.002), hold = o.hold || 0, d = Math.max(0.005, o.d || 0.1);
  envPerc(g.gain, t, o.peak !== undefined ? o.peak : 0.5, a, hold, d);
  let last = s;
  if (o.ft) {
    const f = c.createBiquadFilter(); f.type = o.ft; f.frequency.setValueAtTime(o.ff || 1000, t);
    if (o.ff2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.ff2), t + (o.ffd || d));
    f.Q.value = o.q || 0.7; s.connect(f); last = f;
  }
  last.connect(g); g.connect(dest);
  s.start(t, Math.random() * 2.4); s.stop(t + a + hold + d + 0.04);
  return { src: s, g };
}
// formant voice (screams etc.)
function formantVoice(B, dest, t, o) {
  const c = B.ctx, dur = o.dur, osc = c.createOscillator(), g = c.createGain(), sum = c.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(o.f0, t);
  osc.frequency.exponentialRampToValueAtTime(o.f1, t + dur * 0.18);
  osc.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
  const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = o.vib || 6; lg.gain.value = o.f0 * 0.03;
  lfo.connect(lg); lg.connect(osc.frequency);
  let src = osc;
  if (o.rough) { // growl via amplitude roughness + saturation
    const sh = c.createWaveShaper(); sh.curve = satCurve(o.rough); osc.connect(sh); src = sh;
  }
  for (const [ff, q, gn] of o.formants) {
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = ff; f.Q.value = q;
    const fg = c.createGain(); fg.gain.value = gn; src.connect(f); f.connect(fg); fg.connect(sum);
  }
  // breath noise through the same formants
  const nz = c.createBufferSource(); nz.buffer = B.noise.white; nz.loop = true;
  const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = o.formants[1][0]; nf.Q.value = 1.5;
  const ng = c.createGain(); ng.gain.value = o.breath || 0.3; nz.connect(nf); nf.connect(ng); ng.connect(sum);
  sum.connect(g); g.connect(dest);
  g.gain.setValueAtTime(EPS, t); g.gain.linearRampToValueAtTime(o.peak, t + 0.03);
  g.gain.setValueAtTime(o.peak, t + dur * 0.55); g.gain.exponentialRampToValueAtTime(EPS, t + dur);
  osc.start(t); lfo.start(t); nz.start(t, Math.random() * 2);
  const end = t + dur + 0.05; osc.stop(end); lfo.stop(end); nz.stop(end);
}
// metallic/bell partial stack
function bell(B, dest, t, f, peak, d, parts) {
  const P = parts || [1, 2.76, 5.4];
  for (let i = 0; i < P.length; i++) tone(B, dest, t, { f: f * P[i], a: 0.001, peak: peak / (1 + i * 0.8), d: d / (1 + i * 0.6) });
}

// ---- generic loop builder (used by loops, engines, ambience) -----------------------------------------
class LB {
  constructor(B) { this.B = B; this.c = B.ctx; this.src = []; this.pit = []; }
  osc(type, f) { const o = this.c.createOscillator(); o.type = type; o.frequency.value = f; o.start(); this.src.push(o); return o; }
  noise(kind, rate, buf) {
    const s = this.c.createBufferSource(); s.buffer = buf || this.B.noise[kind || 'white']; s.loop = true;
    if (rate) s.playbackRate.value = rate;
    s.start(0, Math.random() * (s.buffer.duration * 0.8)); this.src.push(s); return s;
  }
  g(v) { const g = this.c.createGain(); g.gain.value = v === undefined ? 1 : v; return g; }
  f(type, freq, q) { const f = this.c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q === undefined ? 0.7 : q; return f; }
  lfo(freq, depth, param, type) { const o = this.osc(type || 'sine', freq), g = this.g(depth); o.connect(g); g.connect(param); return o; }
  chain(...n) { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; }
  p(param, base) { this.pit.push([param, base]); }
  stop(t) { for (const s of this.src) { try { s.stop(t); } catch (e) { /* already stopped */ } } }
}

// =====================================================================================================
//  ONE-SHOT SFX RECIPES   fn(B, out, t, pitch, opts)
// =====================================================================================================
const SFX = {}, META = {};
function def(name, meta, fn) { SFX[name] = fn; META[name] = Object.assign({ ref: 8, max: 160, rev: 0, pri: 1, dur: 1, trim: 1 }, meta); }
const N = noise, T = tone;

// ---- firearms -------------------------------------------------------------------------------------------
function gun(B, o, t, p, c) {
  const j = 1 + rr(-0.03, 0.03); p *= j;
  T(B, o, t, { f: c.sf0 * p, f2: c.sf1 * p, fd: c.sd * 0.6, a: 0.002, peak: c.sg, d: c.sd });                         // sub thump
  T(B, o, t, { type: 'triangle', f: c.sf0 * 2.2 * p, f2: c.sf1 * 2 * p, fd: 0.04, a: 0.001, peak: c.sg * 0.35, d: c.sd * 0.4 });
  N(B, o, t, { ft: 'bandpass', ff: c.cf * p, q: 0.45, a: 0.0006, d: c.cd, peak: c.cg });                               // crack
  N(B, o, t, { ft: 'lowpass', ff: c.bf0 * p, ff2: c.bf1 * p, ffd: c.bd * 0.8, q: 0.6, a: 0.001, d: c.bd, peak: c.bg }); // body blast
  N(B, o, t + 0.006, { kind: 'brown', ft: 'lowpass', ff: c.tf * p, ff2: c.tf * 0.25 * p, ffd: c.td, a: 0.004, d: c.td, peak: c.tg }); // tail
  if (c.echo) N(B, o, t + c.echo, { kind: 'brown', ft: 'lowpass', ff: 600, ff2: 150, ffd: 0.8, a: 0.05, d: 0.9, peak: c.tg * 0.5 });
}
def('shot_pistol', { ref: 14, max: 450, rev: 0.22, pri: 2, dur: 0.6, trim: 0.9 }, (B, o, t, p) =>
  gun(B, o, t, p, { sf0: 190, sf1: 60, sd: 0.12, sg: 0.5, cf: 3000, cd: 0.03, cg: 1.3, bf0: 4500, bf1: 600, bd: 0.15, bg: 1.0, tf: 1400, td: 0.35, tg: 0.5 }));
def('shot_deagle', { ref: 18, max: 550, rev: 0.32, pri: 2, dur: 1.0, trim: 0.95 }, (B, o, t, p) =>
  gun(B, o, t, p, { sf0: 140, sf1: 42, sd: 0.28, sg: 0.78, cf: 2200, cd: 0.04, cg: 1.5, bf0: 4000, bf1: 350, bd: 0.3, bg: 1.3, tf: 1100, td: 0.7, tg: 0.8, echo: 0.12 }));
def('shot_shotgun', { ref: 20, max: 600, rev: 0.35, pri: 2, dur: 1.2, trim: 1.0 }, (B, o, t, p) => {
  gun(B, o, t, p, { sf0: 110, sf1: 35, sd: 0.38, sg: 0.85, cf: 1800, cd: 0.05, cg: 1.6, bf0: 3500, bf1: 250, bd: 0.42, bg: 1.6, tf: 900, td: 0.9, tg: 0.9, echo: 0.15 });
  SFX.cock(B, o, t + 0.55, p * 0.9, {});
});
def('shot_smg', { ref: 12, max: 400, rev: 0.12, pri: 2, dur: 0.3, trim: 0.85 }, (B, o, t, p) =>
  gun(B, o, t, p, { sf0: 210, sf1: 90, sd: 0.07, sg: 0.42, cf: 3800, cd: 0.02, cg: 1.1, bf0: 5000, bf1: 900, bd: 0.09, bg: 0.8, tf: 1800, td: 0.18, tg: 0.3 }));
def('shot_ak', { ref: 16, max: 550, rev: 0.25, pri: 2, dur: 0.8, trim: 0.95 }, (B, o, t, p) => {
  gun(B, o, t, p, { sf0: 150, sf1: 55, sd: 0.16, sg: 0.6, cf: 2600, cd: 0.03, cg: 1.4, bf0: 4500, bf1: 500, bd: 0.2, bg: 1.2, tf: 1300, td: 0.45, tg: 0.6, echo: 0.1 });
  T(B, o, t, { type: 'sawtooth', f: 420 * p, f2: 160 * p, fd: 0.05, a: 0.001, peak: 0.12, d: 0.06, ft: 'lowpass', ff: 2000 }); // bite
});
def('shot_sniper', { ref: 30, max: 900, rev: 0.6, pri: 3, dur: 2.4, trim: 1.0 }, (B, o, t, p) => {
  gun(B, o, t, p, { sf0: 92, sf1: 27, sd: 0.55, sg: 0.9, cf: 4500, cd: 0.015, cg: 1.8, bf0: 3500, bf1: 200, bd: 0.55, bg: 1.5, tf: 800, td: 1.5, tg: 0.9, echo: 0.28 });
  N(B, o, t + 0.4, { kind: 'pink', ft: 'bandpass', ff: 500, ff2: 220, ffd: 1.2, q: 0.6, a: 0.12, d: 1.2, peak: 0.25 }); // distant slapback
});
def('shot_rpg', { ref: 30, max: 700, rev: 0.4, pri: 3, dur: 2.0, trim: 0.95 }, (B, o, t, p) => {
  T(B, o, t, { f: 110 * p, f2: 38 * p, fd: 0.3, a: 0.003, peak: 0.8, d: 0.45 });
  N(B, o, t, { kind: 'white', ft: 'lowpass', ff: 3500, ff2: 400, ffd: 0.35, a: 0.002, d: 0.4, peak: 1.3 });
  N(B, o, t + 0.02, { kind: 'pink', ft: 'bandpass', ff: 250 * p, ff2: 1500 * p, ffd: 0.6, q: 0.5, a: 0.06, hold: 0.3, d: 0.9, peak: 1.4 }); // rocket whoosh
  N(B, o, t + 0.05, { kind: 'brown', ft: 'lowpass', ff: 500, ff2: 120, ffd: 1.5, a: 0.03, d: 1.6, peak: 0.9 });
});

// ---- explosions ------------------------------------------------------------------------------------------
function boom(B, o, t, p, big) {
  const s = big ? 1 : 0.55;
  T(B, o, t, { f: 78 * p, f2: 24 * p, fd: 1.2 * s, a: 0.004, peak: 0.95, d: 2.0 * s });
  T(B, o, t, { f: 130 * p, f2: 42 * p, fd: 0.5 * s, a: 0.003, peak: 0.55, d: 0.9 * s });
  N(B, o, t, { kind: 'white', ft: 'lowpass', ff: 7000, ff2: 150, ffd: 1.5 * s, a: 0.003, d: 2.0 * s, peak: 1.5 });
  N(B, o, t, { kind: 'white', ft: 'highpass', ff: 900, a: 0.001, d: 0.14 * s, peak: 1.2 });
  N(B, o, t + 0.05, { kind: 'brown', ft: 'lowpass', ff: 350, ff2: 55, ffd: 3 * s, a: 0.2 * s, hold: 0.8 * s, d: 2.4 * s, peak: 2.2 });
  const n = big ? 16 : 7;
  for (let i = 0; i < n; i++) { // debris crackle
    const at = 0.12 + Math.pow(Math.random(), 1.4) * 1.8 * s;
    N(B, o, t + at, { ft: 'bandpass', ff: rr(700, 4200), q: 2, a: 0.001, d: rr(0.02, 0.09), peak: rr(0.25, 0.7) * (1 - at / (2.4 * s)) });
  }
}
def('explosion', { ref: 45, max: 1100, rev: 0.55, pri: 3, dur: 5, trim: 0.9 }, (B, o, t, p) => boom(B, o, t, p, true));
def('explosion_small', { ref: 25, max: 650, rev: 0.4, pri: 3, dur: 2.5, trim: 0.9 }, (B, o, t, p) => boom(B, o, t, p * 1.25, false));

// ---- melee ------------------------------------------------------------------------------------------------
def('punch', { ref: 5, max: 70, pri: 1, dur: 0.3, trim: 0.75 }, (B, o, t, p) => {
  T(B, o, t, { f: 165 * p, f2: 55 * p, fd: 0.07, a: 0.001, peak: 0.75, d: 0.12 });
  N(B, o, t, { ft: 'lowpass', ff: 1800, ff2: 300, ffd: 0.06, a: 0.001, d: 0.08, peak: 1.0 });
  N(B, o, t, { ft: 'bandpass', ff: 2600, q: 1, a: 0.001, d: 0.02, peak: 0.6 });
});
def('kick', { ref: 5, max: 70, pri: 1, dur: 0.4, trim: 0.8 }, (B, o, t, p) => {
  N(B, o, t, { ft: 'bandpass', ff: 500 * p, ff2: 1600 * p, ffd: 0.1, q: 1, a: 0.05, d: 0.08, peak: 0.25 }); // leg swish
  T(B, o, t + 0.11, { f: 130 * p, f2: 45 * p, fd: 0.09, a: 0.001, peak: 0.9, d: 0.16 });
  N(B, o, t + 0.11, { ft: 'lowpass', ff: 1400, ff2: 250, ffd: 0.08, a: 0.001, d: 0.1, peak: 1.1 });
});
def('swing_bat', { ref: 5, max: 60, pri: 1, dur: 0.4, trim: 0.6 }, (B, o, t, p) => {
  N(B, o, t, { kind: 'pink', ft: 'bandpass', ff: 380 * p, ff2: 1700 * p, ffd: 0.14, q: 1.4, a: 0.07, d: 0.17, peak: 1.0 });
});
def('hit_flesh', { ref: 5, max: 70, pri: 1, dur: 0.25, trim: 0.75 }, (B, o, t, p) => {
  N(B, o, t, { ft: 'lowpass', ff: 1100, ff2: 200, ffd: 0.08, a: 0.001, d: 0.1, peak: 1.2 });
  T(B, o, t, { f: 120 * p, f2: 50 * p, fd: 0.08, a: 0.001, peak: 0.55, d: 0.11 });
  N(B, o, t, { ft: 'bandpass', ff: 2200, q: 2, a: 0.001, d: 0.03, peak: 0.5 });
});
def('hit_bat', { ref: 6, max: 80, pri: 1, dur: 0.35, trim: 0.85 }, (B, o, t, p) => {
  T(B, o, t, { f: 260 * p, f2: 90 * p, fd: 0.1, a: 0.001, peak: 0.7, d: 0.14 });
  T(B, o, t, { f: 1150 * p, f2: 850 * p, fd: 0.06, a: 0.001, peak: 0.35, d: 0.09 });               // wooden tok
  N(B, o, t, { ft: 'bandpass', ff: 1500, q: 3, a: 0.001, d: 0.05, peak: 1.0 });
  N(B, o, t, { ft: 'lowpass', ff: 1200, ff2: 250, ffd: 0.06, a: 0.001, d: 0.08, peak: 0.9 });
});
def('hit_body_fall', { ref: 6, max: 70, pri: 1, dur: 0.6, trim: 0.75 }, (B, o, t, p) => {
  T(B, o, t, { f: 100 * p, f2: 38 * p, fd: 0.18, a: 0.002, peak: 0.75, d: 0.3 });
  N(B, o, t, { ft: 'lowpass', ff: 700, ff2: 150, ffd: 0.15, a: 0.002, d: 0.22, peak: 1.0 });
  N(B, o, t + 0.05, { ft: 'bandpass', ff: 2000, q: 0.6, a: 0.03, d: 0.15, peak: 0.25 });          // cloth rustle
});

// ---- gun handling ----------------------------------------------------------------------------------------
def('empty_click', { ref: 4, max: 50, dur: 0.1, trim: 0.5 }, (B, o, t, p) => {
  N(B, o, t, { ft: 'bandpass', ff: 4000 * p, q: 4, a: 0.0005, d: 0.012, peak: 1.0 });
  T(B, o, t, { type: 'triangle', f: 2400 * p, f2: 1200 * p, fd: 0.02, a: 0.0005, peak: 0.2, d: 0.025 });
});
def('cock', { ref: 4, max: 50, dur: 0.4, trim: 0.55 }, (B, o, t, p) => {
  N(B, o, t, { ft: 'bandpass', ff: 3000 * p, q: 3, a: 0.0005, d: 0.014, peak: 1.0 });
  T(B, o, t, { type: 'square', f: 1400 * p, f2: 700 * p, fd: 0.03, a: 0.0005, peak: 0.1, d: 0.035, ft: 'lowpass', ff: 3000 });
  N(B, o, t + 0.1, { ft: 'bandpass', ff: 1700 * p, q: 2, a: 0.0005, d: 0.025, peak: 1.3 });
  T(B, o, t + 0.1, { type: 'square', f: 600 * p, f2: 280 * p, fd: 0.04, a: 0.0005, peak: 0.14, d: 0.05, ft: 'lowpass', ff: 2200 });
});
def('reload', { ref: 4, max: 50, dur: 1.2, trim: 0.55 }, (B, o, t, p) => {
  N(B, o, t, { ft: 'bandpass', ff: 2400 * p, q: 2, a: 0.0005, d: 0.02, peak: 1.0 });
  T(B, o, t, { f: 1200 * p, f2: 500 * p, fd: 0.03, a: 0.0005, peak: 0.2, d: 0.04 });
  N(B, o, t + 0.12, { ft: 'bandpass', ff: 900, ff2: 600, q: 2, a: 0.03, d: 0.12, peak: 0.4 });      // mag slide
  N(B, o, t + 0.42, { ft: 'bandpass', ff: 1800 * p, q: 2, a: 0.0005, d: 0.03, peak: 1.4 });         // mag in
  T(B, o, t + 0.42, { f: 300 * p, f2: 150 * p, fd: 0.04, a: 0.001, peak: 0.35, d: 0.07 });
  SFX.cock(B, o, t + 0.72, p, {});
});
def('grenade_bounce', { ref: 6, max: 80, dur: 0.5, trim: 0.6 }, (B, o, t, p) => {
  for (const [f, g] of [[1300, 0.3], [1950, 0.2], [3100, 0.12]]) T(B, o, t, { f: f * p, a: 0.001, peak: g, d: 0.09 });
  N(B, o, t, { ft: 'bandpass', ff: 3000, q: 3, a: 0.0005, d: 0.01, peak: 0.8 });
  T(B, o, t, { f: 210 * p, f2: 120 * p, fd: 0.06, a: 0.001, peak: 0.3, d: 0.08 });
});
def('spray', { ref: 5, max: 60, dur: 0.9, trim: 0.5 }, (B, o, t, p) => {
  for (let i = 0; i < 6; i++) { // rattle ball
    const at = i * 0.045 + rr(0, 0.01);
    N(B, o, t + at, { ft: 'bandpass', ff: rr(2500, 4500), q: 3, a: 0.0005, d: 0.012, peak: 0.8 - i * 0.05 });
  }
  N(B, o, t + 0.3, { ft: 'highpass', ff: 3500, q: 0.5, a: 0.04, hold: 0.25, d: 0.15, peak: 0.6 });
});

// ---- pickups / UI / jingles ------------------------------------------------------------------------------
def('pickup', { ref: 6, max: 60, dur: 0.6, trim: 0.55 }, (B, o, t, p) => {
  bell(B, o, t, 880 * p, 0.3, 0.3, [1, 2]); bell(B, o, t + 0.07, 1320 * p, 0.3, 0.45, [1, 2]);
});
def('cash', { ref: 6, max: 60, dur: 0.8, trim: 0.55 }, (B, o, t, p) => {
  N(B, o, t, { ft: 'bandpass', ff: 2800, q: 2, a: 0.001, d: 0.02, peak: 0.6 });
  bell(B, o, t, 2637 * p, 0.25, 0.22, [1, 1.51, 2.3]);
  bell(B, o, t + 0.085, 3520 * p, 0.28, 0.5, [1, 1.51, 2.3]);
  N(B, o, t + 0.085, { ft: 'highpass', ff: 6000, a: 0.001, d: 0.1, peak: 0.25 });
});
def('ding', { ref: 6, max: 60, dur: 0.9, trim: 0.5 }, (B, o, t, p) => { T(B, o, t, { f: 1760 * p, a: 0.001, peak: 0.3, d: 0.8 }); T(B, o, t, { f: 2637 * p, a: 0.001, peak: 0.12, d: 0.4 }); });
def('menu_click', { ref: 6, max: 60, dur: 0.1, trim: 0.5 }, (B, o, t, p) => { T(B, o, t, { type: 'triangle', f: 1800 * p, f2: 1300 * p, fd: 0.02, a: 0.001, peak: 0.3, d: 0.035 }); N(B, o, t, { ft: 'highpass', ff: 4000, a: 0.0005, d: 0.01, peak: 0.25 }); });
def('menu_move', { ref: 6, max: 60, dur: 0.1, trim: 0.4 }, (B, o, t, p) => { T(B, o, t, { f: 1100 * p, f2: 1250 * p, fd: 0.02, a: 0.002, peak: 0.25, d: 0.05 }); });
def('mission_pass', { ref: 10, max: 100, rev: 0.5, pri: 2, dur: 3, trim: 0.6 }, (B, o, t, p) => {
  const n = [523.25, 659.25, 783.99, 1046.5];
  n.forEach((f, i) => {
    T(B, o, t + i * 0.11, { type: 'sawtooth', f: f * p, a: 0.005, peak: 0.16, d: 0.22, ft: 'lowpass', ff: 3200 });
    T(B, o, t + i * 0.11, { type: 'triangle', f: f * 2 * p, a: 0.005, peak: 0.12, d: 0.3 });
  });
  for (const f of n) {
    T(B, o, t + 0.5, { type: 'sawtooth', f: f * p, det: rr(-6, 6), a: 0.02, hold: 0.45, d: 1.3, peak: 0.13, ft: 'lowpass', ff: 2600 });
    T(B, o, t + 0.5, { type: 'sine', f: f * 2 * p, a: 0.02, hold: 0.3, d: 1.3, peak: 0.06 });
  }
  bell(B, o, t + 0.5, 2093 * p, 0.12, 1.0, [1, 2.4]);
});
def('mission_fail', { ref: 10, max: 100, rev: 0.45, pri: 2, dur: 3, trim: 0.6 }, (B, o, t, p) => {
  [[330, 0, 0.35], [311, 0.38, 0.35], [247, 0.76, 1.6]].forEach(([f, at, d]) => {
    T(B, o, t + at, { type: 'sawtooth', f: f * p, f2: f * 0.97 * p, fd: d, a: 0.02, hold: d * 0.3, d: d, peak: 0.2, ft: 'lowpass', ff: 1000, ff2: 400 });
    T(B, o, t + at, { type: 'sawtooth', f: f * 0.5 * p, a: 0.02, hold: d * 0.3, d: d, peak: 0.12, ft: 'lowpass', ff: 500 });
  });
  T(B, o, t + 0.76, { f: 70, f2: 38, fd: 0.8, a: 0.01, peak: 0.6, d: 1.2 });
});
def('wanted_up', { ref: 10, max: 100, rev: 0.4, pri: 2, dur: 1.2, trim: 0.55 }, (B, o, t, p) => {
  for (let i = 0; i < 4; i++) {
    const f = i % 2 ? 988 : 740;
    T(B, o, t + i * 0.13, { type: 'square', f: f * p, a: 0.004, hold: 0.06, d: 0.05, peak: 0.16, ft: 'lowpass', ff: 3000 });
  }
  T(B, o, t + 0.55, { type: 'sawtooth', f: 247 * p, f2: 330 * p, fd: 0.4, a: 0.05, hold: 0.25, d: 0.3, peak: 0.25, ft: 'lowpass', ff: 900 });
  N(B, o, t, { ft: 'bandpass', ff: 1800, q: 1.5, a: 0.01, d: 0.12, peak: 0.25 });
});
def('wasted', { ref: 10, max: 100, rev: 0.75, pri: 3, dur: 5, trim: 0.75 }, (B, o, t, p) => {
  T(B, o, t, { f: 58, f2: 34, fd: 3, a: 0.06, hold: 1.4, d: 2.6, peak: 0.7 });
  N(B, o, t, { kind: 'pink', ft: 'lowpass', ff: 250, ff2: 3500, ffd: 0.9, a: 0.9, d: 0.06, peak: 1.1 });               // reverse swell
  T(B, o, t + 0.9, { f: 95, f2: 30, fd: 0.8, a: 0.003, peak: 1.0, d: 1.6 });                                         // impact
  N(B, o, t + 0.9, { ft: 'lowpass', ff: 2200, ff2: 100, ffd: 0.9, a: 0.002, d: 1.0, peak: 1.4 });
  for (const f of [220, 261.6, 329.6]) {
    T(B, o, t + 0.9, { type: 'sawtooth', f: f * p, f2: f * 0.88 * p, fd: 2.6, det: rr(-8, 8), a: 0.25, hold: 0.6, d: 2.0, peak: 0.12, ft: 'lowpass', ff: 800, ff2: 300, ffd: 2.5 });
  }
  for (let i = 0; i < 2; i++) T(B, o, t + 0.25 + i * 0.22, { f: 62, f2: 40, fd: 0.12, a: 0.005, peak: 0.4, d: 0.2 }); // heartbeat
});
def('busted', { ref: 10, max: 100, rev: 0.6, pri: 3, dur: 4, trim: 0.7 }, (B, o, t, p) => {
  for (let i = 0; i < 2; i++) T(B, o, t + i * 0.32, { type: 'sawtooth', f: 700 * p, f2: 1250 * p, fd: 0.26, a: 0.01, hold: 0.2, d: 0.06, peak: 0.18, ft: 'bandpass', ff: 1300, q: 0.7 });
  T(B, o, t + 0.75, { f: 100, f2: 40, fd: 0.3, a: 0.002, peak: 0.85, d: 0.7 });                                         // cell door slam
  N(B, o, t + 0.75, { ft: 'bandpass', ff: 900, q: 0.8, a: 0.001, d: 0.3, peak: 1.3 });
  for (const f of [420, 610, 1130]) T(B, o, t + 0.75, { f: f * p, a: 0.001, peak: 0.1, d: 0.6 });
  for (let i = 0; i < 2; i++) N(B, o, t + 1.25 + i * 0.12, { ft: 'bandpass', ff: 3500, q: 4, a: 0.0005, d: 0.018, peak: 1.0 }); // cuffs
  [[392, 1.4, 0.5], [370, 1.9, 0.5], [311, 2.4, 1.5]].forEach(([f, at, d]) =>
    T(B, o, t + at, { type: 'sawtooth', f: f * p, a: 0.06, hold: d * 0.3, d: d, peak: 0.16, ft: 'lowpass', ff: 1300 }));
});
function ringBurst(B, o, t, len, f1, f2, peak) {
  const c = B.ctx, g = c.createGain(), trem = c.createOscillator(), tg = c.createGain(), a = c.createOscillator(), b = c.createOscillator();
  a.frequency.value = f1; b.frequency.value = f2; trem.frequency.value = 24; tg.gain.value = 0.5; g.gain.value = 0.5;
  trem.connect(tg); tg.connect(g.gain); a.connect(g); b.connect(g);
  const env = c.createGain(); g.connect(env); env.connect(o);
  env.gain.setValueAtTime(EPS, t); env.gain.linearRampToValueAtTime(peak, t + 0.01);
  env.gain.setValueAtTime(peak, t + len - 0.02); env.gain.linearRampToValueAtTime(EPS, t + len);
  for (const x of [a, b, trem]) { x.start(t); x.stop(t + len + 0.02); }
}
def('phone_ring', { ref: 5, max: 60, dur: 1.3, pri: 1, trim: 0.6 }, (B, o, t, p) => {
  ringBurst(B, o, t, 0.4, 1400 * p, 1050 * p, 0.3); ringBurst(B, o, t + 0.55, 0.4, 1400 * p, 1050 * p, 0.3);
});

// ---- footsteps / water -------------------------------------------------------------------------------------
def('footstep_concrete', { ref: 2, max: 35, dur: 0.15, trim: 0.25 }, (B, o, t, p) => {
  N(B, o, t, { ft: 'bandpass', ff: rr(1400, 2300) * p, q: 1.1, a: 0.001, d: 0.045, peak: 0.9 });
  T(B, o, t, { f: rr(105, 145) * p, f2: 65 * p, fd: 0.05, a: 0.001, peak: 0.55, d: 0.07 });
  N(B, o, t, { ft: 'highpass', ff: 4000, a: 0.0005, d: 0.012, peak: 0.25 });
});
def('footstep_grass', { ref: 2, max: 30, dur: 0.2, trim: 0.22 }, (B, o, t, p) => {
  N(B, o, t, { kind: 'pink', ft: 'bandpass', ff: rr(2800, 4200) * p, q: 0.7, a: 0.025, d: 0.1, peak: 1.0 });
  T(B, o, t, { f: rr(80, 100) * p, f2: 55 * p, fd: 0.06, a: 0.005, peak: 0.3, d: 0.08 });
});
def('footstep_sand', { ref: 2, max: 30, dur: 0.22, trim: 0.2 }, (B, o, t, p) => {
  N(B, o, t, { kind: 'white', ft: 'lowpass', ff: rr(2200, 3200) * p, ff2: 900, ffd: 0.14, q: 0.5, a: 0.03, d: 0.12, peak: 0.8 });
  N(B, o, t + 0.01, { kind: 'pink', ft: 'highpass', ff: 3500, a: 0.02, d: 0.1, peak: 0.3 });
  T(B, o, t, { f: 75 * p, f2: 50 * p, fd: 0.07, a: 0.01, peak: 0.25, d: 0.09 });
});
def('splash', { ref: 8, max: 120, rev: 0.2, dur: 1.2, trim: 0.6 }, (B, o, t, p) => {
  N(B, o, t, { ft: 'lowpass', ff: 7000, ff2: 900, ffd: 0.5, a: 0.004, d: 0.7, peak: 1.1 });
  N(B, o, t, { kind: 'pink', ft: 'bandpass', ff: 600, ff2: 300, ffd: 0.5, q: 0.6, a: 0.01, d: 0.5, peak: 1.1 });
  T(B, o, t, { f: 240 * p, f2: 80 * p, fd: 0.2, a: 0.003, peak: 0.5, d: 0.3 });
  for (let i = 0; i < 7; i++) { const f = rr(350, 900) * p; T(B, o, t + 0.05 + Math.random() * 0.6, { f, f2: f * 1.8, fd: 0.06, a: 0.002, peak: rr(0.05, 0.14), d: 0.09 }); } // bubbles
});

// ---- vehicles -----------------------------------------------------------------------------------------------
def('horn', { ref: 25, max: 380, pri: 1, dur: 0.5, trim: 0.55 }, (B, o, t, p, opt) => {
  const len = (opt && opt.len) || 0.28;
  for (const [f, g] of [[440, 0.2], [554.4, 0.17], [880, 0.05]]) for (const dt of [-4, 4]) {
    T(B, o, t, { type: 'sawtooth', f: f * p, det: dt, a: 0.008, hold: len, d: 0.06, peak: g, ft: 'lowpass', ff: 2100, q: 0.8 });
  }
  N(B, o, t, { ft: 'bandpass', ff: 1500, q: 1, a: 0.005, hold: len, d: 0.05, peak: 0.03 });
});
def('car_hit_light', { ref: 14, max: 280, rev: 0.12, pri: 2, dur: 0.7, trim: 0.75 }, (B, o, t, p) => {
  T(B, o, t, { f: 140 * p, f2: 60 * p, fd: 0.1, a: 0.001, peak: 0.6, d: 0.18 });
  N(B, o, t, { ft: 'bandpass', ff: 900, q: 0.9, a: 0.001, d: 0.12, peak: 1.1 });
  N(B, o, t, { ft: 'highpass', ff: 2500, a: 0.001, d: 0.04, peak: 0.6 });
  for (const f of [420, 610, 1130]) T(B, o, t, { f: f * p * rr(0.96, 1.04), a: 0.001, peak: 0.07, d: 0.3 });
});
def('car_hit_heavy', { ref: 25, max: 450, rev: 0.3, pri: 3, dur: 1.6, trim: 0.9 }, (B, o, t, p) => {
  T(B, o, t, { f: 85 * p, f2: 33 * p, fd: 0.25, a: 0.002, peak: 0.95, d: 0.6 });
  N(B, o, t, { ft: 'lowpass', ff: 3500, ff2: 300, ffd: 0.4, a: 0.001, d: 0.5, peak: 1.6 });
  N(B, o, t, { ft: 'highpass', ff: 2000, a: 0.001, d: 0.09, peak: 1.0 });
  for (let i = 0; i < 6; i++) N(B, o, t + 0.05 + Math.random() * 0.5, { ft: 'bandpass', ff: rr(900, 2500), q: 2, a: 0.002, d: rr(0.04, 0.2), peak: rr(0.2, 0.5) }); // scraping
  for (const f of [180, 300, 540, 980]) T(B, o, t, { f: f * p * rr(0.97, 1.03), a: 0.001, peak: 0.09, d: 0.7 });
  for (let i = 0; i < 6; i++) T(B, o, t + 0.1 + Math.random() * 0.7, { f: rr(3000, 7000), a: 0.001, peak: rr(0.03, 0.08), d: rr(0.05, 0.15) });
});
def('glass_break', { ref: 10, max: 200, rev: 0.25, pri: 2, dur: 1.4, trim: 0.65 }, (B, o, t, p) => {
  N(B, o, t, { ft: 'highpass', ff: 2800, a: 0.001, d: 0.14, peak: 1.0 });
  N(B, o, t, { ft: 'bandpass', ff: 1200, q: 1, a: 0.001, d: 0.05, peak: 0.6 });
  for (let i = 0; i < 16; i++) {
    const at = Math.pow(Math.random(), 1.6) * 0.9;
    T(B, o, t + at, { f: rr(2500, 7800) * p, a: 0.001, peak: rr(0.04, 0.12), d: rr(0.05, 0.22) });
    N(B, o, t + at, { ft: 'bandpass', ff: rr(4000, 7000), q: 3, a: 0.0005, d: 0.02, peak: 0.25 });
  }
});
def('door_open', { ref: 5, max: 60, dur: 0.5, trim: 0.5 }, (B, o, t, p) => {
  N(B, o, t, { ft: 'bandpass', ff: 2000 * p, q: 4, a: 0.0005, d: 0.014, peak: 1.0 });
  T(B, o, t, { type: 'square', f: 900 * p, f2: 400 * p, fd: 0.02, a: 0.0005, peak: 0.08, d: 0.025, ft: 'lowpass', ff: 2500 });
  T(B, o, t + 0.04, { type: 'sawtooth', f: 160 * p, f2: 230 * p, fd: 0.25, a: 0.06, d: 0.25, peak: 0.05, ft: 'bandpass', ff: 650, q: 8 });
  T(B, o, t + 0.25, { f: 90 * p, f2: 60 * p, fd: 0.08, a: 0.002, peak: 0.25, d: 0.1 });
});
def('door_close', { ref: 6, max: 70, dur: 0.4, trim: 0.65 }, (B, o, t, p) => {
  T(B, o, t, { f: 115 * p, f2: 58 * p, fd: 0.09, a: 0.001, peak: 0.65, d: 0.18 });
  N(B, o, t, { ft: 'lowpass', ff: 900, ff2: 250, ffd: 0.08, a: 0.001, d: 0.12, peak: 1.1 });
  N(B, o, t + 0.05, { ft: 'bandpass', ff: 2200, q: 4, a: 0.0005, d: 0.012, peak: 0.9 });
});
def('screech', { ref: 18, max: 300, rev: 0.12, dur: 1.0, trim: 0.55 }, (B, o, t, p) => {
  N(B, o, t, { ft: 'bandpass', ff: 1800 * p, ff2: 2600 * p, ffd: 0.8, q: 5, a: 0.06, hold: 0.45, d: 0.35, peak: 1.4 });
  T(B, o, t, { type: 'sawtooth', f: 820 * p, f2: 1100 * p, fd: 0.8, a: 0.05, hold: 0.45, d: 0.35, peak: 0.12, ft: 'bandpass', ff: 1500, q: 8 });
});
def('siren_short', { ref: 25, max: 450, rev: 0.15, dur: 1.4, trim: 0.5 }, (B, o, t, p) => {
  T(B, o, t, { type: 'sawtooth', f: 650 * p, f2: 1450 * p, fd: 0.55, a: 0.02, hold: 0.5, d: 0.05, peak: 0.3, ft: 'bandpass', ff: 1400, q: 0.6 });
  T(B, o, t + 0.58, { type: 'sawtooth', f: 1450 * p, f2: 650 * p, fd: 0.55, a: 0.02, hold: 0.45, d: 0.12, peak: 0.3, ft: 'bandpass', ff: 1400, q: 0.6 });
});
def('cop_whistle', { ref: 20, max: 300, dur: 1.2, trim: 0.5 }, (B, o, t, p) => {
  const c = B.ctx;
  [[0, 0.22], [0.3, 0.5]].forEach(([at, len]) => {
    const car = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain(), tt = t + at;
    car.frequency.value = 2850 * p; lfo.frequency.value = 36; lg.gain.value = 260;
    lfo.connect(lg); lg.connect(car.frequency); car.connect(g); g.connect(o);
    g.gain.setValueAtTime(EPS, tt); g.gain.linearRampToValueAtTime(0.25, tt + 0.02); g.gain.setValueAtTime(0.25, tt + len); g.gain.exponentialRampToValueAtTime(EPS, tt + len + 0.08);
    car.start(tt); lfo.start(tt); car.stop(tt + len + 0.1); lfo.stop(tt + len + 0.1);
    N(B, o, tt, { ft: 'bandpass', ff: 3200 * p, q: 5, a: 0.02, hold: len, d: 0.06, peak: 0.25 });
  });
});
function rotorPulses(B, o, t, n, rate, peak) {
  for (let i = 0; i < n; i++) {
    const at = i / rate, e = peak * (1 - i / (n + 1));
    T(B, o, t + at, { f: 60, f2: 38, fd: 0.03, a: 0.002, peak: 0.5 * e, d: 0.06 });
    N(B, o, t + at, { ft: 'lowpass', ff: 900, ff2: 250, ffd: 0.03, a: 0.002, d: 0.035, peak: 1.0 * e });
  }
}
def('heli_chop', { ref: 40, max: 600, dur: 1.2, trim: 0.6 }, (B, o, t, p) => rotorPulses(B, o, t, 12, 20 * p, 1));

// ---- bullets / fire / wanted ---------------------------------------------------------------------------------
def('bullet_whiz', { ref: 6, max: 70, dur: 0.4, pri: 2, trim: 0.65 }, (B, o, t, p) => {
  N(B, o, t, { ft: 'bandpass', ff: 4500 * p, ff2: 1400 * p, ffd: 0.2, q: 4, a: 0.03, d: 0.18, peak: 1.2 });
  T(B, o, t, { f: 3000 * p, f2: 1000 * p, fd: 0.2, a: 0.03, peak: 0.07, d: 0.18 });
});
def('bullet_impact', { ref: 8, max: 120, dur: 0.3, trim: 0.65 }, (B, o, t, p) => {
  N(B, o, t, { ft: 'bandpass', ff: 1800 * p, q: 0.8, a: 0.001, d: 0.05, peak: 1.3 });
  T(B, o, t, { f: 210 * p, f2: 90 * p, fd: 0.05, a: 0.001, peak: 0.4, d: 0.07 });
  N(B, o, t + 0.02, { ft: 'lowpass', ff: 5000, a: 0.005, d: 0.15, peak: 0.25 });
});
def('ricochet', { ref: 10, max: 150, rev: 0.15, dur: 0.6, trim: 0.6 }, (B, o, t, p) => {
  T(B, o, t, { f: 3200 * p, f2: 1100 * p, fd: 0.35, a: 0.002, peak: 0.3, d: 0.4 });
  T(B, o, t, { f: 4800 * p, f2: 1900 * p, fd: 0.3, a: 0.002, peak: 0.12, d: 0.25 });
  N(B, o, t, { ft: 'bandpass', ff: 4000, q: 1, a: 0.0005, d: 0.02, peak: 1.0 });
});
def('fire_whoosh', { ref: 18, max: 250, rev: 0.15, dur: 1.4, trim: 0.65 }, (B, o, t, p) => {
  N(B, o, t, { kind: 'pink', ft: 'bandpass', ff: 250 * p, ff2: 1200 * p, ffd: 0.4, q: 0.7, a: 0.15, hold: 0.1, d: 0.6, peak: 1.5 });
  N(B, o, t, { kind: 'brown', ft: 'lowpass', ff: 300, a: 0.05, hold: 0.2, d: 0.8, peak: 1.6 });
});
def('car_pass', { ref: 15, max: 200, dur: 4, trim: 0.5 }, (B, o, t, p, opt) => {
  const c = B.ctx, pan = c.createStereoPanner ? c.createStereoPanner() : null, dir = Math.random() < 0.5 ? -1 : 1, dur = rr(2.5, 4);
  const tgt = pan || o; if (pan) { pan.pan.setValueAtTime(-0.8 * dir, t); pan.pan.linearRampToValueAtTime(0.8 * dir, t + dur); pan.connect(o); }
  N(B, tgt, t, { kind: 'pink', ft: 'bandpass', ff: 300 * p, ff2: 600 * p, ffd: dur * 0.5, q: 0.8, a: dur * 0.45, hold: 0.05, d: dur * 0.5, peak: 0.5 });
  N(B, tgt, t, { kind: 'brown', ft: 'lowpass', ff: 200, a: dur * 0.45, hold: 0.05, d: dur * 0.5, peak: 0.6 });
});

// ---- voices ---------------------------------------------------------------------------------------------------
def('scream_male', { ref: 14, max: 250, rev: 0.25, pri: 1, dur: 1.3, trim: 0.6 }, (B, o, t, p) => {
  const dur = rr(0.85, 1.15);
  formantVoice(B, o, t, { f0: 210 * p, f1: 390 * p, f2: 250 * p, dur, peak: 0.45, vib: rr(5.5, 7), rough: 2.2, breath: 0.35, formants: [[650, 7, 1.2], [1100, 9, 0.9], [2500, 12, 0.5]] });
});
def('scream_female', { ref: 14, max: 280, rev: 0.25, pri: 1, dur: 1.3, trim: 0.55 }, (B, o, t, p) => {
  const dur = rr(0.9, 1.2);
  formantVoice(B, o, t, { f0: 520 * p, f1: 930 * p, f2: 640 * p, dur, peak: 0.42, vib: rr(6, 7.5), rough: 1.6, breath: 0.3, formants: [[900, 8, 1.1], [1650, 10, 0.9], [3000, 12, 0.55]] });
});

// ---- extra one-shots ------------------------------------------------------------------------------------------
def('exhaust_pop', { ref: 12, max: 200, dur: 0.3, trim: 0.55 }, (B, o, t, p) => {
  N(B, o, t, { ft: 'bandpass', ff: rr(500, 900) * p, q: 1, a: 0.001, d: 0.05, peak: 1.3 });
  T(B, o, t, { f: 150 * p, f2: 65 * p, fd: 0.04, a: 0.001, peak: 0.45, d: 0.07 });
});
def('engine_start', { ref: 10, max: 120, dur: 1.6, trim: 0.5 }, (B, o, t, p) => {
  T(B, o, t, { type: 'sawtooth', f: 62 * p, f2: 105 * p, fd: 0.7, a: 0.03, hold: 0.6, d: 0.1, peak: 0.35, ft: 'lowpass', ff: 600 });
  N(B, o, t, { kind: 'pink', ft: 'bandpass', ff: 900, q: 1.5, a: 0.03, hold: 0.6, d: 0.1, peak: 0.25 });
  for (let i = 0; i < 4; i++) T(B, o, t + 0.65 + i * 0.07, { type: 'sawtooth', f: (70 + i * 14) * p, f2: (55 + i * 14) * p, fd: 0.05, a: 0.004, peak: 0.45, d: 0.12, ft: 'lowpass', ff: 700 });
  N(B, o, t + 0.65, { kind: 'brown', ft: 'lowpass', ff: 400, a: 0.01, d: 0.5, peak: 1.0 });
});
def('bird', { ref: 8, max: 90, dur: 0.6, trim: 0.25 }, (B, o, t, p) => {
  const n = 2 + Math.floor(Math.random() * 4), base = rr(2400, 4200) * p;
  for (let i = 0; i < n; i++) {
    const f = base * rr(0.85, 1.25);
    T(B, o, t + i * rr(0.07, 0.12), { f: f, f2: f * rr(0.7, 1.5), fd: 0.06, a: 0.004, peak: rr(0.1, 0.22), d: 0.07 });
  }
});

// =====================================================================================================
//  LOOPS   build(L, out)   (L = LB builder, out = destination gain)
// =====================================================================================================
const LOOPS = {};
function loopDef(name, meta, build) { LOOPS[name] = Object.assign({ ref: 10, max: 160, vol: 1 }, meta, { build }); }

loopDef('siren_police', { ref: 28, max: 550, vol: 0.32 }, (L, out) => {
  const o = L.osc('sawtooth', 1000), rateMod = L.osc('sine', 0.07), rg = L.g(1.35), lfo = L.osc('sine', 1.65), lg = L.g(380);
  rateMod.connect(rg); rg.connect(lfo.frequency); lfo.connect(lg); lg.connect(o.frequency); L.p(o.frequency, 1000);
  const sh = L.c.createWaveShaper(); sh.curve = satCurve(1.6);
  L.chain(o, L.f('bandpass', 1300, 0.8), L.f('lowpass', 4200, 0.7), sh, out);
});
loopDef('siren_ambulance', { ref: 28, max: 550, vol: 0.3 }, (L, out) => {
  const o = L.osc('sawtooth', 865), o2 = L.osc('triangle', 1730), sq = L.osc('square', 0.9), sg = L.g(95), sg2 = L.g(190), m = L.g(1), m2 = L.g(0.5);
  sq.connect(sg); sg.connect(o.frequency); sq.connect(sg2); sg2.connect(o2.frequency); L.p(o.frequency, 865); L.p(o2.frequency, 1730);
  o.connect(m); o2.connect(m2); m2.connect(m);
  L.chain(m, L.f('bandpass', 1250, 0.9), L.f('lowpass', 3800, 0.7), out);
});
loopDef('tire_skid', { ref: 18, max: 260, vol: 0.45 }, (L, out) => {
  const n = L.noise('white'), b1 = L.f('bandpass', 1800, 4), b2 = L.f('bandpass', 3100, 3), s = L.g(1.3);
  L.lfo(9, 250, b1.frequency); L.lfo(6.3, 420, b2.frequency); L.p(b1.frequency, 1800); L.p(b2.frequency, 3100);
  n.connect(b1); n.connect(b2); b1.connect(s); b2.connect(s);
  const saw = L.osc('sawtooth', 880), sb = L.f('bandpass', 1000, 10), sg = L.g(0.09);
  L.lfo(5, 22, saw.frequency); L.p(saw.frequency, 880); L.chain(saw, sb, sg, s);
  s.connect(out);
});
loopDef('wind', { ref: 10, max: 100, vol: 0.5 }, (L, out) => {
  const n = L.noise('pink'), bp = L.f('bandpass', 420, 0.9), g1 = L.g(0.55);
  L.lfo(0.11, 170, bp.frequency); L.lfo(0.17, 0.3, g1.gain); L.chain(n, bp, g1, out);
  const n2 = L.noise('pink'), bp2 = L.f('bandpass', 1100, 5), g2 = L.g(0.12);
  L.lfo(0.07, 350, bp2.frequency); L.lfo(0.13, 0.1, g2.gain); L.chain(n2, bp2, g2, out);
  const n3 = L.noise('brown'), lp = L.f('lowpass', 160, 0.5), g3 = L.g(0.5); L.chain(n3, lp, g3, out);
});
loopDef('fire_crackle', { ref: 8, max: 110, vol: 0.55 }, (L, out) => {
  const n = L.noise('brown'), lp = L.f('lowpass', 420, 0.6), g = L.g(0.5);
  L.lfo(0.7, 0.14, g.gain); L.lfo(1.9, 0.1, g.gain); L.chain(n, lp, g, out);
  const cs = L.noise(null, 1, L.B.buf('crackle')), hp = L.f('highpass', 1200, 0.6), cg = L.g(0.3); L.p(cs.playbackRate, 1); L.chain(cs, hp, cg, out);
  const w = L.noise('white'), bp = L.f('bandpass', 900, 0.7), wg = L.g(0.1); L.lfo(2.3, 0.05, wg.gain); L.chain(w, bp, wg, out);
});
loopDef('rain', { ref: 10, max: 120, vol: 0.5 }, (L, out) => {
  L.chain(L.noise('white'), L.f('highpass', 2500, 0.5), L.f('lowpass', 9000, 0.5), L.g(0.2), out);
  L.chain(L.noise('pink'), L.f('lowpass', 700, 0.5), L.g(0.3), out);
  L.chain(L.noise(null, 1, L.B.buf('patter')), L.f('bandpass', 3200, 0.5), L.g(0.55), out);
});
loopDef('water_lap', { ref: 6, max: 80, vol: 0.5 }, (L, out) => {
  const n = L.noise('pink'), lp = L.f('lowpass', 700, 0.6), g = L.g(0.3);
  L.lfo(0.55, 0.25, g.gain); L.lfo(0.83, 0.15, g.gain); L.chain(n, lp, g, out);
  const w = L.noise('white'), bp = L.f('bandpass', 2500, 1), wg = L.g(0.05); L.lfo(0.55, 0.04, wg.gain); L.chain(w, bp, wg, out);
});
loopDef('heli_rotor', { ref: 40, max: 650, vol: 0.6 }, (L, out) => {
  const ch = L.noise(null, 1, L.B.buf('chop')), lp = L.f('lowpass', 1300, 0.6), g = L.g(0.9);
  L.p(ch.playbackRate, 1); L.chain(ch, lp, g, out);
  L.chain(L.noise('white'), L.f('bandpass', 2800, 1.2), L.g(0.05), out);
  const wh = L.osc('sine', 1800), wg = L.g(0.02); L.p(wh.frequency, 1800); L.chain(wh, wg, out);
  L.chain(L.noise('pink'), L.f('lowpass', 150, 0.6), L.g(0.35), out);
});
loopDef('spraycan', { ref: 5, max: 60, vol: 0.35 }, (L, out) => {
  const g = L.g(0.55); L.lfo(27, 0.08, g.gain);
  L.chain(L.noise('white'), L.f('bandpass', 6500, 0.4), L.f('highpass', 3000, 0.5), g, out);
});
loopDef('horn', { ref: 25, max: 380, vol: 0.5 }, (L, out) => {
  const m = L.g(1), sh = L.f('lowpass', 2100, 0.8);
  for (const [f, g] of [[440, 0.2], [554.4, 0.17], [880, 0.05]]) for (const dt of [-4, 4]) {
    const o = L.osc('sawtooth', f); o.detune.value = dt; L.p(o.frequency, f); const gg = L.g(g); o.connect(gg); gg.connect(m);
  }
  L.chain(m, sh, out);
});

// =====================================================================================================
//  ENGINE MODEL
// =====================================================================================================
const ENGINES = {
  car:   { idle: 850,  red: 6200,  cyl: 4, sub: 0.30, lo: 650, hi: 4200, drive: 1.8, q: 1.0, noise: 0.35, vol: 0.38, lope: 0.5,  h3: 0.12 },
  truck: { idle: 600,  red: 3400,  cyl: 6, sub: 0.60, lo: 330, hi: 1900, drive: 2.4, q: 1.4, noise: 0.30, vol: 0.42, lope: 0.75, h3: 0.05, diesel: true },
  bike:  { idle: 1500, red: 11500, cyl: 2, sub: 0.05, lo: 900, hi: 6500, drive: 2.2, q: 1.3, noise: 0.45, vol: 0.36, lope: 0.2,  h3: 0.25, pops: true },
  sport: { idle: 1000, red: 8200,  cyl: 8, sub: 0.25, lo: 800, hi: 7500, drive: 2.6, q: 1.2, noise: 0.40, vol: 0.40, lope: 0.35, h3: 0.22, pops: true },
};
function buildEngine(L, out, kind) {
  const c = L.c;
  if (kind === 'heli') {
    const ch = L.noise(null, 0.5, L.B.buf('chop')), lp = L.f('lowpass', 1100, 0.6), cg = L.g(0.8);
    L.chain(ch, lp, cg, out);
    const hiss = L.g(0.03); L.chain(L.noise('white'), L.f('bandpass', 2600, 1.2), hiss, out);
    const wh = L.osc('sine', 1500), wg = L.g(0.0); L.chain(wh, wg, out);
    const rum = L.g(0.3); L.chain(L.noise('pink'), L.f('lowpass', 140, 0.6), rum, out);
    return {
      vol: 0.5, pops: false,
      upd(rpm, thr, now) {
        ch.playbackRate.setTargetAtTime(0.32 + 0.7 * rpm, now, 0.08);
        cg.gain.setTargetAtTime(0.35 + 0.55 * rpm + 0.3 * thr, now, 0.08);
        lp.frequency.setTargetAtTime(700 + 900 * rpm + 500 * thr, now, 0.08);
        hiss.gain.setTargetAtTime(0.015 + 0.07 * rpm + 0.03 * thr, now, 0.1);
        wh.frequency.setTargetAtTime(1300 + 1700 * rpm, now, 0.1);
        wg.gain.setTargetAtTime(0.004 + 0.022 * rpm, now, 0.1);
        rum.gain.setTargetAtTime(0.15 + 0.3 * rpm, now, 0.1);
      },
    };
  }
  const P = ENGINES[kind] || ENGINES.car;
  const mix = L.g(1), o1 = L.osc('sawtooth', 30), o2 = L.osc('sawtooth', 60), o3 = L.osc('triangle', 15), o4 = L.osc('square', 90);
  o2.detune.value = 7;
  const g1 = L.g(0.5), g2 = L.g(0.28), g3 = L.g(P.sub), g4 = L.g(P.h3);
  o1.connect(g1); o2.connect(g2); o3.connect(g3); o4.connect(g4); g1.connect(mix); g2.connect(mix); g3.connect(mix); g4.connect(mix);
  const sh = c.createWaveShaper(); sh.curve = satCurve(P.drive);
  const pre = L.g(0.8), lp = L.f('lowpass', P.lo, P.q), amp = L.g(1), lfo = L.osc('sine', 14), lfoG = L.g(0.1);
  lfo.connect(lfoG); lfoG.connect(amp.gain);
  L.chain(mix, pre, sh, lp, amp, out);
  const nz = L.noise('pink'), nbp = L.f('bandpass', 600, 0.9), ng = L.g(0.05);
  L.chain(nz, nbp, ng, amp);
  let cl = null, clG = null;
  if (P.diesel) { // diesel clatter: noise gated at the firing rate
    const n2 = L.noise('white'), bp = L.f('bandpass', 1700, 2), g = L.g(0.0), sq = L.osc('square', 30), sg = L.g(0.5);
    g.gain.value = 0.5; sq.connect(sg); sg.connect(g.gain);
    const cg2 = L.g(0.0); L.chain(n2, bp, g, cg2, amp); cl = sq; clG = cg2;
  }
  return {
    vol: P.vol, pops: !!P.pops,
    upd(rpm01, thr, now) {
      const rpm = P.idle + (P.red - P.idle) * rpm01, f = (rpm / 60) * (P.cyl / 2), tc = 0.035;
      o1.frequency.setTargetAtTime(f, now, tc); o2.frequency.setTargetAtTime(f * 2, now, tc);
      o3.frequency.setTargetAtTime(f * 0.5, now, tc); o4.frequency.setTargetAtTime(f * 3, now, tc);
      lfo.frequency.setTargetAtTime(f * 0.5, now, tc);
      lfoG.gain.setTargetAtTime(P.lope * (1 - rpm01) * (0.45 - 0.2 * thr) * 0.5, now, 0.08);
      const open = Math.pow(clamp(0.12 + 0.45 * rpm01 + 0.43 * thr, 0, 1), 1.5);
      lp.frequency.setTargetAtTime(P.lo + (P.hi - P.lo) * open, now, 0.06);
      pre.gain.setTargetAtTime(0.5 + 0.35 * rpm01 + 0.35 * thr, now, 0.05);
      nbp.frequency.setTargetAtTime(500 + 2000 * rpm01, now, 0.06);
      ng.gain.setTargetAtTime(P.noise * (0.08 + 0.92 * thr) * (0.3 + 0.7 * rpm01) * 0.45, now, 0.06);
      if (cl) { cl.frequency.setTargetAtTime(f, now, tc); clG.gain.setTargetAtTime(0.12 + 0.12 * thr, now, 0.08); }
    },
  };
}

// =====================================================================================================
//  AMBIENCE BEDS  (gain controlled from outside)
// =====================================================================================================
const BEDS = {
  crickets(L, out) {
    [4150, 4650, 5250].forEach((f, i) => {
      const car = L.osc('sine', f * rr(0.98, 1.02)), g1 = L.g(0.5), g2 = L.g(0.5), fast = L.osc('sine', 26 + i * 3 + rr(-2, 2)), fg = L.g(0.5), slow = L.osc('sine', 2.1 + i * 0.45 + rr(-0.2, 0.2)), sg = L.g(0.5);
      fast.connect(fg); fg.connect(g1.gain); slow.connect(sg); sg.connect(g2.gain);
      L.chain(car, g1, g2, L.g(0.18), out);
    });
  },
  traffic(L, out) {
    const g1 = L.g(0.8); L.lfo(0.06, 0.22, g1.gain); L.chain(L.noise('brown'), L.f('lowpass', 260, 0.6), g1, out);
    const g2 = L.g(0.2); L.lfo(0.09, 0.09, g2.gain); L.chain(L.noise('pink'), L.f('bandpass', 700, 0.6), g2, out);
    L.chain(L.noise('pink'), L.f('bandpass', 1800, 0.8), L.g(0.05), out);
  },
  crowd(L, out) {
    const n = L.noise('pink');
    [[500, 3.1], [900, 4.3], [1600, 5.3], [2600, 3.7]].forEach(([f, r], i) => {
      const bp = L.f('bandpass', f, 2.5), g = L.g(0.35 - i * 0.05); L.lfo(r, 0.22, g.gain); L.lfo(0.3 + i * 0.13, 0.12, g.gain);
      n.connect(bp); bp.connect(g); g.connect(out);
    });
  },
  sea(L, out) {
    const a = L.noise('pink'), lpa = L.f('lowpass', 650, 0.6), ga = L.g(0.4); L.lfo(0.09, 380, lpa.frequency); L.lfo(0.09, 0.32, ga.gain); L.chain(a, lpa, ga, out);
    const b = L.noise('pink'), lpb = L.f('lowpass', 900, 0.6), gb = L.g(0.3); L.lfo(0.137, 420, lpb.frequency); L.lfo(0.137, 0.25, gb.gain); L.chain(b, lpb, gb, out);
    const h = L.noise('white'), hp = L.f('highpass', 3500, 0.5), hg = L.g(0.03); L.lfo(0.11, 0.028, hg.gain); L.chain(h, hp, hg, out);
  },
  wind(L, out) { LOOPS.wind.build(L, out); },
  rain(L, out) { LOOPS.rain.build(L, out); },
};
const BED_LEVEL = { crickets: 0.4, traffic: 0.55, crowd: 0.35, sea: 0.5, wind: 0.5, rain: 0.6 };

// ---- level calibration (measured with tools/audiotest.html offline renders; load the page with ?nocal to re-measure raw levels) ----
const CAL = {shot_pistol: 0.881, shot_deagle: 0.582, shot_shotgun: 0.531, shot_smg: 0.804, shot_ak: 0.7, shot_sniper: 0.479, shot_rpg: 0.7, explosion: 0.367, explosion_small: 0.313, punch: 0.495, kick: 0.684, swing_bat: 0.794, hit_flesh: 0.676, hit_bat: 0.556, hit_body_fall: 0.692, empty_click: 1.135, cock: 1.274, reload: 1.084, grenade_bounce: 0.617, spray: 0.75, pickup: 1.396, cash: 1.096, ding: 1.462, menu_click: 1.148, menu_move: 1.365, mission_pass: 1.698, mission_fail: 1.514, wanted_up: 2.57, wasted: 0.7, busted: 1.059, phone_ring: 1.274, footstep_concrete: 0.442, footstep_grass: 0.513, footstep_sand: 0.638, splash: 0.513, horn: 1.334, car_hit_light: 0.646, car_hit_heavy: 0.49, glass_break: 0.741, door_open: 1.514, door_close: 0.692, screech: 1.318, siren_short: 1.622, cop_whistle: 1.905, heli_chop: 0.944, bullet_whiz: 0.944, bullet_impact: 0.531, ricochet: 0.724, fire_whoosh: 0.292, car_pass: 0.716, scream_male: 2.692, scream_female: 1.972, exhaust_pop: 0.603, engine_start: 0.822, bird: 1.66};
const LCAL = {siren_police: 1.82, siren_ambulance: 2.213, tire_skid: 1.109, wind: 0.501, fire_crackle: 0.871, rain: 0.569, water_lap: 0.716, heli_rotor: 0.75, spraycan: 1.047, horn: 1.603};
if (!(typeof globalThis !== 'undefined' && globalThis.__AUDIO_NOCAL)) {
  for (const n of Object.keys(CAL)) if (META[n]) META[n].trim *= CAL[n];
  for (const n of Object.keys(LCAL)) if (LOOPS[n]) LOOPS[n].vol *= LCAL[n];
}

// =====================================================================================================
//  GENERATIVE RADIO - theory helpers, instruments, sequencer
// =====================================================================================================
const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixo: [0, 2, 4, 5, 7, 9, 10], major: [0, 2, 4, 5, 7, 9, 11],
  pentMin: [0, 3, 5, 7, 10], pentMaj: [0, 2, 4, 7, 9], blues: [0, 3, 5, 6, 7, 10], harmMin: [0, 2, 3, 5, 7, 8, 11],
};
const CHORDS = {
  m: [0, 3, 7], M: [0, 4, 7], m7: [0, 3, 7, 10], 7: [0, 4, 7, 10], M7: [0, 4, 7, 11], m9: [0, 3, 7, 10, 14], M9: [0, 4, 7, 11, 14],
  5: [0, 7, 12], sus4: [0, 5, 7, 10], dim: [0, 3, 6, 9], 9: [0, 4, 7, 10, 14], m6: [0, 3, 7, 9],
};
function scaleNote(tonic, scale, idx) {
  const n = scale.length, o = Math.floor(idx / n), k = ((idx % n) + n) % n;
  return tonic + o * 12 + scale[k];
}
// close-position voicing of chord (root = any midi note of the root pitch class) centred near `center`
function voicing(root, type, center, maxNotes) {
  const iv = CHORDS[type] || CHORDS.m, out = [];
  for (const i of iv) { let m = root + i; while (m < center - 6) m += 12; while (m > center + 6) m -= 12; out.push(m); }
  out.sort((a, b) => a - b);
  return maxNotes ? out.slice(0, maxNotes) : out;
}
function nearestChordTone(m, root, type) { // snap midi note to the closest chord tone (any octave)
  const iv = CHORDS[type] || CHORDS.m; let best = m, bd = 99;
  for (const i of iv) for (let o = -24; o <= 24; o += 12) { const c = root + i + o; const d = Math.abs(c - m); if (d < bd) { bd = d; best = c; } }
  return best;
}
function genMotif(rng, o) {
  const notes = []; let s = rng() < (o.syncStart || 0) ? 2 : 0, deg = o.start !== undefined ? o.start : pickR(rng, [0, 2, 4]);
  while (s < o.steps - 1) {
    let dur = pickR(rng, o.durs); if (s + dur > o.steps) dur = o.steps - s;
    if (rng() < o.rest) { s += dur; continue; }
    let mv = pickR(rng, o.moves || [-2, -1, -1, 0, 1, 1, 2, 3, -3]);
    if (mv === 0 && notes.length && notes[notes.length - 1].d === deg && notes.length > 1 && notes[notes.length - 2].d === deg) mv = rng() < 0.5 ? 1 : -1; // no triple repeats
    let nd = deg + mv; if (nd < o.lo || nd > o.hi) nd = deg - mv; deg = clamp(nd, o.lo, o.hi);   // reflect at the range edges
    notes.push({ s, d: deg, l: dur }); s += dur;
  }
  if (notes.length) { const last = notes[notes.length - 1]; last.d = pickR(rng, o.endDegs || [0, 0, 2]); }
  if (notes.length < 2) notes.push({ s: 0, d: 0, l: 4 }, { s: 8, d: 2, l: 4 });
  return notes;
}
function varyMotif(rng, m, scaleLen) {
  const r = m.map((x) => ({ s: x.s, d: x.d, l: x.l })), k = Math.floor(rng() * 4);
  if (k === 0) { for (let i = Math.max(0, r.length - 2); i < r.length; i++) r[i].d += pickR(rng, [-2, -1, 1, 2]); }
  else if (k === 1) { const i = Math.floor(rng() * r.length); r[i].d += scaleLen * (rng() < 0.5 ? 1 : -1); }
  else if (k === 2) { const i = 1 + Math.floor(rng() * Math.max(1, r.length - 1)); if (r[i] && r[i].s + 1 < 31 && (!r[i + 1] || r[i].s + 1 < r[i + 1].s)) r[i].s += 1; }
  else if (r.length > 3) r.splice(1 + Math.floor(rng() * (r.length - 2)), 1);
  return r;
}
function makeForm(rng, kind) {
  const F = (n, bars, p, l) => ({ n, bars, p, l });
  const a = [F('intro', 4, 'A', 0), F('verse', 8, 'A', 1), F('chorus', 8, 'B', 3), F('verse', 8, 'A', 2), F('chorus', 8, 'B', 3), F('bridge', 8, 'C', 1), F('chorus', 8, 'B', 3), F('outro', 4, 'A', 0)];
  const b = [F('intro', 4, 'A', 0), F('verse', 8, 'A', 1), F('chorus', 8, 'B', 3), F('bridge', 4, 'C', 1), F('chorus', 8, 'B', 3), F('outro', 4, 'A', 0)];
  const c = [F('intro', 8, 'A', 0), F('verse', 8, 'A', 1), F('verse', 8, 'A', 2), F('chorus', 8, 'B', 3), F('verse', 8, 'A', 2), F('chorus', 8, 'B', 3), F('bridge', 8, 'C', 1), F('chorus', 16, 'B', 3), F('outro', 4, 'A', 0)];
  kind = pickR(rng, [0, 0, 1, 2, 2]); // weighted: mostly 2.5-3.5 minute songs, sometimes a short ~1.5 minute one
  const f = kind === 1 ? b : kind === 2 ? c : a;
  return f;
}
function locate(song, bar) {
  let b = bar, i = 0; const f = song.form;
  for (; i < f.length - 1; i++) { if (b < f[i].bars) break; b -= f[i].bars; }
  return { sec: f[i], si: i, bi: Math.min(b, f[i].bars - 1), bar };
}
function chordAt(prog, pos) {
  let tot = 0; for (const c of prog) tot += c.len;
  let p = pos % tot; for (const c of prog) { if (p < c.len) return c; p -= c.len; }
  return prog[0];
}
const mkProg = (arr, len) => arr.map((c) => ({ r: c[0], t: c[1], len: c[2] || len || 16 }));
function mkPlan() { return { ev: Array.from({ length: 16 }, () => []), add(s, bus, fn, h) { if (s >= 0 && s < 16) this.ev[s].push({ bus, fn, h }); } }; }
function songTitle(rng, W) { return (W.t && rng() < 0.6) ? pickR(rng, W.t) : pickR(rng, W.a) + ' ' + pickR(rng, W.n); }

// =====================================================================================================
//  INSTRUMENTS   (M = station runtime; bus = destination node)
// =====================================================================================================
// one shared filter per (bus, kind) - saves 1 node per hat/shaker/clap hit
function sharedFilter(M, bus, key, type, freq, q) {
  const k = '_f_' + key; if (bus[k]) return bus[k];
  const f = M.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; f.connect(bus); return (bus[k] = f);
}
const KIT = {
  kick(M, bus, t, v, o) {
    o = o || {};
    tone(M.B, bus, t, { f: o.f0 || 150, f2: o.f1 || 48, fd: o.fd || 0.07, a: 0.001, peak: 0.95 * v, d: o.d || 0.32 });
    if (o.click !== 0) noise(M.B, bus, t, { ft: 'bandpass', ff: 3000, q: 0.8, a: 0.0005, d: 0.012, peak: (o.click || 0.35) * v });
  },
  snare(M, bus, t, v, o) {
    o = o || {};
    noise(M.B, bus, t, { ft: 'highpass', ff: o.hp || 1300, a: 0.001, d: o.d || 0.17, peak: (o.nz || 0.7) * v });
    tone(M.B, bus, t, { type: 'triangle', f: o.f || 200, f2: (o.f || 200) * 0.72, fd: 0.08, a: 0.001, peak: 0.5 * v, d: o.bd || 0.11 });
    if (o.crack) noise(M.B, bus, t, { ft: 'bandpass', ff: 4500, q: 0.7, a: 0.0005, d: 0.03, peak: 0.5 * v });
  },
  clap(M, bus, t, v, o) {
    o = o || {};
    const f = sharedFilter(M, bus, 'clap', 'bandpass', 1300, 1.2);
    for (let k = 0; k < 3; k++) noise(M.B, f, t + k * 0.011, { a: 0.0008, d: 0.02, peak: 0.6 * v });
    noise(M.B, f, t + 0.033, { a: 0.001, d: o.d || 0.13, peak: 0.6 * v });
  },
  hat(M, bus, t, v, open) {
    noise(M.B, sharedFilter(M, bus, 'hat', 'highpass', 7200, 0.7), t, { a: 0.0008, d: open ? 0.26 : 0.045, peak: (open ? 0.32 : 0.3) * v });
  },
  tom(M, bus, t, v, f) {
    tone(M.B, bus, t, { f: f * 1.35, f2: f * 0.8, fd: 0.14, a: 0.001, peak: 0.8 * v, d: 0.3 });
    noise(M.B, bus, t, { ft: 'lowpass', ff: 2500, a: 0.001, d: 0.03, peak: 0.25 * v });
  },
  conga(M, bus, t, v, kind, f) {
    if (kind === 'slap') { noise(M.B, bus, t, { ft: 'bandpass', ff: 2100, q: 1.4, a: 0.0005, d: 0.05, peak: 0.6 * v }); tone(M.B, bus, t, { f: f * 1.15, f2: f, fd: 0.03, a: 0.001, peak: 0.25 * v, d: 0.08 }); }
    else if (kind === 'mute') { tone(M.B, bus, t, { f: f * 1.05, f2: f, fd: 0.03, a: 0.001, peak: 0.5 * v, d: 0.07 }); noise(M.B, bus, t, { ft: 'bandpass', ff: 1500, q: 1, a: 0.0005, d: 0.02, peak: 0.25 * v }); }
    else { tone(M.B, bus, t, { f: f * 1.2, f2: f, fd: 0.05, a: 0.001, peak: 0.75 * v, d: 0.22 }); tone(M.B, bus, t, { f: f * 2.3, a: 0.001, peak: 0.12 * v, d: 0.06 }); noise(M.B, bus, t, { ft: 'bandpass', ff: 1800, q: 1, a: 0.0005, d: 0.015, peak: 0.3 * v }); }
  },
  cowbell(M, bus, t, v) {
    for (const f of [562, 845]) tone(M.B, bus, t, { type: 'square', f, a: 0.001, peak: 0.12 * v, d: 0.11, ft: 'bandpass', ff: 700, q: 1.5 });
  },
  clave(M, bus, t, v) { tone(M.B, bus, t, { f: 2500, f2: 2350, fd: 0.02, a: 0.0008, peak: 0.45 * v, d: 0.045 }); },
  shaker(M, bus, t, v) { noise(M.B, sharedFilter(M, bus, 'shk', 'bandpass', 6500, 0.8), t, { a: 0.012, d: 0.05, peak: 0.28 * v }); },
  crash(M, bus, t, v) {
    noise(M.B, bus, t, { ft: 'highpass', ff: 5000, a: 0.002, d: 1.6, peak: 0.45 * v });
    noise(M.B, bus, t, { ft: 'bandpass', ff: 9000, q: 0.6, a: 0.002, d: 0.8, peak: 0.3 * v });
  },
  ride(M, bus, t, v) {
    noise(M.B, bus, t, { ft: 'highpass', ff: 6500, a: 0.001, d: 0.3, peak: 0.25 * v });
    tone(M.B, bus, t, { f: 4200, a: 0.001, peak: 0.05 * v, d: 0.25 }); tone(M.B, bus, t, { f: 5650, a: 0.001, peak: 0.03 * v, d: 0.2 });
  },
};
// sine/saw sub bass with optional slide
function subBass(M, bus, t, m, dur, v, o) {
  o = o || {}; const c = M.ctx, f = mtof(m), g = c.createGain(), osc = c.createOscillator(), osc2 = c.createOscillator(), lp = c.createBiquadFilter(), g2 = c.createGain();
  osc.type = 'sine'; osc2.type = 'sawtooth'; lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.7; g2.gain.value = 0.22;
  if (o.from) { osc.frequency.setValueAtTime(mtof(o.from), t); osc.frequency.exponentialRampToValueAtTime(f, t + 0.05); osc2.frequency.setValueAtTime(mtof(o.from), t); osc2.frequency.exponentialRampToValueAtTime(f, t + 0.05); }
  else { osc.frequency.setValueAtTime(f, t); osc2.frequency.setValueAtTime(f, t); }
  const hold = Math.max(0.03, dur - 0.06);
  envPerc(g.gain, t, 0.85 * v, 0.008, hold, 0.08);
  osc.connect(g); osc2.connect(lp); lp.connect(g2); g2.connect(g); g.connect(bus);
  const e = t + 0.008 + hold + 0.1; osc.start(t); osc2.start(t); osc.stop(e); osc2.stop(e);
}
function synthBass(M, bus, t, m, dur, v, o) {
  o = o || {}; const f = mtof(m);
  const hold = Math.max(0.02, dur - 0.04);
  tone(M.B, bus, t, { type: 'sawtooth', f, a: 0.004, hold, d: 0.05, peak: 0.42 * v, ft: 'lowpass', ff: o.f0 || 2200, ff2: o.f1 || 350, ffd: 0.18, q: 4 });
  tone(M.B, bus, t, { type: 'square', f: f * 0.5, a: 0.004, hold, d: 0.05, peak: 0.3 * v, ft: 'lowpass', ff: 300, q: 0.7 });
}
function funkBass(M, bus, t, m, dur, v, kind) {
  const f = mtof(m);
  if (kind === 'g') { // ghost / dead note
    tone(M.B, bus, t, { type: 'sawtooth', f, a: 0.002, d: 0.045, peak: 0.25 * v, ft: 'lowpass', ff: 500, q: 1 });
    noise(M.B, bus, t, { ft: 'bandpass', ff: 700, q: 2, a: 0.001, d: 0.02, peak: 0.12 * v });
    return;
  }
  const pop = kind === 'p', hold = Math.max(0.02, dur - 0.03);
  tone(M.B, bus, t, { type: 'sawtooth', f, a: 0.002, hold, d: 0.06, peak: 0.42 * v, ft: 'lowpass', ff: pop ? 3800 : 2600, ff2: 380, ffd: 0.1, q: 3 });
  tone(M.B, bus, t, { type: 'sine', f: f * 0.5, a: 0.003, hold, d: 0.06, peak: 0.3 * v });
  noise(M.B, bus, t, { ft: 'bandpass', ff: pop ? 3200 : 2000, q: 2, a: 0.0005, d: pop ? 0.02 : 0.012, peak: (pop ? 0.4 : 0.22) * v }); // slap transient
}
function pickBass(M, bus, t, m, dur, v, o) {
  o = o || {}; const f = mtof(m), hold = Math.max(0.02, dur - 0.03);
  tone(M.B, bus, t, { type: 'sawtooth', f, a: 0.003, hold, d: 0.06, peak: 0.42 * v, ft: 'lowpass', ff: o.ff || 1100, q: 1.5 });
  tone(M.B, bus, t, { type: 'square', f, a: 0.003, hold, d: 0.05, peak: 0.18 * v, ft: 'lowpass', ff: 700 });
  noise(M.B, bus, t, { ft: 'bandpass', ff: 1800, q: 1.5, a: 0.0005, d: 0.012, peak: 0.12 * v });
}
function tumbaoBass(M, bus, t, m, dur, v) {
  const f = mtof(m), hold = Math.max(0.03, dur - 0.06), sh = M.B.ctx.createWaveShaper(); sh.curve = satCurve(1.5);
  const g = M.ctx.createGain(); g.gain.value = 1; sh.connect(g); g.connect(bus);
  tone(M.B, sh, t, { type: 'triangle', f, a: 0.005, hold, d: 0.1, peak: 0.65 * v });
  tone(M.B, bus, t, { type: 'sine', f: f * 2, a: 0.003, d: 0.1, peak: 0.12 * v });
  noise(M.B, bus, t, { ft: 'lowpass', ff: 900, a: 0.0005, d: 0.02, peak: 0.12 * v });
}
// multi-note voice through one filter/gain (pads, stabs, brass, power chords)
function chordVoice(M, dest, t, notes, o) {
  const c = M.ctx, g = c.createGain(), f = c.createBiquadFilter(), a = Math.max(0.002, o.a || 0.01), hold = o.hold || 0, d = o.d || 0.2;
  f.type = o.ft || 'lowpass'; f.Q.value = o.q || 0.8;
  f.frequency.setValueAtTime(o.f0 || 1500, t);
  if (o.f1) f.frequency.linearRampToValueAtTime(o.f1, t + (o.fd || a + hold + d));
  if (o.gate) { // rhythmic gating
    g.gain.setValueAtTime(EPS, t);
    for (const [gt, len] of o.gate) { g.gain.setValueAtTime(EPS, t + gt); g.gain.linearRampToValueAtTime(o.peak, t + gt + 0.008); g.gain.setValueAtTime(o.peak, t + gt + len * 0.75); g.gain.linearRampToValueAtTime(EPS, t + gt + len); }
  } else envPerc(g.gain, t, o.peak, a, hold, d);
  f.connect(g); g.connect(dest);
  const end = t + (o.total || (a + hold + d)) + 0.05;
  for (const m of notes) for (const dt of (o.det || [-8, 8])) {
    const osc = c.createOscillator(); osc.type = o.type || 'sawtooth'; osc.frequency.value = mtof(m); osc.detune.value = dt + (o.jit ? rr(-o.jit, o.jit) : 0);
    osc.connect(f); osc.start(t); osc.stop(end);
  }
}
function epiano(M, bus, t, m, dur, v) {
  const f = mtof(m);
  tone(M.B, bus, t, { f, a: 0.004, peak: 0.26 * v, d: dur });
  tone(M.B, bus, t, { f: f * 2, a: 0.002, peak: 0.08 * v, d: dur * 0.35 });
  tone(M.B, bus, t, { f: f * 7.02, a: 0.001, peak: 0.04 * v, d: 0.07 });
  tone(M.B, bus, t, { type: 'triangle', f: f * 0.5, a: 0.004, peak: 0.08 * v, d: dur * 0.6 });
}
function marimba(M, bus, t, m, v) {
  const f = mtof(m), d = 0.42 * Math.pow(220 / f, 0.25);
  tone(M.B, bus, t, { f, a: 0.002, peak: 0.4 * v, d });
  tone(M.B, bus, t, { f: f * 4, a: 0.001, peak: 0.14 * v, d: 0.07 });
  tone(M.B, bus, t, { f: f * 9.9, a: 0.001, peak: 0.04 * v, d: 0.03 });
  noise(M.B, bus, t, { ft: 'bandpass', ff: 2000, q: 2, a: 0.0005, d: 0.01, peak: 0.12 * v });
}
function vibTo(M, x) { // shared vibrato LFO -> detune, released when the note ends (avoids leaking graph connections)
  if (!M.vib) return; M.vib.connect(x.detune); x.onended = () => { try { M.vib.disconnect(x.detune); } catch (e) { /* ignore */ } };
}
// lead voices -------------------------------------------------------------------------------------------------
function leadSynth(M, bus, t, m, dur, v, o) {
  o = o || {}; const c = M.ctx, f = mtof(m), osc = c.createOscillator(), osc2 = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
  osc.type = o.type || 'sawtooth'; osc2.type = o.type2 || 'square'; osc2.detune.value = o.det2 !== undefined ? o.det2 : 7;
  for (const x of [osc, osc2]) {
    if (o.from) { x.frequency.setValueAtTime(mtof(o.from), t); x.frequency.exponentialRampToValueAtTime(f, t + (o.glide || 0.07)); } else x.frequency.setValueAtTime(f, t);
    vibTo(M, x);
  }
  lp.type = 'lowpass'; lp.Q.value = o.q || 4; lp.frequency.setValueAtTime(o.f0 || 3200, t); if (o.f1) lp.frequency.exponentialRampToValueAtTime(o.f1, t + Math.max(0.1, dur));
  const g2 = c.createGain(); g2.gain.value = o.mix2 !== undefined ? o.mix2 : 0.5; osc.connect(lp); osc2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(bus);
  const hold = Math.max(0.03, dur - (o.r || 0.08));
  envPerc(g.gain, t, 0.3 * v, o.a || 0.012, hold, o.r || 0.1);
  const e = t + (o.a || 0.012) + hold + (o.r || 0.1) + 0.04; osc.start(t); osc2.start(t); osc.stop(e); osc2.stop(e);
  // vibrato connections die with the oscillators
}
function pluck(M, bus, t, m, dur, v, o) {
  o = o || {}; const c = M.ctx, f = mtof(m), a = c.createOscillator(), b = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain(), g2 = c.createGain();
  a.type = o.type || 'sawtooth'; b.type = 'square'; a.frequency.value = f; b.frequency.value = f; b.detune.value = 9; g2.gain.value = 0.5;
  lp.type = 'lowpass'; lp.Q.value = 3; lp.frequency.setValueAtTime(o.f0 || 4200, t); lp.frequency.exponentialRampToValueAtTime(o.f1 || 500, t + dur * 0.8);
  envPerc(g.gain, t, 0.28 * v, 0.002, 0, dur);
  a.connect(lp); b.connect(g2); g2.connect(lp); lp.connect(g); g.connect(bus);
  const e = t + dur + 0.04; a.start(t); b.start(t); a.stop(e); b.stop(e);
}
function guitarLead(M, bus, t, m, dur, v, o) {
  o = o || {}; const c = M.ctx, f = mtof(m), osc = c.createOscillator(), osc2 = c.createOscillator(), g = c.createGain();
  osc.type = 'sawtooth'; osc2.type = 'square'; osc2.detune.value = 4;
  const bend = o.bend || 0;
  for (const x of [osc, osc2]) { x.frequency.setValueAtTime(f * Math.pow(2, -bend / 12), t); if (bend) x.frequency.exponentialRampToValueAtTime(f, t + (o.bt || 0.09)); vibTo(M, x); }
  const g2 = c.createGain(); g2.gain.value = 0.4; osc.connect(g); osc2.connect(g2); g2.connect(g); g.connect(bus);
  const hold = Math.max(0.03, dur - 0.1); envPerc(g.gain, t, 0.3 * v, 0.008, hold, 0.12);
  const e = t + 0.008 + hold + 0.16; osc.start(t); osc2.start(t); osc.stop(e); osc2.stop(e);
}
// shared guitar amp (overdrive -> cab filters -> bus)
function makeAmp(M, dest, drive, lpf) {
  const c = M.ctx, inn = c.createGain(), sh = c.createWaveShaper(), hp = c.createBiquadFilter(), lp = c.createBiquadFilter(), pk = c.createBiquadFilter(), out = c.createGain();
  inn.gain.value = 2.2; sh.curve = satCurve(drive || 7); hp.type = 'highpass'; hp.frequency.value = 95;
  lp.type = 'lowpass'; lp.frequency.value = lpf || 3400; lp.Q.value = 0.8; pk.type = 'peaking'; pk.frequency.value = 1900; pk.gain.value = 3; pk.Q.value = 0.9; out.gain.value = 0.3;
  inn.connect(sh); sh.connect(hp); hp.connect(pk); pk.connect(lp); lp.connect(out); out.connect(dest);
  return inn;
}

// =====================================================================================================
//  STATION RUNTIME  (one per tuned station: mix chain + look-ahead step sequencer)
// =====================================================================================================
const STATION_INFO = [
  { id: 'rls', name: 'Radio Los Santos', genre: 'West Coast Hip-Hop / G-Funk', desc: 'Fat sub bass, whiny synth leads and lazy swung beats from the LS streets.' },
  { id: 'sunset', name: 'Sunset FM', genre: '80s Synthwave / Pop', desc: 'Neon arpeggios, gated pads and big gated snares for midnight drives.' },
  { id: 'desert', name: 'Desert Rock 99.1', genre: 'Classic Rock', desc: 'Crunchy power chords and sun-baked riffs from the Mojave.' },
  { id: 'bounce', name: 'Bounce FM', genre: 'Funk / Disco', desc: 'Slap bass, horn stabs and four-on-the-floor grooves.' },
  { id: 'tropicana', name: 'Tropicana', genre: 'Latin / Salsa', desc: 'Congas, marimba and montuno piano straight from the islands.' },
];

class StationRT {
  constructor(radio, idx, st) {
    this.radio = radio; this.idx = idx; this.st = st; this.audio = radio.audio; this.ctx = radio.audio.ctx; this.B = radio.audio.B;
    this.style = STYLES[idx]; this.bus = {}; this.timer = null; this.dead = false; this.solo = null; this.s = 0; this.next = 0; this.sd = 0.15; this.plan = null;
  }
  get song() { return this.st.song; }
  start(offline, solo) {
    const c = this.ctx, S = this.style, st = this.st; this.solo = solo || null;
    if (!st.song) { st.song = S.makeSong(mulberry32(hashN(this.radio.seed, this.idx, st.n = (st.n || 0) + 1))); st.bar = st.startBar || 0; }
    // -- mix chain
    const E = S.eq;
    const mixIn = c.createGain(), hp = c.createBiquadFilter(), pk = c.createBiquadFilter(), lp = c.createBiquadFilter(), comp = c.createDynamicsCompressor(), out = c.createGain(), identBus = c.createGain();
    hp.type = 'highpass'; hp.frequency.value = E.hp; hp.Q.value = 0.7; pk.type = 'peaking'; pk.frequency.value = E.mid; pk.gain.value = E.midg; pk.Q.value = 0.8;
    lp.type = 'lowpass'; lp.frequency.value = E.lp; lp.Q.value = 0.6;
    comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 3; comp.attack.value = 0.012; comp.release.value = 0.2;
    out.gain.value = S.level;
    mixIn.connect(hp); hp.connect(pk); pk.connect(lp); lp.connect(comp); comp.connect(out); identBus.connect(out);
    out.connect(this.radio.duckGain);
    this.mixIn = mixIn; this.out = out; this.identBus = identBus; this.comp = comp;
    // -- delay (tempo synced) + reverb send
    this.B = this.radio.audio.B; this.ctx = c;
    const bpm = st.song.bpm, sd = 60 / bpm / 4;
    this.dlIn = c.createGain(); const dly = c.createDelay(2), fb = c.createGain(), dlp = c.createBiquadFilter(), dout = c.createGain();
    dly.delayTime.value = Math.min(1.9, sd * (S.delaySteps || 3)); fb.gain.value = S.delayFb !== undefined ? S.delayFb : 0.36; dlp.type = 'lowpass'; dlp.frequency.value = 3200; dout.gain.value = 0.8;
    this.dlIn.connect(dly); dly.connect(dlp); dlp.connect(fb); fb.connect(dly); dlp.connect(dout); dout.connect(mixIn);
    this.rvSend = c.createGain(); this.rvSend.gain.value = 1; this.rvSend.connect(this.B.revMus);
    // -- buses
    for (const name of Object.keys(S.buses)) {
      const [gv, rv, dl] = S.buses[name], g = c.createGain(); g.gain.value = gv; g.connect(mixIn);
      if (rv > 0) { const s = c.createGain(); s.gain.value = rv; g.connect(s); s.connect(this.rvSend); }
      if (dl > 0) { const s = c.createGain(); s.gain.value = dl; g.connect(s); s.connect(this.dlIn); }
      this.bus[name] = g;
    }
    // -- vibrato LFO (cents), amps
    this.vib = c.createGain(); this.vib.gain.value = S.vibDepth || 18; this.vibOsc = c.createOscillator(); this.vibOsc.frequency.value = S.vibRate || 5.3; this.vibOsc.connect(this.vib); this.vibOsc.start();
    if (S.setup) S.setup(this);
    // -- ident + start
    const t0 = c.currentTime + 0.05, identLen = 0.62;
    if (!offline) { this._static(t0, 0.42); try { S.ident(this, t0 + 0.05); } catch (e) { /* ignore */ } }
    else { try { S.ident(this, t0 + 0.05); } catch (e) { /* ignore */ } }
    mixIn.gain.setValueAtTime(0.0001, t0); mixIn.gain.setValueAtTime(0.0001, t0 + identLen - 0.02); mixIn.gain.linearRampToValueAtTime(1, t0 + identLen + 0.12);
    this.next = t0 + identLen; this.s = 0; this.bar = st.bar || 0;
    if (!offline) this.timer = setInterval(() => this.tick(), 25);
  }
  _static(t, dur) {
    const B = this.B;
    noise(B, this.identBus, t, { ft: 'bandpass', ff: 900, ff2: 3800, ffd: dur * 0.6, q: 0.9, a: 0.01, hold: dur * 0.6, d: dur * 0.3, peak: 0.22 });
    tone(B, this.identBus, t, { f: 1800, f2: 420, fd: dur * 0.7, a: 0.01, hold: dur * 0.2, d: dur * 0.3, peak: 0.03 });
    for (let i = 0; i < 6; i++) noise(B, this.identBus, t + Math.random() * dur, { ft: 'highpass', ff: 3000, a: 0.001, d: 0.012, peak: rr(0.15, 0.4) });
  }
  tick() {
    if (this.dead) return;
    try { this.schedule(this.ctx.currentTime + (typeof document !== 'undefined' && document.hidden ? 1.5 : 0.2)); } catch (e) { this.audio._warn(e); }
  }
  schedule(until, maxSteps) {
    let guard = 0; const cap = maxSteps || 64;
    while (this.next < until && guard++ < cap) this.stepOnce();
    if (this.next < this.ctx.currentTime - 0.5) this.next = this.ctx.currentTime + 0.05; // recover after a stall
  }
  stepOnce() {
    const st = this.st, song = st.song, S = this.style, sd = 60 / song.bpm / 4; this.sd = sd;
    if (this.s === 0) { this.loc = locate(song, this.bar); this.plan = S.plan(this, song, this.bar, this.loc); }
    const t = this.next + ((this.s & 1) ? S.swing * sd : 0), evs = this.plan.ev[this.s];
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i]; if (this.solo && this.solo !== e.bus) continue;
      try { e.fn(this, this.bus[e.bus], t + (e.h ? rr(0, 0.004) : 0)); } catch (err) { this.audio._warn(err); }
    }
    this.next += sd; this.s++;
    if (this.s >= 16) {
      this.s = 0; this.bar++;
      if (this.bar >= song.bars) { st.song = S.makeSong(mulberry32(hashN(this.radio.seed, this.idx, st.n = (st.n || 0) + 1))); this.bar = 0; }
      st.bar = this.bar;
    }
  }
  stop() {
    if (this.dead) return; this.dead = true;
    try {
      clearInterval(this.timer);
      const now = this.ctx.currentTime;
      this.st.bar = this.bar - (this.bar % 2); this.st.lastStop = now; this.st.barPos = this.bar;
      this.out.gain.cancelScheduledValues(now); this.out.gain.setTargetAtTime(0, now, 0.04);
      this.vibOsc.stop(now + 0.4);
      const out = this.out, mixIn = this.mixIn;
      const d = () => { try { out.disconnect(); mixIn.disconnect(); this.dlIn.disconnect(); } catch (e) { /* ignore */ } };
      if (this.audio._offline) d(); else setTimeout(d, 600);
    } catch (e) { /* ignore */ }
  }
}

class Radio {
  constructor(audio) {
    this.audio = audio; this.stations = STATION_INFO.map((s) => Object.assign({}, s)); this.current = -1;
    this._rt = null; this._duck = 0; this._state = []; this.duckGain = null; this.seed = (Math.random() * 1e9) | 0;
  }
  _onReady() {
    try {
      const a = this.audio; this.duckGain = a.ctx.createGain(); this.duckGain.connect(a.musicBus);
      this.duckGain.gain.value = 1 - 0.82 * this._duck;
      if (this.current >= 0) this._switch(this.current);
    } catch (e) { this.audio._warn(e); }
  }
  set(i) {
    i = Math.floor(+i); if (!(i >= 0 && i < this.stations.length)) i = -1;
    if (i === this.current && this._rt && !this._rt.dead) return;
    this.current = i;
    if (this.audio._ready) this._switch(i);
  }
  next() { const n = this.stations.length; this.set(this.current === n - 1 ? -1 : this.current + 1); }
  prev() { const n = this.stations.length; this.set(this.current === -1 ? n - 1 : this.current - 1); }
  // d = duck amount: 0 = normal level, 1 = heavily ducked (-15 dB)
  setDuck(d) {
    this._duck = clamp(+d || 0, 0, 1);
    try { if (this.duckGain) this.duckGain.gain.setTargetAtTime(1 - 0.82 * this._duck, this.audio.ctx.currentTime, 0.15); } catch (e) { /* ignore */ }
  }
  nowPlaying() {
    const st = this._state[this.current];
    if (this.current < 0) return '';
    if (!st || !st.song) return STATION_INFO[this.current].name;
    return st.song.title + ' — ' + st.song.artist;
  }
  _switch(i) {
    try {
      if (this._rt) { this._rt.stop(); this._rt = null; }
      if (i < 0) return;
      const st = this._state[i] || (this._state[i] = { song: null, bar: 0, n: 0, lastStop: 0 });
      if (!st.song) { // first ever tune-in: join the broadcast somewhere (often the intro, sometimes mid-song)
        st.song = STYLES[i].makeSong(mulberry32(hashN(this.seed, i, st.n = (st.n || 0) + 1)));
        st.bar = Math.random() < 0.5 ? 0 : Math.floor(Math.random() * st.song.bars * 0.6 / 4) * 4;
      }
      this._advance(i, st);
      this._rt = new StationRT(this, i, st); this._rt.start(false);
    } catch (e) { this.audio._warn(e); }
  }
  _advance(i, st) { // pretend the station kept playing while we were away
    const ctx = this.audio.ctx;
    if (!st.song) { st.bar = 0; return; }
    if (st.lastStop > 0) {
      let elapsed = ctx.currentTime - st.lastStop, guard = 0;
      while (elapsed > 0 && guard++ < 20) {
        const barDur = 240 / st.song.bpm, left = (st.song.bars - st.bar) * barDur;
        if (elapsed < left) { st.bar += Math.floor(elapsed / barDur); elapsed = 0; }
        else { elapsed -= left; st.song = STYLES[i].makeSong(mulberry32(hashN(this.seed, i, st.n = (st.n || 0) + 1))); st.bar = 0; }
      }
      st.bar -= st.bar % 2;
    }
  }
  _tickUpdate() { // backstop for throttled timers
    const rt = this._rt; if (rt && !rt.dead && typeof document !== 'undefined' && document.hidden) rt.tick();
  }
  // test helper: render station i for `secs` seconds into the (offline) context
  _offlineRender(i, secs, opts) {
    opts = opts || {};
    const a = this.audio; if (!a._ready) return;
    const st = this._state[i] || (this._state[i] = { song: null, bar: 0, n: 0, lastStop: 0 });
    if (opts.seed) this.seed = opts.seed;
    if (opts.startBar !== undefined) { st.startBar = opts.startBar; }
    this.current = i; if (!this.duckGain) this._onReady();
    const rt = this._rt = new StationRT(this, i, st); rt.start(true, opts.solo);
    rt.schedule(secs, 1e6);
    return st.song;
  }
}

// =====================================================================================================
//  STATION STYLES  (song generators + per-bar arrangement planners)
// =====================================================================================================
const STYLES = [];
const W = [
  { // 0 G-funk
    a: ['Westside', 'Midnight', 'Chrome', 'Lowrider', 'Velvet', 'Candy Paint', 'Sunset', 'Concrete', 'Gold Chain', 'Backstreet', 'Late Night', 'Palm Street', 'Crenshaw', 'Sunday'],
    n: ['Sunrise', 'Cruise', 'Bounce', 'Sermon', 'Lullaby', 'Hustle', 'Boulevard', 'Anthem', 'Groove', 'Shuffle', 'Hydraulics', 'Smoke', 'Affair', 'Stroll'],
    art: ['The Hollow Kings', 'Smoove D & The Velvet Crew', 'Big Kasper', 'Tha Cruise Committee', 'MC Sundown', 'Yung Hydraulic', 'Lil Gasoline', 'Dub Cadillac'],
  },
  { // 1 synthwave
    a: ['Neon', 'Chrome', 'Electric', 'Midnight', 'Laser', 'Turbo', 'Crystal', 'Night Drive', 'Pacific', 'Digital', 'Velvet', 'Holo'],
    n: ['Heartbeat', 'Horizon', 'Romance', 'Palms', 'Polaroid', 'Sunset', 'Dreams', 'Mirage', 'Coast', 'Runner', 'Skyline', 'Afterglow'],
    art: ['Laser Coast', 'The Velvet Arcade', 'Dynamo Sunset', 'Synthia Vale', 'Turbo Mirage', 'Midnight Polaroids', 'Kid Horizon', 'Pacific Static'],
  },
  { // 2 rock
    a: ['Burning', 'Canyon', 'Rattlesnake', 'Mojave', 'Gasoline', 'Sun-Bleached', 'Desert', 'Thunder', 'Iron', 'Outlaw', 'Black Mesa', 'Dusty'],
    n: ['Highway', 'Mile 99', 'Thunder', 'Radio', 'Fury', 'Halo', 'Bones', 'Devil', 'Sky', 'Horses', 'Sermon', 'Fever', 'Road'],
    t: ['Dust On The Highway', 'Burning Through Barstow', 'Rattlesnake Radio', 'Sun-Bleached Bones', 'Gasoline Halo', 'Devil On The Mesa', 'Ride The Canyon Thunder', 'Desert Sermon'],
    art: ['Rattlesnake Highway', 'The Dust Devils', 'Iron Coyote', 'Black Mesa Riders', 'Cactus Judge', 'Gasoline Saints', 'Sandstorm Union', 'Broken Axle'],
  },
  { // 3 funk/disco
    a: ['Velvet', 'Sugar Hill', 'Boogie Down', 'Platinum', 'Mirrorball', 'Funky', 'Glitter', 'Sunday Best', 'Super', 'Golden', 'Hustle'],
    n: ['Bounce', 'Strut', 'Boulevard', 'Groove', 'Love', 'Machine', 'Fever', 'Express', 'Shuffle', 'Party', 'Jam'],
    t: ['Shake Your Platform Shoes', 'Bounce On The Floor Tonight', 'Do The Bounce', 'Mirrorball Love', 'Funky Chicken Scratch', 'Sugar Hill Strut'],
    art: ['The Bounce Brothers', 'Sugar Cane Express', 'Mirrorball Collective', 'Afro Comb Orchestra', 'Lady Platinum', 'Funkadelic Fred & Co', 'The Groove Tax', 'Disco Dan'],
  },
  { // 4 latin
    a: ['Mango', 'Coco', 'Canela', 'Fuego', 'Malecon', 'Isla'],
    n: ['Rumba', 'Moon', 'Sunset', 'Verano', 'Dorada', 'Nights'],
    t: ['Calle del Sol', 'Noche en la Playa', 'Mango Moon', 'Fuego en el Malecon', 'Coco y Ron', 'Ron y Canela', 'Palmeras de Fuego', 'Salsa en la Azotea', 'Baila en la Arena', 'Sol de Verano', 'Luna de Mango', 'Canela y Mango'],
    art: ['Los Mangos del Sol', 'Orquesta Bahia Dorada', 'Rumba Calle Orquesta', 'Tito Montuno Jr', 'Orquesta Tropical Nova', 'Los Coquis', 'La Sonora Pacifica', 'Conjunto Palmera'],
  },
];
function makeMeta(st, rng) { return { title: songTitle(rng, W[st]), artist: pickR(rng, W[st].art) }; }
function riser(P, sd, bus) { // reverse-noise riser over the last bar before a chorus
  P.add(0, bus, (M, b, t) => noise(M.B, b, t, { kind: 'pink', ft: 'bandpass', ff: 250, ff2: 5000, ffd: sd * 16, q: 0.8, a: sd * 15.5, d: 0.05, peak: 0.45 }));
}
function nextSec(song, loc) { return song.form[loc.si + 1] || null; }
// place a motif (32 steps = 2 bars) for bar `bi`
function leadNotes(P, bus, motif, bi, play) {
  const half = (bi % 2) * 16;
  for (const n of motif) { if (n.s < half || n.s >= half + 16) continue; P.add(n.s - half, bus, (M, b, t) => play(M, b, t, n)); }
}
function motifFor(song, sec, bi) { // chorus phrase structure with 4/8/16-bar variation
  const m = song.m, ph = Math.floor(bi / 2);
  const seq = bi >= 8 ? [m.hook, m.hookV, m.alt2, m.hookV] : [m.hook, m.hook, m.alt, m.hookV];
  return seq[ph % 4];
}
const sdOf = (M) => M.sd || 0.16;

// ------------------------------------------------------------------------------------------ 0: G-FUNK
const G_PROGS = [
  [[0, 'm7'], [0, 'm7'], [5, 'm7'], [7, '7']], [[0, 'm9'], [8, 'M7'], [7, '7'], [0, 'm9']], [[0, 'm7'], [3, 'M7'], [8, 'M7'], [7, '7']],
  [[0, 'm7'], [5, '7'], [0, 'm7'], [5, '7']], [[0, 'm9', 32], [8, 'M7', 16], [7, '7', 16]],
];
const G_BASS = [
  [[0, 0, 5], [6, 12, 1], [8, 0, 3], [11, -2, 2], [14, 7, 2]], [[0, 0, 3], [3, 0, 2], [6, 5, 2], [8, 0, 4], [12, 7, 2], [14, 5, 1]],
  [[0, 0, 8], [8, 0, 3], [11, 7, 1], [12, 5, 2], [14, 3, 2]], [[0, 0, 2], [2, 12, 1], [4, 0, 2], [7, 0, 1], [8, 0, 4], [12, -5, 2], [14, -2, 2]],
];
STYLES[0] = {
  swing: 0.17, level: 1.0, vibRate: 5.4, vibDepth: 30, delaySteps: 3, eq: { hp: 50, lp: 9500, mid: 450, midg: 1.5 },
  buses: { drum: [1.161, 0.05, 0], bass: [0.079, 0, 0], keys: [0.600, 0.2, 0.12], pad: [0.238, 0.3, 0], lead: [0.231, 0.2, 0.24] },
  ident(M, t) {
    const b = M.identBus;
    noise(M.B, b, t, { ft: 'bandpass', ff: 3500, ff2: 500, ffd: 0.1, q: 1, a: 0.005, d: 0.1, peak: 0.3 });
    [[69, 0.0, 0.13], [72, 0.14, 0.13], [76, 0.28, 0.3]].forEach(([m, at, d], i) => leadSynth(M, b, t + 0.1 + at, m, d, 0.8, { from: i ? [69, 72][i - 1] : 64, glide: 0.06, f0: 2800 }));
    subBass(M, b, t + 0.38, 33, 0.3, 0.8); KIT.clap(M, b, t + 0.38, 0.7);
  },
  makeSong(rng) {
    const pc = pickR(rng, [0, 2, 3, 5, 7, 9, 10]), tonic = 36 + pc, scale = SCALES.pentMin;
    let A = pickR(rng, G_PROGS), B = pickR(rng, G_PROGS); if (B === A) B = G_PROGS[(G_PROGS.indexOf(A) + 1) % G_PROGS.length];
    const C = pickR(rng, [[[8, 'M7'], [7, '7'], [0, 'm7'], [0, 'm7']], [[5, 'm7'], [3, 'M7'], [7, '7'], [7, '7']]]);
    const hook = genMotif(rng, { steps: 32, durs: [4, 4, 6, 8, 2, 12, 3], rest: 0.22, lo: -2, hi: 7, start: 3, endDegs: [0, 0, 3] });
    const song = {
      seed: rng() * 1e9 | 0, st: 0, bpm: 90 + Math.floor(rng() * 6), tonic, scale, leadBase: tonic + 24,
      progs: { A: mkProg(A), B: mkProg(B), C: mkProg(C) }, form: makeForm(rng, Math.floor(rng() * 3)),
      kick: [pickR(rng, [[0, 10], [0, 7, 10], [0, 3, 10], [0, 6, 10, 14]]), pickR(rng, [[0, 7, 10, 15], [0, 10, 14], [0, 3, 6, 10]])],
      bassA: pickR(rng, G_BASS), bassB: pickR(rng, G_BASS), keys: pickR(rng, [[0, 6, 10], [0, 3, 8, 11], [2, 6, 10, 14], [0, 6, 8, 14]]), lastLead: null,
    };
    song.m = { hook, alt: varyMotif(rng, hook, 5), hookV: varyMotif(rng, hook, 5), alt2: varyMotif(rng, varyMotif(rng, hook, 5), 5),
      verse: genMotif(rng, { steps: 32, durs: [6, 8, 4, 12], rest: 0.4, lo: 0, hi: 6, start: 2 }), bridge: genMotif(rng, { steps: 32, durs: [4, 6, 8, 2], rest: 0.25, lo: 1, hi: 8, start: 4 }) };
    song.bars = song.form.reduce((a, s) => a + s.bars, 0); Object.assign(song, makeMeta(0, rng));
    return song;
  },
  plan(M, song, bar, loc) {
    const P = mkPlan(), { sec, bi } = loc, l = sec.l, rng = mulberry32(hashN(song.seed, bar, 7)), prog = song.progs[sec.p], T = song.tonic;
    const fill = bi % 4 === 3, big = (bi % 8 === 7) || bi === sec.bars - 1, sd = 60 / song.bpm / 4;
    const nx = nextSec(song, loc);
    // drums
    if (l >= 1) {
      const ks = (fill || bi % 4 === 1) ? song.kick[1] : song.kick[0];
      const kicks = ks.slice(); if (rng() < 0.25) kicks.push(pickR(rng, [3, 14, 15]));
      if (!(fill && big)) kicks.forEach((s) => P.add(s, 'drum', (M, b, t) => KIT.kick(M, b, t, s === 0 ? 1 : 0.82, { f0: 140, f1: 42, d: 0.4 })));
      else P.add(0, 'drum', (M, b, t) => KIT.kick(M, b, t, 1, { f0: 140, f1: 42, d: 0.4 }));
      for (const s of [4, 12]) { if (fill && s === 12) continue; P.add(s, 'drum', (M, b, t) => { KIT.snare(M, b, t, 0.85, { f: 185, d: 0.2, hp: 1100, nz: 0.6 }); KIT.clap(M, b, t, 0.7); }); }
      if (l >= 2 && rng() < 0.4) P.add(pickR(rng, [7, 15]), 'drum', (M, b, t) => KIT.snare(M, b, t, 0.22, { d: 0.06 }));
      if (fill) for (let s = 12; s < 16; s++) P.add(s, 'drum', (M, b, t) => KIT.snare(M, b, t, 0.35 + (s - 12) * 0.18, { d: 0.09, hp: 1200 }));
    } else if (bi % 2 === 1) P.add(12, 'drum', (M, b, t) => KIT.clap(M, b, t, 0.4));
    for (let s = 0; s < 16; s++) {
      if (fill && s >= 12 && l >= 1) continue;
      if (l === 0 && s % 2) continue; if (l === 1 && s % 2 && rng() < 0.45) continue; if (s % 4 && rng() < 0.1) continue;
      const vel = (s % 4 === 0 ? 0.8 : s % 2 === 0 ? 0.52 : 0.3) * (0.85 + rng() * 0.3), open = (l >= 2 && (s === 14 || (s === 6 && rng() < 0.3)));
      P.add(s, 'drum', (M, b, t) => KIT.hat(M, b, t, vel, open), true);
    }
    // bass
    if (l >= 1 || (sec.n === 'intro' && bi >= 2)) {
      const pat = l === 0 ? [[0, 0, 14]] : (bi % 4 === 3 ? song.bassB : song.bassA); let prev = null;
      for (const [s, off, len] of pat) {
        const c = chordAt(prog, bi * 16 + s), r = T + (c.r > 6 ? c.r - 12 : c.r), m = r + off, from = (prev !== null && s > 0 && rng() < 0.35) ? prev : undefined; prev = m;
        P.add(s, 'bass', (M, b, t) => subBass(M, b, t, m, len * M.sd, 1, { from }));
      }
    }
    // keys
    const ksteps = l === 0 ? [0, 10] : song.keys;
    if (l >= 0 && !(sec.n === 'outro' && bi > 1)) for (const s of ksteps) {
      const c = chordAt(prog, bi * 16 + s), notes = voicing(T + 24 + c.r, c.t, 64), v = s === 0 ? 0.9 : 0.7;
      P.add(s, 'keys', (M, b, t) => { for (const m of notes) epiano(M, b, t, m, 0.6, v * 0.75); });
    }
    if (l >= 2) { const c = chordAt(prog, bi * 16), notes = voicing(T + 24 + c.r, c.t, 62, 4);
      P.add(0, 'pad', (M, b, t) => chordVoice(M, b, t, notes, { a: 0.4, hold: 1.4, d: 1.0, f0: 500, f1: 1500, peak: 0.07 })); }
    // lead
    const lv = (m, n) => { const c = chordAt(prog, bi * 16 + n.s), x = scaleNote(song.leadBase, song.scale, n.d); return (n.s % 8 === 0) ? nearestChordTone(x, T + c.r + 24, c.t) : x; };
    const playLead = (M, b, t, n) => { const m = lv(null, n); leadSynth(M, b, t, m, n.l * M.sd * 0.96, 0.9, { from: song.lastLead || undefined, glide: 0.09, f0: 2800, f1: 1800, q: 5 }); song.lastLead = m; };
    if (sec.n === 'chorus') leadNotes(P, 'lead', motifFor(song, sec, bi), bi, playLead);
    else if (sec.n === 'verse' && l >= 2 && Math.floor(bi / 2) % 2 === 1) leadNotes(P, 'lead', song.m.verse, bi, playLead);
    else if (sec.n === 'bridge' && Math.floor(bi / 2) % 2 === 0) leadNotes(P, 'lead', song.m.bridge, bi, playLead);
    if (nx && nx.n === 'chorus' && bi === sec.bars - 1) riser(P, sd, 'pad');
    return P;
  },
};

// ------------------------------------------------------------------------------------------ 1: SYNTHWAVE
STYLES[1] = {
  swing: 0, level: 1.0, vibRate: 5.8, vibDepth: 14, delaySteps: 3, delayFb: 0.4, eq: { hp: 45, lp: 12000, mid: 2500, midg: 1.0 },
  buses: { drum: [1.288, 0.05, 0], snr: [1.091, 0.4, 0], bass: [0.165, 0, 0], arp: [0.547, 0.14, 0.4], pad: [0.297, 0.3, 0], lead: [0.326, 0.25, 0.4] },
  ident(M, t) {
    const b = M.identBus;
    [0, 3, 7, 12, 15].forEach((x, i) => pluck(M, b, t + 0.08 + i * 0.075, 69 + x, 0.3, 0.9));
    chordVoice(M, b, t + 0.1, [57, 60, 64, 69], { a: 0.15, hold: 0.2, d: 0.3, f0: 700, f1: 2500, peak: 0.12 });
    KIT.snare(M, b, t + 0.46, 0.7, { d: 0.3, hp: 900, crack: true });
  },
  makeSong(rng) {
    const pc = pickR(rng, [0, 2, 4, 5, 7, 9, 11]), tonic = 36 + pc, minor = rng() < 0.6;
    const pm = [[[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']], [[0, 'm'], [10, 'M'], [8, 'M'], [10, 'M']], [[8, 'M'], [10, 'M'], [0, 'm'], [0, 'm']], [[0, 'm'], [5, 'm'], [8, 'M'], [7, 'M']]];
    const pM = [[[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M']], [[9, 'm'], [5, 'M'], [0, 'M'], [7, 'M']], [[0, 'M'], [9, 'm'], [5, 'M'], [7, 'M']], [[5, 'M'], [7, 'M'], [9, 'm'], [0, 'M']]];
    const pool = minor ? pm : pM; let A = pickR(rng, pool), B = pickR(rng, pool); if (A === B) B = pool[(pool.indexOf(A) + 1) % pool.length];
    const C = minor ? [[8, 'M'], [10, 'M'], [0, 'm'], [0, 'm']] : [[5, 'M'], [7, 'M'], [9, 'm'], [9, 'm']];
    const scale = minor ? SCALES.minor : SCALES.major, hook = genMotif(rng, { steps: 32, durs: [2, 2, 4, 4, 6, 8, 3], rest: 0.18, lo: 0, hi: 9, start: 4, endDegs: [0, 2, 4] });
    const song = {
      seed: rng() * 1e9 | 0, bpm: 107 + Math.floor(rng() * 6), tonic, minor, scale, leadBase: tonic + 36, progs: { A: mkProg(A), B: mkProg(B), C: mkProg(C) }, form: makeForm(rng, Math.floor(rng() * 3)),
      kick: pickR(rng, [[0, 8], [0, 6, 8, 14], [0, 8, 10], [0, 3, 8, 11]]), fof: rng() < 0.5, bassPat: pickR(rng, [[0, 0, 12, 0, 0, 0, 12, 0], [0, 0, 0, 12, 0, 0, 7, 0], [0, 12, 0, 12, 0, 12, 0, 7]]),
      arpPat: pickR(rng, [[0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0, 1], [0, 2, 1, 3, 2, 4, 3, 5, 4, 2, 3, 1, 2, 0, 1, 2], [0, 1, 2, 1, 0, 1, 2, 3, 0, 1, 2, 1, 4, 3, 2, 1]]), lastLead: null,
    };
    song.m = { hook, alt: varyMotif(rng, hook, 7), hookV: varyMotif(rng, hook, 7), alt2: varyMotif(rng, varyMotif(rng, hook, 7), 7), verse: genMotif(rng, { steps: 32, durs: [4, 8, 6, 12], rest: 0.4, lo: 0, hi: 7, start: 2 }), bridge: genMotif(rng, { steps: 32, durs: [4, 6, 8], rest: 0.2, lo: 1, hi: 9, start: 3 }) };
    song.bars = song.form.reduce((a, s) => a + s.bars, 0); Object.assign(song, makeMeta(1, rng));
    return song;
  },
  plan(M, song, bar, loc) {
    const P = mkPlan(), { sec, bi } = loc, l = sec.l, rng = mulberry32(hashN(song.seed, bar, 11)), prog = song.progs[sec.p], T = song.tonic, sd = 60 / song.bpm / 4;
    const fill = bi % 4 === 3, nx = nextSec(song, loc), ch = l === 3;
    if (l >= 1) {
      const ks = (ch && song.fof) ? [0, 4, 8, 12] : song.kick;
      for (const s of ks) { if (fill && s >= 12 && sec.bars > 4) continue; P.add(s, 'drum', (M, b, t) => KIT.kick(M, b, t, s === 0 ? 1 : 0.85, { f0: 130, f1: 46, d: 0.3, click: 0.4 })); }
      for (const s of [4, 12]) { if (fill && s === 12) continue; P.add(s, 'snr', (M, b, t) => { KIT.snare(M, b, t, 0.9, { f: 175, d: 0.3, hp: 900, nz: 0.9, crack: true, bd: 0.14 }); KIT.clap(M, b, t, 0.45, { d: 0.22 }); }); }
      if (fill) [[12, 230], [13, 190], [14, 150], [15, 115]].forEach(([s, f], i) => P.add(s, 'drum', (M, b, t) => KIT.tom(M, b, t, 0.75 + i * 0.05, f)));
      for (let s = 0; s < 16; s += ch ? 1 : 2) { if (fill && s >= 12) continue; const v = s % 4 === 0 ? 0.65 : (s % 2 === 0 ? 0.45 : 0.25); P.add(s, 'drum', (M, b, t) => KIT.hat(M, b, t, v, false), true); }
      for (const s of (ch ? [2, 6, 10, 14] : [14])) P.add(s, 'drum', (M, b, t) => KIT.hat(M, b, t, 0.6, true), true);
      if (bi === 0 && sec.n === 'chorus') P.add(0, 'drum', (M, b, t) => KIT.crash(M, b, t, 0.7));
    } else for (let s = 0; s < 16; s += 4) P.add(s, 'drum', (M, b, t) => KIT.hat(M, b, t, 0.4, false), true);
    // bass
    if (l >= 1) for (let i = 0; i < 8; i++) {
      const s = i * 2, c = chordAt(prog, bi * 16 + s), r = T + (c.r > 6 ? c.r - 12 : c.r) + 12, off = song.bassPat[i];
      P.add(s, 'bass', (M, b, t) => synthBass(M, b, t, r + off, 1.85 * M.sd, 0.95, { f0: ch ? 2600 : 1800, f1: 300 }));
    }
    // pad
    { const c = chordAt(prog, bi * 16), notes = voicing(T + 24 + c.r, c.t, 62, 4), dur = 16 * sd;
      if (ch) { const gate = []; for (let i = 0; i < 8; i++) gate.push([i * 2 * sd, 1.9 * sd]);
        P.add(0, 'pad', (M, b, t) => chordVoice(M, b, t, notes, { gate, peak: 0.1, f0: 1500, f1: 1500, total: dur, det: [-10, 10] })); }
      else P.add(0, 'pad', (M, b, t) => chordVoice(M, b, t, notes, { a: 0.45, hold: dur - 1.0, d: 0.8, f0: 600, f1: 2200, fd: dur * 0.7, peak: 0.1 })); }
    // arp
    if (l >= 1 || (sec.n === 'intro' && bi >= 2)) {
      const c0 = chordAt(prog, bi * 16);
      for (let s = 0; s < 16; s += (l <= 1 ? 2 : 1)) {
        const c = chordAt(prog, bi * 16 + s), tones = CHORDS[c.t], k = song.arpPat[s], oct = Math.floor(k / tones.length) * 12, m = T + 36 + c.r + tones[k % tones.length] + oct + (ch ? 12 : 0);
        P.add(s, 'arp', (M, b, t) => pluck(M, b, t, m, 0.22, (s % 4 === 0 ? 0.9 : 0.6) * (l === 0 ? 0.7 : 1), { f0: 3800, f1: 600 }));
      }
    }
    // lead
    const playLead = (M, b, t, n) => { const c = chordAt(prog, bi * 16 + n.s); let m = scaleNote(song.leadBase, song.scale, n.d); if (n.s % 8 === 0) m = nearestChordTone(m, T + c.r + 36, c.t);
      leadSynth(M, b, t, m, n.l * M.sd * 0.95, 0.9, { type: 'sawtooth', type2: 'square', f0: 4200, f1: 2500, q: 2, glide: 0.02, a: 0.01, r: 0.12 }); };
    if (sec.n === 'chorus') leadNotes(P, 'lead', motifFor(song, sec, bi), bi, playLead);
    else if (sec.n === 'verse' && l >= 2 && Math.floor(bi / 2) % 2 === 1) leadNotes(P, 'lead', song.m.verse, bi, playLead);
    else if (sec.n === 'bridge' && Math.floor(bi / 2) % 2 === 0) leadNotes(P, 'lead', song.m.bridge, bi, playLead);
    if (nx && nx.n === 'chorus' && bi === sec.bars - 1) riser(P, sd, 'pad');
    return P;
  },
};

// ------------------------------------------------------------------------------------------ 2: ROCK
STYLES[2] = {
  swing: 0.03, level: 1.0, vibRate: 5.6, vibDepth: 26, delaySteps: 3, delayFb: 0.25, eq: { hp: 60, lp: 8200, mid: 2200, midg: 2.0 },
  buses: { drum: [1.024, 0.07, 0], bass: [0.227, 0, 0], gtr: [0.188, 0.1, 0], gtrL: [0.181, 0.22, 0.18] },
  setup(M) { M.ampR = makeAmp(M, M.bus.gtr, 8, 3300); M.ampL = makeAmp(M, M.bus.gtrL, 6, 3800); },
  ident(M, t) {
    const b = M.identBus, amp = makeAmp(M, b, 8, 3500);
    chordVoice(M, amp, t + 0.08, [52, 59, 64], { a: 0.004, hold: 0.25, d: 0.25, f0: 3500, peak: 0.6 });
    chordVoice(M, amp, t + 0.3, [55, 62, 67], { a: 0.004, hold: 0.15, d: 0.3, f0: 3500, peak: 0.6 });
    KIT.kick(M, b, t + 0.08, 1); KIT.crash(M, b, t + 0.08, 0.6); KIT.snare(M, b, t + 0.3, 0.9, { d: 0.22, crack: true });
  },
  makeSong(rng) {
    const pc = pickR(rng, [4, 9, 2, 7, 11, 4, 9]), root = 36 + pc, scale = SCALES.pentMin;
    const pr = [[[0, '5'], [10, '5'], [5, '5'], [0, '5']], [[0, '5'], [0, '5'], [8, '5'], [10, '5']], [[0, '5'], [7, '5'], [8, '5'], [7, '5']], [[0, '5'], [3, '5'], [5, '5'], [7, '5']], [[0, '5'], [5, '5'], [10, '5'], [5, '5']]];
    const A = pickR(rng, pr); const B = pickR(rng, [[[5, '5'], [0, '5'], [7, '5'], [0, '5']], [[8, '5'], [10, '5'], [0, '5'], [0, '5']], [[0, '5'], [10, '5'], [5, '5'], [7, '5']]]);
    const C = pickR(rng, [[[8, '5'], [10, '5'], [0, '5'], [7, '5']], [[0, '5'], [0, '5'], [5, '5'], [7, '5']]]);
    const riff = genMotif(rng, { steps: 32, durs: [1, 2, 2, 2, 3, 4], rest: 0.12, lo: 0, hi: 5, start: 0, endDegs: [0, 0, 3], moves: [-1, -1, 0, 0, 1, 2, 3, -2] });
    const hook = genMotif(rng, { steps: 32, durs: [2, 4, 4, 6, 8], rest: 0.2, lo: 2, hi: 9, start: 4, endDegs: [0, 3] });
    const song = {
      seed: rng() * 1e9 | 0, bpm: 121 + Math.floor(rng() * 6), tonic: root, root, scale, leadBase: root + 24, progs: { A: mkProg(A), B: mkProg(B), C: mkProg(C) }, form: makeForm(rng, Math.floor(rng() * 3)).map((s) => (s.n === 'bridge' ? Object.assign({}, s, { n: 'solo' }) : s)),
      kick: pickR(rng, [[0, 8], [0, 2, 8], [0, 8, 10], [0, 6, 8, 14]]), chug: pickR(rng, [0, 1, 2]), riff, lastLead: null,
    };
    song.m = { hook, alt: varyMotif(rng, hook, 5), hookV: varyMotif(rng, hook, 5), alt2: varyMotif(rng, varyMotif(rng, hook, 5), 5), riffB: varyMotif(rng, riff, 5) };
    song.bars = song.form.reduce((a, s) => a + s.bars, 0); Object.assign(song, makeMeta(2, rng));
    return song;
  },
  plan(M, song, bar, loc) {
    const P = mkPlan(), { sec, bi } = loc, l = sec.l, rng = mulberry32(hashN(song.seed, bar, 13)), prog = song.progs[sec.p], R = song.root, sd = 60 / song.bpm / 4;
    const fill = bi % 4 === 3, ch = sec.n === 'chorus', solo = sec.n === 'solo', nx = nextSec(song, loc);
    const cAt = (s) => chordAt(prog, bi * 16 + s), rootAt = (s) => R + (cAt(s).r > 6 ? cAt(s).r - 12 : cAt(s).r);
    // drums
    if (l >= 1 || sec.n === 'intro') {
      const ks = song.kick;
      if (l >= 1) for (const s of ks) { if (fill && s >= 12) continue; P.add(s, 'drum', (M, b, t) => KIT.kick(M, b, t, s === 0 ? 1 : 0.85, { f0: 120, f1: 50, d: 0.28, click: 0.5 })); }
      if (l >= 1) for (const s of [4, 12]) { if (fill && s === 12) continue; P.add(s, 'drum', (M, b, t) => KIT.snare(M, b, t, 0.95, { f: 190, d: 0.22, hp: 1000, nz: 0.8, bd: 0.13, crack: true })); }
      if (fill && l >= 1) { for (let i = 0; i < 4; i++) P.add(12 + i, 'drum', (M, b, t) => KIT.snare(M, b, t, 0.5 + i * 0.15, { f: 170 - i * 15, d: 0.12, hp: 900 })); }
      for (let s = 0; s < 16; s += 2) { if (fill && s >= 12 && l >= 1) continue; const op = ch && s === 14 ? true : false;
        P.add(s, 'drum', (M, b, t) => (ch && s % 4 === 2 ? KIT.ride(M, b, t, 0.7) : KIT.hat(M, b, t, s % 4 === 0 ? 0.7 : 0.5, op)), true); }
      if (bi === 0 && (sec.n === 'chorus' || sec.n === 'solo' || (sec.n === 'verse' && sec.l === 1))) P.add(0, 'drum', (M, b, t) => KIT.crash(M, b, t, 0.8));
    }
    // bass
    if (l >= 1 || (sec.n === 'intro' && bi >= 4)) for (let s = 0; s < 16; s += 2) {
      const m = rootAt(s) - 12; if (ch && s % 4 === 2 && rng() < 0.5) continue;
      P.add(s, 'bass', (M, b, t) => pickBass(M, b, t, m, 1.8 * M.sd, s % 8 === 0 ? 1 : 0.85));
    }
    // rhythm guitar
    const gch = (M, t, m, dur, mute, v) => chordVoice(M, M.ampR, t, [m, m + 7, m + 12], { a: 0.004, hold: mute ? 0 : dur * 0.85, d: mute ? 0.06 : 0.18, f0: mute ? 1100 : 3400, peak: 0.55 * v, det: [-7, 7], jit: 3 });
    const riffM = (Math.floor(bi / 4) % 2 ? song.m.riffB : song.riff);
    if (sec.n === 'intro' || (sec.n === 'verse') || sec.n === 'outro') {
      if (l === 0 && sec.n === 'intro' && bi < 4) { // intro riff alone-ish
        leadNotes(P, 'gtr', riffM, bi, (M, b, t, n) => gch(M, t, rootAt(n.s) + scaleNote(0, song.scale, n.d), n.l * M.sd, n.l <= 2, 0.9));
      } else if (song.chug === 2 || sec.n === 'verse' && song.chug === 1) {
        leadNotes(P, 'gtr', riffM, bi, (M, b, t, n) => gch(M, t, rootAt(n.s) + scaleNote(0, song.scale, n.d), n.l * M.sd, n.l <= 3, 0.9));
      } else for (let s = 0; s < 16; s += 2) P.add(s, 'gtr', (M, b, t) => gch(M, t, rootAt(s), 2 * M.sd, !(s % 8 === 0), s % 4 === 0 ? 1 : 0.8));
    } else if (ch) {
      const pat = [0, 6, 8, 12, 14]; for (const s of pat) { const dur = s === 0 ? 6 : 2; P.add(s, 'gtr', (M, b, t) => gch(M, t, rootAt(s), dur * M.sd, false, s === 0 ? 1.05 : 0.85)); }
    } else if (solo) {
      for (let s = 0; s < 16; s += 4) P.add(s, 'gtr', (M, b, t) => gch(M, t, rootAt(s), 4 * M.sd, false, 0.8));
    }
    // lead guitar
    const hookPlay = (M, b, t, n) => { const c = cAt(n.s); let m = scaleNote(song.leadBase, song.scale, n.d); if (n.s % 8 === 0) m = nearestChordTone(m, R + c.r + 24, '5');
      guitarLead(M, M.ampL, t, m, n.l * M.sd * 0.97, 0.85, { bend: n.l >= 4 ? 1 : 0 }); };
    if (ch) leadNotes(P, 'gtrL', motifFor(song, sec, bi), bi, hookPlay);
    if (solo) { // generated solo: pentatonic runs + held bent notes
      const base = R + 36, run = rng() < 0.6;
      if (run) { let idx = Math.floor(rng() * 5) + 3, dir = rng() < 0.5 ? 1 : -1;
        for (let s = 0; s < 12; s++) { if (rng() < 0.12) { dir = -dir; } idx = clamp(idx + dir * (rng() < 0.7 ? 1 : 2), 0, 12); const m = scaleNote(base, SCALES.pentMin, idx); const st = s; P.add(st, 'gtrL', (M, b, t) => guitarLead(M, M.ampL, t, m, M.sd * 0.95, 0.8, {})); }
        const fm = scaleNote(base, SCALES.pentMin, pickR(rng, [5, 7, 8, 10])); P.add(12, 'gtrL', (M, b, t) => guitarLead(M, M.ampL, t, fm, 4 * M.sd, 0.9, { bend: 2, bt: 0.12 }));
      } else { const n1 = scaleNote(base, SCALES.pentMin, pickR(rng, [5, 7, 9])), n2 = scaleNote(base, SCALES.pentMin, pickR(rng, [4, 6, 8]));
        P.add(0, 'gtrL', (M, b, t) => guitarLead(M, M.ampL, t, n1, 6 * M.sd, 0.9, { bend: 2, bt: 0.15 })); P.add(8, 'gtrL', (M, b, t) => guitarLead(M, M.ampL, t, n2, 8 * M.sd, 0.9, { bend: 1, bt: 0.1 })); }
    }
    if (nx && nx.n === 'chorus' && bi === sec.bars - 1) P.add(0, 'drum', (M, b, t) => noise(M.B, b, t, { kind: 'pink', ft: 'bandpass', ff: 300, ff2: 5000, ffd: sd * 16, a: sd * 15.5, d: 0.05, peak: 0.25 }));
    return P;
  },
};

// ------------------------------------------------------------------------------------------ 3: FUNK / DISCO
function genFunkBass(rng) {
  const prob = [1, 0.3, 0.3, 0.55, 0.55, 0.3, 0.65, 0.4, 0.7, 0.3, 0.6, 0.5, 0.65, 0.3, 0.55, 0.5], pat = [];
  for (let s = 0; s < 16; s++) {
    if (rng() > prob[s]) continue;
    const down = s % 4 === 0, r = rng();
    let kind = 'n', off = 0;
    if (!down) { if (r < 0.35) kind = 'g'; else if (r < 0.6) { kind = 'p'; off = 12; } else if (r < 0.75) off = pickR(rng, [7, 10, 5]); }
    else if (s > 0 && r < 0.3) off = pickR(rng, [7, 12]);
    pat.push([s, off, kind === 'g' ? 1 : (s % 2 ? 1 : 2), kind]);
  }
  return pat;
}
STYLES[3] = {
  swing: 0.1, level: 1.0, vibRate: 5.5, vibDepth: 12, delaySteps: 3, delayFb: 0.25, eq: { hp: 55, lp: 10500, mid: 1200, midg: 1.0 },
  buses: { drum: [0.922, 0.05, 0], bass: [0.225, 0, 0], stab: [0.881, 0.12, 0], chick: [2.028, 0.04, 0], pad: [0.260, 0.3, 0], lead: [0.420, 0.18, 0.1] },
  ident(M, t) {
    const b = M.identBus;
    [0, 0.17].forEach((at, i) => chordVoice(M, b, t + 0.08 + at, voicing(57 + (i ? 5 : 0), 'm7', 64), { a: 0.004, d: 0.12, f0: 4000, f1: 900, fd: 0.1, peak: 0.25, det: [-6, 6] }));
    funkBass(M, b, t + 0.08, 33, 0.14, 1, 'n'); funkBass(M, b, t + 0.25, 45, 0.1, 1, 'p'); funkBass(M, b, t + 0.36, 38, 0.2, 1, 'n');
    KIT.hat(M, b, t + 0.08, 0.6, true); KIT.clap(M, b, t + 0.36, 0.7);
  },
  makeSong(rng) {
    const pc = pickR(rng, [0, 2, 4, 5, 7, 9, 10]), tonic = 36 + pc;
    const pr = [[[0, 'm7'], [5, '7']], [[0, 'm7'], [5, '7'], [10, 'M7'], [3, 'M7']], [[0, 'm9', 32], [7, 'm7', 16], [5, '7', 16]], [[0, 'm7'], [8, 'M7'], [3, 'M7'], [7, '7']], [[0, 'm7', 8], [5, '7', 8], [0, 'm7', 8], [7, '7', 8]]];
    let A = pickR(rng, pr), B = pickR(rng, pr); if (A === B) B = pr[(pr.indexOf(A) + 1) % pr.length];
    const C = pickR(rng, [[[5, '7'], [5, '7'], [0, 'm7'], [0, 'm7']], [[8, 'M7'], [7, '7'], [0, 'm7'], [0, 'm7']]]);
    const scale = pickR(rng, [SCALES.dorian, SCALES.dorian, SCALES.minor]);
    const hook = genMotif(rng, { steps: 32, durs: [1, 2, 2, 3, 4], rest: 0.22, lo: 2, hi: 9, start: 4, endDegs: [0, 4], moves: [-2, -1, 0, 0, 1, 2, 3, -3], syncStart: 0.4 });
    const bassA = genFunkBass(rng);
    const song = {
      seed: rng() * 1e9 | 0, bpm: 109 + Math.floor(rng() * 6), tonic, scale, leadBase: tonic + 24, progs: { A: mkProg(A), B: mkProg(B), C: mkProg(C) }, form: makeForm(rng, Math.floor(rng() * 3)),
      kickFunk: pickR(rng, [[0, 3, 6, 10], [0, 5, 8, 11], [0, 6, 8, 14], [0, 3, 10, 14]]), bassA, bassB: genFunkBass(rng), stabs: pickR(rng, [[3, 6, 10, 11], [2, 5, 8, 11, 14], [0, 3, 6, 10], [3, 7, 10, 14]]), lastLead: null,
    };
    song.m = { hook, alt: varyMotif(rng, hook, 7), hookV: varyMotif(rng, hook, 7), alt2: varyMotif(rng, varyMotif(rng, hook, 7), 7), bridge: genMotif(rng, { steps: 32, durs: [2, 4, 6], rest: 0.3, lo: 1, hi: 8, start: 3 }) };
    song.bars = song.form.reduce((a, s) => a + s.bars, 0); Object.assign(song, makeMeta(3, rng));
    return song;
  },
  plan(M, song, bar, loc) {
    const P = mkPlan(), { sec, bi } = loc, l = sec.l, rng = mulberry32(hashN(song.seed, bar, 17)), prog = song.progs[sec.p], T = song.tonic, sd = 60 / song.bpm / 4;
    const fill = bi % 4 === 3, ch = sec.n === 'chorus', br = sec.n === 'bridge', nx = nextSec(song, loc);
    // drums
    if (l >= 1) {
      const ks = (ch || (l === 2 && bi % 2 === 1)) ? [0, 4, 8, 12] : song.kickFunk;
      if (!br || bi % 2 === 0) for (const s of ks) { if (fill && s >= 13) continue; P.add(s, 'drum', (M, b, t) => KIT.kick(M, b, t, s === 0 ? 1 : 0.85, { f0: 125, f1: 50, d: 0.25 })); }
      if (!br) for (const s of [4, 12]) P.add(s, 'drum', (M, b, t) => { KIT.snare(M, b, t, 0.8, { f: 200, d: 0.15, hp: 1400, nz: 0.6 }); KIT.clap(M, b, t, 0.75); });
      if (l >= 2 && !br) for (const s of [7, 9, 15]) if (rng() < 0.55) P.add(s, 'drum', (M, b, t) => KIT.snare(M, b, t, 0.2, { d: 0.05 }));
      if (fill) for (let i = 0; i < 4; i++) P.add(12 + i, 'drum', (M, b, t) => KIT.snare(M, b, t, 0.4 + i * 0.15, { d: 0.09, hp: 1300 }));
    }
    for (let s = 0; s < 16; s++) {
      if (fill && s >= 12 && l >= 1) continue;
      const off = s % 4 === 2; if (l === 0 && s % 2) continue;
      if (off && l >= 2) P.add(s, 'drum', (M, b, t) => KIT.hat(M, b, t, 0.65, true), true);
      else P.add(s, 'drum', (M, b, t) => KIT.hat(M, b, t, s % 2 ? 0.22 : 0.42, false), true);
    }
    // bass
    if (l >= 1 || (sec.n === 'intro' && bi >= 2)) {
      const pat = l === 0 ? [[0, 0, 3, 'n'], [6, 0, 2, 'n'], [10, 7, 2, 'n']] : (bi % 4 === 3 ? song.bassB : song.bassA);
      for (const [s, off, len, kind] of pat) {
        const c = chordAt(prog, bi * 16 + s), r = T + (c.r > 6 ? c.r - 12 : c.r) + 12, m = r + off;
        P.add(s, 'bass', (M, b, t) => funkBass(M, b, t, m, len * M.sd * 0.9, kind === 'g' ? 0.9 : 1, kind));
      }
    }
    // guitar chick + stabs + pad
    if (l >= 1) for (let s = 0; s < 16; s++) {
      if (rng() < 0.22) continue; const c = chordAt(prog, bi * 16 + s), a = s % 4 === 2 ? 1 : 0.5;
      P.add(s, 'chick', (M, b, t) => { noise(M.B, b, t, { ft: 'bandpass', ff: 1900, q: 2, a: 0.001, d: 0.03, peak: 0.5 * a });
        tone(M.B, b, t, { type: 'square', f: mtof(T + 48 + c.r + 7), a: 0.001, d: 0.03, peak: 0.1 * a, ft: 'bandpass', ff: 1900, q: 2 }); }, true);
    }
    if (l >= 2 || ch) for (const s of song.stabs) {
      if (br) break; const c = chordAt(prog, bi * 16 + s), notes = voicing(T + 24 + c.r, c.t, 64);
      P.add(s, 'stab', (M, b, t) => chordVoice(M, b, t, notes, { a: 0.004, d: 0.1, f0: 4200, f1: 900, fd: 0.09, peak: 0.26, det: [-6, 6] }));
    }
    if (ch || br || l >= 2) { const c = chordAt(prog, bi * 16), notes = voicing(T + 24 + c.r, c.t, 62, 4), dur = 16 * sd;
      P.add(0, 'pad', (M, b, t) => chordVoice(M, b, t, notes, { a: 0.3, hold: dur - 0.8, d: 0.6, f0: 900, f1: 2600, fd: dur, peak: 0.08 })); }
    // lead (brass-like hook)
    const playLead = (M, b, t, n) => { const c = chordAt(prog, bi * 16 + n.s); let m = scaleNote(song.leadBase, song.scale, n.d); if (n.s % 8 === 0) m = nearestChordTone(m, T + c.r + 36, c.t);
      leadSynth(M, b, t, m, n.l * M.sd * 0.85, 0.85, { type: 'sawtooth', type2: 'sawtooth', det2: 12, q: 1.2, f0: 3000, f1: 1400, glide: 0.03, a: 0.018, r: 0.06, mix2: 0.6 }); };
    if (ch) leadNotes(P, 'lead', motifFor(song, sec, bi), bi, playLead);
    else if (br && Math.floor(bi / 2) % 2 === 1) leadNotes(P, 'lead', song.m.bridge, bi, playLead);
    if (nx && nx.n === 'chorus' && bi === sec.bars - 1) riser(P, sd, 'pad');
    return P;
  },
};

// ------------------------------------------------------------------------------------------ 4: LATIN / SALSA
STYLES[4] = {
  swing: 0.04, level: 1.2, vibRate: 5.2, vibDepth: 10, delaySteps: 3, delayFb: 0.25, eq: { hp: 70, lp: 10000, mid: 3000, midg: 1.5 },
  buses: { drum: [0.556, 0.05, 0], perc: [1.046, 0.08, 0], bass: [0.123, 0, 0], keys: [0.773, 0.16, 0.08], mar: [0.673, 0.2, 0.14], horn: [1.008, 0.2, 0.08] },
  ident(M, t) {
    const b = M.identBus;
    [0, 3, 7, 10, 12].forEach((x, i) => marimba(M, b, t + 0.08 + i * 0.075, 69 + x, 1));
    KIT.conga(M, b, t + 0.08, 0.8, 'open', 240); KIT.cowbell(M, b, t + 0.3, 0.8); KIT.cowbell(M, b, t + 0.45, 0.6);
    chordVoice(M, b, t + 0.46, [57, 60, 64], { a: 0.01, d: 0.25, f0: 900, f1: 3000, fd: 0.15, peak: 0.25, det: [-6, 6] });
  },
  makeSong(rng) {
    const pc = pickR(rng, [0, 2, 4, 5, 7, 9, 11]), tonic = 36 + pc, minor = rng() < 0.7;
    const pm = [[[0, 'm7'], [5, 'm7'], [7, '7'], [0, 'm7']], [[0, 'm'], [8, 'M'], [10, 'M'], [7, '7']], [[0, 'm7'], [7, '7'], [0, 'm7'], [7, '7']], [[0, 'm'], [5, 'm'], [7, '7'], [0, 'm']], [[0, 'm7', 8], [5, 'm7', 8], [7, '7', 8], [0, 'm7', 8]]];
    const pM = [[[0, 'M7'], [5, 'M'], [7, '7'], [0, 'M']], [[0, 'M'], [9, 'm'], [5, 'M'], [7, '7']], [[0, 'M'], [5, 'M'], [7, '7'], [7, '7']]];
    const pool = minor ? pm : pM; let A = pickR(rng, pool), B = pickR(rng, pool); if (A === B) B = pool[(pool.indexOf(A) + 1) % pool.length];
    const C = minor ? [[5, 'm7'], [10, '7'], [3, 'M7'], [7, '7']] : [[9, 'm'], [2, 'm'], [7, '7'], [0, 'M']];
    const scale = minor ? SCALES.harmMin : SCALES.pentMaj;
    const hook = genMotif(rng, { steps: 32, durs: [1, 1, 2, 2, 3, 4], rest: 0.15, lo: 0, hi: 7, start: 4, endDegs: [0, 2], moves: [-2, -1, -1, 0, 1, 1, 2, 3] });
    const song = {
      seed: rng() * 1e9 | 0, bpm: 97 + Math.floor(rng() * 6), tonic, minor, scale, leadBase: tonic + 24, progs: { A: mkProg(A), B: mkProg(B), C: mkProg(C) }, form: makeForm(rng, Math.floor(rng() * 3)),
      mont: pickR(rng, [[0, 3, 6, 8, 11, 14], [2, 3, 6, 10, 11, 14], [0, 3, 4, 8, 11, 12], [1, 3, 6, 9, 11, 14]]), horn: pickR(rng, [[0, 6, 10], [0, 3, 8], [2, 6, 12]]), lastLead: null,
    };
    song.m = { hook, alt: varyMotif(rng, hook, scale.length), hookV: varyMotif(rng, hook, scale.length), alt2: varyMotif(rng, varyMotif(rng, hook, scale.length), scale.length), verse: genMotif(rng, { steps: 32, durs: [2, 3, 4, 6], rest: 0.35, lo: 0, hi: 7, start: 2 }), bridge: genMotif(rng, { steps: 32, durs: [1, 2, 3], rest: 0.25, lo: 2, hi: 9, start: 4 }) };
    song.bars = song.form.reduce((a, s) => a + s.bars, 0); Object.assign(song, makeMeta(4, rng));
    return song;
  },
  plan(M, song, bar, loc) {
    const P = mkPlan(), { sec, bi } = loc, l = sec.l, rng = mulberry32(hashN(song.seed, bar, 19)), prog = song.progs[sec.p], T = song.tonic, sd = 60 / song.bpm / 4;
    const fill = bi % 4 === 3, ch = sec.n === 'chorus', nx = nextSec(song, loc);
    // percussion
    const clave = bi % 2 === 0 ? [0, 6, 12] : [4, 8];
    if (l >= 1 || sec.n === 'intro') for (const s of clave) P.add(s, 'perc', (M, b, t) => KIT.clave(M, b, t, 0.7));
    const cong = [[0, 'mute', 240, 0.4], [2, 'mute', 330, 0.3], [4, 'open', 330, 0.6], [6, 'open', 240, 0.8], [8, 'slap', 330, 0.7], [10, 'mute', 330, 0.3], [12, 'open', 330, 0.6], [14, 'open', 240, 0.7]];
    if (l >= 1 || bi >= 2) for (const [s, k, f, v] of cong) { if (fill && s >= 12 && l >= 1) continue; if (rng() < 0.08) continue; P.add(s, 'perc', (M, b, t) => KIT.conga(M, b, t, v, k, f), true); }
    if (fill && l >= 1) for (let i = 0; i < 4; i++) P.add(12 + i, 'perc', (M, b, t) => KIT.conga(M, b, t, 0.5 + i * 0.15, i % 2 ? 'slap' : 'open', i % 2 ? 330 : 270));
    if (l >= 1) for (let s = 0; s < 16; s++) P.add(s, 'perc', (M, b, t) => KIT.shaker(M, b, t, s % 4 === 2 ? 0.8 : (s % 2 ? 0.35 : 0.55)), true);
    if (ch || l === 2) for (const s of [0, 4, 8, 12]) if (rng() < 0.8 || s === 0) P.add(s, 'perc', (M, b, t) => KIT.cowbell(M, b, t, s % 8 === 0 ? 0.8 : 0.55));
    if (l >= 2) { P.add(0, 'drum', (M, b, t) => KIT.kick(M, b, t, 0.6, { f0: 100, f1: 48, d: 0.2, click: 0.2 })); P.add(12, 'drum', (M, b, t) => KIT.kick(M, b, t, 0.5, { f0: 100, f1: 48, d: 0.2, click: 0.2 })); }
    if (bi === 0 && ch) P.add(0, 'drum', (M, b, t) => KIT.crash(M, b, t, 0.4));
    // tumbao bass
    if (l >= 1 || (sec.n === 'intro' && bi >= 4)) {
      const steps = [[6, 5], [12, 4]]; if (l >= 2 && bi % 2 === 0) steps.unshift([0, 5]); if (fill) steps.push([14, 2]);
      for (const [s, len] of steps) {
        const c = chordAt(prog, bi * 16 + s), r = T + (c.r > 6 ? c.r - 12 : c.r) + 12, m = (s === 6 && rng() < 0.4) ? r + 7 : (s === 14 ? r + 7 : r);
        P.add(s, 'bass', (M, b, t) => tumbaoBass(M, b, t, m, len * M.sd * 0.9, s === 12 || s === 0 ? 1 : 0.9));
      }
    }
    // montuno piano
    if (l >= 1 || bi >= 2) {
      const steps = l === 0 ? [3, 11] : song.mont; let k = 0;
      for (const s of steps) {
        const c = chordAt(prog, bi * 16 + s), notes = voicing(T + 24 + c.r, c.t, 66), m = notes[(k++ + (bi % 2)) % notes.length];
        P.add(s, 'keys', (M, b, t) => { epiano(M, b, t, m, 0.3, 0.85); epiano(M, b, t, m + 12, 0.25, 0.5); });
      }
    }
    // horns
    if (ch && bi % 2 === 0) for (const s of song.horn) {
      const c = chordAt(prog, bi * 16 + s), notes = voicing(T + 24 + c.r, c.t, 66);
      P.add(s, 'horn', (M, b, t) => chordVoice(M, b, t, notes, { a: 0.02, d: 0.2, f0: 900, f1: 3400, fd: 0.12, peak: 0.22, det: [-6, 6] }));
    }
    // marimba lead
    const playLead = (M, b, t, n) => {
      const c = chordAt(prog, bi * 16 + n.s); let m = scaleNote(song.leadBase, song.scale, n.d); if (n.s % 8 === 0) m = nearestChordTone(m, T + c.r + 36, c.t);
      marimba(M, b, t, m, 0.95); if (n.l >= 4) for (let k = 2; k < n.l; k += 2) marimba(M, b, t + k * M.sd, m, 0.6); // tremolo roll
    };
    if (ch) leadNotes(P, 'mar', motifFor(song, sec, bi), bi, playLead);
    else if (sec.n === 'verse' && l >= 2 && Math.floor(bi / 2) % 2 === 1) leadNotes(P, 'mar', song.m.verse, bi, playLead);
    else if (sec.n === 'bridge' && Math.floor(bi / 2) % 2 === 0) leadNotes(P, 'mar', song.m.bridge, bi, playLead);
    if (nx && nx.n === 'chorus' && bi === sec.bars - 1) riser(P, sd, 'perc');
    return P;
  },
};

// =====================================================================================================
//  GameAudio
// =====================================================================================================
const VOICE_CAP = 32, LIVE_CAP = 40;
function nullHandle() {
  return { setVolume() {}, setPitch() {}, setPos() {}, update() {}, stop() {}, pop() {}, get alive() { return false; } };
}

export class GameAudio {
  constructor() {
    this.ctx = null; this._ready = false; this.B = null;
    this._vol = { master: 0.85, sfx: 1.0, music: 0.7 };
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this._live = new Set(); this._voices = []; this._last = {}; this._beds = {};
    this._amb = { night01: 0, rain01: 0, crowd01: 0, traffic01: 0, wind01: 0, sea01: 0 };
    this._at = { car: 6, bird: 4, siren: 30, horn: 15 };
    this._lastErr = 0;
    this.radio = new Radio(this);
    const self = this;
    const amb = (s) => self.setAmbient(s); amb.setAmbient = amb; amb.set = amb;   // callable + .setAmbient/.set for API flexibility
    this.ambient = amb;
  }
  get ready() { return this._ready; }
  get sfxNames() { return Object.keys(SFX); }
  get loopNames() { return Object.keys(LOOPS); }
  get engineKinds() { return ['car', 'truck', 'bike', 'sport', 'heli']; }
  _warn(e) { const n = Date.now(); if (n - this._lastErr > 2000) { this._lastErr = n; try { console.warn('[audio]', e && e.message ? e.message : e); } catch (_) { /* ignore */ } } }

  // ---- lifecycle ------------------------------------------------------------------------------------
  // init() is safe to call repeatedly. Optional args are for tests: init(existingContext, {raw:true}) skips compressor/clipper.
  init(ctxOverride, opts) {
    try {
      if (this._ready) { this.resume(); return true; }
      opts = opts || {};
      let ctx = ctxOverride;
      if (!ctx) {
        const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
        if (!AC) return false;
        ctx = new AC({ latencyHint: 'interactive' });
      }
      this.ctx = ctx; this._offline = !!ctxOverride;
      const master = ctx.createGain(), sfxBus = ctx.createGain(), musicBus = ctx.createGain(), oneBus = ctx.createGain();
      if (opts.raw) master.connect(ctx.destination);
      else {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
        const clip = ctx.createWaveShaper(); clip.curve = clipCurve();
        master.connect(comp); comp.connect(clip); clip.connect(ctx.destination);
      }
      sfxBus.connect(master); musicBus.connect(master); oneBus.connect(sfxBus);
      // shared reverb (one convolver, two send inputs so sfx/music volume scale their own reverb)
      const conv = ctx.createConvolver(); conv.buffer = makeIR(ctx, 2.3);
      const rvPre = ctx.createBiquadFilter(); rvPre.type = 'highpass'; rvPre.frequency.value = 250;
      const rvLp = ctx.createBiquadFilter(); rvLp.type = 'lowpass'; rvLp.frequency.value = 7000;
      const revSfx = ctx.createGain(), revMus = ctx.createGain(), revRet = ctx.createGain();
      revRet.gain.value = 0.55;
      revSfx.connect(rvPre); revMus.connect(rvPre); rvPre.connect(rvLp); rvLp.connect(conv); conv.connect(revRet); revRet.connect(master);
      const bufs = {};
      const B = { ctx, noise: makeNoiseBuffers(ctx), sfx: sfxBus, music: musicBus, revSfx, revMus,
        buf(n) { return bufs[n] || (bufs[n] = makeSpecialBuffer(ctx, n)); } };
      this.B = B; this.master = master; this.sfxBus = sfxBus; this.musicBus = musicBus; this.oneBus = oneBus; this.revSfx = revSfx; this.revMus = revMus;
      this._ready = true;
      this._applyVolumes();
      this.resume();
      this.radio._onReady();
      return true;
    } catch (e) { this._ready = false; this._warn(e); return false; }
  }
  resume() { try { if (this.ctx && !this._offline && this.ctx.state === 'suspended' && this.ctx.resume) { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); } } catch (e) { /* ignore */ } }
  suspend() { try { if (this.ctx && this.ctx.suspend && !this._offline) this.ctx.suspend(); } catch (e) { /* ignore */ } }
  setVolumes(v) {
    try {
      if (v) for (const k of ['master', 'sfx', 'music']) if (typeof v[k] === 'number' && isFinite(v[k])) this._vol[k] = clamp(v[k], 0, 1);
      this._applyVolumes();
    } catch (e) { this._warn(e); }
  }
  _applyVolumes() {
    if (!this._ready) return;
    const t = this.ctx.currentTime, v = this._vol;
    this.master.gain.setTargetAtTime(v.master * 0.9, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(v.sfx, t, 0.03);
    this.revSfx.gain.setTargetAtTime(v.sfx, t, 0.03);
    this.musicBus.gain.setTargetAtTime(v.music * 0.8, t, 0.03);
    this.revMus.gain.setTargetAtTime(v.music * 0.8, t, 0.03);
  }

  // ---- 3D ------------------------------------------------------------------------------------------------
  _calc(pos, ref, max) {
    const L = this.listener;
    const dx = pos.x - L.x, dy = (pos.y || 0) - (L.y || 0), dz = pos.z - L.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
    if (!isFinite(d)) return { att: 1, pan: 0, fc: 18000, d: 0 };
    let att = d <= ref ? 1 : Math.pow(ref / d, 1.25);
    att *= 1 - smooth(max * 0.55, max, d);
    const rx = -Math.cos(L.yaw), rz = Math.sin(L.yaw);
    const pan = clamp(((dx * rx + dz * rz) / d) * clamp(d / 3, 0, 1) * 0.92, -1, 1);
    const fc = clamp(18000 / (1 + d / (ref * 2.5)), 1200, 18000);
    return { att, pan, fc, d };
  }
  // spatial chain for live (loop/engine) sounds: in -> lowpass -> panner -> sfxBus
  _makeLive(pos, meta, vol) {
    const c = this.ctx, sp = { meta, pos: pos || null, vol: vol, trim: meta.trim || 1, culled: false, dirty: true, last: 0 };
    sp.in = c.createGain(); sp.in.gain.value = 0;
    sp.lp = c.createBiquadFilter(); sp.lp.type = 'lowpass'; sp.lp.frequency.value = 20000; sp.lp.Q.value = 0.5;
    sp.pan = c.createStereoPanner();
    sp.in.connect(sp.lp); sp.lp.connect(sp.pan); sp.pan.connect(this.sfxBus);
    this._applyLive(sp, false); // ramps up from 0 (no start click)
    return sp;
  }
  _applyLive(sp, immediate) {
    const now = this.ctx.currentTime; let att = 1, pan = 0, fc = 20000;
    if (sp.pos) { const r = this._calc(sp.pos, sp.meta.ref, sp.meta.max); att = r.att; pan = r.pan; fc = r.fc; }
    const g = sp.vol * sp.trim * att;
    if (immediate) { sp.in.gain.value = g; sp.pan.pan.value = pan; sp.lp.frequency.value = fc; }
    else {
      sp.in.gain.setTargetAtTime(g, now, 0.05); sp.pan.pan.setTargetAtTime(pan, now, 0.05);
      if (sp.pos) sp.lp.frequency.setTargetAtTime(fc, now, 0.08);
    }
    const inaudible = g < 0.0015;
    if (inaudible && !sp.culled) { try { sp.pan.disconnect(this.sfxBus); } catch (e) { /* ignore */ } sp.culled = true; }
    else if (!inaudible && sp.culled) { try { sp.pan.connect(this.sfxBus); } catch (e) { /* ignore */ } sp.culled = false; }
    sp.dirty = false; sp.last = now;
  }
  _killLive(sp, L) {
    try {
      const now = this.ctx.currentTime;
      sp.in.gain.cancelScheduledValues(now); sp.in.gain.setTargetAtTime(0, now, 0.03);
      L.stop(now + 0.2);
      const d = () => { try { sp.in.disconnect(); sp.lp.disconnect(); sp.pan.disconnect(); } catch (e) { /* ignore */ } };
      if (this._offline) d(); else setTimeout(d, 400);
    } catch (e) { /* ignore */ }
  }

  update(dt, listener) {
    if (!this._ready) return;
    try {
      if (listener) {
        const L = this.listener;
        if (isFinite(listener.x)) L.x = listener.x; if (isFinite(listener.y)) L.y = listener.y || 0; if (isFinite(listener.z)) L.z = listener.z;
        if (isFinite(listener.yaw)) L.yaw = listener.yaw;
      }
      for (const sp of this._live) if (sp.pos) this._applyLive(sp, false);
      dt = clamp(dt || 0, 0, 0.5);
      this._ambTick(dt);
      this.radio._tickUpdate(dt);
    } catch (e) { this._warn(e); }
  }

  // ---- one-shots --------------------------------------------------------------------------------------------
  play(name, o) {
    if (!this._ready) return;
    try {
      const fn = SFX[name]; if (!fn) return;
      const meta = META[name], ctx = this.ctx, now = ctx.currentTime;
      if (!this._offline && ctx.state !== 'running') { this.resume(); return; } // don't queue sounds while the browser keeps audio suspended
      o = o || {};
      const last = this._last[name] === undefined ? -1 : this._last[name];
      if (now - last < 0.012 && !this._offline) return;
      this._last[name] = now;
      const v = this._voices; let w = 0; for (let i = 0; i < v.length; i++) if (v[i] > now) v[w++] = v[i]; v.length = w;
      if (v.length >= VOICE_CAP + 8 || (v.length >= VOICE_CAP && meta.pri < 2)) return;
      const vol = (isFinite(o.volume) ? o.volume : 1) * meta.trim;
      const pitch = o.pitch > 0 ? o.pitch : 1, pos = o.pos || null;
      let att = 1, pan = 0, fc = 20000;
      if (pos) { const r = this._calc(pos, meta.ref, meta.max); att = r.att; pan = r.pan; fc = r.fc; if (att * vol < 0.004) return; }
      const t = now + 0.006 + (o.delay || 0);
      const inG = ctx.createGain(); inG.gain.value = vol * att;
      let node = inG;
      if (pos) {
        if (fc < 17000) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = fc; lp.Q.value = 0.5; node.connect(lp); node = lp; }
        if (Math.abs(pan) > 0.01) { const p = ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); node = p; }
      }
      node.connect(this.oneBus);
      if (meta.rev > 0) { const s = ctx.createGain(); s.gain.value = meta.rev * (pos ? clamp(0.5 + 0.5 * att * 4, 0.5, 1) : 1); inG.connect(s); s.connect(this.revSfx); }
      fn(this.B, inG, t, pitch, o);
      v.push(t + meta.dur + 0.1);
    } catch (e) { this._warn(e); }
  }
  // looped sfx
  loop(name, o) {
    if (!this._ready) return nullHandle();
    try {
      const def = LOOPS[name]; if (!def || this._live.size >= LIVE_CAP) return nullHandle();
      o = o || {};
      const sp = this._makeLive(o.pos, def, (isFinite(o.volume) ? o.volume : 1) * def.vol);
      const L = new LB(this.B), out = L.g(1); out.connect(sp.in);
      def.build(L, out);
      const now0 = this.ctx.currentTime, pitch0 = o.pitch > 0 ? o.pitch : 1;
      if (pitch0 !== 1) for (const [p, b] of L.pit) p.setValueAtTime(b * pitch0, now0);
      this._live.add(sp);
      let dead = false; const self = this, baseVol = def.vol;
      return {
        get alive() { return !dead; },
        setVolume(v) { if (dead) return; sp.vol = clamp(+v || 0, 0, 4) * baseVol; self._applyLive(sp, false); },
        setPitch(p) { if (dead) return; try { const n = self.ctx.currentTime; p = clamp(+p || 1, 0.05, 8); for (const [pr, b] of L.pit) pr.setTargetAtTime(b * p, n, 0.05); } catch (e) { /* ignore */ } },
        setPos(pos) { if (dead) return; sp.pos = pos || null; if (self.ctx.currentTime - sp.last > 0.05) self._applyLive(sp, false); },
        update() {},
        stop() { if (dead) return; dead = true; self._live.delete(sp); self._killLive(sp, L); },
      };
    } catch (e) { this._warn(e); return nullHandle(); }
  }
  // continuous engine model
  engine(kind) {
    if (!this._ready) return nullHandle();
    try {
      if (this._live.size >= LIVE_CAP) return nullHandle();
      kind = ENGINES[kind] || kind === 'heli' ? kind : 'car';
      const meta = { ref: kind === 'heli' ? 45 : 7, max: kind === 'heli' ? 700 : 170, trim: 1 };
      const sp = this._makeLive(null, meta, 1);
      const L = new LB(this.B), out = L.g(1); out.connect(sp.in);
      const eng = buildEngine(L, out, kind);
      let vol = 1, dead = false, prevThr = 0, lastUpd = -1; const self = this;
      const setBase = () => { sp.vol = vol * eng.vol; };
      setBase(); this._applyLive(sp, true); this._live.add(sp);
      eng.upd(0, 0, this.ctx.currentTime);
      const h = {
        get alive() { return !dead; },
        update(rpm01, throttle01, pos) {
          if (dead) return;
          try {
            rpm01 = clamp(+rpm01 || 0, 0, 1.15); throttle01 = clamp(+throttle01 || 0, 0, 1);
            if (pos) sp.pos = pos;
            const now = self.ctx.currentTime;
            if (!sp.culled || now - lastUpd > 0.25) { eng.upd(rpm01, throttle01, now); lastUpd = now; }
            if (eng.pops && prevThr > 0.6 && throttle01 < 0.15 && rpm01 > 0.45 && !sp.culled) {
              const n = 1 + Math.floor(Math.random() * 3);
              for (let i = 0; i < n; i++) self.play('exhaust_pop', { pos: sp.pos, delay: 0.05 + i * rr(0.06, 0.14), volume: 0.6 * vol, pitch: rr(0.8, 1.2) });
            }
            prevThr = throttle01;
          } catch (e) { self._warn(e); }
        },
        setVolume(v) { if (dead) return; vol = clamp(+v || 0, 0, 4); setBase(); self._applyLive(sp, false); },
        setPitch() {},
        setPos(pos) { if (dead) return; sp.pos = pos || null; },
        pop() { if (!dead) self.play('exhaust_pop', { pos: sp.pos, volume: 0.6 * vol }); },
        stop() { if (dead) return; dead = true; self._live.delete(sp); self._killLive(sp, L); },
      };
      return h;
    } catch (e) { this._warn(e); return nullHandle(); }
  }

  // ---- ambience -----------------------------------------------------------------------------------------------
  setAmbient(s) {
    if (!this._ready || !s) return;
    try {
      const a = this._amb;
      for (const k of Object.keys(a)) if (typeof s[k] === 'number' && isFinite(s[k])) a[k] = clamp(s[k], 0, 1);
      const n = a.night01, r = a.rain01;
      this._setBed('crickets', n * (1 - r * 0.85) * (1 - a.traffic01 * 0.4));
      this._setBed('traffic', a.traffic01 * (1 - n * 0.35));
      this._setBed('crowd', a.crowd01 * (1 - n * 0.6) * (1 - r * 0.6));
      this._setBed('wind', a.wind01);
      this._setBed('rain', r);
      this._setBed('sea', a.sea01);
    } catch (e) { this._warn(e); }
  }
  _setBed(name, lvl) {
    const now = this.ctx.currentTime; let bed = this._beds[name];
    const target = lvl * BED_LEVEL[name];
    if (!bed) {
      if (lvl < 0.01) return;
      const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.oneBus);
      const L = new LB(this.B); BEDS[name](L, g);
      bed = this._beds[name] = { g, L, idle: 0 };
    }
    bed.g.gain.setTargetAtTime(target, now, 0.7);
    bed.idle = lvl < 0.01 ? (bed.idle || now) : 0;
  }
  _ambTick(dt) {
    const now = this.ctx.currentTime;
    for (const k of Object.keys(this._beds)) { // free silent beds
      const b = this._beds[k];
      if (b.idle && now - b.idle > 6) { try { b.L.stop(now); b.g.disconnect(); } catch (e) { /* ignore */ } delete this._beds[k]; }
    }
    const a = this._amb, L = this.listener, T = this._at;
    if (a.traffic01 > 0.2 && a.night01 < 0.9 && (T.car -= dt) < 0) {
      T.car = rr(5, 13) / (a.traffic01 + 0.25); this.play('car_pass', { volume: 0.3 + 0.5 * a.traffic01, pitch: rr(0.8, 1.3) });
    }
    if (a.night01 < 0.5 && a.rain01 < 0.3 && a.traffic01 < 0.8 && (T.bird -= dt) < 0) {
      T.bird = rr(3, 10);
      this.play('bird', { pos: { x: L.x + rr(-45, 45), y: L.y + 8, z: L.z + rr(-45, 45) }, volume: 0.8 * (1 - a.night01 * 2), pitch: rr(0.85, 1.2) });
    }
    if (a.traffic01 > 0.4 && (T.horn -= dt) < 0) {
      T.horn = rr(12, 35); const an = rr(0, TAU), d = rr(60, 130);
      this.play('horn', { pos: { x: L.x + Math.cos(an) * d, y: L.y, z: L.z + Math.sin(an) * d }, pitch: rr(0.85, 1.15), volume: 0.7, len: rr(0.15, 0.4) });
    }
    if (a.traffic01 > 0.5 && a.night01 < 0.95 && (T.siren -= dt) < 0) {
      T.siren = rr(30, 80); const an = rr(0, TAU), d = rr(180, 320);
      this.play('siren_short', { pos: { x: L.x + Math.cos(an) * d, y: L.y, z: L.z + Math.sin(an) * d }, volume: 0.7, pitch: rr(0.9, 1.1) });
    }
  }

  stopAll() {
    if (!this._ready) return;
    try {
      const now = this.ctx.currentTime;
      for (const sp of Array.from(this._live)) { try { sp.in.gain.cancelScheduledValues(now); sp.in.gain.setValueAtTime(0, now); } catch (e) { /* ignore */ } }
      this._live.clear();
      for (const k of Object.keys(this._beds)) { try { this._beds[k].L.stop(now); this._beds[k].g.disconnect(); } catch (e) { /* ignore */ } }
      this._beds = {};
      // silence in-flight one-shots by swapping the one-shot bus
      const old = this.oneBus; old.gain.setTargetAtTime(0, now, 0.02);
      const nb = this.ctx.createGain(); nb.connect(this.sfxBus); this.oneBus = nb;
      setTimeout(() => { try { old.disconnect(); } catch (e) { /* ignore */ } }, 300);
      this._voices.length = 0;
      this.radio.set(-1);
    } catch (e) { this._warn(e); }
  }
}
