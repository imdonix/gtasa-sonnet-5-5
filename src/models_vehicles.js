// Los Santos Rising - procedural vehicle models (low-poly, PS2-era silhouettes, cleaner).
// Facing +Z, origin on the ground between the axles, driver on the LEFT (+X).
// Each vehicle = a handful of merged meshes (paint / paint2 / detail / glass / lights) + 4 wheel meshes.
import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------------------
export const VEHICLE_DEFS = {
  sedan:     { name: 'Marlin',      length: 4.8,  width: 1.85, height: 1.45, wheelRadius: 0.34, wheelbase: 2.75, track: 1.55, seats: 4, kind: 'car' },
  coupe:     { name: 'Nimbus',      length: 4.4,  width: 1.8,  height: 1.3,  wheelRadius: 0.33, wheelbase: 2.6,  track: 1.52, seats: 2, kind: 'car' },
  muscle:    { name: 'Bandit',      length: 4.9,  width: 1.95, height: 1.3,  wheelRadius: 0.36, wheelbase: 2.85, track: 1.62, seats: 2, kind: 'car' },
  lowrider:  { name: 'Hustler',     length: 5.2,  width: 1.9,  height: 1.4,  wheelRadius: 0.31, wheelbase: 3.15, track: 1.56, seats: 4, kind: 'car' },
  sports:    { name: 'Kestrel',     length: 4.3,  width: 1.9,  height: 1.15, wheelRadius: 0.33, wheelbase: 2.6,  track: 1.62, seats: 2, kind: 'car' },
  hatch:     { name: 'Pixie',       length: 3.8,  width: 1.7,  height: 1.5,  wheelRadius: 0.31, wheelbase: 2.45, track: 1.44, seats: 4, kind: 'car' },
  suv:       { name: 'Canyon',      length: 4.6,  width: 1.95, height: 1.85, wheelRadius: 0.39, wheelbase: 2.8,  track: 1.66, seats: 5, kind: 'car' },
  pickup:    { name: 'Workhorse',   length: 5.2,  width: 1.9,  height: 1.75, wheelRadius: 0.39, wheelbase: 3.1,  track: 1.62, seats: 3, kind: 'car' },
  van:       { name: 'Hauler',      length: 5.2,  width: 2.0,  height: 2.2,  wheelRadius: 0.37, wheelbase: 3.1,  track: 1.7,  seats: 3, kind: 'car' },
  taxi:      { name: 'Yellowjack',  length: 4.8,  width: 1.85, height: 1.45, wheelRadius: 0.34, wheelbase: 2.75, track: 1.55, seats: 4, kind: 'car' },
  police:    { name: 'Patrolman',   length: 4.8,  width: 1.85, height: 1.45, wheelRadius: 0.34, wheelbase: 2.75, track: 1.55, seats: 4, kind: 'car' },
  swatvan:   { name: 'Enforcer',    length: 5.6,  width: 2.1,  height: 2.3,  wheelRadius: 0.40, wheelbase: 3.3,  track: 1.78, seats: 4, kind: 'truck' },
  ambulance: { name: 'Lifeline',    length: 5.6,  width: 2.1,  height: 2.4,  wheelRadius: 0.38, wheelbase: 3.3,  track: 1.76, seats: 3, kind: 'truck' },
  bus:       { name: 'Metro Liner', length: 11,   width: 2.6,  height: 3.1,  wheelRadius: 0.52, wheelbase: 5.6,  track: 2.14, seats: 4, kind: 'bus' },
  truck:     { name: 'Longhaul',    length: 7,    width: 2.4,  height: 3.2,  wheelRadius: 0.50, wheelbase: 4.2,  track: 1.96, seats: 2, kind: 'truck' },
  limo:      { name: 'Stretch',     length: 7.5,  width: 2.0,  height: 1.5,  wheelRadius: 0.33, wheelbase: 4.7,  track: 1.68, seats: 5, kind: 'car' },
  motorbike: { name: 'Sprinter',    length: 2.1,  width: 0.8,  height: 1.2,  wheelRadius: 0.32, wheelbase: 1.38, track: 0,    seats: 2, kind: 'bike' },
  bicycle:   { name: 'Beach Cruiser', length: 1.7, width: 0.6, height: 1.0,  wheelRadius: 0.34, wheelbase: 1.05, track: 0,    seats: 1, kind: 'bicycle' },
  policeheli:{ name: 'Sentinel Air', length: 12,  width: 3,    height: 3.4,  wheelRadius: 0,    wheelbase: 0,    track: 0,    seats: 3, kind: 'heli' },
};
export const VEHICLE_TYPES = Object.keys(VEHICLE_DEFS);

// ---------------------------------------------------------------------------------------------
// Geometry helpers (non-indexed, flat-shaded, vertex-coloured accumulators)
// ---------------------------------------------------------------------------------------------
const colCache = new Map();
const _tc = new THREE.Color();
function C(h) {
  if (Array.isArray(h)) return h;
  let v = colCache.get(h);
  if (!v) { _tc.set(h); v = [_tc.r, _tc.g, _tc.b]; colCache.set(h, v); }
  return v;
}
const mulC = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const WHITE = [1, 1, 1];

class Bucket {
  constructor() { this.p = []; this.n = []; this.c = []; this.ranges = {}; }
  get count() { return this.p.length / 3; }
  _v(p, n, c) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.c.push(c[0], c[1], c[2]); }
  tri(a, b, c, ca, cb, cc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz); if (l < 1e-9) return;
    const n = [nx / l, ny / l, nz / l];
    this._v(a, n, ca); this._v(b, n, cb || ca); this._v(c, n, cc || ca);
  }
  triN(a, b, c, na, nb, nc, col) {
    const g = cross(sub(b, a), sub(c, a));
    if (Math.hypot(g[0], g[1], g[2]) < 1e-10) return;
    if (dot(g, na) < 0) { this._v(a, na, col); this._v(c, nc, col); this._v(b, nb, col); }
    else { this._v(a, na, col); this._v(b, nb, col); this._v(c, nc, col); }
  }
  quad(a, b, c, d, col) {
    if (typeof col[0] === 'number') { this.tri(a, b, c, col); this.tri(a, c, d, col); }
    else { this.tri(a, b, c, col[0], col[1], col[2]); this.tri(a, c, d, col[0], col[2], col[3]); }
  }
  // quad whose normal faces `dir`
  quadF(a, b, c, d, dir, col) {
    const n1 = cross(sub(b, a), sub(c, a)), n2 = cross(sub(c, a), sub(d, a));
    const n = [n1[0] + n2[0], n1[1] + n2[1], n1[2] + n2[2]];
    if (dot(n, dir) < 0) {
      const cc = (typeof col[0] === 'number') ? col : [col[0], col[3], col[2], col[1]];
      this.quad(a, d, c, b, cc);
    } else this.quad(a, b, c, d, col);
  }
  quadO(a, b, c, d, ctr, col) {
    const m = [(a[0] + b[0] + c[0] + d[0]) / 4 - ctr[0], (a[1] + b[1] + c[1] + d[1]) / 4 - ctr[1], (a[2] + b[2] + c[2] + d[2]) / 4 - ctr[2]];
    this.quadF(a, b, c, d, m, col);
  }
  poly(pts, dir, col) {
    for (let i = 1; i < pts.length - 1; i++) {
      const n = cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0]));
      if (dot(n, dir) >= 0) this.tri(pts[0], pts[i], pts[i + 1], col); else this.tri(pts[0], pts[i + 1], pts[i], col);
    }
  }
  // add a THREE geometry transformed by matrix m (smooth normals kept unless flat)
  geo(g, m, col, flat) {
    let gg = g.index ? g.toNonIndexed() : g.clone();
    if (m) gg.applyMatrix4(m);
    if (flat) gg.computeVertexNormals();
    const p = gg.attributes.position, n = gg.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      this.p.push(p.getX(i), p.getY(i), p.getZ(i));
      this.n.push(n.getX(i), n.getY(i), n.getZ(i));
      this.c.push(col[0], col[1], col[2]);
    }
    gg.dispose();
  }
  range(key, fn) { const s = this.count; fn(); const e = this.count; const r = this.ranges[key] || (this.ranges[key] = []); r.push([s, e - s]); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    g.userData.ranges = this.ranges;
    return g;
  }
}

function box(B, cx, cy, cz, sx, sy, sz, col) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  B.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col);         // +z
  B.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col);         // -z
  B.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col);         // +x
  B.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col);         // -x
  B.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], col);         // +y
  B.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col);         // -y
}
// box between two points with rectangular cross-section a x b (a along s = dir x hint, b along t)
function beam(B, p0, p1, a, b, col, hint) {
  const d = sub(p1, p0); const dn = norm(d);
  let h = hint || [0, 1, 0];
  let s = cross(dn, h);
  if (Math.hypot(s[0], s[1], s[2]) < 1e-3) { h = [1, 0, 0]; s = cross(dn, h); }
  s = norm(s); const t = norm(cross(s, dn));
  const c = (p, i, j) => [p[0] + s[0] * a / 2 * i + t[0] * b / 2 * j, p[1] + s[1] * a / 2 * i + t[1] * b / 2 * j, p[2] + s[2] * a / 2 * i + t[2] * b / 2 * j];
  const A0 = [c(p0, -1, -1), c(p0, 1, -1), c(p0, 1, 1), c(p0, -1, 1)];
  const A1 = [c(p1, -1, -1), c(p1, 1, -1), c(p1, 1, 1), c(p1, -1, 1)];
  const ctr = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; B.quadO(A0[i], A0[j], A1[j], A1[i], ctr, col); }
  B.poly(A0, sub(p0, p1), col); B.poly(A1, d, col);
}
// convex plan polygon [(x,z)...] extruded between y0..y1
function extrudePlan(B, pts, y0, y1, col, colTop) {
  const n = pts.length;
  let cx = 0, cz = 0; pts.forEach(p => { cx += p[0] / n; cz += p[1] / n; });
  const ctr = [cx, (y0 + y1) / 2, cz];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    B.quadO([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], ctr, col);
  }
  B.poly(pts.map(p => [p[0], y1, p[1]]), [0, 1, 0], colTop || col);
  B.poly(pts.map(p => [p[0], y0, p[1]]), [0, -1, 0], col);
}
function cyl(B, c, axis, r, len, col, segs = 8, r2, flat) {
  const g = new THREE.CylinderGeometry(r2 === undefined ? r : r2, r, len, segs, 1, false);
  const m = new THREE.Matrix4();
  if (axis === 'x') m.makeRotationZ(Math.PI / 2); else if (axis === 'z') m.makeRotationX(Math.PI / 2);
  m.setPosition(c[0], c[1], c[2]);
  B.geo(g, m, col, flat); g.dispose();
}
function ellipsoid(B, c, rx, ry, rz, col, ws = 8, hs = 6, flat) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const m = new THREE.Matrix4().makeScale(rx, ry, rz); m.setPosition(c[0], c[1], c[2]);
  B.geo(g, m, col, flat); g.dispose();
}
// add a quad on both sides of the car (x mirrored), facing outwards
function mirrorQuad(B, a, b, c, d, col) {
  B.quadF(a, b, c, d, [1, 0, 0], col);
  const m = p => [-p[0], p[1], p[2]];
  B.quadF(m(a), m(b), m(c), m(d), [-1, 0, 0], col);
}
function mirrorBox(B, cx, cy, cz, sx, sy, sz, col) { box(B, cx, cy, cz, sx, sy, sz, col); box(B, -cx, cy, cz, sx, sy, sz, col); }

// revolve a (x, r, colour-of-edge) profile around the X axis with smooth rotational normals
function revolveX(B, prof, segs) {
  for (let i = 0; i < prof.length - 1; i++) {
    const [x0, r0, col] = prof[i], [x1, r1] = prof[i + 1];
    const dx = x1 - x0, dr = r1 - r0, l = Math.hypot(dx, dr); if (l < 1e-7) continue;
    const nx = -dr / l, nr = dx / l;
    for (let j = 0; j < segs; j++) {
      const t0 = j / segs * Math.PI * 2, t1 = (j + 1) / segs * Math.PI * 2;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      const p00 = [x0, r0 * c0, r0 * s0], p01 = [x0, r0 * c1, r0 * s1], p10 = [x1, r1 * c0, r1 * s0], p11 = [x1, r1 * c1, r1 * s1];
      const n0 = [nx, nr * c0, nr * s0], n1 = [nx, nr * c1, nr * s1];
      B.triN(p00, p10, p11, n0, n0, n1, col);
      B.triN(p00, p11, p01, n0, n1, n1, col);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------------------------
const K = {
  blk: C(0x141518), dgrey: C(0x2b2d33), grey: C(0x55585f), chrome: C(0xcfd5dd), chromeD: C(0x8e959e),
  rubber: C(0x1a1a1c), side: C(0x28282c), interior: C(0x2c2e33), seat: C(0x4b4338), seatLight: C(0x8a7c68),
  plate: C(0xe9e7da), plateBlue: C(0x2b4d9b), gold: C(0xd6ad3a), red: C(0xc8201a), white: C(0xf2f2ee),
};

// ---------------------------------------------------------------------------------------------
// Wheels
// ---------------------------------------------------------------------------------------------
const wheelGeoCache = new Map();
function wheelGeometry(r, w, style) {
  const key = `${r.toFixed(3)}_${w.toFixed(3)}_${style}`;
  let g = wheelGeoCache.get(key); if (g) return g;
  const B = new Bucket(); const segs = r > 0.45 ? 18 : 14;
  const rr = r * (style === 'steel' ? 0.62 : style === 'wire' ? 0.7 : 0.66);
  const white = style === 'wire';
  const sc = white ? C(0xe9e6da) : K.side, dk = K.rubber, tr = C(0x111113);
  const hw = w / 2, sh = Math.min(0.07, (r - rr) * 0.6);
  revolveX(B, [
    [-hw + 0.02, rr, sc], [-hw, r - sh, dk], [-hw + 0.035, r - 0.012, dk], [-hw + 0.07, r, tr],
    [hw - 0.07, r, tr], [hw - 0.035, r - 0.012, dk], [hw, r - sh, dk], [hw - 0.02, rr, white ? sc : K.side],
  ], segs);
  // white wall lives on edge 6 (outer) - redo colour for edge 6 only
  const dish = style === 'spoke' ? C(0x1e1f23) : style === 'steel' ? C(0x9a9ea5) : style === 'wire' ? C(0xbdc3cc) : C(0xb4bac3);
  const lip = style === 'steel' ? C(0xc3c7cd) : K.chrome;
  const xf = hw - 0.025;
  // rim lip + dished face (facing +x)
  revolveX(B, [[xf + 0.004, rr + 0.012, lip], [xf - 0.004, rr * 0.96, lip], [xf - 0.03, rr * 0.80, dish], [xf - 0.03, rr * 0.22, dish]], segs);
  if (style === 'hub') {
    revolveX(B, [[xf - 0.03, rr * 0.62, C(0x7b8189)], [xf - 0.038, rr * 0.55, C(0x7b8189)], [xf - 0.03, rr * 0.48, C(0x7b8189)]], segs);
    revolveX(B, [[xf - 0.03, rr * 0.22, K.chrome], [xf - 0.012, rr * 0.16, K.chrome], [xf - 0.012, 0, K.chrome]], segs);
  } else if (style === 'spoke') {
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 + 0.3;
      beam(B, [xf - 0.022, 0.05 * Math.cos(a), 0.05 * Math.sin(a)], [xf - 0.022, rr * 0.93 * Math.cos(a), rr * 0.93 * Math.sin(a)], 0.085, 0.03, K.chrome, [1, 0, 0]);
    }
    revolveX(B, [[xf - 0.03, rr * 0.2, K.chrome], [xf - 0.01, rr * 0.14, K.chrome], [xf - 0.01, 0, K.chrome]], segs);
  } else if (style === 'wire') {
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2, a2 = a + (i % 2 ? 0.55 : -0.55);
      beam(B, [xf - 0.03, 0.07 * Math.cos(a2), 0.07 * Math.sin(a2)], [xf - 0.02, rr * 0.96 * Math.cos(a), rr * 0.96 * Math.sin(a)], 0.014, 0.014, K.chrome, [1, 0, 0]);
    }
    revolveX(B, [[xf - 0.03, rr * 0.16, C(0xd8b848)], [xf - 0.005, rr * 0.12, C(0xd8b848)], [xf - 0.005, 0, C(0xd8b848)]], segs);
  } else if (style === 'steel') {
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      box(B, xf - 0.022, 0.3 * rr * Math.cos(a), 0.3 * rr * Math.sin(a), 0.03, 0.035, 0.035, C(0x5a5e66));
    }
    revolveX(B, [[xf - 0.03, rr * 0.16, C(0x6a6e76)], [xf - 0.005, rr * 0.12, C(0x6a6e76)], [xf - 0.005, 0, C(0x6a6e76)]], segs);
  }
  // back plate (facing -x), dark
  revolveX(B, [[-hw + 0.05, 0, C(0x232427)], [-hw + 0.05, rr, C(0x232427)]], segs);
  g = B.build(); wheelGeoCache.set(key, g); return g;
}

