// Shared math / helper utilities.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = v => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, v) => { const t = saturate((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const sign = v => (v < 0 ? -1 : 1);
export function wrapAngle(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
export function angleDiff(a, b) { return wrapAngle(b - a); } // shortest signed rotation from a to b
export function lerpAngle(a, b, t) { return a + wrapAngle(b - a) * t; }
export function damp(cur, target, lambda, dt) { return lerp(cur, target, 1 - Math.exp(-lambda * dt)); }
export function dampAngle(cur, target, lambda, dt) { return cur + wrapAngle(target - cur) * (1 - Math.exp(-lambda * dt)); }
export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));
export const headingTo = (fx, fz, tx, tz) => Math.atan2(tx - fx, tz - fz); // yaw convention: forward=(sin,cos)
export const fwdX = yaw => Math.sin(yaw);
export const fwdZ = yaw => Math.cos(yaw);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}
export const rnd = Math.random;
export const rrange = (a, b, r = Math.random) => a + (b - a) * r();
export const rint = (a, b, r = Math.random) => Math.floor(a + (b - a + 1) * r());
export const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
export function pickWeighted(items, weightFn, r = Math.random) {
  let tot = 0;
  for (const it of items) tot += weightFn(it);
  let x = r() * tot;
  for (const it of items) { x -= weightFn(it); if (x <= 0) return it; }
  return items[items.length - 1];
}

// smooth value noise 2D
export function makeNoise(seed = 1) {
  const r = mulberry32(seed);
  const P = new Float32Array(256 * 256);
  for (let i = 0; i < P.length; i++) P[i] = r();
  const g = (x, y) => P[((y & 255) << 8) | (x & 255)];
  return function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(g(xi, yi), g(xi + 1, yi), u), lerp(g(xi, yi + 1), g(xi + 1, yi + 1), u), v);
  };
}

// 2D uniform spatial hash of arbitrary items having x,z (point) or explicit bounds.
export class SpatialHash {
  constructor(cell = 16) { this.cell = cell; this.map = new Map(); }
  _k(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  insertBounds(item, minx, minz, maxx, maxz) {
    const c = this.cell;
    const x0 = Math.floor(minx / c), x1 = Math.floor(maxx / c), z0 = Math.floor(minz / c), z1 = Math.floor(maxz / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this._k(ix, iz);
      let b = this.map.get(k);
      if (!b) { b = []; this.map.set(k, b); }
      b.push(item);
    }
  }
  insertPoint(item, x, z) { this.insertBounds(item, x, z, x, z); }
  remove(item, minx, minz, maxx, maxz) {
    const c = this.cell;
    const x0 = Math.floor(minx / c), x1 = Math.floor(maxx / c), z0 = Math.floor(minz / c), z1 = Math.floor(maxz / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const b = this.map.get(this._k(ix, iz));
      if (b) { const i = b.indexOf(item); if (i >= 0) b.splice(i, 1); }
    }
  }
  // collect unique items in bounds into `out` (array), using a stamp to dedupe
  query(minx, minz, maxx, maxz, out = []) {
    const c = this.cell;
    this._stamp = (this._stamp || 0) + 1;
    const st = this._stamp;
    const x0 = Math.floor(minx / c), x1 = Math.floor(maxx / c), z0 = Math.floor(minz / c), z1 = Math.floor(maxz / c);
    out.length = 0;
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const b = this.map.get(this._k(ix, iz));
      if (!b) continue;
      for (let i = 0; i < b.length; i++) {
        const it = b[i];
        if (it._hs === st) continue;
        it._hs = st;
        out.push(it);
      }
    }
    return out;
  }
  queryRadius(x, z, r, out = []) { return this.query(x - r, z - r, x + r, z + r, out); }
}

// Oriented rectangle helpers (2D, xz plane). yaw follows game convention: local +Z forward = (sin,cos).
export function obbContains(o, x, z, margin = 0) {
  const dx = x - o.x, dz = z - o.z;
  const s = Math.sin(o.yaw), c = Math.cos(o.yaw);
  const lx = dx * c - dz * s;   // local x (right axis of rotation): rotation about Y by yaw maps local x -> (cos, -sin)
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= o.hw + margin && Math.abs(lz) <= o.hd + margin;
}
// closest point push-out of circle (x,z,r) from OBB. Returns null or {nx,nz,depth}
export function circleVsObb(o, x, z, r) {
  const dx = x - o.x, dz = z - o.z;
  const s = Math.sin(o.yaw), c = Math.cos(o.yaw);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const cx = clamp(lx, -o.hw, o.hw), cz = clamp(lz, -o.hd, o.hd);
  let ex = lx - cx, ez = lz - cz;
  const d2 = ex * ex + ez * ez;
  if (d2 >= r * r) return null;
  let nlx, nlz, depth;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    nlx = ex / d; nlz = ez / d; depth = r - d;
  } else { // centre inside box: push along smallest penetration axis
    const px = o.hw - Math.abs(lx), pz = o.hd - Math.abs(lz);
    if (px < pz) { nlx = Math.sign(lx) || 1; nlz = 0; depth = px + r; }
    else { nlx = 0; nlz = Math.sign(lz) || 1; depth = pz + r; }
  }
  // local -> world: inverse rotation
  return { nx: nlx * c + nlz * s, nz: -nlx * s + nlz * c, depth };
}
// Segment vs OBB (2D) ray test; returns t in [0,1] or -1.
export function segVsObb(o, ax, az, bx, bz) {
  const s = Math.sin(o.yaw), c = Math.cos(o.yaw);
  const adx = ax - o.x, adz = az - o.z, bdx = bx - o.x, bdz = bz - o.z;
  const alx = adx * c - adz * s, alz = adx * s + adz * c;
  const blx = bdx * c - bdz * s, blz = bdx * s + bdz * c;
  let t0 = 0, t1 = 1;
  const dx = blx - alx, dz = blz - alz;
  for (let i = 0; i < 2; i++) {
    const p = i === 0 ? alx : alz, d = i === 0 ? dx : dz, h = i === 0 ? o.hw : o.hd;
    if (Math.abs(d) < 1e-9) { if (Math.abs(p) > h) return -1; }
    else {
      let ta = (-h - p) / d, tb = (h - p) / d;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return -1;
    }
  }
  return t0;
}
export function obbOverlap(a, b) { // SAT for two OBBs
  const ax = [Math.cos(a.yaw), -Math.sin(a.yaw)], az = [Math.sin(a.yaw), Math.cos(a.yaw)];
  const bx = [Math.cos(b.yaw), -Math.sin(b.yaw)], bz = [Math.sin(b.yaw), Math.cos(b.yaw)];
  const axes = [ax, az, bx, bz];
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const ax_ of axes) {
    const ra = a.hw * Math.abs(ax_[0] * ax[0] + ax_[1] * ax[1]) + a.hd * Math.abs(ax_[0] * az[0] + ax_[1] * az[1]);
    const rb = b.hw * Math.abs(ax_[0] * bx[0] + ax_[1] * bx[1]) + b.hd * Math.abs(ax_[0] * bz[0] + ax_[1] * bz[1]);
    const d = Math.abs(dx * ax_[0] + dz * ax_[1]);
    if (d > ra + rb) return false;
  }
  return true;
}

export function fmtMoney(n) { return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US'); }
export function pad2(n) { return n < 10 ? '0' + n : '' + n; }
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const nextFrame = () => new Promise(r => requestAnimationFrame(r));