// thin spoked wheel for bikes / bicycles
const thinWheelCache = new Map();
function thinWheelGeometry(r, w, spokes, tyreCol, rimCol) {
  const key = `${r}_${w}_${spokes}`;
  let g = thinWheelCache.get(key); if (g) return g;
  const B = new Bucket(); const segs = 20; const hw = w / 2; const rr = r - w * 0.8;
  revolveX(B, [[-hw, rr, tyreCol], [-hw * 0.8, r - w * 0.15, tyreCol], [-hw * 0.3, r, tyreCol], [hw * 0.3, r, tyreCol], [hw * 0.8, r - w * 0.15, tyreCol], [hw, rr, tyreCol]], segs);
  revolveX(B, [[-0.008, rr, rimCol], [-0.008, rr - 0.03, rimCol], [0.008, rr - 0.03, rimCol], [0.008, rr, rimCol]], segs);
  const sp = spokes || 12;
  for (let i = 0; i < sp; i++) {
    const a = i / sp * Math.PI * 2, a2 = a + (i % 2 ? 0.35 : -0.35);
    beam(B, [0, 0.03 * Math.cos(a2), 0.03 * Math.sin(a2)], [0, (rr - 0.02) * Math.cos(a), (rr - 0.02) * Math.sin(a)], 0.006, 0.006, rimCol, [1, 0, 0]);
  }
  cyl(B, [0, 0, 0], 'x', 0.035, 0.05, rimCol, 8);
  g = B.build(); thinWheelCache.set(key, g); return g;
}

// ---------------------------------------------------------------------------------------------
// Lofting: stations along Z with a right-half ring [x,y]... (mirrored to the left)
// ---------------------------------------------------------------------------------------------
function loftQuads(st, rings, segFn) {
  for (let i = 0; i < st.length - 1; i++) {
    const R0 = rings[i], R1 = rings[i + 1], z0 = st[i].z, z1 = st[i + 1].z;
    const m = Math.min(R0.length, R1.length) - 1;
    for (let k = 0; k < m; k++) {
      const s = segFn(k, i); if (!s) continue;
      const a = [R0[k][0], R0[k][1], z0], d = [R0[k + 1][0], R0[k + 1][1], z0], c = [R1[k + 1][0], R1[k + 1][1], z1], b = [R1[k][0], R1[k][1], z1];
      const f = s.col;
      const ca = f(a[1]), cd = f(d[1]), cc = f(c[1]), cb = f(b[1]);
      s.B.quad(a, d, c, b, [ca, cd, cc, cb]);
      s.B.quad([-a[0], a[1], a[2]], [-b[0], b[1], b[2]], [-c[0], c[1], c[2]], [-d[0], d[1], d[2]], [ca, cb, cc, cd]);
    }
  }
}
function loftCap(B, ring, z, dirZ, col) {
  const pts = ring.map(p => [p[0], p[1], z]);
  const mir = ring.slice().reverse().map(p => [-p[0], p[1], z]);
  const all = pts.concat(mir.filter((p, i) => !(Math.abs(p[0]) < 1e-6)));
  B.poly(all, [0, 0, dirZ], col);
}
// probe for querying a loft surface
function makeProbe(st, rings) {
  const find = (z) => {
    for (let i = 0; i < st.length - 1; i++) if (z >= st[i].z - 1e-9 && z <= st[i + 1].z + 1e-9 && st[i + 1].z - st[i].z > 1e-6) return i;
    return z < st[0].z ? 0 : st.length - 2;
  };
  const ringAt = (z) => {
    const i = find(z); const z0 = st[i].z, z1 = st[i + 1].z; const t = clamp((z - z0) / (z1 - z0), 0, 1);
    return rings[i].map((p, k) => [lerp(p[0], rings[i + 1][k][0], t), lerp(p[1], rings[i + 1][k][1], t)]);
  };
  return {
    ringAt,
    sideX(z, y) {
      const R = ringAt(z); let best = R[R.length - 1][0];
      for (let k = 0; k < R.length - 1; k++) {
        const y0 = R[k][1], y1 = R[k + 1][1]; if (Math.abs(y1 - y0) < 1e-6) continue;
        if ((y >= y0 && y <= y1) || (y <= y0 && y >= y1)) { const t = (y - y0) / (y1 - y0); return lerp(R[k][0], R[k + 1][0], t); }
      }
      return best;
    },
    topY(z) { const R = ringAt(z); return R[R.length - 1][1]; },
  };
}

// ---------------------------------------------------------------------------------------------
// Light ranges / colours
// ---------------------------------------------------------------------------------------------
const LIGHT_OFF = {
  head: C(0x7a7d78), tail: C(0x5a0e0e), rev: C(0x8c8c8c), indL: C(0x7a5212), indR: C(0x7a5212),
  sirenR: C(0x6a0c0c), sirenB: C(0x0c1a66), sign: C(0xc8a040), white: C(0xbbbbb0), amber: C(0x7a5212),
};
const LIGHT_ON = {
  head: C(0xfff2c4), tail: C(0xff2418), rev: C(0xffffff), indL: C(0xffa800), indR: C(0xffa800),
  sirenR: C(0xff2020), sirenB: C(0x2a52ff), sign: C(0xfff0a0), white: C(0xffffff), amber: C(0xffa800),
};

// ---------------------------------------------------------------------------------------------
// Generic car builder
// ---------------------------------------------------------------------------------------------
function buildLowerStations(S) {
  const Z = u => (u - 0.5) * S.L;
  const key = S.lower.map((k, i) => ({ z: Z(k[0]), top: k[1], ws: k[2], bot: k[3], o: 0.5 + i * 1e-3 }));
  const interp = (z, f) => {
    if (z <= key[0].z) return key[0][f];
    for (let i = 0; i < key.length - 1; i++) {
      if (z >= key[i].z && z <= key[i + 1].z) { const d = key[i + 1].z - key[i].z; if (d < 1e-6) continue; return lerp(key[i][f], key[i + 1][f], (z - key[i].z) / d); }
    }
    return key[key.length - 1][f];
  };
  const list = key.map(k => ({ z: k.z, top: k.top, ws: k.ws, bot: k.bot, o: k.o, arch: null }));
  const extraArch = [];
  const archR = S.wr + (S.archGap ?? 0.07);
  for (const zc of [S.wb / 2, -S.wb / 2]) {
    const yc = S.wr; const N = 10; const rear = zc < 0;
    const zA = zc - archR, zB = zc + archR;
    const seq = [];
    seq.push({ z: zA, arch: null, o: rear ? 0 : 1 });
    seq.push({ z: zA, arch: yc, o: rear ? 1 : 0 });
    for (let i = 1; i < N; i++) { const a = Math.PI - i / N * Math.PI; seq.push({ z: zc + archR * Math.cos(a), arch: yc + archR * Math.sin(a), o: 0.5 }); }
    seq.push({ z: zB, arch: yc, o: rear ? 1 : 0 });
    seq.push({ z: zB, arch: null, o: rear ? 0 : 1 });
    // fix ordering at edges: entering arch at rear edge (zA): plain then arch; leaving at zB: arch then plain
    seq[0].o = 0; seq[1].o = 1; seq[seq.length - 2].o = 0; seq[seq.length - 1].o = 1;
    for (const s of seq) extraArch.push(s);
  }
  for (const s of extraArch) list.push({ z: s.z, top: interp(s.z, 'top'), ws: interp(s.z, 'ws'), bot: interp(s.z, 'bot'), o: s.o, arch: s.arch });
  // key stations that fall inside a wheel arch must follow the arch as well
  for (const s of list) {
    if (s.arch !== null) continue;
    for (const zc of [S.wb / 2, -S.wb / 2]) { const dz = Math.abs(s.z - zc); if (dz < archR - 1e-4) s.arch = S.wr + Math.sqrt(archR * archR - dz * dz); }
  }
  list.sort((a, b) => (a.z - b.z) || (a.o - b.o));
  for (const s of list) { if (s.arch !== null) s.bot = Math.max(s.arch, s.bot); s.bot = Math.min(s.bot, s.top - 0.12); }
  return list;
}
function lowerRing(S, s) {
  const hw = S.W / 2 * s.ws, top = s.top, bot = s.bot, h = top - bot;
  const c = Math.min(S.shoulder ?? 0.10, h * 0.3), r = Math.min(0.07, h * 0.2);
  const hi = Math.max(0, hw - (S.shoulderIn ?? 0.10));
  return [[0, bot], [Math.max(0, hw - 0.05), bot], [hw, bot + r], [hw, top - c], [hi, top], [0, top + (S.crown ?? 0.012)]];
}

function cabTopAt(cst, z) {
  for (let i = 0; i < cst.length - 1; i++) if (z >= cst[i].z && z <= cst[i + 1].z && cst[i + 1].z - cst[i].z > 1e-6) return lerp(cst[i].y, cst[i + 1].y, (z - cst[i].z) / (cst[i + 1].z - cst[i].z));
  return z < cst[0].z ? cst[0].y : cst[cst.length - 1].y;
}
function mirrorPoly(B, pts, col) {
  B.poly(pts, [1, 0, 0], col);
  B.poly(pts.map(p => [-p[0], p[1], p[2]]).reverse(), [-1, 0, 0], col);
}
function sideStrip(B, probe, zA, zB, y0, y1, off, col, N, S) {
  N = N || Math.max(1, Math.ceil(Math.abs(zB - zA) / 0.25));
  for (let i = 0; i < N; i++) {
    const za = lerp(zA, zB, i / N), zb = lerp(zA, zB, (i + 1) / N);
    if (S) { const R = S.wr + (S.archGap ?? 0.07); let skip = false; for (const zc of [S.wb / 2, -S.wb / 2]) if (y0 < S.wr + R && Math.max(za, zb) > zc - R && Math.min(za, zb) < zc + R) skip = true; if (skip) continue; }
    mirrorQuad(B, [probe.sideX(za, y0) + off, y0, za], [probe.sideX(zb, y0) + off, y0, zb], [probe.sideX(zb, y1) + off, y1, zb], [probe.sideX(za, y1) + off, y1, za], col);
  }
}
function buildCar(S) {
  const L = S.L, W2 = S.W / 2; const Z = u => (u - 0.5) * L;
  const P = new Bucket(), P2 = new Bucket(), D = new Bucket(), G = new Bucket(), Lt = new Bucket();
  const ao = (y) => { const t = clamp((y - S.sill) / 0.45, 0, 1); return mulC(WHITE, 0.74 + 0.26 * t); };
  const ctx = { S, L, W2, Z, P, P2, D, G, Lt };

  // ---- lower body loft
  const st = buildLowerStations(S);
  const rings = st.map(s => lowerRing(S, s));
  const p2z = S.p2Z;
  loftQuads(st, rings, (k, i) => k < 1 ? { B: D, col: () => K.blk } : { B: (p2z !== undefined && st[i].z + st[i + 1].z < 2 * p2z) ? P2 : P, col: ao });
  loftCap(p2z !== undefined ? P2 : P, rings[0], st[0].z, -1, ao(0.6)); loftCap(P, rings[rings.length - 1], st[st.length - 1].z, 1, ao(0.6));
  const probe = makeProbe(st, rings); ctx.probe = probe;
  const zF = st[st.length - 1].z, zR = st[0].z; ctx.zF = zF; ctx.zR = zR;
  const nose = S.lower[S.lower.length - 1], tail = S.lower[0];
  ctx.nose = { top: nose[1], bot: nose[3], hw: W2 * nose[2] }; ctx.tail = { top: tail[1], bot: tail[3], hw: W2 * tail[2] };

  // ---- cabin (glass loft + paint frame)
  const cab = S.cab; const belt = S.belt;
  const cst = cab.pts.map(p => ({ z: Z(p[0]), y: p[1] }));
  const wTat = y => cab.wB - (cab.wB - cab.wT) * clamp((y - belt) / ((cab.roofH ?? cab.pts[1][1]) - belt), 0, 1);
  const crings = cst.map(s => [[cab.wB, belt], [wTat(s.y), s.y], [0, s.y]]);
  loftQuads(cst, crings, () => ({ B: G, col: () => WHITE }));
  const cabCapRing = (ring) => [ring[0], ring[1], ring[2]];
  loftCap(G, cabCapRing(crings[0]), cst[0].z, -1, WHITE); loftCap(G, cabCapRing(crings[crings.length - 1]), cst[cst.length - 1].z, 1, WHITE);
  ctx.cab = { st: cst, wTat, wB: cab.wB };
  const roofStations = cst.filter(s => s.y >= belt + 0.9 * ((cab.roofH ?? cab.pts[1][1]) - belt));
  // roof slab
  if (roofStations.length >= 2 && !S.noRoofSlab) {
    const rs = roofStations.map((s, i) => ({ z: s.z + (i === 0 ? -0.03 : i === roofStations.length - 1 ? 0.03 : 0), y: s.y }));
    const rr = rs.map(s => { const hw = wTat(s.y) + 0.02, y0 = s.y - 0.045; return [[0, y0], [hw + 0.012, y0], [hw + 0.018, y0 + 0.03], [hw - 0.07, y0 + 0.065], [0, y0 + 0.075]]; });
    loftQuads(rs, rr, (k) => ({ B: k === 0 ? D : P, col: () => WHITE }));
    loftCap(P, rr[0], rs[0].z, -1, WHITE); loftCap(P, rr[rr.length - 1], rs[rs.length - 1].z, 1, WHITE);
    ctx.roof = { z0: rs[0].z, z1: rs[rs.length - 1].z, y: roofStations[0].y + 0.03, hw: wTat(roofStations[0].y) };
  }
  // pillars
  const pl = S.pillar ?? 0.06;
  const cFront = cst[cst.length - 1], cFront2 = cst[cst.length - 2], cRear = cst[0], cRear2 = cst[1];
  for (const sx of [1, -1]) {
    // A pillar
    beam(P, [sx * (cab.wB - 0.01), belt - 0.02, cFront.z + 0.02], [sx * (wTat(cFront2.y) + 0.005), cFront2.y + 0.005, cFront2.z], pl, pl, WHITE, [1, 0, 0]);
    // C pillar
    beam(P, [sx * (cab.wB - 0.01), belt - 0.02, cRear.z - 0.02], [sx * (wTat(cRear2.y) + 0.005), cRear2.y + 0.005, cRear2.z], S.cThick ?? 0.09, pl, WHITE, [1, 0, 0]);
    // belt trim
    beam(D, [sx * (cab.wB + 0.004), belt + 0.012, cRear.z + 0.05], [sx * (cab.wB + 0.004), belt + 0.012, cFront.z - 0.05], 0.02, 0.028, K.chromeD, [0, 1, 0]);
    // B pillars
    (S.bz || []).forEach(bu => {
      const z = Z(bu);
      // interpolate cabin roof y at z
      let yT = cFront2.y; for (let i = 0; i < cst.length - 1; i++) if (z >= cst[i].z && z <= cst[i + 1].z && cst[i + 1].z - cst[i].z > 1e-6) { yT = lerp(cst[i].y, cst[i + 1].y, (z - cst[i].z) / (cst[i + 1].z - cst[i].z)); break; }
      beam(D, [sx * (cab.wB + 0.004), belt, z], [sx * (wTat(yT) + 0.004), yT, z], S.bzW ?? 0.085, 0.03, K.blk, [0, 0, 1]);
    });
  }

  // solid rear quarter panel (fastback coupes etc.)
  if (S.quarter) {
    const zq = Z(S.quarter); const pts = [[cab.wB + 0.012, belt, cRear.z]]; const n = 8;
    for (let i = 0; i <= n; i++) { const z = lerp(cRear.z, zq, i / n); const y = cabTopAt(cst, z); pts.push([wTat(y) + 0.012, y - 0.0, z]); }
    pts.push([cab.wB + 0.012, belt, zq]);
    mirrorPoly(P, pts, WHITE);
  }
  // ---- underbody blockers (see-through protection through the wheel arches)
  const ih = S.track / 2 - S.ww / 2 - 0.03;
  {
    const hl = Math.min((L - 0.6) / 2, S.wb / 2 + S.wr + (S.archGap ?? 0.07) + 0.1); let topMin = belt - 0.1;
    for (let i = 0; i <= 14; i++) topMin = Math.min(topMin, probe.topY(lerp(-hl, hl, i / 14)) - 0.07);
    const y0 = S.sill + 0.03; if (topMin > y0 + 0.05) box(D, 0, (y0 + topMin) / 2, 0, ih * 2, topMin - y0, hl * 2, K.blk);
  }

  // ---- bumpers
  const bumperCol = S.bumper === 'chrome' ? K.chrome : WHITE;
  const bumperB = S.bumper === 'chrome' ? D : P;
  const bY0 = S.bumperY0 ?? 0.27, bY1 = S.bumperY1 ?? 0.58;
  const bump = (z0, dir, hw, depth) => {
    const pts = [[-hw, z0], [-hw + 0.04, z0 + dir * depth * 0.5], [-hw + 0.2, z0 + dir * depth], [hw - 0.2, z0 + dir * depth], [hw - 0.04, z0 + dir * depth * 0.5], [hw, z0]];
    extrudePlan(bumperB, pts, bY0 + 0.07, bY1, bumperCol);
    extrudePlan(D, pts.map(p => [p[0] * 0.96, p[1] + dir * 0.01 * (p[1] === z0 ? 0 : 1)]), bY0, bY0 + 0.07, S.bumper === 'chrome' ? K.chromeD : K.blk);
    // chrome / black strip across the bumper
    const zo = z0 + dir * depth;
    box(D, 0, (bY0 + bY1) / 2 + 0.03, zo + dir * 0.004, (hw - 0.22) * 2, 0.035, 0.012, S.bumper === 'chrome' ? K.chromeD : K.dgrey);
  };
  bump(zF - 0.34, 1, W2 * (S.bumperW ?? 0.93), 0.40);
  bump(zR + 0.34, -1, W2 * (S.bumperW ?? 0.93), 0.40);
  ctx.bumpFrontZ = zF + 0.06; ctx.bumpRearZ = zR - 0.06;

  // ---- grille
  if (!S.noGrille) {
    const gw = W2 * (S.grilleW ?? 0.36), gy0 = ctx.nose.bot + 0.04, gy1 = ctx.nose.top - 0.045;
    box(D, 0, (gy0 + gy1) / 2, zF + 0.006, gw * 2, gy1 - gy0, 0.022, K.blk);
    const bars = S.grilleBars ?? 3;
    for (let i = 0; i < bars; i++) box(D, 0, lerp(gy0 + 0.04, gy1 - 0.03, bars === 1 ? 0.5 : i / (bars - 1)), zF + 0.018, gw * 2 - 0.04, 0.018, 0.014, S.grilleChrome === false ? K.grey : K.chrome);
    box(D, 0, (gy0 + gy1) / 2, zF + 0.018, 0.04, 0.05, 0.014, S.badge ?? K.chrome);
  }
  // ---- headlights / indicators
  {
    const hy = ctx.nose.top - (S.headDrop ?? 0.14), hh = S.headH ?? 0.11;
    const hx0 = W2 * (S.headX0 ?? 0.46), hx1 = W2 * (S.headX1 ?? 0.92) - 0.02;
    for (const sx of [1, -1]) {
      if (S.headStyle === 'round') {
        const cx = sx * (hx0 + hx1) / 2, rad = hh * 0.85;
        cyl(D, [cx, hy, zF + 0.004], 'z', rad + 0.025, 0.035, K.chrome, 10);
        Lt.range('head', () => cyl(Lt, [cx, hy, zF + 0.026], 'z', rad, 0.02, LIGHT_OFF.head, 10));
      } else {
        box(D, sx * (hx0 + hx1) / 2, hy, zF + 0.003, hx1 - hx0 + 0.04, hh + 0.04, 0.03, K.blk);
        Lt.range('head', () => box(Lt, sx * (hx0 + hx1) / 2, hy, zF + 0.02, hx1 - hx0, hh, 0.014, LIGHT_OFF.head));
      }
      // indicator (amber), below the headlight, outer
      Lt.range(sx > 0 ? 'indL' : 'indR', () => box(Lt, sx * (hx1 - 0.06), hy - hh / 2 - 0.065, zF + 0.012, 0.17, 0.055, 0.014, LIGHT_OFF.indL));
    }
  }
  // ---- tail lights
  {
    const ty = ctx.tail.top - (S.tailDrop ?? 0.13), th = S.tailH ?? 0.12;
    const tx0 = W2 * (S.tailX0 ?? 0.5), tx1 = W2 * (S.tailX1 ?? 0.94) - 0.02;
    for (const sx of [1, -1]) {
      box(D, sx * (tx0 + tx1) / 2, ty, zR - 0.003, tx1 - tx0 + 0.04, th + 0.04, 0.03, K.blk);
      Lt.range('tail', () => box(Lt, sx * ((tx0 + tx1) / 2 + 0.06), ty, zR - 0.018, tx1 - tx0 - 0.12, th, 0.014, LIGHT_OFF.tail));
      Lt.range('rev', () => box(Lt, sx * (tx0 + 0.06), ty, zR - 0.02, 0.1, th * 0.9, 0.014, LIGHT_OFF.rev));
      Lt.range(sx > 0 ? 'indL' : 'indR', () => box(Lt, sx * (tx1 - 0.085), ty - th / 2 - 0.05, zR - 0.014, 0.15, 0.04, 0.014, LIGHT_OFF.indL));
    }
    // plates
    const py = S.plateY ?? (ctx.tail.top - 0.25);
    box(D, 0, py, zR - 0.006, 0.36, 0.17, 0.012, K.plate);
    box(D, 0, py + 0.065, zR - 0.013, 0.36, 0.03, 0.006, K.plateBlue);
    box(D, 0, py - 0.01, zR - 0.013, 0.26, 0.05, 0.006, C(0x333))
  }
  // front plate
  box(D, 0, (bY0 + bY1) / 2 + 0.03, ctx.bumpFrontZ + 0.006, 0.36, 0.16, 0.01, K.plate);
  box(D, 0, (bY0 + bY1) / 2 + 0.03, ctx.bumpFrontZ + 0.013, 0.26, 0.05, 0.006, C(0x333));
  // exhaust
  (S.exhaust ?? [0.55]).forEach(ex => { cyl(D, [ex, bY0 - 0.01, zR - 0.1], 'z', 0.04, 0.28, K.chrome, 8); cyl(D, [ex, bY0 - 0.01, zR - 0.245], 'z', 0.03, 0.02, K.blk, 8); });

  // ---- mirrors
  if (!S.noMirror) {
    const mz = cFront.z - 0.02, my = belt + 0.09;
    for (const sx of [1, -1]) {
      box(D, sx * (cab.wB + 0.08), my - 0.03, mz, 0.12, 0.022, 0.03, K.blk);
      box(P, sx * (cab.wB + 0.17), my, mz - 0.01, 0.1, 0.1, 0.17, WHITE);
      box(D, sx * (cab.wB + 0.17), my, mz + 0.078, 0.085, 0.085, 0.012, K.chromeD);
    }
  }
  // ---- door seams + handles
  {
    const y0 = S.sill + 0.12, y1 = belt - 0.05;
    const seam = (u) => {
      const z = Z(u); const x0 = probe.sideX(z, y0) + 0.006, x1 = probe.sideX(z, y1) + 0.006;
      mirrorQuad(D, [x0, y0, z - 0.006], [x1, y1, z - 0.006], [x1, y1, z + 0.006], [x0, y0, z + 0.006], K.blk);
    };
    (S.doorU || []).forEach(seam);
    // horizontal seam along sill of the doors
    if (S.doorU && S.doorU.length >= 2) {
      const za = Z(Math.min(...S.doorU)), zb = Z(Math.max(...S.doorU));
      const x0 = probe.sideX(za, y0 + 0.02) + 0.006, x1 = probe.sideX(zb, y0 + 0.02) + 0.006;
      mirrorQuad(D, [x0, y0 + 0.02, za], [x1, y0 + 0.02, zb], [x1, y0 + 0.032, zb], [x0, y0 + 0.032, za], K.blk);
    }
    const hy = belt - 0.17;
    (S.handleU || []).forEach(u => {
      const z = Z(u); const x = probe.sideX(z, hy) + 0.014;
      mirrorBox(D, x, hy, z, 0.028, 0.03, 0.15, S.handleCol ?? K.chrome);
    });
  }
  // ---- flares around wheel arches
  if (S.flares) {
    for (const zc of [S.wb / 2, -S.wb / 2]) {
      const R = S.wr + (S.archGap ?? 0.07) + 0.02; let prev = null;
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI - i / 10 * Math.PI; const y = S.wr + R * Math.sin(a), z = zc + R * Math.cos(a);
        const x = probe.sideX(z, y + 0.05) + 0.01;
        const p = [x, y, z]; if (prev) for (const sx of [1, -1]) beam(D, [sx * prev[0], prev[1], prev[2]], [sx * p[0], p[1], p[2]], 0.055, 0.075, S.flareCol ?? K.blk, [1, 0, 0]);
        prev = p;
      }
    }
  }
  // ---- interior
  // seat hips are lowered (never below the floor pan) until a seated ped's head fits under the roof at that seat; the ped rig
  // (models_peds.js fitSeat) does the rest (recline, leg extension).  Wheel height is taken from the original seat height.
  const hipOff = S.hipOff ?? 0.05, floorY = S.sill + 0.01;
  const seats = S.seats.map(sp => sp.slice());
  const wheelY0 = seats[0][1] + hipOff + 0.29;
  for (const sp of seats) {
    const rAt = z => z >= cst[0].z ? cabTopAt(cst, z) - 0.065 : probe.topY(z) - 0.1;
    const zh = sp[2] - 0.03, roofMin = Math.min(rAt(zh - 0.1), rAt(zh + 0.1), rAt(zh));
    const hip = Math.max(floorY + 0.1, Math.min(sp[1] + hipOff, roofMin - 0.012 - (S.seatedH ?? 0.91)));
    sp[1] = hip - hipOff;
  }
  ctx.seatsAdj = seats;
  {
    const seatCol = S.interiorCol ?? K.seat;
    seats.forEach((sp, i) => {
      box(D, sp[0], sp[1] - 0.12, sp[2], 0.46, 0.14, 0.5, seatCol);
      const top = [sp[0], sp[1] + 0.3, sp[2] - 0.2 - (S.seatRake ?? 0.06)];
      const cabTop = cabTopAt(cst, top[2]);
      const topY = clamp(Math.min(belt + 0.27, cabTop - 0.24), belt + 0.06, belt + 0.3);
      beam(D, [sp[0], sp[1] - 0.06, sp[2] - 0.17], [sp[0], topY, top[2]], 0.46, 0.1, seatCol, [1, 0, 0]);
      if (cabTop - topY > 0.3) box(D, sp[0], topY + 0.06, top[2] - 0.02, 0.3, 0.14, 0.09, seatCol); // headrest
    });
    const d = seats[0];
    const wheelZ = d[2] + (S.wheelDz ?? 0.42), wheelY = S.wheelY ?? wheelY0;
    ctx.wheelC = { x: d[0], y: wheelY, z: wheelZ, r: 0.165, tilt: 0.45 };
    const dz = Math.min(cFront.z - 0.12, Math.max(cFront.z - 0.37, wheelZ + 0.2));
    box(D, 0, belt + 0.03, dz, (cab.wB - 0.06) * 2, 0.12, 0.3, K.interior);
    // steering wheel (plane tilted: top edge away from the driver) + column
    const tg = new THREE.TorusGeometry(0.16, 0.02, 4, 10); const m = new THREE.Matrix4().makeRotationX(0.45); m.setPosition(d[0], wheelY, wheelZ);
    D.geo(tg, m, K.blk, true); tg.dispose();
    cyl(D, [d[0], wheelY - 0.05, wheelZ + 0.11], 'z', 0.025, 0.22, K.blk, 6);
    // dark interior floor just above the belt line (hides the body's top surface under the glass)
    {
      const fz0 = cRear.z + 0.04, fz1 = cFront.z - 0.02, fw = cab.wB - 0.015;
      D.quadF([-fw, belt + 0.004, fz0], [fw, belt + 0.004, fz0], [fw, belt + 0.004, fz1], [-fw, belt + 0.004, fz1], [0, 1, 0], K.interior);
    }
    // far-side inner door panels (only visible from the opposite side)
    const zA = cRear.z + 0.12, zB = cFront.z - 0.12;
    const yA = belt + 0.0, yB = (cab.roofH ?? cab.pts[1][1]) - 0.04;
    G; // (no-op)
    for (const sx of [1, -1]) {
      const x = sx * (wTat((yA + yB) / 2) - 0.07);
      D.quadF([x, yA, zA], [x, yB, zA + 0.1], [x, yB, zB - 0.1], [x, yA, zB], [-sx, 0, 0], K.interior);
    }
  }
  if (S.extra) S.extra(ctx);

  // ---- wheels
  const wheels = [];
  const hxz = S.track / 2;
  [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sz], i) => {
    wheels.push({ pos: [sx * hxz, S.wr, sz * S.wb / 2], radius: S.wr, steer: sz > 0, drive: S.awd ? true : sz < 0, side: sx, ww: sz < 0 && S.wwRear ? S.wwRear : S.ww });
  });

  const geos = { paint: P.build(), paint2: P2.count ? P2.build() : null, detail: D.build(), glass: G.build(), lights: Lt.build() };
  // seat data for the ped rig (see models_peds.js fitSeat): hip pivot height, floor pan height (soles), roof (inner) height lookup, steering wheel
  const seatInfo = { roofAt: z => z >= cst[0].z ? cabTopAt(cst, z) - 0.065 : probe.topY(z) - 0.1, seats: ctx.seatsAdj.map((s, i) => ({ x: s[0], y: s[1], z: s[2], hip: s[1] + hipOff, floor: floorY, wheel: i === 0 ? ctx.wheelC : null })) };
  return { geos, wheels, wheelStyle: S.wheelStyle ?? 'hub', wheelW: S.ww, seats: ctx.seatsAdj.map(s => ({ x: s[0], y: s[1], z: s[2] })), seatInfo, S };
}

// ---------------------------------------------------------------------------------------------
// Type specs (cars)
// ---------------------------------------------------------------------------------------------
const BUILDERS = {};
const CARS = {};
function stdSeats(zF, zR, y, xs = 0.4) { return [[xs, y, zF], [-xs, y, zF], [xs, y, zR], [-xs, y, zR], [0, y, zR]]; }

CARS.sedan = {
  L: 4.8, W: 1.85, H: 1.45, wr: 0.34, wb: 2.75, track: 1.55, ww: 0.22, sill: 0.22, belt: 0.95,
  lower: [[0, .86, .90, .46], [.012, .93, .96, .34], [.05, .955, 1, .24], [.22, .96, 1, .22], [.735, .95, 1, .22], [.85, .90, 1, .22], [.94, .85, 1, .25], [.985, .79, .96, .36], [1, .72, .88, .47]],
  cab: { pts: [[.265, .95], [.345, 1.45], [.60, 1.45], [.735, .95]], wB: .76, wT: .63, roofH: 1.45 },
  bz: [.50], doorU: [.735, .50, .285], handleU: [.565, .345],
  seats: [[0.4, 0.52, 0.2], [-0.4, 0.52, 0.2], [0.4, 0.52, -0.5], [-0.4, 0.52, -0.5]],
  wheelStyle: 'hub',
};
CARS.coupe = {
  L: 4.4, W: 1.8, H: 1.3, wr: 0.33, wb: 2.6, track: 1.5, ww: 0.22, sill: 0.21, belt: 0.86,
  lower: [[0, .78, .9, .42], [.012, .85, .96, .32], [.05, .88, 1, .23], [.30, .88, 1, .21], [.70, .86, 1, .21], [.86, .80, 1, .21], [.95, .76, .98, .24], [.985, .72, .95, .33], [1, .64, .88, .42]],
  cab: { pts: [[.17, .86], [.40, 1.27], [.56, 1.27], [.70, .86]], wB: .74, wT: .60, roofH: 1.27 }, cThick: .18,
  doorU: [.70, .40], handleU: [.44], quarter: 0.29,
  seats: [[0.38, 0.44, 0.0], [-0.38, 0.44, 0.0]],
  wheelStyle: 'spoke', headStyle: 'rect',
};
CARS.muscle = {
  L: 4.9, W: 1.95, H: 1.3, wr: 0.36, wb: 2.85, track: 1.62, ww: 0.27, sill: 0.21, belt: 0.88,
  lower: [[0, .82, .9, .42], [.012, .90, .96, .31], [.05, .93, 1, .22], [.25, .93, 1, .21], [.64, .89, 1, .21], [.80, .91, 1, .21], [.93, .89, 1, .22], [.985, .83, .97, .3], [1, .75, .90, .42]],
  cab: { pts: [[.21, .88], [.33, 1.27], [.50, 1.27], [.63, .88]], wB: .78, wT: .64, roofH: 1.27 }, cThick: .14,
  doorU: [.63, .36], handleU: [.40], quarter: 0.28,
  seats: [[0.4, 0.44, 0.05], [-0.4, 0.44, 0.05]],
  wheelStyle: 'spoke', bumper: 'chrome', flares: false, exhaust: [0.6, -0.6], headStyle: 'round', grilleBars: 2,
  extra(ctx) { addMuscleExtras(ctx); },
};
CARS.lowrider = {
  L: 5.2, W: 1.9, H: 1.4, wr: 0.31, wb: 3.15, track: 1.56, ww: 0.2, sill: 0.14, belt: 0.90, archGap: 0.045,
  lower: [[0, .84, .92, .36], [.012, .89, .97, .27], [.04, .91, 1, .17], [.27, .92, 1, .14], [.70, .91, 1, .14], [.85, .89, 1, .14], [.95, .87, 1, .17], [.988, .84, .97, .26], [1, .77, .91, .36]],
  cab: { pts: [[.265, .90], [.355, 1.40], [.575, 1.40], [.70, .90]], wB: .77, wT: .64, roofH: 1.40 },
  bz: [.50], doorU: [.70, .50, .30], handleU: [.54, .34], bumper: 'chrome', bumperY0: 0.2, bumperY1: 0.5,
  seats: [[0.42, 0.44, 0.2], [-0.42, 0.44, 0.2], [0.42, 0.44, -0.5], [-0.42, 0.44, -0.5]],
  wheelStyle: 'wire', headStyle: 'round', exhaust: [0.5, -0.5], grilleBars: 4, pillar: 0.085, cThick: .14,
  extra(ctx) { addLowriderExtras(ctx); },
};
CARS.sports = {
  L: 4.3, W: 1.9, H: 1.15, wr: 0.33, wb: 2.6, track: 1.62, ww: 0.26, sill: 0.15, belt: 0.78,
  lower: [[0, .72, .9, .40], [.015, .80, .97, .28], [.06, .83, 1, .19], [.26, .84, 1, .17], [.54, .82, 1, .17], [.66, .78, 1, .17], [.80, .68, 1, .17], [.94, .60, 1, .2], [.985, .55, .96, .30], [1, .48, .88, .36]],
  cab: { pts: [[.26, .80], [.40, 1.16], [.54, 1.16], [.67, .78]], wB: .76, wT: .60, roofH: 1.16 }, cThick: .17,
  doorU: [.66, .43], handleU: [.47], quarter: 0.33, bumperY0: 0.2, bumperY1: 0.46, headDrop: 0.1, headH: 0.08, headX0: .42, tailH: 0.09,
  seats: [[0.4, 0.34, 0.0], [-0.4, 0.34, 0.0]],
  wheelStyle: 'spoke', headStyle: 'rect', grilleW: 0.3, grilleBars: 1, exhaust: [0.5, -0.5],
  extra(ctx) { addSportsExtras(ctx); },
};
CARS.hatch = {
  L: 3.8, W: 1.7, H: 1.5, wr: 0.31, wb: 2.45, track: 1.44, ww: 0.2, sill: 0.22, belt: 0.92,
  lower: [[0, .82, .93, .42], [.012, .88, .98, .32], [.04, .92, 1, .23], [.73, .92, 1, .22], [.80, .91, 1, .22], [.90, .86, 1, .22], [.97, .80, .97, .30], [1, .70, .90, .42]],
  cab: { pts: [[.05, .92], [.09, 1.47], [.56, 1.47], [.735, .92]], wB: .70, wT: .59, roofH: 1.47 }, cThick: .1,
  bz: [.44], doorU: [.735, .44, .13], handleU: [.50],
  seats: [[0.36, 0.5, 0.3], [-0.36, 0.5, 0.3], [0.36, 0.5, -0.55], [-0.36, 0.5, -0.55]],
  wheelStyle: 'hub', headStyle: 'rect', bumperY0: 0.25, bumperY1: 0.55, exhaust: [0.45],
};
CARS.suv = {
  L: 4.6, W: 1.95, H: 1.85, wr: 0.39, wb: 2.8, track: 1.66, ww: 0.25, sill: 0.30, belt: 1.15, archGap: 0.09,
  lower: [[0, 1.00, .94, .56], [.012, 1.08, .98, .40], [.04, 1.13, 1, .32], [.735, 1.15, 1, .30], [.80, 1.14, 1, .30], [.90, 1.05, 1, .30], [.97, .99, .98, .36], [1, .92, .92, .50]],
  cab: { pts: [[.05, 1.15], [.09, 1.82], [.60, 1.82], [.75, 1.15]], wB: .80, wT: .70, roofH: 1.82 }, cThick: .1,
  bz: [.46], doorU: [.75, .46, .14], handleU: [.52, .20],
  seats: [[0.42, 0.7, 0.3], [-0.42, 0.7, 0.3], [0.42, 0.7, -0.6], [-0.42, 0.7, -0.6], [0, 0.7, -0.6]],
  wheelStyle: 'spoke', flares: true, awd: true, bumperY0: 0.32, bumperY1: 0.7, headStyle: 'rect', headDrop: 0.17, headH: 0.14, tailDrop: 0.16, tailH: 0.22, tailX0: 0.8, exhaust: [0.6],
  extra(ctx) { addSuvExtras(ctx); },
};
CARS.pickup = {
  L: 5.2, W: 1.9, H: 1.75, wr: 0.39, wb: 3.1, track: 1.62, ww: 0.25, sill: 0.30, belt: 1.12, archGap: 0.09,
  lower: [[0, .94, .94, .50], [.012, .95, .98, .36], [.04, .95, 1, .30], [.335, .95, 1, .30], [.34, 1.12, 1, .30], [.65, 1.12, 1, .30], [.80, 1.08, 1, .30], [.93, 1.0, 1, .30], [.985, .94, .98, .36], [1, .86, .92, .50]],
  cab: { pts: [[.345, 1.12], [.375, 1.72], [.53, 1.72], [.65, 1.12]], wB: .78, wT: .68, roofH: 1.72 }, cThick: .1,
  bz: [.48], doorU: [.65, .48, .355], handleU: [.52],
  seats: [[0.4, 0.66, 0.1], [-0.4, 0.66, 0.1], [0, 0.66, 0.1]],
  wheelStyle: 'steel', flares: true, awd: true, bumperY0: 0.32, bumperY1: 0.66, headStyle: 'rect', headDrop: 0.17, headH: 0.14, tailDrop: 0.05, tailH: 0.2, tailX0: 0.8, exhaust: [0.6], noGrille: false,
  extra(ctx) { addPickupExtras(ctx); },
};
CARS.van = {
  L: 5.2, W: 2.0, H: 2.2, wr: 0.37, wb: 3.1, track: 1.7, ww: 0.23, sill: 0.28, belt: 1.12, archGap: 0.08, shoulder: 0.14, shoulderIn: 0.14,
  lower: [[0, 2.06, .94, .52], [.01, 2.15, .985, .36], [.03, 2.2, 1, .3], [.515, 2.2, 1, .3], [.52, 1.12, 1, .3], [.76, 1.12, 1, .30], [.88, 1.04, 1, .30], [.97, .98, .98, .36], [1, .90, .92, .50]],
  cab: { pts: [[.52, 1.12], [.54, 2.17], [.655, 2.17], [.765, 1.12]], wB: .86, wT: .80, roofH: 2.17 }, cThick: .1,
  doorU: [.765, .60], handleU: [.63],
  seats: [[0.45, 0.78, 0.95], [-0.45, 0.78, 0.95], [0, 0.78, 0.95]],
  wheelStyle: 'steel', bumperY0: 0.3, bumperY1: 0.62, headStyle: 'rect', headDrop: 0.15, headH: 0.13, tailDrop: 0.35, tailH: 0.42, tailX0: 0.86, tailX1: 0.97, exhaust: [0.6],
  extra(ctx) { addVanExtras(ctx); },
};
CARS.taxi = Object.assign({}, CARS.sedan, { extra(ctx) { addTaxiExtras(ctx); }, wheelStyle: 'hub' });
CARS.police = Object.assign({}, CARS.sedan, { extra(ctx) { addPoliceExtras(ctx); }, wheelStyle: 'steel' });
CARS.limo = {
  L: 7.5, W: 2.0, H: 1.5, wr: 0.33, wb: 4.7, track: 1.68, ww: 0.22, sill: 0.21, belt: 0.98,
  lower: [[0, .90, .92, .45], [.008, .96, .97, .33], [.03, .98, 1, .23], [.18, .98, 1, .21], [.83, .97, 1, .21], [.895, .93, 1, .21], [.96, .87, 1, .24], [.99, .82, .96, .33], [1, .75, .9, .45]],
  cab: { pts: [[.19, .98], [.235, 1.46], [.69, 1.46], [.785, .98]], wB: .82, wT: .70, roofH: 1.46 }, cThick: .1,
  bz: [.36, .52, .64], doorU: [.785, .64, .52, .36, .25], handleU: [.60, .48, .32],
  seats: [[0.42, 0.52, 1.6], [-0.42, 0.52, 1.6], [0.42, 0.52, -0.2], [-0.42, 0.52, -0.2], [0, 0.52, -1.7]],
  wheelStyle: 'hub', bumper: 'paint', exhaust: [0.5, -0.5], grilleBars: 4,
  extra(ctx) { addLimoExtras(ctx); },
};
CARS.swatvan = Object.assign({}, CARS.van, {
  L: 5.6, W: 2.1, H: 2.3, wr: 0.40, wb: 3.3, track: 1.78, ww: 0.26,
  lower: [[0, 2.14, .94, .52], [.01, 2.24, .985, .38], [.03, 2.3, 1, .32], [.535, 2.3, 1, .32], [.54, 1.16, 1, .32], [.77, 1.16, 1, .32], [.88, 1.08, 1, .32], [.97, 1.02, .98, .38], [1, .94, .92, .52]],
  cab: { pts: [[.535, 1.16], [.555, 2.27], [.66, 2.27], [.77, 1.16]], wB: .92, wT: .86, roofH: 2.27 },
  belt: 1.16, sill: 0.3, doorU: [.77, .62], handleU: [.65], wheelStyle: 'steel',
  extra(ctx) { addSwatExtras(ctx); },
});
CARS.ambulance = Object.assign({}, CARS.van, {
  L: 5.6, W: 2.1, H: 2.4, wr: 0.38, wb: 3.3, track: 1.76, ww: 0.25,
  lower: [[0, 2.24, .94, .52], [.01, 2.34, .985, .38], [.03, 2.4, 1, .32], [.535, 2.4, 1, .32], [.54, 1.14, 1, .32], [.77, 1.14, 1, .32], [.88, 1.06, 1, .32], [.97, 1.0, .98, .38], [1, .94, .92, .52]],
  cab: { pts: [[.535, 1.14], [.555, 2.37], [.65, 2.37], [.77, 1.14]], wB: .94, wT: .88, roofH: 2.37 },
  belt: 1.14, sill: 0.3, doorU: [.77, .62], handleU: [.65], wheelStyle: 'hub',
  extra(ctx) { addAmbulanceExtras(ctx); },
});
// fix extra-specific data after the Object.assign copies
CARS.swatvan.seats = [[0.47, 0.8, 1.0], [-0.47, 0.8, 1.0], [0.6, 0.8, -0.6], [-0.6, 0.8, -0.6]];
CARS.ambulance.seats = [[0.47, 0.8, 1.0], [-0.47, 0.8, 1.0], [0, 0.8, 1.0]];

// ---------------------------------------------------------------------------------------------
// Car extras
// ---------------------------------------------------------------------------------------------
function topZY(ctx, z) { // body/roof height at z
  const c = ctx.cab.st;
  if (z >= c[0].z && z <= c[c.length - 1].z) {
    for (let i = 0; i < c.length - 1; i++) if (z >= c[i].z && z <= c[i + 1].z && c[i + 1].z - c[i].z > 1e-6) return lerp(c[i].y, c[i + 1].y, (z - c[i].z) / (c[i + 1].z - c[i].z)) + 0.0;
  }
  return ctx.probe.topY(z);
}
function stripe(B, ctx, x0, x1, za, zb, col, lift = 0.008, N = 14) {
  let prev = null;
  for (let i = 0; i <= N; i++) {
    const z = lerp(za, zb, i / N); const y = topZY(ctx, z) + lift;
    const p = [[x0, y, z], [x1, y, z]];
    if (prev) B.quadF(prev[0], prev[1], p[1], p[0], [0, 1, 0], col);
    prev = p;
  }
}
function addMuscleExtras(ctx) {
  const { P, P2, D, S, Z } = ctx;
  const zc = Z(0.66), zs = Z(0.80);
  // hood scoop
  const pts = [[-0.3, zs - 0.45], [-0.3, zs + 0.3], [0.3, zs + 0.3], [0.3, zs - 0.45]];
  const y0 = ctx.probe.topY(zs) - 0.01;
  // wedge scoop
  const a = [-0.3, y0, zs - 0.45], b = [0.3, y0, zs - 0.45], c = [0.3, y0, zs + 0.35], d = [-0.3, y0, zs + 0.35];
  const a2 = [-0.26, y0 + 0.13, zs - 0.35], b2 = [0.26, y0 + 0.13, zs - 0.35], c2 = [0.26, y0 + 0.05, zs + 0.3], d2 = [-0.26, y0 + 0.05, zs + 0.3];
  P.quadF(a2, b2, c2, d2, [0, 1, 0], WHITE);
  P.quadF(a, a2, d2, d, [-1, 0, 0], WHITE); P.quadF(b, b2, c2, c, [1, 0, 0], WHITE);
  D.quadF(a, b, b2, a2, [0, 0, -1], K.blk); D.quadF(d, c, c2, d2, [0, 0, 1], K.blk);
  D.quadF([-0.24, y0 + 0.12, zs + 0.34], [0.24, y0 + 0.12, zs + 0.34], [0.24, y0 + 0.048, zs + 0.34], [-0.24, y0 + 0.048, zs + 0.34], [0, 0, 1], K.blk);
  // racing stripes (paint2)
  const rc = ctx.cab.st;
  for (const [x0, x1] of [[-0.36, -0.14], [0.14, 0.36]]) {
    stripe(P2, ctx, x0, x1, ctx.zF - 0.12, rc[rc.length - 1].z + 0.02, WHITE, 0.008, 12);
    stripe(P2, ctx, x0, x1, rc[1].z - 0.02, rc[2].z + 0.02, WHITE, 0.034, 3);
    stripe(P2, ctx, x0, x1, ctx.zR + 0.05, rc[0].z - 0.02, WHITE, 0.008, 6);
  }
  // rear lip spoiler
  box(P, 0, ctx.tail.top + 0.03, ctx.zR + 0.25, ctx.tail.hw * 1.7, 0.03, 0.22, WHITE);
}
function addLowriderExtras(ctx) {
  const { P, P2, D, S, Z } = ctx;
  // pinstripe down the side
  const z0 = Z(0.04), z1 = Z(0.98); const y = S.belt - 0.26;
  sideStrip(P2, ctx.probe, z0, z1, y, y + 0.035, 0.008, WHITE);
  // chrome strip along the side
  const y2 = S.belt - 0.40;
  sideStrip(D, ctx.probe, z0, z1, y2, y2 + 0.02, 0.008, K.chrome);
  // hood ornament
  cyl(D, [0, ctx.probe.topY(ctx.zF - 0.3) + 0.04, ctx.zF - 0.3], 'y', 0.03, 0.08, K.chrome, 6);
  // antenna
  cyl(D, [-0.7, S.belt + 0.35, ctx.cab.st[0].z - 0.1], 'y', 0.006, 0.7, K.blk, 4);
}
function addSportsExtras(ctx) {
  const { P, P2, D, S } = ctx;
  // rear wing with struts
  const zw = ctx.zR + 0.28, yw = ctx.tail.top + 0.26;
  box(P2, 0, yw, zw, ctx.tail.hw * 2 * 0.92, 0.035, 0.3, WHITE);
  box(P2, ctx.tail.hw * 0.92, yw + 0.05, zw, 0.03, 0.14, 0.3, WHITE); box(P2, -ctx.tail.hw * 0.92, yw + 0.05, zw, 0.03, 0.14, 0.3, WHITE);
  for (const sx of [1, -1]) box(D, sx * 0.42, yw - 0.12, zw + 0.02, 0.05, 0.24, 0.07, K.blk);
  // side intakes
  const z = ctx.cab.st[0].z + 0.25; const y = S.belt - 0.26;
  mirrorQuad(D, [ctx.probe.sideX(z, y) + 0.006, y, z - 0.25], [ctx.probe.sideX(z, y) + 0.006, y, z + 0.25], [ctx.probe.sideX(z, y + 0.16) + 0.006, y + 0.16, z + 0.2], [ctx.probe.sideX(z, y + 0.16) + 0.006, y + 0.16, z - 0.2], K.blk);
  // hood vents + centre stripes
  const rc = ctx.cab.st;
  stripe(P2, ctx, -0.12, 0.12, ctx.zF - 0.1, rc[rc.length - 1].z + 0.02, WHITE, 0.008, 12);
  stripe(P2, ctx, -0.12, 0.12, rc[1].z - 0.02, rc[2].z + 0.02, WHITE, 0.034, 3);
  stripe(P2, ctx, -0.12, 0.12, ctx.zR + 0.05, rc[0].z - 0.02, WHITE, 0.008, 6);
  // front splitter
  box(D, 0, 0.2, ctx.zF + 0.1, ctx.nose.hw * 2 * 0.9, 0.025, 0.12, K.blk);
}
function addSuvExtras(ctx) {
  const { D, S } = ctx; const cst = ctx.cab.st;
  // roof rails
  for (const sx of [1, -1]) beam(D, [sx * (ctx.cab.wTat(cst[1].y) - 0.02), cst[1].y + 0.062, cst[1].z + 0.2], [sx * (ctx.cab.wTat(cst[1].y) - 0.02), cst[1].y + 0.062, cst[2].z - 0.1], 0.04, 0.04, K.chrome, [0, 1, 0]);
  // spare wheel on the back
  cyl(D, [0, 0.9, ctx.zR - 0.15], 'z', 0.36, 0.2, K.blk, 14);
  cyl(D, [0, 0.9, ctx.zR - 0.26], 'z', 0.22, 0.02, K.chromeD, 12);
  // cladding on the lower doors
  const z0 = ctx.Z(0.14), z1 = ctx.Z(0.75), y = S.sill + 0.05;
  mirrorQuad(D, [ctx.probe.sideX(z0, y + 0.22) + 0.004, y + 0.0, z0 + 0.05], [ctx.probe.sideX(z1, y + 0.22) + 0.004, y + 0.0, z1], [ctx.probe.sideX(z1, y + 0.22) + 0.004, y + 0.22, z1], [ctx.probe.sideX(z0, y + 0.22) + 0.004, y + 0.22, z0 + 0.05], K.dgrey);
}
function addPickupExtras(ctx) {
  const { P, D, S, Z } = ctx; const hw = ctx.probe.sideX(Z(0.15), 1.0);
  const z0 = ctx.zR + 0.06, z1 = Z(0.34) - 0.02; const yF = 0.95 + 0.012;
  // bed walls
  const wallH = 0.26;
  for (const sx of [1, -1]) {
    box(P, sx * (hw - 0.05), yF + wallH / 2, (z0 + z1) / 2, 0.1, wallH, z1 - z0, WHITE);
    // wheel-arch bump inside the bed
    box(D, sx * (hw - 0.22), yF + 0.09, -S.wb / 2, 0.22, 0.18, 0.95, K.dgrey);
  }
  box(P, 0, yF + wallH / 2, z1 - 0.04, hw * 2 - 0.1, wallH + 0.04, 0.08, WHITE);
  box(P, 0, yF + wallH / 2 - 0.02, z0 + 0.04, hw * 2 - 0.1, wallH - 0.04, 0.07, WHITE);
  // bed floor liner
  box(D, 0, yF - 0.003, (z0 + z1) / 2, hw * 2 - 0.18, 0.012, z1 - z0 - 0.1, K.dgrey);
  // rear bumper steps
  // roll bar / rack behind cab
  for (const sx of [1, -1]) cyl(D, [sx * 0.75, yF + 0.36, z1 - 0.12], 'y', 0.02, 0.26, K.chrome, 6);
  beam(D, [-0.75, yF + 0.5, z1 - 0.12], [0.75, yF + 0.5, z1 - 0.12], 0.04, 0.04, K.chrome, [0, 1, 0]);
  // bull bar
  for (const sx of [1, -1]) cyl(D, [sx * 0.5, 0.56, ctx.zF + 0.12], 'y', 0.025, 0.42, K.chrome, 6);
  beam(D, [-0.55, 0.72, ctx.zF + 0.12], [0.55, 0.72, ctx.zF + 0.12], 0.04, 0.04, K.chrome, [0, 1, 0]);
}
function addVanExtras(ctx) {
  const { P, D, S, Z, P2 } = ctx;
  // sliding door track + rear doors seam
  const y0 = 0.55, y1 = 1.9;
  const seam = (z) => { const x0 = ctx.probe.sideX(z, y0) + 0.006, x1 = ctx.probe.sideX(z, y1) + 0.006; mirrorQuad(D, [x0, y0, z - 0.007], [x1, y1, z - 0.007], [x1, y1, z + 0.007], [x0, y0, z + 0.007], K.blk); };
  seam(Z(0.30)); seam(Z(0.50));
  // rear door seam
  D.quadF([-0.008, 0.6, ctx.zR - 0.006], [0.008, 0.6, ctx.zR - 0.006], [0.008, 1.95, ctx.zR - 0.006], [-0.008, 1.95, ctx.zR - 0.006], [0, 0, -1], K.blk);
  // rear windows
  for (const sx of [1, -1]) D.quadF([sx * 0.12, 1.3, ctx.zR - 0.007], [sx * 0.78, 1.3, ctx.zR - 0.007], [sx * 0.78, 1.85, ctx.zR - 0.007], [sx * 0.12, 1.85, ctx.zR - 0.007], [0, 0, -1], C(0x1c2836));
  // cargo windows on side (small), roof vent
  box(D, 0, 2.23, Z(0.3), 0.5, 0.05, 0.5, K.dgrey);
  // accent stripe
  const zz0 = ctx.zR + 0.1, zz1 = Z(0.52); const y = 0.85;
  sideStrip(P2, ctx.probe, zz0, zz1, y, y + 0.22, 0.008, WHITE);
}
function addTaxiExtras(ctx) {
  const { P, D, Lt, S, Z, probe } = ctx; const cst = ctx.cab.st;
  const zc = (cst[1].z + cst[2].z) / 2, yR = cst[1].y + 0.03;
  // roof sign
  box(D, 0, yR + 0.09, zc, 0.62, 0.17, 0.2, K.blk);
  Lt.range('sign', () => { box(Lt, 0, yR + 0.09, zc + 0.102, 0.56, 0.12, 0.006, LIGHT_OFF.sign); box(Lt, 0, yR + 0.09, zc - 0.102, 0.56, 0.12, 0.006, LIGHT_OFF.sign); box(Lt, 0.305, yR + 0.09, zc, 0.006, 0.12, 0.17, LIGHT_OFF.sign); box(Lt, -0.305, yR + 0.09, zc, 0.006, 0.12, 0.17, LIGHT_OFF.sign); });
  // "TAXI" letter blocks (dark)
  [-0.2, -0.07, 0.07, 0.2].forEach((x, i) => { for (const dz of [0.106, -0.106]) { box(D, x, yR + 0.09, zc + dz, 0.06, 0.08, 0.004, C(0x2a2208)); box(D, x, yR + 0.09 + (i % 2 ? 0 : 0.02), zc + dz * 1.0005, 0.03, 0.03, 0.005, C(0xf4d878)); } });
  // checker stripe along the side
  const y = S.belt - 0.30, sq = 0.095; const zA = Z(0.105), zB = Z(0.93);
  const n = Math.floor((zB - zA) / sq);
  for (let i = 0; i < n; i++) for (let r = 0; r < 2; r++) {
    const za = zA + i * sq, zb = za + sq, ya = y + r * sq, yb = ya + sq; const col = (i + r) % 2 ? C(0xf4f4ee) : C(0x16161a);
    mirrorQuad(D, [probe.sideX(za, ya) + 0.005, ya, za], [probe.sideX(zb, ya) + 0.005, ya, zb], [probe.sideX(zb, yb) + 0.005, yb, zb], [probe.sideX(za, yb) + 0.005, yb, za], col);
  }
  cyl(D, [0.55, S.belt + 0.3, ctx.cab.st[0].z - 0.1], 'y', 0.006, 0.6, K.blk, 4);
}
function addPoliceExtras(ctx) {
  const { P, P2, D, Lt, S, Z, probe } = ctx; const cst = ctx.cab.st;
  // white doors + black/white panels
  const zA = Z(0.285), zB = Z(0.735); const y0 = S.sill + 0.1, y1 = S.belt - 0.11;
  sideStrip(P2, probe, zA, zB, y0, y1, 0.008, WHITE);
  // trunk lid white stripe + hood black
  stripe(P2, ctx, -0.55, 0.55, ctx.zR + 0.1, Z(0.22), WHITE, 0.006, 4);
  // badge on door
  for (const sx of [1, -1]) { const z = Z(0.6); cyl(D, [sx * (probe.sideX(z, S.belt - 0.3) + 0.012), S.belt - 0.3, z], 'x', 0.07, 0.012, K.gold, 6); }
  // roof lightbar
  const zc = (cst[1].z + cst[2].z) / 2, yR = cst[1].y + 0.03;
  box(D, 0, yR + 0.03, zc, 1.1, 0.05, 0.3, K.blk);
  Lt.range('sirenR', () => { box(Lt, 0.28, yR + 0.1, zc, 0.52, 0.09, 0.26, LIGHT_OFF.sirenR); });
  Lt.range('sirenB', () => { box(Lt, -0.28, yR + 0.1, zc, 0.52, 0.09, 0.26, LIGHT_OFF.sirenB); });
  box(D, 0, yR + 0.1, zc, 0.04, 0.095, 0.27, K.blk);
  box(D, 0.56, yR + 0.1, zc, 0.03, 0.09, 0.27, K.blk); box(D, -0.56, yR + 0.1, zc, 0.03, 0.09, 0.27, K.blk);
  box(D, 0, yR + 0.16, zc, 1.08, 0.02, 0.28, K.chromeD);
  // grille-guard push bar
  for (const sx of [1, -1]) cyl(D, [sx * 0.45, 0.45, ctx.zF + 0.16], 'y', 0.02, 0.3, K.blk, 6);
  beam(D, [-0.5, 0.6, ctx.zF + 0.16], [0.5, 0.6, ctx.zF + 0.16], 0.05, 0.06, K.blk, [0, 1, 0]);
  // spotlight + antenna
  cyl(D, [S.W / 2 * 0.0 + 0.78, S.belt + 0.12, cst[cst.length - 1].z - 0.08], 'z', 0.035, 0.09, K.chrome, 6);
  cyl(D, [-0.55, S.belt + 0.3, cst[0].z - 0.1], 'y', 0.006, 0.6, K.blk, 4);
  ctx.siren = true;
}
function addLimoExtras(ctx) {
  const { P2, D, S, Z, probe } = ctx;
  // chrome side trim + small interior bar lights omitted; antenna
  const z0 = Z(0.04), z1 = Z(0.98); const y2 = S.belt - 0.36;
  mirrorQuad(D, [probe.sideX(z0, y2) + 0.006, y2, z0], [probe.sideX(z1, y2) + 0.006, y2, z1], [probe.sideX(z1, y2) + 0.006, y2 + 0.02, z1], [probe.sideX(z0, y2) + 0.006, y2 + 0.02, z0], K.chrome);
  cyl(D, [0.7, S.belt + 0.3, ctx.cab.st[0].z - 0.1], 'y', 0.006, 0.6, K.blk, 4);
}
function addSwatExtras(ctx) {
  const { P, D, Lt, S, Z, probe } = ctx; const cst = ctx.cab.st;
  // armour plates (dark grey), wheel guards, roof hatch and bar
  const zz0 = ctx.zR + 0.3, zz1 = Z(0.5), y0 = 0.62, y1 = 1.7;
  sideStrip(D, probe, zz0, zz1, y0, y1, 0.012, K.dgrey, 2);
  [1.1, 1.75].forEach(y => sideStrip(D, probe, zz0, zz1, y, y + 0.04, 0.016, K.blk, 2));
  // small armoured windows on cargo
  mirrorQuad(D, [probe.sideX(Z(0.33), 1.45) + 0.02, 1.45, Z(0.30)], [probe.sideX(Z(0.45), 1.45) + 0.02, 1.45, Z(0.45)], [probe.sideX(Z(0.45), 1.7) + 0.02, 1.7, Z(0.45)], [probe.sideX(Z(0.30), 1.7) + 0.02, 1.7, Z(0.30)], C(0x0c1420));
  box(D, 0, 2.36, Z(0.3), 0.7, 0.08, 0.7, K.blk); // roof hatch
  cyl(D, [0, 2.44, Z(0.3)], 'y', 0.1, 0.08, K.dgrey, 8);
  // roof light bar
  const zc = (cst[1].z + cst[2].z) / 2, yR = cst[1].y + 0.03;
  box(D, 0, yR + 0.03, zc, 1.3, 0.05, 0.26, K.blk);
  Lt.range('sirenR', () => box(Lt, 0.33, yR + 0.09, zc, 0.6, 0.08, 0.22, LIGHT_OFF.sirenR));
  Lt.range('sirenB', () => box(Lt, -0.33, yR + 0.09, zc, 0.6, 0.08, 0.22, LIGHT_OFF.sirenB));
  // bull bar
  for (const sx of [1, -1]) cyl(D, [sx * 0.55, 0.52, ctx.zF + 0.16], 'y', 0.03, 0.4, K.blk, 6);
  beam(D, [-0.65, 0.7, ctx.zF + 0.16], [0.65, 0.7, ctx.zF + 0.16], 0.07, 0.08, K.blk, [0, 1, 0]);
  // rear step
  box(D, 0, 0.42, ctx.zR - 0.2, 1.5, 0.05, 0.25, K.grey);
  // rear doors seam
  D.quadF([-0.008, 0.6, ctx.zR - 0.006], [0.008, 0.6, ctx.zR - 0.006], [0.008, 2.1, ctx.zR - 0.006], [-0.008, 2.1, ctx.zR - 0.006], [0, 0, -1], K.grey);
  ctx.siren = true;
}
function addAmbulanceExtras(ctx) {
  const { P, P2, D, Lt, S, Z, probe } = ctx; const cst = ctx.cab.st;
  // red stripe
  const zz0 = ctx.zR + 0.03, zz1 = ctx.zF - 0.3; const y = 0.68;
  sideStrip(P2, probe, zz0, zz1, y, y + 0.26, 0.008, WHITE, 28, S);
  // red cross on cargo side and back
  const zc = Z(0.28), cy = 1.55;
  const crossQ = (B, zc_, cy_, s, sideFn) => {};
  for (const sx of [1, -1]) {
    const x = sx * (probe.sideX(zc, cy) + 0.008);
    const q = (za, zb, ya, yb) => D.quadF([x, ya, za], [x, yb, za], [x, yb, zb], [x, ya, zb], [sx, 0, 0], K.red);
    q(zc - 0.36, zc + 0.36, cy - 0.11, cy + 0.11); q(zc - 0.11, zc + 0.11, cy - 0.36, cy + 0.36);
  }
  // rear: red cross + stripes
  D.quadF([-0.35, 1.45, ctx.zR - 0.006], [0.35, 1.45, ctx.zR - 0.006], [0.35, 1.67, ctx.zR - 0.006], [-0.35, 1.67, ctx.zR - 0.006], [0, 0, -1], K.red);
  D.quadF([-0.11, 1.22, ctx.zR - 0.006], [0.11, 1.22, ctx.zR - 0.006], [0.11, 1.9, ctx.zR - 0.006], [-0.11, 1.9, ctx.zR - 0.006], [0, 0, -1], K.red);
  D.quadF([-0.008, 0.6, ctx.zR - 0.008], [0.008, 0.6, ctx.zR - 0.008], [0.008, 2.15, ctx.zR - 0.008], [-0.008, 2.15, ctx.zR - 0.008], [0, 0, -1], K.grey);
  // roof lightbar (red + blue)
  const zr = Z(0.6), yR = cst[1].y + 0.03;
  box(D, 0, yR + 0.03, zr, 1.4, 0.05, 0.3, K.blk);
  Lt.range('sirenR', () => box(Lt, 0.36, yR + 0.1, zr, 0.64, 0.09, 0.26, LIGHT_OFF.sirenR));
  Lt.range('sirenB', () => box(Lt, -0.36, yR + 0.1, zr, 0.64, 0.09, 0.26, LIGHT_OFF.white));
  // rear lights bar on cargo top
  box(D, 0, 2.43, ctx.zR + 0.12, 1.1, 0.05, 0.2, K.dgrey);
  Lt.range('sirenB', () => { box(Lt, 0.3, 2.475, ctx.zR + 0.12, 0.3, 0.06, 0.16, LIGHT_OFF.sirenB); box(Lt, -0.3, 2.475, ctx.zR + 0.12, 0.3, 0.06, 0.16, LIGHT_OFF.sirenB); });
  // roof vent
  box(D, 0, 2.43, Z(0.35), 0.4, 0.05, 0.4, K.grey);
  ctx.siren = true;
}

// ---------------------------------------------------------------------------------------------
// Bus + box truck (built with the car pipeline)
// ---------------------------------------------------------------------------------------------
CARS.bus = {
  L: 11, W: 2.6, H: 3.1, wr: 0.52, wb: 5.6, track: 2.14, ww: 0.3, wwRear: 0.42, sill: 0.36, belt: 1.3, archGap: 0.08, shoulder: 0.1, shoulderIn: 0.1,
  lower: [[0, 1.12, .94, .62], [.008, 1.24, .985, .46], [.022, 1.3, 1, .4], [.978, 1.3, 1, .4], [.992, 1.24, .985, .46], [1, 1.14, .95, .62]],
  cab: { pts: [[.0115, 1.3], [.0115, 3.0], [.9885, 3.0], [.9885, 1.3]], wB: 1.19, wT: 1.15, roofH: 3.0 }, pillar: 0.1, cThick: 0.12, bzW: 0.12,
  bz: [.11, .205, .3, .395, .49, .585, .68], doorU: [],
  seats: [[0.9, 1.72, 4.5], [-0.9, 1.72, 2.7], [0.9, 1.72, 2.7], [0.9, 1.72, 1.1]],
  wheelStyle: 'steel', noMirror: true, noGrille: true, bumper: 'chrome', bumperY0: 0.3, bumperY1: 0.72, bumperW: 0.96,
  headStyle: 'round', headDrop: 0.3, headH: 0.16, headX0: 0.55, tailDrop: 0.2, tailH: 0.34, tailX0: 0.8, tailX1: 0.98, plateY: 0.95, exhaust: [0.9], flares: true, flareCol: C(0x1a1b1e),
  extra(ctx) { addBusExtras(ctx); },
};
function addBusExtras(ctx) {
  const { P, P2, D, Lt, S, Z, probe } = ctx; const wT = ctx.cab.wTat; const cst = ctx.cab.st;
  const zA = ctx.zR + 0.04, zB = ctx.zF - 0.04;
  const band = (B, y0, y1, col) => mirrorQuad(B, [wT(y0) + 0.008, y0, zA], [wT(y0) + 0.008, y0, zB], [wT(y1) + 0.008, y1, zB], [wT(y1) + 0.008, y1, zA], col);
  band(P, 2.76, 3.0, WHITE); band(P2, 1.3, 1.6, WHITE);
  // stripe along the lower body
  sideStrip(P2, probe, zA, zB, 0.74, 1.1, 0.008, WHITE, 40, S);
  // route sign (front + back) + roof AC units
  const zf = cst[cst.length - 1].z, zr = cst[0].z;
  box(D, 0, 2.86, zf + 0.02, 2.0, 0.3, 0.05, K.blk);
  Lt.range('sign', () => box(Lt, 0, 2.86, zf + 0.052, 1.85, 0.2, 0.012, LIGHT_OFF.sign));
  [-0.8, -0.3, 0.3, 0.8].forEach(x => box(D, x, 2.86, zf + 0.06, 0.08, 0.12, 0.006, C(0x2a2208)));
  box(D, 0, 2.86, zr - 0.02, 0.9, 0.22, 0.05, K.blk);
  Lt.range('sign', () => box(Lt, 0, 2.86, zr - 0.052, 0.8, 0.12, 0.012, LIGHT_OFF.sign));
  box(D, 0, 3.17, -1.9, 1.7, 0.22, 2.3, C(0xdcdcd6)); box(D, 0, 3.17, 1.6, 1.7, 0.22, 2.3, C(0xdcdcd6));
  // windscreen centre divider
  beam(D, [0, 1.35, zf + 0.004], [0, 2.7, zf + 0.004], 0.06, 0.03, K.blk, [0, 0, 1]);
  // door on the right (-X) side: leaves with dark glass + seams
  const d0 = Z(0.78), d1 = Z(0.835), d2 = Z(0.89);
  const xs = (z, y) => -(y < 1.3 ? probe.sideX(z, y) : wT(y)) - 0.012;
  [d0, d1, d2].forEach(z => beam(D, [xs(z, 0.5), 0.5, z], [xs(z, 2.74), 2.74, z], 0.035, 0.03, K.blk, [0, 0, 1]));
  [[d0, d1], [d1, d2]].forEach(([za, zb]) => D.quadF([xs(za, 0.62), 0.62, za + 0.03], [xs(zb, 0.62), 0.62, zb - 0.03], [xs(zb, 1.25), 1.25, zb - 0.03], [xs(za, 1.25), 1.25, za + 0.03], [-1, 0, 0], C(0x1f2e40)));
  // solid rear engine panel + dash panel under the windscreen (paint)
  {
    const yb = 1.3, yt = 2.3;
    P.quadF([-(wT(yb) + 0.004), yb, zr - 0.006], [wT(yb) + 0.004, yb, zr - 0.006], [wT(yt) + 0.004, yt, zr - 0.006], [-(wT(yt) + 0.004), yt, zr - 0.006], [0, 0, -1], WHITE);
    P.quadF([-(wT(yb) + 0.004), yb, zf + 0.006], [wT(yb) + 0.004, yb, zf + 0.006], [wT(1.62) + 0.004, 1.62, zf + 0.006], [-(wT(1.62) + 0.004), 1.62, zf + 0.006], [0, 0, 1], WHITE);
    D.quadF([-0.6, 1.5, zr - 0.012], [0.6, 1.5, zr - 0.012], [0.6, 2.2, zr - 0.012], [-0.6, 2.2, zr - 0.012], [0, 0, -1], C(0x1f2e40));
    box(D, 0, 1.75, zr - 0.02, 1.0, 0.03, 0.012, K.dgrey); box(D, 0, 1.9, zr - 0.02, 1.0, 0.03, 0.012, K.dgrey); box(D, 0, 2.05, zr - 0.02, 1.0, 0.03, 0.012, K.dgrey);
  }
  // wipers
  beam(D, [-0.15, 1.42, zf + 0.02], [0.85, 1.5, zf + 0.02], 0.02, 0.02, K.blk, [0, 0, 1]);
  // passenger rows
  const seatCol = C(0x4a5366);
  for (let i = 0; i < 6; i++) {
    const z = -4.4 + i * 1.12;
    for (const sx of [1, -1]) {
      if (sx < 0 && z > 2.5) continue;
      const x = sx * 0.83; box(D, x, 1.3 + 0.36, z, 0.86, 0.1, 0.5, seatCol);
      beam(D, [x, 1.3 + 0.4, z - 0.2], [x, 1.3 + 0.95, z - 0.26], 0.86, 0.1, seatCol, [1, 0, 0]);
    }
  }
  [[0.35, -3.3], [-0.35, -1.0], [0.35, 1.0], [-0.35, 3.4]].forEach(([x, z]) => cyl(D, [x, 2.15, z], 'y', 0.022, 1.7, K.chrome, 6));
  // mirrors (large)
  for (const sx of [1, -1]) { box(D, sx * 1.45, 2.2, zf - 0.15, 0.04, 0.42, 0.26, K.blk); beam(D, [sx * 1.3, 2.35, zf - 0.1], [sx * 1.44, 2.35, zf - 0.15], 0.03, 0.03, K.grey, [0, 1, 0]); }
  ctx.noDefaultMirror = true;
}

CARS.truck = {
  L: 7, W: 2.4, H: 3.2, wr: 0.5, wb: 4.2, track: 1.96, ww: 0.3, wwRear: 0.42, sill: 0.5, belt: 1.3, archGap: 0.07, p2Z: (0.62 - 0.5) * 7 + 0.001, shoulder: 0.1, shoulderIn: 0.1,
  lower: [[0, 3.05, .95, 1.22], [.01, 3.17, .99, 1.12], [.03, 3.2, 1, 1.1], [.62, 3.2, 1, 1.1], [.62, 1.3, 1, .5], [.80, 1.3, 1, .5], [.91, 1.26, 1, .5], [.975, 1.2, .97, .55], [1, 1.12, .93, .66]],
  cab: { pts: [[.63, 1.3], [.645, 2.6], [.80, 2.6], [.905, 1.3]], wB: 0.99, wT: 0.9, roofH: 2.6 }, cThick: 0.1,
  doorU: [.905, .7], handleU: [.74], bz: [],
  seats: [[0.5, 1.55, 1.6], [-0.5, 1.55, 1.6]],
  wheelStyle: 'steel', bumperY0: 0.36, bumperY1: 0.78, bumperW: 0.98, headStyle: 'rect', headDrop: 0.28, headH: 0.16, tailDrop: 1.75, tailH: 0.24, tailX0: 0.7, tailX1: 0.98, plateY: 0.92, exhaust: [], grilleW: 0.5, grilleBars: 5,
  flares: false, noMirror: true,
  extra(ctx) { addTruckExtras(ctx); },
};
function addTruckExtras(ctx) {
  const { P, P2, D, Lt, S, Z, probe } = ctx; const wT = ctx.cab.wTat; const cst = ctx.cab.st;
  // chassis rails + axles + fuel tanks + flaps
  for (const sx of [1, -1]) {
    box(D, sx * 0.45, 0.85, -0.5, 0.14, 0.2, 6.2, K.blk);
    cyl(D, [sx * 1.0, 0.85, -0.6], 'z', 0.28, 0.9, K.chrome, 10);
    box(D, sx * 1.0, 0.45, ctx.zR + 0.4, 0.4, 0.4, 0.04, K.blk);
  }
  box(D, 0, 0.5, 2.2 - 0.3, 1.9, 0.05, 0.1, K.blk); box(D, 0, 0.5, -2.1, 1.9, 0.05, 0.1, K.blk);
  // cargo box details: ribs + door lines + brand stripe
  const z0 = ctx.zR + 0.25, z1 = Z(0.62) - 0.1;
  for (let i = 0; i < 9; i++) {
    const z = lerp(z0, z1, i / 8);
    mirrorQuad(D, [probe.sideX(z, 1.3) + 0.006, 1.3, z - 0.02], [probe.sideX(z, 3.0) + 0.006, 3.0, z - 0.02], [probe.sideX(z, 3.0) + 0.006, 3.0, z + 0.02], [probe.sideX(z, 1.3) + 0.006, 1.3, z + 0.02], C(0xc4c4be));
  }
  const ys = 1.75; sideStrip(P, probe, z0, z1, ys, ys + 0.5, 0.008, WHITE, 4);
  D.quadF([-0.01, 1.2, ctx.zR - 0.007], [0.01, 1.2, ctx.zR - 0.007], [0.01, 3.1, ctx.zR - 0.007], [-0.01, 3.1, ctx.zR - 0.007], [0, 0, -1], K.grey);
  for (const y of [1.5, 2.2, 2.9]) D.quadF([-1.12, y, ctx.zR - 0.007], [1.12, y, ctx.zR - 0.007], [1.12, y + 0.03, ctx.zR - 0.007], [-1.12, y + 0.03, ctx.zR - 0.007], [0, 0, -1], C(0xc4c4be));
  // door panel band under the cab glass
  const zA = cst[0].z, zB = cst[cst.length - 1].z;
  [[1.3, 1.6]].forEach(([y0, y1]) => mirrorQuad(P, [wT(y0) + 0.008, y0, zA], [wT(y0) + 0.008, y0, zB], [wT(y1) + 0.008, y1, zB], [wT(y1) + 0.008, y1, zA], WHITE));
  // exhaust stacks behind the cab + air horn + roof lights
  for (const sx of [1, -1]) { cyl(D, [sx * 1.12, 2.0, cst[0].z - 0.15], 'y', 0.07, 2.0, K.chrome, 8); }
  for (let i = 0; i < 5; i++) box(D, (i - 2) * 0.22, 2.66, cst[cst.length - 1].z - 0.12, 0.12, 0.08, 0.1, C(0xe0a020));
  // big mirrors
  for (const sx of [1, -1]) { box(D, sx * 1.38, 1.95, cst[cst.length - 1].z + 0.05, 0.05, 0.45, 0.24, K.blk); beam(D, [sx * 1.0, 2.05, cst[cst.length - 1].z + 0.02], [sx * 1.36, 2.05, cst[cst.length - 1].z + 0.05], 0.03, 0.03, K.grey, [0, 1, 0]); }
  // steps
  for (const sx of [1, -1]) box(D, sx * 1.05, 0.72, cst[cst.length - 1].z - 0.5, 0.22, 0.04, 0.4, K.grey);
  // pipes + seat windows
  ctx.noDefaultMirror = true;
}

// ---------------------------------------------------------------------------------------------
// Motorbike
// ---------------------------------------------------------------------------------------------
function buildBike() {
  const P = new Bucket(), D = new Bucket(), G = new Bucket(), Lt = new Bucket(), SP = new Bucket(), SD = new Bucket();
  const wr = 0.32, zf = 0.69, zr = -0.69; const metal = C(0x34363c);
  const F = (x, y, z) => [x, y - wr, z - zf];   // to front-wheel pivot space
  // --- engine & frame
  box(D, 0, 0.44, 0.05, 0.26, 0.32, 0.5, K.dgrey);
  cyl(D, [0, 0.4, -0.22], 'x', 0.12, 0.3, K.grey, 10);
  cyl(D, [0, 0.66, 0.16], 'y', 0.085, 0.22, K.grey, 8);
  for (let i = 0; i < 4; i++) cyl(D, [0, 0.58 + i * 0.05, 0.16], 'y', 0.105, 0.012, K.chromeD, 8);
  box(D, 0, 0.3, -0.05, 0.22, 0.12, 0.45, K.blk);
  beam(D, [0, 0.96, 0.50], [0, 0.62, -0.05], 0.06, 0.07, metal, [1, 0, 0]);
  beam(D, [0, 0.62, -0.05], [0, 0.46, -0.35], 0.06, 0.07, metal, [1, 0, 0]);
  beam(D, [0, 0.94, 0.5], [0, 0.42, 0.25], 0.05, 0.06, metal, [1, 0, 0]);
  for (const sx of [1, -1]) {
    beam(D, [sx * 0.11, 0.46, -0.36], [sx * 0.11, 0.32, zr], 0.045, 0.09, metal, [1, 0, 0]);      // swingarm
    beam(D, [sx * 0.13, 0.66, -0.3], [sx * 0.11, 0.38, -0.62], 0.035, 0.035, K.chrome, [1, 0, 0]);  // shock
    box(D, sx * 0.27, 0.35, -0.02, 0.09, 0.03, 0.06, K.blk);                                        // footpeg
    beam(D, [sx * 0.1, 0.8, -0.2], [sx * 0.1, 0.5, -0.36], 0.04, 0.04, metal, [1, 0, 0]);          // subframe
  }
  // --- tank (paint) + tail (paint) + seat
  const ring = (hw, bot, top) => [[0, bot], [hw, bot + 0.04], [hw, top - 0.04], [hw * 0.55, top], [0, top + 0.01]];
  const tank = [{ z: -0.1, hw: 0.11, bot: 0.78, top: 0.92 }, { z: 0.0, hw: 0.155, bot: 0.76, top: 0.97 }, { z: 0.25, hw: 0.175, bot: 0.74, top: 1.0 }, { z: 0.45, hw: 0.13, bot: 0.78, top: 0.98 }, { z: 0.54, hw: 0.08, bot: 0.84, top: 0.96 }];
  const tr = tank.map(s => ring(s.hw, s.bot, s.top));
  loftQuads(tank, tr, () => ({ B: P, col: y => mulC(WHITE, 0.8 + 0.2 * clamp((y - 0.75) / 0.25, 0, 1)) }));
  loftCap(P, tr[0], tank[0].z, -1, WHITE); loftCap(P, tr[tr.length - 1], tank[tank.length - 1].z, 1, WHITE);
  const tail = [{ z: -0.92, hw: 0.055, bot: 0.84, top: 0.94 }, { z: -0.84, hw: 0.1, bot: 0.8, top: 0.99 }, { z: -0.55, hw: 0.125, bot: 0.76, top: 0.95 }, { z: -0.28, hw: 0.13, bot: 0.74, top: 0.9 }];
  const tl = tail.map(s => ring(s.hw, s.bot, s.top));
  loftQuads(tail, tl, () => ({ B: P, col: y => mulC(WHITE, 0.8 + 0.2 * clamp((y - 0.75) / 0.25, 0, 1)) }));
  loftCap(P, tl[0], tail[0].z, -1, WHITE); loftCap(P, tl[tl.length - 1], tail[tail.length - 1].z, 1, WHITE);
  const seat = [{ z: -0.62, hw: 0.14, bot: 0.78, top: 0.85 }, { z: -0.35, hw: 0.155, bot: 0.76, top: 0.875 }, { z: -0.05, hw: 0.14, bot: 0.76, top: 0.87 }, { z: 0.08, hw: 0.11, bot: 0.78, top: 0.88 }];
  const sr = seat.map(s => ring(s.hw, s.bot, s.top));
  loftQuads(seat, sr, () => ({ B: D, col: () => C(0x1c1c20) }));
  loftCap(D, sr[0], seat[0].z, -1, C(0x1c1c20)); loftCap(D, sr[sr.length - 1], seat[seat.length - 1].z, 1, C(0x1c1c20));
  // rear fender + plate + lights
  beam(D, [0, 0.66, -0.48], [0, 0.6, -0.9], 0.15, 0.02, K.blk, [0, 1, 0]);
  box(D, 0, 0.72, -0.96, 0.17, 0.11, 0.008, K.plate);
  Lt.range('tail', () => box(Lt, 0, 0.88, -0.935, 0.12, 0.05, 0.02, LIGHT_OFF.tail));
  for (const sx of [1, -1]) Lt.range(sx > 0 ? 'indL' : 'indR', () => { box(Lt, sx * 0.13, 0.85, -0.9, 0.05, 0.04, 0.05, LIGHT_OFF.indL); box(Lt, sx * 0.3, 1.0, 0.48, 0.05, 0.05, 0.06, LIGHT_OFF.indL); });
  // exhaust (right side = -x)
  beam(D, [-0.15, 0.3, 0.28], [-0.17, 0.26, -0.05], 0.06, 0.06, K.chrome, [0, 1, 0]);
  beam(D, [-0.17, 0.26, -0.05], [-0.2, 0.44, -0.86], 0.09, 0.09, K.chrome, [0, 1, 0]);
  box(D, -0.2, 0.44, -0.9, 0.09, 0.09, 0.02, K.blk);
  // headlight
  D.geo(new THREE.CylinderGeometry(0.115, 0.115, 0.1, 10).rotateX(Math.PI / 2).translate(0, 0.92, 0.6), null, K.chrome);
  Lt.range('head', () => cyl(Lt, [0, 0.92, 0.655], 'z', 0.09, 0.02, LIGHT_OFF.head, 10));
  // --- steering assembly (local to the front-wheel pivot)
  for (const sx of [1, -1]) {
    beam(SD, F(sx * 0.085, wr, zf), F(sx * 0.085, 1.0, 0.52), 0.045, 0.045, K.chrome, [1, 0, 0]);   // fork leg
    cyl(SD, F(sx * 0.085, wr, zf), 'x', 0.04, 0.04, K.dgrey, 8);
    cyl(SD, F(sx * 0.4, 1.12, 0.46), 'x', 0.022, 0.16, K.blk, 6);                                   // grip
    beam(SD, F(sx * 0.05, 1.03, 0.5), F(sx * 0.3, 1.1, 0.47), 0.03, 0.03, metal, [0, 1, 0]);       // bar
    beam(SD, F(sx * 0.3, 1.1, 0.47), F(sx * 0.4, 1.12, 0.46), 0.03, 0.03, metal, [0, 1, 0]);
    beam(SD, F(sx * 0.27, 1.1, 0.47), F(sx * 0.27, 1.2, 0.5), 0.015, 0.015, K.blk, [1, 0, 0]);       // mirror stem
    box(SD, sx * 0.27, 1.22 - wr, 0.51 - zf, 0.1, 0.06, 0.02, K.blk);                                // mirror
  }
  box(SD, 0, 1.02 - wr, 0.5 - zf, 0.22, 0.05, 0.09, K.dgrey);
  cyl(SD, F(0, 1.06, 0.45), 'y', 0.06, 0.05, K.blk, 8);   // gauge
  // front fender
  {
    const R = wr + 0.05; let prev = null;
    for (let i = 0; i <= 7; i++) { const a = lerp(Math.PI * 0.42, -Math.PI * 0.1, i / 7); const p = [0, Math.sin(a) * R, Math.cos(a) * R]; if (prev) beam(SP, prev, p, 0.15, 0.022, WHITE, [0, 1, 0]); prev = p; }
  }
  // wheels (thin spoked)
  const wheels = [
    { pos: [0, wr, zf], radius: wr, steer: true, drive: false, side: 1, geo: () => thinWheelGeometry(wr, 0.15, 10, C(0x161618), C(0xc9ced6)) },
    { pos: [0, wr, zr], radius: wr, steer: false, drive: true, side: 1, geo: () => thinWheelGeometry(wr, 0.17, 10, C(0x161618), C(0xc9ced6)) },
  ];
  return {
    geos: { paint: P.build(), paint2: null, detail: D.build(), glass: G.build(), lights: Lt.build() }, wheels, wheelW: 0.15, wheelStyle: 'hub', damageable: false,
    seats: [{ x: 0, y: 0.88, z: -0.12 }, { x: 0, y: 0.9, z: -0.58 }],
    steer: { paint: SP.build(), detail: SD.build() },
    customize(m) {
      const piv = m.wheels[0].pivot; const sh = shared();
      const a = new THREE.Mesh(this.steer.detail, sh.detail); const b = new THREE.Mesh(this.steer.paint, m.paintMat); a.name = 'steer_detail'; b.name = 'steer_paint';
      piv.add(a); piv.add(b); m.detailMeshes.push(a);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Bicycle
// ---------------------------------------------------------------------------------------------
function buildBicycle() {
  const P = new Bucket(), D = new Bucket(), G = new Bucket(), Lt = new Bucket(), SP = new Bucket(), SD = new Bucket();
  const wr = 0.34, zf = 0.525, zr = -0.525; const T = 0.028;
  const F = (x, y, z) => [x, y - wr, z - zf];
  const B = [0, 0.3, -0.05], S0 = [0, 0.86, -0.25], S1 = [0, 0.76, -0.2], Hb = [0, 0.6, 0.4], Ht = [0, 0.78, 0.38];
  const tube = (a, b, t = T) => beam(P, a, b, t, t, WHITE, [1, 0, 0]);
  tube(B, S0); tube(S1, Ht); tube(B, Hb, 0.035); tube(Hb, Ht, 0.04);
  for (const sx of [1, -1]) {
    tube([sx * 0.055, 0.32, -0.12], [sx * 0.055, 0.34, zr], 0.02); // chain stay
    tube([sx * 0.05, 0.76, -0.23], [sx * 0.05, 0.34, zr], 0.018);  // seat stay
    beam(D, [0, 0.3, -0.05], [sx * 0.15, 0.3, -0.05], 0.03, 0.03, K.chromeD, [0, 1, 0]); // axle of the cranks
  }
  // saddle + post
  beam(D, S0, [0, 0.92, -0.26], 0.03, 0.03, K.chrome, [1, 0, 0]);
  box(D, 0, 0.94, -0.27, 0.13, 0.05, 0.3, C(0x2a2018));
  box(D, 0, 0.95, -0.15, 0.06, 0.04, 0.12, C(0x2a2018));
  // crank + pedals + chainring + chain
  cyl(D, [0.04, 0.3, -0.05], 'x', 0.095, 0.012, K.chrome, 12);
  beam(D, [0.085, 0.3, -0.05], [0.085, 0.17, 0.02], 0.025, 0.012, K.chromeD, [1, 0, 0]);
  beam(D, [-0.085, 0.3, -0.05], [-0.085, 0.43, -0.12], 0.025, 0.012, K.chromeD, [1, 0, 0]);
  box(D, 0.12, 0.17, 0.02, 0.09, 0.02, 0.1, K.blk); box(D, -0.12, 0.43, -0.12, 0.09, 0.02, 0.1, K.blk);
  cyl(D, [0.04, 0.34, zr], 'x', 0.04, 0.012, K.chrome, 8);
  beam(D, [0.04, 0.395, -0.05], [0.04, 0.375, zr], 0.012, 0.012, K.blk, [1, 0, 0]);
  beam(D, [0.04, 0.205, -0.05], [0.04, 0.305, zr], 0.012, 0.012, K.blk, [1, 0, 0]);
  // rear fender + rack + light
  { const R = wr + 0.03; let prev = null; for (let i = 0; i <= 6; i++) { const a = lerp(Math.PI * 0.5, Math.PI * 0.05 - Math.PI * 0.55, i / 6); const p = [0, wr + Math.sin(a) * R, zr + Math.cos(a) * R]; if (prev) beam(P, prev, p, 0.08, 0.012, WHITE, [0, 1, 0]); prev = p; } }
  Lt.range('tail', () => box(Lt, 0, 0.56, zr - 0.3, 0.04, 0.04, 0.012, LIGHT_OFF.tail));
  Lt.range('head', () => box(Lt, 0, 0.82, 0.45, 0.06, 0.06, 0.03, LIGHT_OFF.head));
  // steering assembly
  for (const sx of [1, -1]) {
    beam(SD, F(sx * 0.05, wr, zf), F(sx * 0.03, 0.68, 0.43), 0.022, 0.022, K.chromeD, [1, 0, 0]);
    beam(SD, F(sx * 0.03, 0.68, 0.43), F(sx * 0.03, 0.8, 0.39), 0.02, 0.02, K.chromeD, [1, 0, 0]);
  }
  beam(SD, F(0, 0.8, 0.39), F(0, 0.86, 0.37), 0.03, 0.03, K.chrome, [1, 0, 0]);
  for (const sx of [1, -1]) {
    beam(SD, F(sx * 0.02, 0.86, 0.37), F(sx * 0.27, 0.88, 0.3), 0.022, 0.022, K.chrome, [0, 1, 0]);
    beam(SD, F(sx * 0.27, 0.88, 0.3), F(sx * 0.3, 0.86, 0.2), 0.022, 0.022, K.chrome, [0, 1, 0]);
    cyl(SD, F(sx * 0.3, 0.86, 0.16), 'z', 0.018, 0.12, K.blk, 6);
  }
  box(SD, 0, 0.82 - wr, 0.43 - zf, 0.22, 0.05, 0.07, K.blk);
  { const R = wr + 0.03; let prev = null; for (let i = 0; i <= 6; i++) { const a = lerp(Math.PI * 0.45, -Math.PI * 0.02, i / 6); const p = [0, Math.sin(a) * R, Math.cos(a) * R]; if (prev) beam(SP, prev, p, 0.07, 0.012, WHITE, [0, 1, 0]); prev = p; } }
  const tyre = C(0x1a1a1c), rim = C(0xc9ced6);
  const wheels = [
    { pos: [0, wr, zf], radius: wr, steer: true, drive: false, side: 1, geo: () => thinWheelGeometry(wr, 0.045, 16, tyre, rim) },
    { pos: [0, wr, zr], radius: wr, steer: false, drive: true, side: 1, geo: () => thinWheelGeometry(wr, 0.045, 16, tyre, rim) },
  ];
  return {
    geos: { paint: P.build(), paint2: null, detail: D.build(), glass: G.build(), lights: Lt.build() }, wheels, wheelW: 0.045, wheelStyle: 'hub', damageable: false,
    seats: [{ x: 0, y: 0.95, z: -0.24 }],
    steer: { paint: SP.build(), detail: SD.build() },
    customize(m) {
      const piv = m.wheels[0].pivot; const sh = shared();
      const a = new THREE.Mesh(this.steer.detail, sh.detail); const b = new THREE.Mesh(this.steer.paint, m.paintMat); a.name = 'steer_detail'; b.name = 'steer_paint';
      piv.add(a); piv.add(b); m.detailMeshes.push(a);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Police helicopter
// ---------------------------------------------------------------------------------------------
function extrudeSide(B, pts, x0, x1, col) { // convex polygon in (z,y) extruded along x
  const n = pts.length; let cz = 0, cy = 0; pts.forEach(p => { cz += p[0] / n; cy += p[1] / n; });
  const ctr = [(x0 + x1) / 2, cy, cz];
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; B.quadO([x0, a[1], a[0]], [x1, a[1], a[0]], [x1, b[1], b[0]], [x0, b[1], b[0]], ctr, col); }
  B.poly(pts.map(p => [x1, p[1], p[0]]), [1, 0, 0], col); B.poly(pts.map(p => [x0, p[1], p[0]]), [-1, 0, 0], col);
}
function buildHeli() {
  const P = new Bucket(), P2 = new Bucket(), D = new Bucket(), G = new Bucket(), Lt = new Bucket(), RB = new Bucket(), TB = new Bucket();
  const st = [
    { z: 3.25, bot: 0.95, top: 1.45, hw: 0.2 }, { z: 3.0, bot: 0.75, top: 1.75, hw: 0.55 }, { z: 2.4, bot: 0.62, top: 2.05, hw: 0.85 }, { z: 1.6, bot: 0.58, top: 2.25, hw: 0.98 },
    { z: 0.6, bot: 0.58, top: 2.3, hw: 1.02 }, { z: -0.6, bot: 0.62, top: 2.25, hw: 0.98 }, { z: -1.8, bot: 0.8, top: 2.1, hw: 0.8 }, { z: -3.0, bot: 1.15, top: 1.9, hw: 0.45 },
    { z: -4.2, bot: 1.3, top: 1.78, hw: 0.27 }, { z: -6.0, bot: 1.42, top: 1.7, hw: 0.17 }, { z: -8.2, bot: 1.52, top: 1.8, hw: 0.1 },
  ];
  st.reverse();
  const ringF = (s) => { const h = s.top - s.bot; return [[0, s.bot], [s.hw * 0.55, s.bot + 0.06 * h], [s.hw, s.bot + 0.38 * h], [s.hw, s.bot + 0.68 * h], [s.hw * 0.6, s.top - 0.03 * h], [0, s.top]]; };
  const rings = st.map(ringF);
  const ao = y => mulC(WHITE, 0.7 + 0.3 * clamp((y - 0.5) / 1.2, 0, 1));
  loftQuads(st, rings, (k, i) => ((k === 2 || k === 3) && st[i].z >= 0.69 && st[i + 1].z >= 0.69) ? { B: G, col: () => WHITE } : { B: k <= 2 ? P2 : P, col: ao });
  loftCap(P, rings[0], st[0].z, -1, WHITE); loftCap(P, rings[rings.length - 1], st[st.length - 1].z, 1, WHITE);
  const probe = makeProbe(st, rings);
  // windscreen nose piece (upper front)
  {
    const a = probe.ringAt(3.0);
    G.quadF([-a[3][0] * 1.0, a[3][1], 3.0], [a[3][0] * 1.0, a[3][1], 3.0], [a[4][0], a[4][1], 3.0], [-a[4][0], a[4][1], 3.0], [0, 0.5, 1], WHITE);
  }
  // frame beams over the glass
  for (const z of [2.4, 1.6, 0.7]) for (const sx of [1, -1]) { const R = probe.ringAt(z); beam(P, [sx * R[2][0] * 1.014, R[2][1], z], [sx * R[3][0] * 1.014, R[3][1], z], 0.07, 0.04, WHITE, [0, 0, 1]); }
  // interior
  box(D, 0, 0.75, 1.2, 1.7, 0.03, 3.0, K.interior);
  const seats = [[0.42, 1.02, 1.6], [-0.42, 1.02, 1.6], [0.4, 1.02, 0.15], [-0.4, 1.02, 0.15]];
  seats.forEach(sp => { box(D, sp[0], sp[1] - 0.25, sp[2], 0.46, 0.12, 0.5, K.seat); beam(D, [sp[0], sp[1] - 0.2, sp[2] - 0.2], [sp[0], sp[1] + 0.5, sp[2] - 0.3], 0.46, 0.1, K.seat, [1, 0, 0]); });
  box(D, 0, 1.4, 2.65, 1.3, 0.35, 0.3, K.interior);
  // engine cowling + mast
  const cw = [{ z: -0.3, bot: 2.2, top: 2.42, hw: 0.55 }, { z: -1.0, bot: 2.15, top: 2.72, hw: 0.72 }, { z: -2.0, bot: 2.1, top: 2.7, hw: 0.64 }, { z: -3.0, bot: 1.95, top: 2.35, hw: 0.36 }];
  cw.reverse(); const cr = cw.map(ringF);
  loftQuads(cw, cr, () => ({ B: P, col: () => WHITE })); loftCap(P, cr[0], cw[0].z, -1, WHITE); loftCap(P, cr[cr.length - 1], cw[cw.length - 1].z, 1, WHITE);
  cyl(D, [0, 2.95, -0.85], 'y', 0.11, 0.6, K.dgrey, 8); cyl(D, [0, 3.2, -0.85], 'y', 0.2, 0.08, K.blk, 8);
  cyl(D, [0.25, 2.55, -2.9], 'z', 0.07, 0.4, K.chromeD, 6); // exhaust
  // tail fin + stabiliser
  extrudeSide(P, [[-7.3, 1.62], [-8.35, 1.62], [-8.55, 3.05], [-8.05, 3.05]], -0.04, 0.04, WHITE);
  box(P2, 0, 1.78, -7.75, 2.3, 0.05, 0.55, WHITE);
  extrudeSide(P2, [[-7.3, 1.62], [-7.6, 1.62], [-7.75, 2.3], [-7.5, 2.3]], -0.045, 0.045, WHITE);
  // skids
  for (const sx of [1, -1]) {
    beam(D, [sx * 1.0, 0.12, -1.6], [sx * 1.0, 0.12, 2.3], 0.08, 0.07, K.blk, [0, 1, 0]);
    beam(D, [sx * 1.0, 0.12, 2.3], [sx * 1.0, 0.36, 2.85], 0.08, 0.07, K.blk, [1, 0, 0]);
    for (const z of [1.5, -0.6]) beam(D, [sx * 1.0, 0.12, z], [sx * 0.72, 0.68, z], 0.06, 0.06, K.dgrey, [0, 0, 1]);
  }
  // searchlight + strobes + landing light
  cyl(D, [0, 0.52, 2.45], 'y', 0.2, 0.22, K.dgrey, 8);
  cyl(D, [0, 0.43, 2.45], 'y', 0.16, 0.03, C(0xfff6d0), 8);
  Lt.range('head', () => box(Lt, 0, 1.12, 3.22, 0.22, 0.12, 0.03, LIGHT_OFF.head));
  Lt.range('sirenR', () => { box(Lt, 0.75, 0.6, 2.1, 0.2, 0.08, 0.2, LIGHT_OFF.sirenR); box(Lt, 0.12, 1.66, -6.9, 0.07, 0.1, 0.16, LIGHT_OFF.sirenR); });
  Lt.range('sirenB', () => { box(Lt, -0.75, 0.6, 2.1, 0.2, 0.08, 0.2, LIGHT_OFF.sirenB); box(Lt, -0.12, 1.66, -6.9, 0.07, 0.1, 0.16, LIGHT_OFF.sirenB); });
  Lt.range('white', () => box(Lt, 0, 3.07, -8.55, 0.08, 0.1, 0.06, LIGHT_OFF.white));
  // side stripes (paint2) and doors
  sideStrip(P2, probe, -1.4, 2.9, 1.15, 1.4, 0.008, WHITE, 10);
  [0.2, -1.2].forEach(z => mirrorQuad(D, [probe.sideX(z, 0.75) + 0.006, 0.75, z], [probe.sideX(z, 1.95) + 0.006, 1.95, z], [probe.sideX(z, 1.95) + 0.006, 1.95, z - 0.014], [probe.sideX(z, 0.75) + 0.006, 0.75, z - 0.014], K.blk));
  // rotor meshes (animated groups built in customize)
  const hub = [0, 3.28, -0.85];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    beam(RB, [0.25 * dx, 0, 0.25 * dz], [5.2 * dx, 0, 5.2 * dz], 0.26, 0.035, C(0x24262b), [0, 1, 0]);
    beam(RB, [4.6 * dx, 0.002, 4.6 * dz], [5.2 * dx, 0.002, 5.2 * dz], 0.262, 0.036, (i % 2) ? C(0xe8e8e0) : C(0xd03020), [0, 1, 0]);
  }
  cyl(RB, [0, 0, 0], 'y', 0.22, 0.12, K.dgrey, 8);
  for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; beam(TB, [0, 0.0, 0], [0, 0.72 * s, 0.0], 0.03, 0.14, C(0x24262b), [1, 0, 0]); }
  cyl(TB, [0, 0, 0], 'x', 0.08, 0.1, K.dgrey, 6);
  return {
    geos: { paint: P.build(), paint2: P2.build(), detail: D.build(), glass: G.build(), lights: Lt.build() }, wheels: [], wheelW: 0, wheelStyle: 'hub', damageable: false,
    seats: [{ x: 0.42, y: 1.02, z: 1.6 }, { x: -0.42, y: 1.02, z: 1.6 }, { x: 0.4, y: 1.02, z: 0.15 }],
    rotors: { main: RB.build(), tail: TB.build(), hub },
    customize(m) {
      const sh = shared(); const grp = new THREE.Group(); grp.position.set(hub[0], hub[1], hub[2]);
      const rm = new THREE.Mesh(this.rotors.main, sh.detail); grp.add(rm);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(5.25, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x20242c, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
      grp.add(disc); m._owned.push(disc.geometry, disc.material);
      m.group.add(grp);
      const tg = new THREE.Group(); tg.position.set(0.16, 2.35, -8.3); const tm = new THREE.Mesh(this.rotors.tail, sh.detail); tg.add(tm); m.group.add(tg);
      m.detailMeshes.push(rm, tm);
      // searchlight beam
      const h = 16; const cg = new THREE.ConeGeometry(1.9, h, 14, 1, true); cg.translate(0, -h / 2, 0);
      const d = new THREE.Vector3(0, -0.55, 0.83).normalize(); cg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d));
      const bm = new THREE.Mesh(cg, sh.beam); bm.position.set(0, 0.43, 2.45); bm.visible = false; bm.renderOrder = 4; bm.frustumCulled = false; m.group.add(bm); m._owned.push(cg);
      m.beam = bm;
      m.rotorSpeed = 22; m.main = grp; m.tailRotor = tg; m._rotorAng = 0;
      m._anim.push((dt) => { if (m.st.burnt) return; grp.rotation.y += dt * m.rotorSpeed; tg.rotation.x += dt * m.rotorSpeed * 2.2; disc.visible = m.rotorSpeed > 8; disc.material.opacity = clamp(m.rotorSpeed / 22, 0, 1) * 0.12; });
    },
    onSiren(m, on) { if (m.beam) m.beam.visible = on; },
    onBurnt(m, on) { if (on && m.beam) m.beam.visible = false; if (m.main) m.main.children[1].visible = false; },
  };
}
BUILDERS.motorbike = buildBike;
BUILDERS.bicycle = buildBicycle;
BUILDERS.policeheli = buildHeli;

// ---------------------------------------------------------------------------------------------
// Blueprint registry + instance
// ---------------------------------------------------------------------------------------------
for (const t of Object.keys(CARS)) BUILDERS[t] = () => buildCar(CARS[t]);

// ---------------------------------------------------------------------------------------------
// Per-type metadata: default colours, locked colours (livery vehicles), finish
// ---------------------------------------------------------------------------------------------
const META = {
  taxi:      { body: 0xf2b81c, secondary: 0x111111, lock: true },
  police:    { body: 0x15161a, secondary: 0xf4f4f0, lock: true, siren: { R: 0xff1c1c, B: 0x2a52ff } },
  swatvan:   { body: 0x1b1c1f, secondary: 0x222222, lock: true, matte: true, siren: { R: 0xff1c1c, B: 0x2a52ff } },
  ambulance: { body: 0xf4f4f2, secondary: 0xc8201a, lock: true, siren: { R: 0xff1c1c, B: 0xe8f0ff } },
  policeheli:{ body: 0x1c2233, secondary: 0xf2f2f0, lock: true, siren: { R: 0xff1c1c, B: 0x2a52ff } },
  muscle:    { body: 0xcc2222, secondary: 0xf2f2f0 },
  lowrider:  { body: 0x6a2a8c, secondary: 0xe8d6a0 },
  sports:    { body: 0xe8c020, secondary: 0x151515 },
  van:       { body: 0xe8e8e4, secondary: 0x2a5aa0 },
  bus:       { body: 0x2d6cb8, secondary: 0xf0f0ec },
  truck:     { body: 0xc86a1e, secondary: 0xe8e8e4 },
  motorbike: { body: 0xc02020, secondary: 0x222222 },
  bicycle:   { body: 0x2a7ac0, secondary: 0x222222 },
};
function metaFor(type) { return META[type] || {}; }

// ---------------------------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------------------------
let SHARED = null;
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function shared() {
  if (SHARED) return SHARED;
  const mk = (color, opacity, shin) => new THREE.MeshPhongMaterial({ color, specular: 0xbcc8e0, shininess: shin, transparent: true, opacity, depthWrite: false, vertexColors: true });
  SHARED = {
    detail: new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x666666, shininess: 55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    detailBurnt: new THREE.MeshPhongMaterial({ vertexColors: true, color: 0x3a3836, specular: 0x000000, shininess: 4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    glass: [mk(0x1c2c42, 0.62, 140), mk(0x34465c, 0.72, 100), mk(0x8d9aa8, 0.85, 60)],
    wheel: new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x444444, shininess: 35 }),
    wheelBurnt: new THREE.MeshPhongMaterial({ vertexColors: true, color: 0x2a2826, specular: 0x000000, shininess: 2 }),
    lights: new THREE.MeshBasicMaterial({ vertexColors: true }),
    glow: new THREE.PointsMaterial({ size: 1.1, map: glowTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }),
    beam: new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  };
  return SHARED;
}

const bpCache = new Map();
function getBlueprint(type) {
  let bp = bpCache.get(type);
  if (!bp) {
    const fn = BUILDERS[type]; if (!fn) throw new Error('unknown vehicle type ' + type);
    bp = fn();
    // light sources for glow sprites, derived from light ranges
    const lp = bp.geos.lights.attributes.position, rg = bp.geos.lights.userData.ranges;
    bp.glowSrc = [];
    const centre = (s, n) => { let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9; for (let i = s; i < s + n; i++) { const x = lp.getX(i), y = lp.getY(i), z = lp.getZ(i); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]; };
    for (const key of ['head', 'tail', 'sirenR', 'sirenB']) (rg[key] || []).forEach(([s, n]) => { const c = centre(s, n); bp.glowSrc.push({ key, pos: c, sign: (key === 'head' ? 1 : 0) }); });
    bpCache.set(type, bp);
  }
  return bp;
}

function h3(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function deformGeometry(src, amp, crumple, L, dirtColors) {
  const g = new THREE.BufferGeometry();
  const p = src.attributes.position, n = p.count; const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const qx = Math.round(x * 400), qy = Math.round(y * 400), qz = Math.round(z * 400);
    const w = 0.3 + 0.7 * smooth(0.22 * L, 0.5 * L, Math.abs(z));
    const e = smooth(0.3 * L, 0.5 * L, Math.abs(z));
    let dx = (h3(qx, qy, qz) - 0.5) * 2 * amp * w, dy = (h3(qx + 7, qy, qz) - 0.5) * 2 * amp * w * 0.7, dz = (h3(qx, qy + 5, qz) - 0.5) * 2 * amp * w;
    dz -= Math.sign(z) * crumple * e * (0.55 + 0.45 * h3(qx + 3, qy + 1, qz + 9));
    dy -= crumple * 0.35 * e * (y > 0.5 ? 1 : 0.2);
    out[i * 3] = x + dx; out[i * 3 + 1] = y + dy; out[i * 3 + 2] = z + dz;
  }
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.setAttribute('normal', src.attributes.normal); g.setAttribute('color', src.attributes.color);
  g.computeVertexNormals();
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Vehicle instance
// ---------------------------------------------------------------------------------------------
class VehicleModel {
  constructor(type, colors = {}) {
    const bp = getBlueprint(type); const M = metaFor(type); const sh = shared();
    this.type = type; this.def = VEHICLE_DEFS[type]; this.bp = bp;
    this.group = new THREE.Group(); this.group.name = 'vehicle_' + type;
    this.wheels = []; this.seats = bp.seats.map(s => ({ x: s.x, y: s.y, z: s.z }));
    if (bp.seatInfo) this.group.userData.seatInfo = bp.seatInfo;
    this._owned = [];            // per-instance disposables
    this._deform = [];           // deformed geometry clones
    const bodyHex = M.lock ? M.body : (colors && colors.body != null ? colors.body : (M.body ?? 0xcc2222));
    const secHex = M.lock ? M.secondary : (colors && colors.secondary != null ? colors.secondary : (M.secondary ?? 0x222222));
    this.bodyHex = bodyHex; this.secHex = secHex; this.matte = !!M.matte;
    this.paintMat = new THREE.MeshPhongMaterial({ color: bodyHex, vertexColors: true, specular: this.matte ? 0x111111 : 0x3c3c3c, shininess: this.matte ? 8 : 60 });
    this._owned.push(this.paintMat);
    if (bp.geos.paint2) { this.paint2Mat = new THREE.MeshPhongMaterial({ color: secHex, vertexColors: true, specular: this.matte ? 0x111111 : 0x5a5a5a, shininess: this.matte ? 8 : 60, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); this._owned.push(this.paint2Mat); }
    const mk = (geo, mat, name, ro) => { const m = new THREE.Mesh(geo, mat); m.name = name; if (ro) m.renderOrder = ro; m.matrixAutoUpdate = false; m.updateMatrix(); this.group.add(m); return m; };
    this.meshes = {};
    this.meshes.paint = mk(bp.geos.paint, this.paintMat, 'paint');
    if (bp.geos.paint2) this.meshes.paint2 = mk(bp.geos.paint2, this.paint2Mat, 'paint2');
    this.meshes.detail = mk(bp.geos.detail, sh.detail, 'detail'); this.detailMeshes = [this.meshes.detail];
    this.meshes.glass = mk(bp.geos.glass, sh.glass[0], 'glass', 2);
    // lights: per-instance colour attribute
    const lg = new THREE.BufferGeometry(); const bl = bp.geos.lights;
    lg.setAttribute('position', bl.attributes.position); lg.setAttribute('normal', bl.attributes.normal);
    const carr = new THREE.BufferAttribute(new Float32Array(bl.attributes.color.array), 3); carr.setUsage(THREE.DynamicDrawUsage);
    lg.setAttribute('color', carr); lg.boundingSphere = bl.boundingSphere; lg.boundingBox = bl.boundingBox;
    this.lightGeo = lg; this._owned.push(lg);
    this.meshes.lights = mk(lg, sh.lights, 'lights');
    for (const k of ['detail', 'glass', 'lights']) if (!bp.geos[k].attributes.position.count) this.meshes[k].visible = false;
    // glow points
    if (bp.glowSrc.length) {
      const pg = new THREE.BufferGeometry(); const pos = new Float32Array(bp.glowSrc.length * 3);
      bp.glowSrc.forEach((s, i) => { pos[i * 3] = s.pos[0]; pos[i * 3 + 1] = s.pos[1]; pos[i * 3 + 2] = s.pos[2] + (s.key === 'head' ? 0.08 : s.key === 'tail' ? -0.08 : 0); });
      pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const gc = new THREE.BufferAttribute(new Float32Array(bp.glowSrc.length * 3), 3); gc.setUsage(THREE.DynamicDrawUsage); pg.setAttribute('color', gc);
      pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), Math.max(6, this.def.length)); 
      this.glowGeo = pg; this._owned.push(pg);
      this.glow = new THREE.Points(pg, sh.glow); this.glow.renderOrder = 3; this.glow.frustumCulled = false; this.glow.visible = false; this.group.add(this.glow);
    }
    // wheels
    const sp = bp.wheelKind;
    bp.wheels.forEach((w) => {
      const pivot = new THREE.Group(), spin = new THREE.Group();
      pivot.position.set(w.pos[0], w.pos[1], w.pos[2]); pivot.add(spin);
      const geo = w.geo ? w.geo() : wheelGeometry(w.radius, w.ww ?? bp.wheelW, bp.wheelStyle);
      const m = new THREE.Mesh(geo, sh.wheel); m.name = 'wheel';
      if (w.side < 0) m.rotation.y = Math.PI;
      spin.add(m); this.group.add(pivot);
      this.wheels.push({ pivot, spin, pos: new THREE.Vector3(w.pos[0], w.pos[1], w.pos[2]), radius: w.radius, steer: w.steer, drive: w.drive, mesh: m });
    });
    // state
    this.st = { brake: false, head: false, rev: false, siren: false, ind: 0, blink: false, slot: -1, burnt: false, damage: 0, level: 0 };
    this._t = 0; this._tb = 0; this._ts = 0;
    this._anim = [];
    if (bp.customize) bp.customize(this);
    this._lightsDirty = true; this._refreshLights();
    this._applyPaint();
  }

  // ----- lights
  _lightColour(key) {
    const s = this.st;
    if (s.burnt) return [0.04, 0.04, 0.04];
    const M = metaFor(this.type); const sc = M.siren || {};
    switch (key) {
      case 'head': return s.head ? LIGHT_ON.head : LIGHT_OFF.head;
      case 'tail': return s.brake ? LIGHT_ON.tail : (s.head ? [0.62, 0.08, 0.06] : LIGHT_OFF.tail);
      case 'rev': return s.rev ? LIGHT_ON.rev : LIGHT_OFF.rev;
      case 'indL': return (s.ind === -1 && s.blink) ? LIGHT_ON.indL : LIGHT_OFF.indL;
      case 'indR': return (s.ind === 1 && s.blink) ? LIGHT_ON.indR : LIGHT_OFF.indR;
      case 'sirenR': return (s.siren && (s.slot === 0 || s.slot === 2)) ? C(sc.R ?? 0xff2020) : LIGHT_OFF.sirenR;
      case 'sirenB': return (s.siren && (s.slot === 6 || s.slot === 8)) ? C(sc.B ?? 0x2a52ff) : LIGHT_OFF.sirenB;
      case 'sign': return s.head ? LIGHT_ON.sign : LIGHT_OFF.sign;
      case 'white': return LIGHT_ON.white;
      case 'amber': return LIGHT_OFF.amber;
      default: return LIGHT_OFF.white;
    }
  }
  _refreshLights() {
    const rg = this.bp.geos.lights.userData.ranges; const arr = this.lightGeo.attributes.color.array;
    for (const key in rg) {
      const c = this._lightColour(key);
      rg[key].forEach(([s, n]) => { for (let i = s; i < s + n; i++) { arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2]; } });
    }
    this.lightGeo.attributes.color.needsUpdate = true;
    if (this.glowGeo) {
      const ga = this.glowGeo.attributes.color.array; let any = false; const s = this.st;
      this.bp.glowSrc.forEach((g, i) => {
        let c = [0, 0, 0];
        if (!s.burnt) {
          if (g.key === 'head' && s.head) c = [0.85, 0.8, 0.55];
          else if (g.key === 'tail') c = s.brake ? [1, 0.12, 0.08] : s.head ? [0.45, 0.04, 0.03] : [0, 0, 0];
          else if (g.key === 'sirenR' && s.siren && (s.slot === 0 || s.slot === 2)) c = [1, 0.1, 0.1];
          else if (g.key === 'sirenB' && s.siren && (s.slot === 6 || s.slot === 8)) c = [0.2, 0.35, 1];
        }
        ga[i * 3] = c[0]; ga[i * 3 + 1] = c[1]; ga[i * 3 + 2] = c[2]; if (c[0] + c[1] + c[2] > 0) any = true;
      });
      this.glowGeo.attributes.color.needsUpdate = true; this.glow.visible = any;
    }
    this._lightsDirty = false;
  }
  setBrake(on) { on = !!on; if (this.st.brake !== on) { this.st.brake = on; this._refreshLights(); } }
  setHeadlights(on) { on = !!on; if (this.st.head !== on) { this.st.head = on; this._refreshLights(); } }
  setReverse(on) { on = !!on; if (this.st.rev !== on) { this.st.rev = on; this._refreshLights(); } }
  setSiren(on) {
    on = !!on; if (this.st.siren !== on) { this.st.siren = on; this._ts = 0; this.st.slot = on ? 0 : -1; this._refreshLights(); if (this.bp.onSiren) this.bp.onSiren(this, on); }
  }
  // -1 = left turn signal (+X side), 1 = right, 0 = off
  setIndicators(dir) { dir = dir | 0; if (this.st.ind !== dir) { this.st.ind = dir; this._tb = 0; this.st.blink = dir !== 0; this._refreshLights(); } }

  // ----- paint / damage
  _applyPaint() {
    const s = this.st;
    if (s.burnt) { this.paintMat.color.setHex(0x1b1918); this.paintMat.shininess = 3; this.paintMat.specular.setHex(0x000000); if (this.paint2Mat) { this.paint2Mat.color.setHex(0x1b1918); this.paint2Mat.shininess = 3; this.paint2Mat.specular.setHex(0x000000); } return; }
    this.paintMat.shininess = this.matte ? 8 : 70; this.paintMat.specular.setHex(this.matte ? 0x111111 : 0x3c3c3c);
    const dirt = new THREE.Color(0x2d2620); const f = clamp(s.damage, 0, 1) * 0.55;
    this.paintMat.color.setHex(this.bodyHex).lerp(dirt, f);
    if (this.paint2Mat) { this.paint2Mat.color.setHex(this.secHex).lerp(dirt, f); this.paint2Mat.shininess = this.matte ? 8 : 60; this.paint2Mat.specular.setHex(this.matte ? 0x111111 : 0x5a5a5a); }
  }
  setBodyColor(hex) { this.bodyHex = hex; this._applyPaint(); }
  setSecondaryColor(hex) { this.secHex = hex; this._applyPaint(); }
  _setDeformLevel(level) {
    const bp = this.bp, L = this.def.length;
    this._deform.forEach(g => g.dispose()); this._deform = [];
    const amp = [0, 0.03, 0.06][level], cr = [0, 0.03, 0.09][level];
    const swap = (name, key) => { const m = this.meshes[name]; if (!m) return; if (level === 0) { m.geometry = key === 'lights' ? this.lightGeo : bp.geos[name]; return; }
      if (key === 'lights') { const g = deformGeometry(bp.geos.lights, amp, cr, L); g.setAttribute('color', this.lightGeo.attributes.color); this._deform.push(g); m.geometry = g; }
      else { const g = deformGeometry(bp.geos[name], amp, cr, L); this._deform.push(g); m.geometry = g; } };
    if (bp.damageable !== false) { swap('paint', 'paint'); swap('paint2', 'paint2'); swap('detail', 'detail'); swap('glass', 'glass'); swap('lights', 'lights'); }
    this.meshes.glass.material = shared().glass[level];
  }
  setDamage(d) {
    d = clamp(+d || 0, 0, 1); const s = this.st; s.damage = d;
    const level = d >= 0.66 ? 2 : d >= 0.33 ? 1 : 0;
    if (level !== s.level && !s.burnt) { s.level = level; this._setDeformLevel(level); }
    this._applyPaint();
  }
  setBurnt(on) {
    on = !!on; const s = this.st; if (s.burnt === on) return; s.burnt = on; const sh = shared();
    this.meshes.glass.visible = !on;
    this.detailMeshes.forEach(d => { d.material = on ? sh.detailBurnt : sh.detail; });
    this.wheels.forEach(w => { w.mesh.material = on ? sh.wheelBurnt : sh.wheel; });
    if (on) { s.siren = false; s.ind = 0; s.blink = false; if (this.bp.onSiren) this.bp.onSiren(this, false); }
    this._applyPaint(); this._refreshLights();
    if (this.bp.onBurnt) this.bp.onBurnt(this, on);
  }

  // ----- per-frame
  update(dt) {
    const s = this.st; let dirty = false;
    if (s.ind !== 0 && !s.burnt) { this._tb += dt; const b = (this._tb % 0.7) < 0.35; if (b !== s.blink) { s.blink = b; dirty = true; } }
    if (s.siren && !s.burnt) { this._ts += dt; const slot = Math.floor(this._ts / 0.085) % 12; if (slot !== s.slot) { s.slot = slot; dirty = true; } }
    if (dirty) this._refreshLights();
    for (let i = 0; i < this._anim.length; i++) this._anim[i](dt);
  }

  dispose() {
    this._owned.forEach(o => o.dispose()); this._owned = [];
    this._deform.forEach(g => g.dispose()); this._deform = [];
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this.bp.dispose) this.bp.dispose(this);
  }
}

export function createVehicleModel(type, colors = { body: 0xcc2222, secondary: null }) {
  return new VehicleModel(type, colors || {});
}
export function vehicleTriangleCount(type) {
  const bp = getBlueprint(type); let t = 0;
  for (const k in bp.geos) if (bp.geos[k]) t += bp.geos[k].attributes.position.count / 3;
  const wg = bp.wheels.length ? bp.wheels.map(w => (w.geo ? w.geo() : wheelGeometry(w.radius, w.ww ?? bp.wheelW, bp.wheelStyle)).attributes.position.count / 3).reduce((a, b) => a + b, 0) : 0;
  return { body: Math.round(t), wheels: Math.round(wg), total: Math.round(t + wg) };
}
/** Free the cached geometry/materials (only needed when tearing down the whole game). */
export function disposeVehicleCaches() {
  for (const bp of bpCache.values()) for (const k in bp.geos) if (bp.geos[k]) bp.geos[k].dispose();
  bpCache.clear(); wheelGeoCache.forEach(g => g.dispose()); wheelGeoCache.clear(); thinWheelCache.forEach(g => g.dispose()); thinWheelCache.clear();
  if (SHARED) { Object.values(SHARED).forEach(m => Array.isArray(m) ? m.forEach(x => x.dispose()) : (m.map && m.map.dispose(), m.dispose())); SHARED = null; }
}
