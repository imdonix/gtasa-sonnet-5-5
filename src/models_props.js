// Los Santos Rising - procedural street / yard / nature props.
// Every prop = ONE merged, vertex-coloured BufferGeometry (base at y=0, origin at the centre of the base, faces +Z).
// Emissive-looking parts (lamp lenses, signal lights, billboard faces, vending fronts ...) are encoded with vertex
// colours whose brightest channel is > 1.0; createPropMaterial() turns those into real emission (see setPropNight).
import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------------------
// radius/solid: circular collider for the engine.  colliders: optional multi-circle footprint for long props.
// bounds: {w (x), d (z)} footprint box.  lightOffset: local position of the light source (night glow / light pool).
export const PROP_DEFS = {
  palm:          { radius: 0.4,  height: 13,  solid: true },
  palm_small:    { radius: 0.3,  height: 5.2, solid: true },
  tree:          { radius: 0.5,  height: 8.3,   solid: true },
  bush:          { radius: 0.7,  height: 1, solid: false },
  lamp:          { radius: 0.2,  height: 7.9, solid: true, lightOffset: { x: 0, y: 7.55, z: 2.0 } },
  trafficlight:  { radius: 0.25, height: 5.7, solid: true, lightOffset: { x: 3.3, y: 5.36, z: 0.2 } },
  hydrant:       { radius: 0.22, height: 0.8, solid: true },
  trashcan:      { radius: 0.32, height: 1.1, solid: true },
  dumpster:      { radius: 1.0,  height: 1.7, solid: true, bounds: { w: 2.0, d: 1.3 }, colliders: [{ x: -0.6, z: 0, r: 0.7 }, { x: 0.6, z: 0, r: 0.7 }] },
  bench:         { radius: 0.5,  height: 1.1, solid: true, bounds: { w: 1.8, d: 0.6 }, colliders: [{ x: -0.6, z: 0, r: 0.35 }, { x: 0.6, z: 0, r: 0.35 }] },
  bollard:       { radius: 0.15, height: 1, solid: true },
  mailbox:       { radius: 0.3,  height: 1.3, solid: true },
  busstop:       { radius: 0.5,  height: 2.7, solid: false, bounds: { w: 3.2, d: 1.5 }, colliders: [{ x: -1.5, z: -0.6, r: 0.25 }, { x: 1.5, z: -0.6, r: 0.25 }, { x: 0, z: -0.65, r: 0.25 }] },
  billboard:     { radius: 0.5,  height: 10.9, solid: true, bounds: { w: 8.4, d: 0.8 }, colliders: [{ x: -2.6, z: 0, r: 0.45 }, { x: 2.6, z: 0, r: 0.45 }] },
  sign_stop:     { radius: 0.15, height: 2.6, solid: true },
  fence_segment: { radius: 0.25, height: 1.9, solid: false, bounds: { w: 4.0, d: 0.15 }, colliders: [{ x: -1.5, z: 0, r: 0.2 }, { x: -0.5, z: 0, r: 0.2 }, { x: 0.5, z: 0, r: 0.2 }, { x: 1.5, z: 0, r: 0.2 }] },
  crate:         { radius: 0.55, height: 1.2, solid: true },
  barrel:        { radius: 0.4,  height: 1, solid: true },
  container:     { radius: 1.3,  height: 2.7, solid: true, bounds: { w: 2.4, d: 12 }, colliders: [-4.8, -2.4, 0, 2.4, 4.8].map(z => ({ x: 0, z, r: 1.3 })) },
  cone:          { radius: 0.25, height: 0.7, solid: false },
  phonebooth:    { radius: 0.55, height: 2.5, solid: true },
  vending:       { radius: 0.5,  height: 1.9, solid: true },
  newspaper:     { radius: 0.3,  height: 1.1, solid: true },
  parkingmeter:  { radius: 0.12, height: 1.5, solid: true },
  tombstone:     { radius: 0.4,  height: 1.4, solid: true },
  streetsign:    { radius: 0.12, height: 3.5, solid: true },
  pallet:        { radius: 0.7,  height: 0.2, solid: false, bounds: { w: 1.2, d: 1.0 } },
  tyre_stack:    { radius: 0.45, height: 1.2, solid: true },
  sofa:          { radius: 0.95, height: 1.1, solid: true, bounds: { w: 1.9, d: 0.9 }, colliders: [{ x: -0.5, z: 0, r: 0.5 }, { x: 0.5, z: 0, r: 0.5 }] },
  grill:         { radius: 0.4,  height: 1.1, solid: true },
  pool_chair:    { radius: 0.5,  height: 1.2, solid: false, bounds: { w: 0.7, d: 1.9 } },
  umbrella_beach:{ radius: 0.15, height: 2.6, solid: true },
  lifeguard_tower:{ radius: 1.3, height: 4.6, solid: true, bounds: { w: 2.4, d: 2.4 } },
  cactus:        { radius: 0.35, height: 2.2, solid: true },
  rock:          { radius: 0.9,  height: 1.3, solid: true },
  hedge_segment: { radius: 0.55, height: 1.4, solid: true, bounds: { w: 4.0, d: 1.0 }, colliders: [-1.5, -0.5, 0.5, 1.5].map(x => ({ x, z: 0, r: 0.55 })) },
  wall_segment:  { radius: 0.3,  height: 2.7, solid: true, bounds: { w: 4.0, d: 0.3 }, colliders: [-1.5, -0.5, 0.5, 1.5].map(x => ({ x, z: 0, r: 0.3 })) },
  garden_gnome:  { radius: 0.15, height: 0.7, solid: false },
  utility_pole:  { radius: 0.2,  height: 10,  solid: true },
  planter:       { radius: 0.65, height: 1.8, solid: true },
  jersey_barrier:{ radius: 0.4,  height: 0.9, solid: true, bounds: { w: 3.0, d: 0.6 }, colliders: [-1.0, 0, 1.0].map(x => ({ x, z: 0, r: 0.4 })) },
  foodcart:      { radius: 1.0,  height: 2.6, solid: true, bounds: { w: 1.8, d: 1.2 }, colliders: [{ x: -0.4, z: 0, r: 0.75 }, { x: 0.4, z: 0, r: 0.75 }] },
  bike_rack:     { radius: 0.5,  height: 0.9, solid: false, bounds: { w: 1.6, d: 0.3 } },
};
export const PROP_KINDS = Object.keys(PROP_DEFS);

const VARIANTS = {
  palm: 3, palm_small: 2, tree: 4, bush: 3, lamp: 2, trafficlight: 3, hydrant: 2, trashcan: 2, dumpster: 2, bench: 2, bollard: 2, mailbox: 2,
  busstop: 2, billboard: 4, sign_stop: 1, fence_segment: 2, crate: 3, barrel: 3, container: 6, cone: 2, phonebooth: 2, vending: 4, newspaper: 3,
  parkingmeter: 1, tombstone: 4, streetsign: 2, pallet: 1, tyre_stack: 2, sofa: 3, grill: 2, pool_chair: 3, umbrella_beach: 4, lifeguard_tower: 2,
  cactus: 3, rock: 4, hedge_segment: 2, wall_segment: 3, garden_gnome: 2, utility_pole: 1, planter: 2, jersey_barrier: 2, foodcart: 2, bike_rack: 1,
};
export function propVariantCount(kind) { return VARIANTS[kind] || 1; }

// ---------------------------------------------------------------------------------------------
// Geometry accumulator
// ---------------------------------------------------------------------------------------------
const colCache = new Map(); const _tc = new THREE.Color();
function C(h) {
  if (Array.isArray(h)) return h;
  let v = colCache.get(h); if (!v) { _tc.set(h); v = [_tc.r, _tc.g, _tc.b]; colCache.set(h, v); } return v;
}
const E = (h, k = 1.8) => { const c = C(h); return [c[0] * k, c[1] * k, c[2] * k]; };   // emissive-looking (brightest channel > 1)
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
const grad = (y0, y1, c0, c1) => (p) => mix(c0, c1, clamp((p[1] - y0) / (y1 - y0 || 1), 0, 1));
const gradRand = (c0, c1, amt) => (p) => mul(mix(c0, c1, hash(Math.round(p[0] * 10), Math.round(p[1] * 10), Math.round(p[2] * 10))), 1);
const cv = (c, p) => (typeof c === 'function' ? c(p) : c);

class PB {
  constructor() { this.p = []; this.n = []; this.c = []; }
  get count() { return this.p.length / 3; }
  _v(p, n, c) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); const k = cv(c, p); this.c.push(k[0], k[1], k[2]); }
  tri(a, b, c, col) {
    const u = sub(b, a), v = sub(c, a); const n = cross(u, v); const l = Math.hypot(n[0], n[1], n[2]); if (l < 1e-10) return;
    const nn = [n[0] / l, n[1] / l, n[2] / l]; this._v(a, nn, col); this._v(b, nn, col); this._v(c, nn, col);
  }
  triS(a, b, c, na, nb, nc, col) { // smooth normals, winding fixed by na
    const g = cross(sub(b, a), sub(c, a)); if (Math.hypot(g[0], g[1], g[2]) < 1e-10) return;
    if (dot(g, na) < 0) { this._v(a, na, col); this._v(c, nc, col); this._v(b, nb, col); } else { this._v(a, na, col); this._v(b, nb, col); this._v(c, nc, col); }
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  quadF(a, b, c, d, dir, col) {
    const n = add(cross(sub(b, a), sub(c, a)), cross(sub(c, a), sub(d, a)));
    if (dot(n, dir) < 0) this.quad(a, d, c, b, col); else this.quad(a, b, c, d, col);
  }
  quadO(a, b, c, d, ctr, col) { this.quadF(a, b, c, d, sub([(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4], ctr), col); }
  quad2(a, b, c, d, col) { this.quad(a, b, c, d, col); this.quad(a, d, c, b, col); }   // double-sided
  poly(pts, dir, col) {
    for (let i = 1; i < pts.length - 1; i++) { const n = cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0])); if (dot(n, dir) >= 0) this.tri(pts[0], pts[i], pts[i + 1], col); else this.tri(pts[0], pts[i + 1], pts[i], col); }
  }
  // axis-aligned box; c = colour or function(p) -> colour
  box(cx, cy, cz, sx, sy, sz, c, ry = 0) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2; const co = Math.cos(ry), si = Math.sin(ry);
    const P = (x, y, z) => [cx + x * co + z * si, cy + y, cz - x * si + z * co];
    const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
    const ctr = [cx, cy, cz]; const f = (a, b, c2, d) => this.quadO(v[a], v[b], v[c2], v[d], ctr, c);
    f(4, 5, 6, 7); f(1, 0, 3, 2); f(5, 1, 2, 6); f(0, 4, 7, 3); f(7, 6, 2, 3); f(0, 1, 5, 4);
  }
  // box from two points with cross-section w x h (hint = up-ish vector)
  beam(p0, p1, w, h, c, hint) {
    const d = norm(sub(p1, p0)); let hh = hint || [0, 1, 0]; let s = cross(d, hh); if (Math.hypot(s[0], s[1], s[2]) < 1e-3) { hh = [1, 0, 0]; s = cross(d, hh); }
    s = norm(s); const t = norm(cross(s, d));
    const cc = (p, i, j) => [p[0] + s[0] * w / 2 * i + t[0] * h / 2 * j, p[1] + s[1] * w / 2 * i + t[1] * h / 2 * j, p[2] + s[2] * w / 2 * i + t[2] * h / 2 * j];
    const A0 = [cc(p0, -1, -1), cc(p0, 1, -1), cc(p0, 1, 1), cc(p0, -1, 1)], A1 = [cc(p1, -1, -1), cc(p1, 1, -1), cc(p1, 1, 1), cc(p1, -1, 1)];
    const ctr = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; this.quadO(A0[i], A0[j], A1[j], A1[i], ctr, c); }
    this.poly(A0, sub(p0, p1), c); this.poly(A1, sub(p1, p0), c);
  }
  // tapered tube between two points; o: {smooth=true, caps=true, phase, colTop}
  tube(p0, p1, r0, r1, segs, c, o = {}) {
    const d = norm(sub(p1, p0)); let hint = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm(cross(d, hint)), v = norm(cross(d, u));
    const ph = o.phase || 0; const len = Math.hypot(...sub(p1, p0)) || 1; const slope = (r0 - r1) / len;
    const ring = (p, r, k) => { const a = ph + k / segs * Math.PI * 2; const dir = [u[0] * Math.cos(a) + v[0] * Math.sin(a), u[1] * Math.cos(a) + v[1] * Math.sin(a), u[2] * Math.cos(a) + v[2] * Math.sin(a)]; return { p: [p[0] + dir[0] * r, p[1] + dir[1] * r, p[2] + dir[2] * r], n: norm([dir[0] + d[0] * slope, dir[1] + d[1] * slope, dir[2] + d[2] * slope]), dir }; };
    const smooth = o.smooth !== false; const c1 = o.colTop || c;
    for (let k = 0; k < segs; k++) {
      const a0 = ring(p0, r0, k), a1 = ring(p0, r0, k + 1), b0 = ring(p1, r1, k), b1 = ring(p1, r1, k + 1);
      if (smooth) { this.triS(a0.p, a1.p, b1.p, a0.n, a1.n, b1.n, c); this.triS(a0.p, b1.p, b0.p, a0.n, b1.n, b0.n, c); }
      else { const dir = norm([a0.dir[0] + a1.dir[0], a0.dir[1] + a1.dir[1], a0.dir[2] + a1.dir[2]]); this.quadF(a0.p, a1.p, b1.p, b0.p, dir, c); }
    }
    if (o.caps !== false) {
      const top = [], bot = []; for (let k = 0; k < segs; k++) { top.push(ring(p1, r1, k).p); bot.push(ring(p0, r0, k).p); }
      if (r1 > 1e-4) this.poly(top, d, o.capColTop || c); if (r0 > 1e-4) this.poly(bot, [-d[0], -d[1], -d[2]], c);
    }
  }
  cyl(cx, y0, cz, rb, rt, h, segs, c, o) { this.tube([cx, y0, cz], [cx, y0 + h, cz], rb, rt, segs, c, o); }
  cone(cx, y0, cz, r, h, segs, c, o) { this.tube([cx, y0, cz], [cx, y0 + h, cz], r, 0, segs, c, o); }
  // lumpy flat-shaded ellipsoid
  blob(cx, cy, cz, rx, ry, rz, c, o = {}) {
    const g = new THREE.IcosahedronGeometry(1, o.detail === undefined ? 1 : o.detail); const pos = g.attributes.position; const j = o.jitter ?? 0.15; const seed = o.seed || 0;
    const vs = []; for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const hh = 1 + (hash(Math.round(x * 50) + seed, Math.round(y * 50), Math.round(z * 50)) - 0.5) * 2 * j;
      let py = y * ry; if (o.flatBottom !== undefined && y < o.flatBottom) py = o.flatBottom * ry;
      vs.push([cx + x * rx * hh, cy + py * (o.squashTop && y > 0 ? 1 : 1) * 1 + 0, cz + z * rz * hh]);
    }
    for (let i = 0; i < pos.count; i += 3) this.tri(vs[i], vs[i + 1], vs[i + 2], c);
    g.dispose();
  }
  torus(cx, cy, cz, R, r, segs, tsegs, c, rotX = 0) {
    const g = new THREE.TorusGeometry(R, r, tsegs, segs); g.rotateX(Math.PI / 2 + rotX); g.translate(cx, cy, cz); const ng = g.toNonIndexed(); const p = ng.attributes.position, n = ng.attributes.normal;
    for (let i = 0; i < p.count; i++) this._v([p.getX(i), p.getY(i), p.getZ(i)], [n.getX(i), n.getY(i), n.getZ(i)], c); g.dispose(); ng.dispose();
  }
  // apply a matrix to vertices added by fn
  xf(fn, m) {
    const s = this.count; fn(); const e = this.count; const v = new THREE.Vector3(); const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = s; i < e; i++) {
      v.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]).applyMatrix4(m); this.p[i * 3] = v.x; this.p[i * 3 + 1] = v.y; this.p[i * 3 + 2] = v.z;
      v.set(this.n[i * 3], this.n[i * 3 + 1], this.n[i * 3 + 2]).applyMatrix3(nm).normalize(); this.n[i * 3] = v.x; this.n[i * 3 + 1] = v.y; this.n[i * 3 + 2] = v.z;
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
}
const M4 = (tx, ty, tz, ry = 0, rx = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(tx, ty, tz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));

// ---------------------------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------------------------
const PAL = {
  steel: C(0x6b7178), steelD: C(0x40444a), steelL: C(0x9aa0a8), black: C(0x1b1c1f), concrete: C(0x9d9d96), concreteD: C(0x7d7d77), white: C(0xf0f0ea),
  wood: C(0x8b5e34), woodD: C(0x5e3d1f), woodL: C(0xb58a55), green: C(0x2f7d3a), greenL: C(0x5aa84a), greenD: C(0x1f5a2c), red: C(0xc8241c), yellow: C(0xe2b626),
  blue: C(0x2a5a9e), orange: C(0xe8761e), glassB: C(0x9cc4d8), trunk: C(0x8a6a48), trunkD: C(0x6a4e34),
};

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------
const BUILD = {};

// ---- palms
function frondsColoured(B, crown, n, len, o = {}) {
  // same as fronds but with gradient rib->edge colours by using per-vertex colours
  for (let k = 0; k < n; k++) {
    const th = k / n * Math.PI * 2 + (o.phase || 0) + (hash(k, n, 3) - 0.5) * 0.4;
    const el = (k % 2 ? 0.05 : 0.6) + (hash(k, 7, n) - 0.5) * 0.3 - (o.droopy || 0);
    const L = len * (0.85 + hash(k, 2, 5) * 0.3); const dir = [Math.cos(th), 0, Math.sin(th)]; const side = [-Math.sin(th), 0, Math.cos(th)];
    const N = 6; const rib = [], left = [], right = [];
    const cRib = o.ribCol || C(0x7fbe5a), cEdge = o.edgeCol || C(0x2a7a34);
    for (let i = 0; i <= N; i++) {
      const s = i / N; const hx = L * s * Math.cos(el); const y = L * (Math.sin(el) * s - (o.droop ?? 0.6) * s * s);
      const p = [crown[0] + dir[0] * hx, crown[1] + y, crown[2] + dir[2] * hx]; rib.push(p);
      const w = (o.width ?? 0.5) * Math.pow(Math.sin(Math.PI * (0.1 + 0.9 * s)), 0.7) * (1 - 0.2 * s) * (i === N ? 0.12 : 1) * ((i % 2) ? 0.78 : 1);
      left.push([p[0] + side[0] * w, p[1] - w * 0.6, p[2] + side[2] * w]); right.push([p[0] - side[0] * w, p[1] - w * 0.6, p[2] - side[2] * w]);
    }
    const tip = (i) => mix(cRib, cEdge, i / N * 0.5);
    for (let i = 0; i < N; i++) {
      const f = (a, b, c2, d, ca, cb, cc, cd) => { // double sided, per-vertex colours via function lookup on position identity
        const map = new Map([[a, ca], [b, cb], [c2, cc], [d, cd]]); const fn = (p) => map.get(p) || ca;
        B.quad2(a, b, c2, d, fn);
      };
      f(rib[i], rib[i + 1], left[i + 1], left[i], tip(i), tip(i + 1), mul(cEdge, 1), mul(cEdge, 1));
      f(rib[i], right[i], right[i + 1], rib[i + 1], tip(i), mul(cEdge, 1), mul(cEdge, 1), tip(i + 1));
    }
  }
}
function palmTrunk(B, H, lean, rBase, rTop, n, bend, col, col2) {
  const c = (t) => [lean * t * t, H * t, Math.sin(t * 2.6 + bend) * 0.22 * t];
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n; const fl = (t) => 1 + 0.6 * Math.max(0, 1 - t * 9) ** 2;
    const r0 = lerp(rBase, rTop, Math.min(1, t0 * 1.4)) * fl(t0), r1 = lerp(rBase, rTop, Math.min(1, t1 * 1.4)) * fl(t1);
    const cc = i % 2 ? col2 : col;
    B.tube(c(t0), c(t1), r0, r1 * 1.0, 8, cc, { caps: i === 0 || i === n - 1 });
    // ring scar
    if (i > 0) B.tube(c(t0), [c(t0)[0], c(t0)[1] + 0.05, c(t0)[2]], r0 * 1.08, r0 * 1.08, 8, mul(col2, 0.8), { caps: false });
  }
  return c(1);
}
BUILD.palm = (B, v) => {
  const H = [12, 9.5, 10.6][v], lean = [0.9, 1.7, 0.5][v];
  const top = palmTrunk(B, H, lean, 0.3, 0.17, 16, v * 1.3, C(0x8f7050), C(0x77593c));
  B.blob(top[0], top[1] - 0.05, top[2], 0.32, 0.36, 0.32, C(0x6c4f34), { detail: 1, jitter: 0.1 });
  const crown = [top[0], top[1] + 0.15, top[2]];
  frondsColoured(B, crown, [10, 9, 11][v], [4.4, 3.8, 4.0][v], { ribCol: [C(0x8cc95f), C(0x7fbe5a), C(0x9ccf62)][v], edgeCol: [C(0x2d8038), C(0x2a7a34), C(0x3c8c38)][v], width: [0.72, 0.68, 0.8][v], droop: 0.7 });
  // dead drooping fronds
  frondsColoured(B, [crown[0], crown[1] - 0.3, crown[2]], 4, 2.6, { phase: 0.5, droopy: 0.6, droop: 0.9, ribCol: C(0x9a7a42), edgeCol: C(0x6a4e2c), width: 0.32 });
};
BUILD.palm_small = (B, v) => {
  const H = [4.6, 3.6][v];
  const top = palmTrunk(B, H, [0.4, 0.2][v], 0.22, 0.14, 8, v, C(0x8f7050), C(0x77593c));
  B.blob(top[0], top[1], top[2], 0.24, 0.26, 0.24, C(0x6c4f34), { detail: 1, jitter: 0.1 });
  frondsColoured(B, [top[0], top[1] + 0.1, top[2]], [10, 12][v], [2.3, 2.0][v], { ribCol: C(0x86c35c), edgeCol: C(0x2c7d37), width: 0.36, droop: 0.65 });
};

// ---- trees & plants
BUILD.tree = (B, v) => {
  const tr = [C(0x6b4a2e), C(0x7a5a3a), C(0x5d4028), C(0x5d4028)][v];
  const Ht = [3.0, 3.6, 3.2, 1.2][v];
  B.tube([0, 0, 0], [0.05, Ht * 0.6, 0], 0.26, 0.17, 7, tr, { caps: false }); B.tube([0.05, Ht * 0.6, 0], [0.0, Ht, 0.05], 0.17, 0.12, 7, tr, { caps: false });
  B.tube([0.05, Ht * 0.65, 0], [0.9, Ht + 0.9, 0.2], 0.1, 0.06, 5, tr); B.tube([0.03, Ht * 0.7, 0], [-0.8, Ht + 0.8, -0.3], 0.09, 0.05, 5, tr);
  const greens = [[C(0x2a6a30), C(0x5fae47)], [C(0x3a7a34), C(0x8acb58)], [C(0x6a3f9a), C(0xb48be0)], [C(0x1c4a30), C(0x3a7a4a)]][v];
  const g = (y0, y1) => grad(y0, y1, greens[0], greens[1]);
  if (v === 0) { [[0, 0, 0, 2.3, 1.8], [1.4, -0.4, 0.4, 1.7, 1.4], [-1.2, -0.2, -0.6, 1.8, 1.5], [0.2, 1.1, -0.2, 1.6, 1.3]].forEach(([x, y, z, rx, ry], i) => B.blob(x, Ht + 1.6 + y, z, rx, ry, rx * 0.95, g(Ht + 0.2, Ht + 3.8), { detail: 1, jitter: 0.12, seed: i })); }
  else if (v === 1) { [[0, 0, 0, 2.0, 2.4], [1.2, -0.7, 0.3, 1.5, 1.6], [-1.1, -0.5, -0.4, 1.5, 1.6]].forEach(([x, y, z, rx, ry], i) => B.blob(x, Ht + 2.2 + y, z, rx, ry, rx, g(Ht + 0.3, Ht + 4.8), { detail: 1, jitter: 0.12, seed: i + 5 })); }
  else if (v === 2) { [[0, 0, 0, 2.4, 1.6], [1.5, -0.2, 0.3, 1.6, 1.2], [-1.4, -0.3, -0.5, 1.7, 1.2], [0.1, 0.9, 0.2, 1.7, 1.1]].forEach(([x, y, z, rx, ry], i) => B.blob(x, Ht + 1.5 + y, z, rx, ry, rx, g(Ht + 0.3, Ht + 3.4), { detail: 1, jitter: 0.16, seed: i + 9 })); }
  else { for (let i = 0; i < 4; i++) B.blob(0, Ht + 0.9 + i * 1.5, 0, 1.25 - i * 0.22, 1.3, 1.25 - i * 0.22, g(Ht, Ht + 6.5), { detail: 1, jitter: 0.12, seed: i }); B.cone(0, Ht + 5.3, 0, 0.5, 1.5, 7, greens[1]); }
};
BUILD.bush = (B, v) => {
  const cols = [[C(0x2c6a32), C(0x5aa84a)], [C(0x1f5a2c), C(0x3a8a3c)], [C(0x2f7a38), C(0x6cbc52)]][v];
  [[0, 0, 0, 0.75, 0.55], [0.55, 0, 0.25, 0.55, 0.45], [-0.5, 0, -0.2, 0.55, 0.42], [0.1, 0.05, -0.4, 0.45, 0.4]].forEach(([x, y, z, r, h], i) => B.blob(x, h * 0.7 + y, z, r, h, r, grad(0, h * 1.6, cols[0], cols[1]), { detail: 1, jitter: 0.14, seed: i + v * 4, flatBottom: -0.3 }));
  if (v === 2) { for (let i = 0; i < 9; i++) { const a = i * 2.4; B.blob(Math.cos(a) * 0.6 * (0.4 + (i % 3) * 0.3), 0.55 + (i % 4) * 0.12, Math.sin(a) * 0.5 * (0.4 + (i % 3) * 0.3), 0.11, 0.09, 0.11, [C(0xe8508a), C(0xf08a2a), C(0xf2e050)][i % 3], { detail: 0, jitter: 0.1 }); } }
};
BUILD.cactus = (B, v) => {
  const g0 = C(0x3f8a4a), g1 = C(0x63b05a), gd = C(0x2e6a3a);
  if (v === 0) {
    B.tube([0, 0, 0], [0, 1.9, 0], 0.26, 0.23, 8, grad(0, 2, g0, g1), { caps: false }); B.blob(0, 1.9, 0, 0.23, 0.26, 0.23, g1, { detail: 1, jitter: 0.02 });
    B.tube([0.25, 0.85, 0], [0.75, 1.0, 0], 0.15, 0.15, 7, g0, { caps: false }); B.tube([0.75, 1.0, 0], [0.75, 1.65, 0], 0.15, 0.14, 7, grad(1, 1.7, g0, g1), { caps: false }); B.blob(0.75, 1.68, 0, 0.14, 0.17, 0.14, g1, { detail: 1, jitter: 0.02 });
    B.tube([-0.22, 1.15, 0], [-0.62, 1.3, 0.1], 0.13, 0.13, 7, g0, { caps: false }); B.tube([-0.62, 1.3, 0.1], [-0.62, 1.95, 0.1], 0.13, 0.12, 7, grad(1.3, 2, g0, g1), { caps: false }); B.blob(-0.62, 1.97, 0.1, 0.12, 0.15, 0.12, g1, { detail: 1, jitter: 0.02 });
  } else if (v === 1) { B.blob(0, 0.35, 0, 0.42, 0.38, 0.42, grad(0, 0.8, g0, g1), { detail: 1, jitter: 0.05 }); B.blob(0, 0.72, 0, 0.12, 0.05, 0.12, C(0xe85a8a), { detail: 0, jitter: 0 }); }
  else { [[0, 0, 0, 0.42, 0.5, 0.0], [0.3, 0.42, 0.05, 0.3, 0.38, 0.3], [-0.26, 0.4, -0.05, 0.27, 0.34, -0.25], [0.0, 0.85, 0.05, 0.22, 0.28, 0.1]].forEach(([x, y, z, rx, ry, rz], i) => B.blob(x, y + 0.3, z, rx, ry, 0.09, grad(0, 1.4, g0, g1), { detail: 1, jitter: 0.04, seed: i })); }
};
BUILD.rock = (B, v) => {
  const cols = [[C(0x6a665e), C(0x96928a)], [C(0x7a6a52), C(0xa8967a)], [C(0x5a5a5e), C(0x8a8a90)], [C(0x7e7468), C(0xaaa092)]][v];
  const s = [1, 0.75, 0.55, 1.15][v];
  B.blob(0, 0.45 * s, 0, 0.9 * s, 0.62 * s, 0.8 * s, grad(0, 1.2 * s, cols[0], cols[1]), { detail: 1, jitter: 0.28, seed: v * 13, flatBottom: -0.35 });
  B.blob(0.65 * s, 0.22 * s, 0.35 * s, 0.45 * s, 0.32 * s, 0.4 * s, grad(0, 0.8 * s, cols[0], cols[1]), { detail: 1, jitter: 0.25, seed: v * 13 + 4, flatBottom: -0.3 });
};
BUILD.hedge_segment = (B, v) => {
  const g0 = v ? C(0x2a6a30) : C(0x2a6a30), g1 = v ? C(0x58a848) : C(0x4a9a42);
  const c = (p) => { const n = hash(Math.round(p[0] * 8), Math.round(p[1] * 8), Math.round(p[2] * 8)); return mul(mix(g0, g1, clamp(p[1] / 1.4 + (n - 0.5) * 0.5, 0, 1)), 1); };
  for (let i = 0; i < 4; i++) { const x = -1.5 + i; B.box(x, 0.65, 0, 1.0, 1.3, 0.95, c); B.box(x, 0.7, 0, 0.92, 1.4, 0.85, c); }
  if (v) for (let i = 0; i < 14; i++) B.blob(-1.9 + (i * 0.29) % 3.9, 1.0 + hash(i, 1, 1) * 0.35, (i % 2 ? 0.48 : -0.48), 0.09, 0.08, 0.09, [C(0xf06aa0), C(0xf0d040), C(0xffffff)][i % 3], { detail: 0, jitter: 0.1 });
};

// ---- street furniture
BUILD.lamp = (B, v) => {
  const pole = C(0x5d6268), poleL = C(0x7a8086);
  if (v === 0) {
    B.cyl(0, 0, 0, 0.17, 0.17, 0.12, 8, PAL.steelD); B.cyl(0, 0.12, 0, 0.12, 0.085, 7.1, 8, grad(0, 7.2, pole, poleL), { caps: false });
    B.cyl(0, 0.9, 0, 0.14, 0.14, 0.05, 8, PAL.steelD);
    const arm = [[0, 7.2, 0], [0, 7.45, 0.32], [0, 7.66, 0.78], [0, 7.75, 1.3], [0, 7.72, 1.8]];
    for (let i = 0; i < arm.length - 1; i++) B.tube(arm[i], arm[i + 1], i ? 0.06 : 0.075, 0.06, 6, pole, { caps: false });
    B.box(0, 7.68, 2.05, 0.46, 0.14, 1.05, grad(7.6, 7.78, C(0x606569), C(0x858a90)));
    B.box(0, 7.6, 2.05, 0.4, 0.04, 0.92, E(0xffe9a8, 2.2));
    B.box(0, 7.77, 1.6, 0.3, 0.08, 0.3, PAL.steelD);
  } else {
    B.cyl(0, 0, 0, 0.26, 0.2, 0.3, 8, C(0x3d4a44)); B.cyl(0, 0.3, 0, 0.17, 0.09, 3.8, 8, C(0x34473f)); B.cyl(0, 0.3, 0, 0.2, 0.2, 0.08, 8, C(0x55695f));
    B.cyl(0, 2.0, 0, 0.12, 0.12, 0.06, 8, C(0x55695f)); B.cyl(0, 3.95, 0, 0.17, 0.15, 0.16, 8, C(0x55695f));
    B.cyl(0, 4.1, 0, 0.3, 0.23, 0.12, 8, C(0x34473f));
    B.blob(0, 4.5, 0, 0.3, 0.36, 0.3, E(0xfff2c8, 1.9), { detail: 1, jitter: 0.0 });
    B.cone(0, 4.82, 0, 0.3, 0.24, 8, C(0x34473f)); B.cyl(0, 5.05, 0, 0.03, 0.03, 0.14, 5, C(0x55695f));
    for (const s of [-1, 1]) { B.tube([0, 2.6, 0], [s * 0.45, 2.9, 0], 0.04, 0.03, 5, C(0x34473f)); B.blob(s * 0.5, 2.98, 0, 0.14, 0.17, 0.14, E(0xfff2c8, 1.9), { detail: 0, jitter: 0 }); }
  }
};
export function propLightOffset(kind, variant = 0) {
  if (kind === 'lamp') return variant === 0 ? { x: 0, y: 7.55, z: 2.05 } : { x: 0, y: 4.5, z: 0 };
  if (kind === 'trafficlight') return { x: 3.3, y: [5.36, 4.64, 5.0][variant] ?? 5.0, z: 0.2 };   // red, green, yellow lamp
  const d = PROP_DEFS[kind]; return d && d.lightOffset ? { ...d.lightOffset } : null;
}
function signalHead(B, x, y, z, active, facing = 1) {
  const hx = x, hz = z;
  B.box(hx, y, hz, 0.42, 1.12, 0.32, PAL.black);
  B.box(hx, y, hz - facing * 0.22, 0.58, 1.3, 0.03, C(0x2a2a2a));
  const lamps = [[0.36, C(0xff2a18), C(0x3a0c08)], [0, C(0xffb818), C(0x3a2a08)], [-0.36, C(0x28ff58), C(0x083a14)]];
  lamps.forEach(([dy, on, off], i) => {
    const isOn = active === i;
    B.cyl(hx, y + dy, hz + facing * 0.17, 0.125, 0.125, 0.03, 10, isOn ? E(on, 1.9) : off, { smooth: false });
    B.box(hx, y + dy + 0.14, hz + facing * 0.25, 0.3, 0.03, 0.16, PAL.black);
    B.box(hx - 0.15, y + dy, hz + facing * 0.25, 0.03, 0.26, 0.16, PAL.black); B.box(hx + 0.15, y + dy, hz + facing * 0.25, 0.03, 0.26, 0.16, PAL.black);
  });
}
BUILD.trafficlight = (B, v) => {
  const pole = C(0x4a4e54);
  B.cyl(0, 0, 0, 0.19, 0.19, 0.25, 8, pole); B.cyl(0, 0.25, 0, 0.13, 0.085, 5.15, 8, pole, { caps: false });
  // arm towards +X
  B.tube([0, 5.0, 0], [0.8, 5.15, 0], 0.085, 0.07, 7, pole, { caps: false }); B.tube([0.8, 5.15, 0], [3.6, 5.3, 0], 0.07, 0.05, 7, pole);
  B.beam([0.1, 4.6, 0], [1.4, 5.15, 0], 0.05, 0.05, pole);
  const act = [0, 2, 1][v];   // variant 0 = red, 1 = green, 2 = yellow
  signalHead(B, 1.5, 5.0, 0.0, act, 1); signalHead(B, 3.3, 5.0, 0.0, act, 1);
  // pole-mounted head + pedestrian box
  signalHead(B, 0, 3.0, 0.23, act, 1);
  B.box(0.25, 2.3, 0.12, 0.3, 0.3, 0.12, PAL.black); B.box(0.25, 2.3, 0.19, 0.22, 0.22, 0.02, E(0xff8a20, 1.6));
};
BUILD.hydrant = (B, v) => {
  const c = v ? C(0xe0b020) : C(0xc8241c), cap = v ? C(0xb88a10) : C(0xe0e0e0), cB = grad(0, 0.7, mul(c, 0.8), c);
  B.cyl(0, 0, 0, 0.17, 0.17, 0.06, 8, C(0x55585c)); B.cyl(0, 0.06, 0, 0.13, 0.12, 0.46, 8, cB); B.cyl(0, 0.52, 0, 0.15, 0.15, 0.05, 8, c);
  B.blob(0, 0.57, 0, 0.12, 0.1, 0.12, c, { detail: 1, jitter: 0 }); B.cyl(0, 0.64, 0, 0.045, 0.045, 0.08, 6, cap);
  for (const s of [-1, 1]) { B.tube([s * 0.1, 0.36, 0], [s * 0.25, 0.36, 0], 0.055, 0.055, 7, c); B.tube([s * 0.25, 0.36, 0], [s * 0.27, 0.36, 0], 0.07, 0.07, 7, cap); }
  B.tube([0, 0.3, 0.1], [0, 0.3, 0.22], 0.075, 0.075, 7, c); B.tube([0, 0.3, 0.22], [0, 0.3, 0.24], 0.09, 0.09, 7, cap);
};
BUILD.trashcan = (B, v) => {
  const c = v ? C(0x2f5d3c) : C(0x6f767d), cl = v ? C(0x3d7a4e) : C(0x98a0a8);
  B.cyl(0, 0, 0, 0.26, 0.31, 0.9, 10, grad(0, 0.9, c, cl), { caps: false, smooth: false }); B.cyl(0, 0, 0, 0.26, 0.26, 0.02, 10, PAL.black);
  B.cyl(0, 0.3, 0, 0.3, 0.3, 0.05, 10, mul(c, 0.7), { caps: false }); B.cyl(0, 0.6, 0, 0.31, 0.31, 0.05, 10, mul(c, 0.7), { caps: false });
  B.cyl(0, 0.88, 0, 0.33, 0.34, 0.05, 10, mul(c, 0.75)); B.blob(0, 0.92, 0, 0.33, 0.1, 0.33, cl, { detail: 1, jitter: 0, flatBottom: 0 });
  if (!v) B.blob(0.05, 1.0, 0.05, 0.14, 0.1, 0.12, C(0x2a2d30), { detail: 0, jitter: 0.2 });
};
BUILD.dumpster = (B, v) => {
  const c = v ? C(0x2c4f86) : C(0x2f6b43), cd = mul(c, 0.7), lid = C(0x25272b);
  for (const sx of [-0.8, 0.8]) for (const sz of [-0.4, 0.4]) { B.cyl(sx, 0, sz, 0.09, 0.09, 0.14, 7, PAL.black); }
  B.box(0, 0.78, 0, 2.0, 1.2, 1.25, grad(0.2, 1.4, cd, c));
  B.box(0, 1.42, 0.05, 2.08, 0.06, 1.35, cd);
  // lids
  B.quadF([-1.03, 1.45, 0.72], [1.03, 1.45, 0.72], [1.03, 1.62, 0.0], [-1.03, 1.62, 0.0], [0, 1, 0.5], lid); B.quadF([-1.03, 1.45, 0.0], [1.03, 1.45, 0.0], [1.03, 1.62, -0.66], [-1.03, 1.62, -0.66], [0, 1, -0.2], mul(lid, 1.2));
  B.box(0, 1.535, 0.72, 2.06, 0.18, 0.05, lid);
  // ribs + yellow stripes
  for (const x of [-0.65, 0, 0.65]) B.box(x, 0.8, 0.64, 0.06, 1.1, 0.03, cd);
  B.box(0.0, 0.3, 0.64, 2.02, 0.08, 0.03, C(0xe0b020)); B.box(0, 1.25, 0.64, 2.02, 0.05, 0.03, C(0xe0b020));
  B.box(-0.6, 0.85, 0.66, 0.5, 0.35, 0.02, mul(c, 1.5)); B.box(0.45, 0.6, 0.66, 0.4, 0.25, 0.02, mul(c, 0.55));
};
BUILD.bench = (B, v) => {
  const w = v ? C(0x3f7d4c) : C(0x94642f), wd = mul(w, 0.75), m = v ? C(0xbcbcb4) : C(0x2f3236);
  for (let i = 0; i < 3; i++) B.box(0, 0.47, -0.18 + i * 0.18, 1.8, 0.05, 0.16, i % 2 ? w : mul(w, 1.08));
  for (let i = 0; i < 3; i++) B.box(0, 0.63 + i * 0.16, -0.27 - i * 0.03, 1.8, 0.12, 0.04, i % 2 ? w : mul(w, 1.08));
  for (const x of [-0.8, 0.8]) {
    if (v) { B.box(x, 0.4, -0.05, 0.12, 0.8, 0.52, m); B.box(x, 0.85, -0.3, 0.12, 0.3, 0.06, m); }
    else { B.box(x, 0.23, 0.15, 0.06, 0.46, 0.06, m); B.box(x, 0.23, -0.22, 0.06, 0.46, 0.06, m); B.beam([x, 0.46, -0.27], [x, 0.98, -0.34], 0.06, 0.06, m, [1, 0, 0]); B.box(x, 0.45, -0.03, 0.06, 0.05, 0.42, m); B.box(x, 0.6, -0.1, 0.06, 0.05, 0.3, m); }
  }
};
BUILD.bollard = (B, v) => {
  const c = v ? C(0x9a9a94) : C(0x8d939a);
  B.cyl(0, 0, 0, 0.11, 0.1, 0.88, 8, grad(0, 0.9, mul(c, 0.8), c), { caps: false }); B.blob(0, 0.88, 0, 0.1, 0.06, 0.1, c, { detail: 1, jitter: 0, flatBottom: 0 });
  B.cyl(0, 0.6, 0, 0.113, 0.113, 0.12, 8, v ? C(0xe8c020) : C(0xc8241c), { caps: false }); B.cyl(0, 0.6, 0, 0.113, 0.113, 0.03, 8, C(0xf0f0f0), { caps: false });
};
BUILD.mailbox = (B, v) => {
  const c = v ? C(0xc22828) : C(0x2a4f9a), cd = mul(c, 0.7);
  for (const x of [-0.17, 0.17]) B.box(x, 0.17, -0.05, 0.05, 0.34, 0.05, PAL.steelD);
  B.box(0, 0.68, 0, 0.46, 0.66, 0.56, grad(0.35, 1.0, cd, c));
  B.tube([0, 1.0, -0.28], [0, 1.0, 0.28], 0.23, 0.23, 10, c);
  B.box(0, 0.93, 0.285, 0.3, 0.05, 0.02, PAL.black); B.box(0, 0.76, 0.285, 0.26, 0.2, 0.02, PAL.white); B.box(0, 0.76, 0.295, 0.2, 0.12, 0.01, c);
  B.box(0, 0.47, 0.29, 0.34, 0.24, 0.03, cd); B.box(0, 0.47, 0.31, 0.3, 0.05, 0.02, PAL.steelL);
};
BUILD.busstop = (B, v) => {
  const fr = v ? C(0x3a4a5a) : C(0x55595f), glass = C(0x8fb4c8), roof = v ? C(0xb02a2a) : C(0x444850);
  for (const x of [-1.5, 1.5]) for (const z of [-0.55, 0.55]) B.box(x, 1.25, z, 0.09, 2.5, 0.09, fr);
  B.box(0, 2.56, 0, 3.3, 0.1, 1.4, roof); B.box(0, 2.63, 0, 3.2, 0.04, 1.3, mul(roof, 1.3));
  B.box(0, 1.35, -0.6, 3.0, 1.85, 0.03, glass); B.box(-1.5, 1.35, 0, 0.03, 1.85, 1.1, glass);
  B.box(0, 0.45, -0.3, 2.4, 0.06, 0.4, C(0x8b5e34)); B.box(0, 0.22, -0.3, 2.3, 0.05, 0.05, fr);
  B.box(0.55, 1.45, -0.54, 1.2, 1.5, 0.05, fr); B.box(0.55, 1.45, -0.508, 1.05, 1.35, 0.02, E(v ? 0x5ac8f0 : 0xf0d848, 1.5)); // ad panel
  B.box(-0.3, 1.0, -0.54, 0.5, 0.7, 0.05, C(0x333));
  B.cyl(1.9, 0, 0.0, 0.04, 0.04, 2.5, 6, PAL.steel); B.box(1.9, 2.4, 0.0, 0.5, 0.45, 0.04, C(0x2a5a9e)); B.box(1.9, 2.4, 0.03, 0.3, 0.26, 0.01, PAL.white);
};
BUILD.billboard = (B, v) => {
  const face = [E(0xf4f0dc, 1.45), E(0x64b4ff, 1.4), E(0xff8a3a, 1.45), E(0xff4a9a, 1.4)][v];
  for (const x of [-2.6, 2.6]) { B.cyl(x, 0, 0, 0.24, 0.2, 6.4, 8, grad(0, 6.4, C(0x5a5e64), C(0x7a8086)), { caps: true }); B.cyl(x, 0, 0, 0.42, 0.42, 0.22, 8, PAL.steelD); }
  B.beam([-2.6, 2.6, 0], [2.6, 2.6, 0], 0.16, 0.16, PAL.steelD); B.beam([-2.6, 4.5, 0], [2.6, 4.5, 0], 0.16, 0.16, PAL.steelD);
  B.box(0, 8.2, -0.12, 8.4, 4.6, 0.3, C(0x2a2c30));
  B.box(0, 8.2, 0.04, 8.0, 4.2, 0.04, face);
  if (v === 1) { B.box(-2.4, 8.2, 0.07, 1.6, 1.6, 0.02, E(0xffe040, 1.6)); B.box(1.2, 8.6, 0.07, 3.6, 0.5, 0.02, E(0xffffff, 1.6)); B.box(1.2, 7.7, 0.07, 3.0, 0.3, 0.02, E(0xffffff, 1.6)); }
  if (v === 2) { B.box(0, 9.3, 0.07, 6.5, 0.7, 0.02, E(0xffffff, 1.6)); B.box(-2.2, 7.6, 0.07, 2.4, 1.3, 0.02, E(0x2a4a8a, 1.3)); }
  if (v === 3) { B.box(2.0, 8.2, 0.07, 2.4, 2.4, 0.02, E(0xffe8f4, 1.6)); B.box(-1.8, 8.6, 0.07, 3.4, 0.4, 0.02, E(0xffffff, 1.6)); }
  B.box(0, 10.62, 0.2, 8.4, 0.12, 0.5, PAL.steelD);   // light rail
  for (let i = 0; i < 4; i++) B.box(-3.1 + i * 2.07, 10.74, 0.42, 0.22, 0.18, 0.25, C(0x55585c));
  B.box(0, 5.9, -0.05, 8.6, 0.12, 0.7, PAL.steelD);  // catwalk
  B.box(0, 6.38, 0.3, 8.4, 0.05, 0.05, PAL.steel);
  for (const x of [-4.2, 4.2]) B.box(x, 6.15, 0.3, 0.05, 0.5, 0.05, PAL.steel);
  B.beam([-2.6, 4.5, 0], [-1.0, 7.0, -0.2], 0.1, 0.1, PAL.steelD); B.beam([2.6, 4.5, 0], [1.0, 7.0, -0.2], 0.1, 0.1, PAL.steelD);
};
BUILD.sign_stop = (B) => {
  B.cyl(0, 0, 0, 0.035, 0.035, 2.5, 6, PAL.steel);
  const oct = (r, y, z) => Array.from({ length: 8 }, (_, i) => { const a = Math.PI / 8 + i * Math.PI / 4; return [Math.cos(a) * r, y + Math.sin(a) * r, z]; });
  B.poly(oct(0.31, 2.28, 0.04), [0, 0, 1], PAL.white); B.poly(oct(0.285, 2.28, 0.045), [0, 0, 1], C(0xc41e18));
  B.box(0, 2.28, 0.05, 0.4, 0.08, 0.01, E(0xffffff, 1.5)); B.box(-0.14, 2.28, 0.05, 0.05, 0.14, 0.01, PAL.white); B.box(0.14, 2.28, 0.05, 0.05, 0.14, 0.01, PAL.white);
  B.poly(oct(0.31, 2.28, 0.03).reverse(), [0, 0, -1], C(0x8a8e94));
};
BUILD.streetsign = (B, v) => {
  B.cyl(0, 0, 0, 0.045, 0.04, 3.4, 7, PAL.steel); B.cyl(0, 3.4, 0, 0.055, 0.0, 0.1, 7, PAL.steel);
  const g = v ? C(0x1f7a4a) : C(0x1c6a9a);
  for (const [z, ry, y] of [[0, 0, 3.22], [0, Math.PI / 2, 3.02]]) {
    const dx = ry ? 0.0 : 0.0; B.box(0, y, 0, ry ? 0.06 : 0.9, 0.22, ry ? 0.9 : 0.06, PAL.white);
    if (ry) { B.box(0, y, 0, 0.065, 0.19, 0.86, g); B.box(0, y, 0.0, 0.07, 0.04, 0.6, E(0xffffff, 1.3)); } else { B.box(0, y, 0, 0.86, 0.19, 0.065, g); B.box(0, y, 0, 0.6, 0.04, 0.07, E(0xffffff, 1.3)); }
  }
};
BUILD.fence_segment = (B, v) => {
  if (v === 0) {
    const wire = C(0xb4bac0);
    for (const x of [-1.96, 0, 1.96]) B.cyl(x, 0, 0, 0.045, 0.04, 1.85, 6, PAL.steel);
    B.beam([-2, 1.82, 0], [2, 1.82, 0], 0.04, 0.04, PAL.steel); B.beam([-2, 0.12, 0], [2, 0.12, 0], 0.03, 0.03, PAL.steel);
    // diamond mesh = two sets of thin diagonal strips (clipped to the panel)
    const y0 = 0.14, y1 = 1.8, H = y1 - y0;
    for (const dir of [1, -1]) for (let x0 = -2 - H; x0 <= 2 + H; x0 += 0.34) {
      const xs = (t) => dir > 0 ? x0 + H * t : x0 - H * t + H; // slope 45deg
      let t0 = 0, t1 = 1; const dx = dir > 0 ? H : -H, xa = dir > 0 ? x0 : x0 + H;
      // x(t) = xa + dx*t ; clip to [-1.98, 1.98]
      const lo = -1.98, hi = 1.98; if (dx > 0) { t0 = Math.max(t0, (lo - xa) / dx); t1 = Math.min(t1, (hi - xa) / dx); } else { t0 = Math.max(t0, (hi - xa) / dx); t1 = Math.min(t1, (lo - xa) / dx); }
      if (t1 - t0 < 0.03) continue;
      const pa = [xa + dx * t0, y0 + H * t0, 0.0], pb = [xa + dx * t1, y0 + H * t1, 0.0];
      B.quad2([pa[0], pa[1] - 0.008, 0], [pb[0], pb[1] - 0.008, 0], [pb[0], pb[1] + 0.008, 0], [pa[0], pa[1] + 0.008, 0], wire);
    }
    for (let i = 0; i < 3; i++) B.box(0, 0.1 + i * 0.85, 0, 3.94, 0.012, 0.012, wire);
  } else {
    const w = C(0xe8e0cf), wd = C(0xb8aa8a);
    for (const x of [-1.95, 0, 1.95]) B.box(x, 0.85, 0, 0.12, 1.7, 0.12, wd);
    B.box(0, 1.35, -0.05, 4.0, 0.08, 0.05, wd); B.box(0, 0.45, -0.05, 4.0, 0.08, 0.05, wd);
    for (let i = 0; i < 19; i++) { const x = -1.8 + i * 0.2; const hh = 1.55 + (i % 2) * 0.05; B.box(x, hh / 2 + 0.05, 0.0, 0.14, hh, 0.04, w); B.poly([[x - 0.07, hh + 0.05, 0.022], [x + 0.07, hh + 0.05, 0.022], [x, hh + 0.14, 0.022]], [0, 0, 1], w); B.poly([[x - 0.07, hh + 0.05, -0.022], [x + 0.07, hh + 0.05, -0.022], [x, hh + 0.14, -0.022]], [0, 0, -1], w); }
  }
};

// ---- industrial / urban clutter
function extrudeZY(B, pts, x0, x1, col) { // convex polygon in (z,y) extruded along x
  const n = pts.length; let cz = 0, cy = 0; pts.forEach(p => { cz += p[0] / n; cy += p[1] / n; });
  const ctr = [(x0 + x1) / 2, cy, cz];
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; B.quadO([x0, a[1], a[0]], [x1, a[1], a[0]], [x1, b[1], b[0]], [x0, b[1], b[0]], ctr, col); }
  B.poly(pts.map(p => [x1, p[1], p[0]]), [1, 0, 0], col); B.poly(pts.map(p => [x0, p[1], p[0]]), [-1, 0, 0], col);
}
BUILD.crate = (B, v) => {
  if (v === 0) {
    const w = C(0xa0733f), wd = C(0x6e4b26);
    B.box(0, 0.5, 0, 1.0, 1.0, 1.0, w);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(sx * 0.5, 0.55, sz * 0.5, 0.11, 1.1, 0.11, wd);
    for (const y of [0.08, 1.02]) { B.box(0, y, 0.5, 1.0, 0.1, 0.06, wd); B.box(0, y, -0.5, 1.0, 0.1, 0.06, wd); B.box(0.5, y, 0, 0.06, 0.1, 1.0, wd); B.box(-0.5, y, 0, 0.06, 0.1, 1.0, wd); }
    B.beam([-0.45, 0.12, 0.52], [0.45, 0.98, 0.52], 0.09, 0.05, wd, [0, 0, 1]); B.beam([0.45, 0.12, 0.52], [-0.45, 0.98, 0.52], 0.09, 0.05, C(0x7a5430), [0, 0, 1]);
    B.beam([0.52, 0.12, -0.45], [0.52, 0.98, 0.45], 0.09, 0.05, wd, [1, 0, 0]);
  } else if (v === 1) {
    const c = C(0x2f6fc2), cd = C(0x1e4a8a);
    B.box(0, 0.22, 0, 0.6, 0.44, 0.45, c, 0);
    for (const y of [0.1, 0.25, 0.38]) for (let i = 0; i < 4; i++) B.box(-0.22 + i * 0.147, y, 0.226, 0.09, 0.05, 0.01, cd);
    B.box(0, 0.44, 0, 0.64, 0.03, 0.49, cd);
    B.box(0.0, 0.66, 0.0, 0.6, 0.44, 0.45, C(0x2f6fc2), 0.0);
    for (const y of [0.54, 0.69, 0.82]) for (let i = 0; i < 4; i++) B.box(-0.22 + i * 0.147, y, 0.226, 0.09, 0.05, 0.01, cd);
  } else {
    const g = C(0x4a5a3a), gd = C(0x353f29);
    B.box(0, 0.45, 0, 1.0, 0.9, 0.7, g);
    for (const x of [-0.3, 0.3]) B.box(x, 0.45, 0.356, 0.08, 0.86, 0.03, gd); B.box(0, 0.88, 0.0, 1.06, 0.06, 0.76, gd); B.box(0, 0.06, 0.0, 1.06, 0.06, 0.76, gd);
    B.box(0, 0.6, 0.36, 0.4, 0.14, 0.01, C(0xd8d0a0)); B.box(0, 0.42, 0.36, 0.3, 0.05, 0.01, C(0xd8d0a0));
  }
};
BUILD.barrel = (B, v) => {
  const c = [C(0xb8281e), C(0x2a5aa0), C(0x3f7a44)][v]; const cd = mul(c, 0.72), cl = mul(c, 1.25);
  B.cyl(0, 0, 0, 0.28, 0.3, 0.48, 12, grad(0, 0.5, cd, c), { caps: false }); B.cyl(0, 0.48, 0, 0.3, 0.28, 0.46, 12, grad(0.48, 0.95, c, cd), { caps: false });
  for (const y of [0.03, 0.47, 0.9]) B.cyl(0, y, 0, 0.312, 0.312, 0.05, 12, cd, { caps: false });
  B.cyl(0, 0.94, 0, 0.3, 0.3, 0.02, 12, cl); B.cyl(0.1, 0.95, 0.06, 0.04, 0.04, 0.02, 6, C(0x333)); B.cyl(-0.12, 0.95, -0.05, 0.03, 0.03, 0.02, 6, C(0x777));
  if (v === 2) B.cyl(0, 0.3, 0, 0.312, 0.312, 0.16, 12, C(0xe8c020), { caps: false });
  if (v === 0) B.box(0.0, 0.3, 0.3, 0.14, 0.14, 0.01, C(0xf0d830));
};
BUILD.container = (B, v) => {
  const base = [C(0xb03a2a), C(0x2a5a9a), C(0x2a7a4a), C(0xd8761e), C(0x8a9098), C(0xd8b82a)][v];
  const dark = mul(base, 0.72), L = 12, W = 2.4, H = 2.6;
  const wall = grad(0.2, 2.6, mul(base, 0.85), base);
  // corrugated side walls (zig-zag in plan)
  const N = 40; const z0 = -L / 2 + 0.1, dz = (L - 0.2) / N;
  for (const s of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const za = z0 + i * dz, zm = za + dz * 0.5, zb = za + dz;
      const xo = s * W / 2, xi = s * (W / 2 - 0.06);
      const ctr = [0, 1.4, 0];
      B.quadO([xo, 0.2, za], [xo, 0.2, zm], [xo, 2.5, zm], [xo, 2.5, za], ctr, wall);
      B.quadO([xo, 0.2, zm], [xi, 0.2, zm + 0.0], [xi, 2.5, zm], [xo, 2.5, zm], ctr, dark);
      B.quadO([xi, 0.2, zm], [xi, 0.2, zb - 0.0], [xi, 2.5, zb], [xi, 2.5, zm], ctr, mul(wall(0) ? base : base, 0.9));
    }
  }
  B.box(0, 1.35, 0, W - 0.25, 2.3, L - 0.3, dark);
  // roof with ridges
  B.box(0, 2.55, 0, W, 0.1, L, mul(base, 1.05)); for (let i = 0; i < 9; i++) B.box(0, 2.62, -5.2 + i * 1.3, W - 0.3, 0.03, 0.22, dark);
  // bottom frame + corner castings
  B.box(0, 0.12, 0, W, 0.24, L, C(0x2a2c30));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { B.box(sx * (W / 2 - 0.08), 1.3, sz * (L / 2 - 0.08), 0.18, 2.6, 0.18, C(0x2c2e33)); B.box(sx * (W / 2 - 0.08), 2.55, sz * (L / 2 - 0.08), 0.22, 0.14, 0.22, C(0x55585d)); }
  B.box(0, 2.52, L / 2 - 0.08, W, 0.14, 0.18, C(0x2c2e33)); B.box(0, 2.52, -L / 2 + 0.08, W, 0.14, 0.18, C(0x2c2e33));
  // door end (+Z)
  const zd = L / 2 + 0.005; B.box(0, 1.35, L / 2 - 0.02, W - 0.2, 2.25, 0.05, base);
  for (const x of [-0.85, -0.3, 0.3, 0.85]) { B.box(x, 1.35, zd + 0.03, 0.05, 2.25, 0.04, C(0x8a8e94)); B.box(x, 0.45, zd + 0.06, 0.12, 0.05, 0.05, C(0x5a5e64)); B.box(x, 2.3, zd + 0.06, 0.12, 0.05, 0.05, C(0x5a5e64)); }
  B.box(0, 1.35, zd + 0.02, 0.03, 2.25, 0.04, C(0x2a2a2a));
  B.box(0, 0.3, zd + 0.02, W - 0.2, 0.06, 0.04, dark);
  // labels
  B.box(-0.6, 2.2, zd + 0.03, 0.6, 0.18, 0.01, C(0xf0f0ec)); B.box(-0.6, 2.2, zd + 0.04, 0.45, 0.06, 0.01, C(0x222222));
};
BUILD.cone = (B, v) => {
  const c = v ? C(0xe8d020) : C(0xf0661a);
  B.box(0, 0.025, 0, 0.4, 0.05, 0.4, C(0x25262a));
  B.cyl(0, 0.05, 0, 0.15, 0.085, 0.3, 8, c, { caps: false }); B.cyl(0, 0.35, 0, 0.085, 0.04, 0.3, 8, c, { caps: false });
  B.cyl(0, 0.26, 0, 0.128, 0.11, 0.1, 8, E(0xffffff, 1.15), { caps: false }); B.cyl(0, 0.46, 0, 0.078, 0.065, 0.09, 8, E(0xffffff, 1.15), { caps: false });
  B.cyl(0, 0.65, 0, 0.04, 0.03, 0.04, 8, mul(c, 0.8));
};
BUILD.phonebooth = (B, v) => {
  const f = v ? C(0xc4281e) : C(0x46566a), g = C(0x8fbcd4), gd = C(0x5c8ca4);
  B.box(0, 0.05, 0, 0.98, 0.1, 0.98, C(0x55585c));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(sx * 0.44, 1.2, sz * 0.44, 0.08, 2.3, 0.08, f);
  B.box(0, 0.3, 0, 0.9, 0.45, 0.9, f);
  for (const [nx, nz, w2, d2] of [[0, -1, 0.85, 0.03], [1, 0, 0.03, 0.85], [-1, 0, 0.03, 0.85]]) B.box(nx * 0.44, 1.35, nz * 0.44, w2, 1.6, d2, g);
  B.box(0, 1.95, 0.44, 0.85, 0.04, 0.05, f); B.box(0, 0.9, 0.44, 0.85, 0.04, 0.05, f); B.box(0, 1.4, 0.44, 0.04, 1.0, 0.05, f);
  B.box(0, 2.25, 0, 1.0, 0.25, 1.0, f); B.box(0, 2.4, 0, 1.06, 0.06, 1.06, mul(f, 0.7));
  B.box(0, 2.25, 0.501, 0.7, 0.14, 0.01, E(0xfff0a8, 1.5));
  B.box(0, 1.35, -0.38, 0.35, 0.3, 0.1, C(0x2a2c30)); B.box(0, 1.15, -0.36, 0.3, 0.05, 0.1, PAL.steelL); B.box(0, 1.65, -0.36, 0.2, 0.05, 0.05, PAL.black);
};
BUILD.vending = (B, v) => {
  const c = [C(0xc8241c), C(0x2a5aa8), C(0x2f8a4a), C(0xe0b020)][v];
  B.box(0, 0.95, 0, 0.92, 1.9, 0.78, c); B.box(0, 0.05, 0.0, 0.94, 0.1, 0.8, C(0x2a2c30));
  B.box(-0.12, 1.1, 0.395, 0.56, 1.25, 0.02, E(0xfff6e0, 1.45));
  const prod = [C(0xd83028), C(0x2a70d8), C(0xf0c020), C(0x30a050), C(0xf07a20), C(0xd8d8d0)];
  for (let r = 0; r < 6; r++) for (let i = 0; i < 4; i++) B.box(-0.3 + i * 0.12, 1.55 - r * 0.2, 0.41, 0.07, 0.13, 0.02, prod[(r * 2 + i) % prod.length]);
  B.box(0.33, 1.2, 0.395, 0.2, 0.7, 0.02, C(0x25272b)); B.box(0.33, 1.4, 0.41, 0.12, 0.12, 0.01, E(0x40ff60, 1.5)); B.box(0.33, 1.1, 0.41, 0.1, 0.03, 0.01, PAL.steelL);
  B.box(-0.05, 0.42, 0.395, 0.6, 0.22, 0.02, C(0x1c1d20)); B.box(0, 1.83, 0.395, 0.88, 0.14, 0.02, E(0xffffff, 1.45)); B.box(0, 1.83, 0.41, 0.5, 0.06, 0.01, c);
};
BUILD.newspaper = (B, v) => {
  const c = [C(0x2a56a8), C(0xc22828), C(0xe0b820)][v];
  B.cyl(0, 0, 0, 0.05, 0.04, 0.62, 6, PAL.steel); B.box(0, 0.05, 0, 0.3, 0.06, 0.26, PAL.steelD);
  B.box(0, 0.85, 0, 0.5, 0.42, 0.42, c); B.box(0, 0.68, 0, 0.52, 0.06, 0.44, mul(c, 0.7));
  B.box(0, 0.85, 0.215, 0.36, 0.26, 0.02, C(0x20242a)); B.box(0, 1.06, 0.0, 0.54, 0.04, 0.46, mul(c, 0.85)); B.box(0.18, 0.7, 0.22, 0.05, 0.05, 0.02, PAL.steelL);
  B.box(0, 0.88, 0.226, 0.3, 0.1, 0.005, C(0xe8e4d0));
};
BUILD.parkingmeter = (B) => {
  B.cyl(0, 0, 0, 0.03, 0.028, 1.05, 6, PAL.steel); B.box(0, 1.2, 0, 0.18, 0.3, 0.14, C(0x3a3e44)); B.blob(0, 1.35, 0, 0.09, 0.07, 0.07, C(0x4a4e54), { detail: 1, jitter: 0 });
  B.box(0, 1.25, 0.072, 0.12, 0.1, 0.01, C(0xc8d8c8)); B.box(0, 1.1, 0.072, 0.06, 0.04, 0.01, PAL.black); B.box(0.0, 1.15, -0.07, 0.04, 0.04, 0.03, C(0xb02a2a));
};
BUILD.tombstone = (B, v) => {
  const s = [C(0x8f9298), C(0x9a9890), C(0x6e7076), C(0xa4a6aa)][v]; const sd = mul(s, 0.75);
  B.box(0, 0.09, 0, 0.9, 0.18, 0.45, sd);
  if (v === 0) { B.box(0, 0.6, 0, 0.7, 0.85, 0.15, s); B.tube([-0.35, 1.03, 0], [0.35, 1.03, 0], 0.0, 0.0, 3, s); B.tube([0, 1.03, -0.075], [0, 1.03, 0.075], 0.35, 0.35, 10, s); B.box(0, 0.75, 0.078, 0.4, 0.05, 0.01, sd); B.box(0, 0.6, 0.078, 0.3, 0.03, 0.01, sd); }
  else if (v === 1) { B.box(0, 0.75, 0, 0.16, 1.15, 0.14, s); B.box(0, 1.0, 0, 0.6, 0.15, 0.14, s); B.box(0, 0.3, 0, 0.5, 0.25, 0.3, sd); }
  else if (v === 2) { B.box(0, 0.45, 0, 0.75, 0.55, 0.18, s); B.beam([-0.375, 0.72, 0], [0.375, 0.8, 0], 0.18, 0.02, s, [0, 0, 1]); B.box(0, 0.5, 0.095, 0.5, 0.05, 0.01, sd); }
  else { B.tube([0, 0.18, 0], [0, 1.25, 0], 0.26, 0.11, 4, s, { phase: 0.78, smooth: false }); B.cone(0, 1.25, 0, 0.11, 0.1, 4, mul(s, 1.15), { phase: 0.78 }); }
  B.blob(0, 0.05, 0.35, 0.3, 0.1, 0.22, C(0x6a5034), { detail: 1, jitter: 0.15, flatBottom: 0 });
};
BUILD.pallet = (B) => {
  const w = C(0xb58a55), wd = C(0x8a6438);
  for (const x of [-0.5, 0, 0.5]) B.box(x, 0.06, 0, 0.12, 0.09, 1.0, wd);
  for (let i = 0; i < 5; i++) B.box(0, 0.11, -0.4 + i * 0.2, 1.2, 0.02, 0.12, i % 2 ? w : mul(w, 1.1));
  for (let i = 0; i < 3; i++) B.box(0, 0.015, -0.43 + i * 0.43, 1.2, 0.03, 0.1, wd);
};
BUILD.tyre_stack = (B, v) => {
  const t = C(0x1c1c1e), tl = C(0x2e2e32);
  const n = v ? 3 : 5;
  for (let i = 0; i < n; i++) { const o = (i % 2) * 0.03; B.torus(o, 0.12 + i * 0.22, (i % 3) * 0.02, 0.27, 0.12, 12, 6, i % 2 ? t : tl); }
  if (v) { B.torus(0.62, 0.3, 0.1, 0.27, 0.12, 12, 6, t, 0); B.xf(() => B.torus(0, 0, 0, 0.27, 0.12, 12, 6, tl), M4(-0.55, 0.36, 0.3, 0.3, 0, 1.25)); }
};
BUILD.sofa = (B, v) => {
  const c = [C(0x6a4a34), C(0x5a6a3a), C(0x8c3a30)][v], cd = mul(c, 0.72), cl = mul(c, 1.18);
  B.box(0, 0.22, 0, 1.9, 0.3, 0.85, cd);
  for (const sx of [-1, 1]) B.box(sx * 0.91, 0.5, 0.0, 0.22, 0.52, 0.85, c);
  B.box(0, 0.65, -0.33, 1.7, 0.66, 0.22, c); B.box(0, 0.98, -0.33, 1.7, 0.06, 0.24, cl);
  B.box(-0.42, 0.44, 0.08, 0.8, 0.18, 0.66, cl); B.box(0.44, 0.44, 0.08, 0.8, 0.18, 0.66, cl, 0.08);
  for (const sx of [-0.85, 0.85]) for (const sz of [-0.36, 0.36]) B.box(sx, 0.04, sz, 0.08, 0.08, 0.08, PAL.black);
  B.box(-0.3, 0.535, 0.2, 0.4, 0.01, 0.3, cd); B.box(0.6, 0.535, 0.0, 0.25, 0.012, 0.35, mul(c, 0.55));
  if (v === 2) { for (let i = 0; i < 5; i++) B.box(-0.7 + i * 0.35, 0.65, -0.215, 0.04, 0.6, 0.01, mul(c, 1.35)); }
};
BUILD.grill = (B, v) => {
  const k = C(0x25262a), kl = C(0x3a3c42);
  if (v === 0) {
    for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; B.beam([0, 0.6, 0], [Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3], 0.03, 0.03, k); }
    B.blob(0, 0.72, 0, 0.32, 0.22, 0.32, grad(0.5, 0.95, k, kl), { detail: 1, jitter: 0, flatBottom: -0.2 }); B.blob(0, 0.85, 0, 0.33, 0.18, 0.33, kl, { detail: 1, jitter: 0, flatBottom: 0 });
    B.box(0.0, 1.0, 0.0, 0.05, 0.05, 0.1, PAL.steelL); B.box(0.0, 0.92, 0.36, 0.22, 0.03, 0.04, PAL.steelL); B.cyl(0, 0.3, 0, 0.22, 0.22, 0.03, 8, C(0x555960));
  } else {
    B.box(0, 0.75, 0, 0.9, 0.22, 0.5, k); B.box(0, 0.93, -0.12, 0.92, 0.22, 0.28, kl, 0); B.box(0, 0.82, 0.3, 0.9, 0.04, 0.12, PAL.steelL);
    for (const sx of [-0.4, 0.4]) { B.box(sx, 0.36, -0.18, 0.05, 0.72, 0.05, PAL.steelD); B.box(sx, 0.36, 0.18, 0.05, 0.72, 0.05, PAL.steelD); }
    B.box(0, 0.3, 0, 0.8, 0.04, 0.4, PAL.steelD); B.cyl(0.5, 0.25, 0.3, 0.1, 0.1, 0.05, 8, k); B.box(0.0, 0.63, 0.0, 0.8, 0.05, 0.4, C(0x55585c));
  }
};
BUILD.pool_chair = (B, v) => {
  const pad = [C(0xf2f2ec), C(0x2f9ad8), C(0xf0c030)][v], fr = C(0xd8dadc); const pad2 = v === 1 ? C(0xf2f2ec) : v === 2 ? C(0x2f9ad8) : C(0x3aa6d8);
  for (const sx of [-0.3, 0.3]) { B.box(sx, 0.17, 0.75, 0.04, 0.34, 0.04, fr); B.box(sx, 0.17, -0.1, 0.04, 0.34, 0.04, fr); B.beam([sx, 0.3, 0.8], [sx, 0.3, -0.15], 0.04, 0.04, fr); B.beam([sx, 0.32, -0.15], [sx, 0.78, -0.72], 0.04, 0.04, fr); B.beam([sx, 0.32, -0.1], [sx, 0.2, -0.55], 0.03, 0.03, fr); }
  for (let i = 0; i < 6; i++) B.box(0, 0.345, 0.82 - i * 0.17, 0.6, 0.06, 0.16, i % 2 ? pad : pad2);
  for (let i = 0; i < 4; i++) { const t = i / 3; B.beam([0, 0.36 + t * 0.4 + 0.02, -0.18 - t * 0.5], [0, 0.36 + t * 0.4 + 0.1, -0.3 - t * 0.5], 0.6, 0.06, i % 2 ? pad : pad2, [1, 0, 0]); }
};
BUILD.umbrella_beach = (B, v) => {
  const cols = [[C(0xe03030), C(0xf4f0e8)], [C(0x2a6ad8), C(0xf4f0e8)], [C(0xf0c020), C(0xf4f0e8)], [C(0x28b8a8), C(0xf06ab0)]][v];
  B.xf(() => {
    B.tube([0, 0, 0], [0, 2.35, 0], 0.025, 0.02, 6, C(0xc8c8c4));
    const n = 8, R = 1.25, y0 = 2.0, y1 = 2.5;
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; const c = cols[i % 2];
      const p0 = [Math.cos(a0) * R, y0, Math.sin(a0) * R], p1 = [Math.cos(a1) * R, y0, Math.sin(a1) * R]; const pm = [Math.cos((a0 + a1) / 2) * R * 0.98, y0 - 0.05, Math.sin((a0 + a1) / 2) * R * 0.98];
      B.tri([0, y1, 0], p1, pm, c); B.tri([0, y1, 0], pm, p0, c); B.tri([0, y1 - 0.02, 0], pm, p1, mul(c, 0.8)); B.tri([0, y1 - 0.02, 0], p0, pm, mul(c, 0.8));
    }
    B.cyl(0, 2.48, 0, 0.03, 0.0, 0.1, 6, C(0xd8d8d4)); B.cone(0.0, 0, 0.0, 0.05, 0.3, 5, C(0x888888));
  }, M4(0, 0, 0, 0, 0, 0.13));
};
BUILD.lifeguard_tower = (B, v) => {
  const w = v ? C(0xd8c098) : C(0xf2f0ea), a = v ? C(0x2a6ab0) : C(0xd8382a), wd = C(0xa07a4a);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.beam([sx * 1.05, 0, sz * 1.05], [sx * 0.85, 2.3, sz * 0.85], 0.14, 0.14, wd);
  B.beam([-1, 0.7, 1.0], [1, 0.7, 1.0], 0.08, 0.08, wd); B.beam([-1, 0.7, -1.0], [1, 0.7, -1.0], 0.08, 0.08, wd); B.beam([1.0, 0.7, -1], [1.0, 0.7, 1], 0.08, 0.08, wd); B.beam([-1.0, 0.7, -1], [-1.0, 0.7, 1], 0.08, 0.08, wd);
  B.beam([-0.95, 0.35, 1.0], [0.95, 1.6, 1.0], 0.07, 0.07, wd); B.beam([0.95, 0.35, 1.0], [-0.95, 1.6, 1.0], 0.07, 0.07, wd);
  B.box(0, 2.35, 0, 2.2, 0.12, 2.2, wd); for (let i = 0; i < 5; i++) B.box(0, 2.42, -0.9 + i * 0.45, 2.2, 0.01, 0.4, i % 2 ? wd : mul(wd, 1.12));
  // cabin
  B.box(0, 3.05, -0.25, 1.9, 1.35, 1.35, w); B.box(0, 3.05, 0.45, 1.9, 1.35, 0.05, w);
  B.box(0, 3.15, 0.49, 1.5, 0.75, 0.02, C(0x1c2a3a)); B.box(0.96, 3.15, -0.25, 0.02, 0.6, 0.8, C(0x1c2a3a)); B.box(-0.96, 3.15, -0.25, 0.02, 0.6, 0.8, C(0x1c2a3a));
  B.box(0, 3.45, 0.5, 1.9, 0.14, 0.04, a); B.box(0, 2.55, 0.5, 1.9, 0.12, 0.04, a);
  B.box(0, 3.85, -0.05, 2.5, 0.09, 1.9, a); B.beam([-1.25, 3.82, 0.92], [1.25, 3.82, 0.92], 0.03, 0.06, mul(a, 1.1), [0, 1, 0]);
  // ladder + flag + ring buoy
  for (const x of [-0.25, 0.25]) B.beam([x, 0.0, -1.35], [x, 2.35, -1.1], 0.05, 0.05, wd); for (let i = 0; i < 7; i++) B.box(0, 0.25 + i * 0.3, -1.3 + i * 0.1, 0.5, 0.04, 0.05, wd);
  B.cyl(1.0, 3.85, -0.9, 0.02, 0.02, 0.7, 5, PAL.steelL); B.quad2([1.0, 4.5, -0.9], [1.0, 4.52, -1.45], [1.0, 4.22, -1.42], [1.0, 4.2, -0.9], E(0xff2a20, 1.3));
  B.torus(1.0, 2.9, 0.52, 0.22, 0.05, 12, 5, C(0xe84030), 0);
};
BUILD.wall_segment = (B, v) => {
  if (v === 0) { const c = C(0xe6d6b4); B.box(0, 1.15, 0, 3.9, 2.3, 0.25, grad(0, 2.3, mul(c, 0.85), c)); B.box(0, 2.38, 0, 4.0, 0.12, 0.34, mul(c, 0.78)); B.box(-1.98, 1.25, 0, 0.14, 2.5, 0.38, mul(c, 0.9)); B.box(1.98, 1.25, 0, 0.14, 2.5, 0.38, mul(c, 0.9)); for (const x of [-2, 2]) B.box(x, 2.56, 0, 0.26, 0.1, 0.46, mul(c, 0.75)); B.box(0.3, 0.9, 0.14, 1.3, 0.5, 0.01, mul(c, 0.94)); }
  else if (v === 1) { const c = C(0xa8482f), m = C(0x6a3a2c); B.box(0, 1.15, 0, 3.9, 2.3, 0.25, c); for (let i = 1; i < 15; i++) { B.box(0, i * 0.153, 0.127, 3.9, 0.02, 0.005, m); B.box(0, i * 0.153, -0.127, 3.9, 0.02, 0.005, m); } B.box(0, 2.36, 0, 4.0, 0.1, 0.34, C(0xc4b49a)); for (const x of [-2, 2]) { B.box(x, 1.25, 0, 0.16, 2.5, 0.4, C(0x8c3a26)); B.box(x, 2.55, 0, 0.26, 0.1, 0.5, C(0xc4b49a)); } }
  else { const c = C(0x9a9a94); B.box(0, 1.15, 0, 3.9, 2.3, 0.22, c); B.box(0, 2.35, 0, 4.0, 0.1, 0.3, C(0x7d7d77)); for (const x of [-2, 2]) B.box(x, 1.2, 0, 0.16, 2.4, 0.34, C(0x84847e));
    B.box(-0.8, 1.2, 0.115, 1.6, 0.7, 0.01, C(0xd8468a)); B.box(0.4, 1.0, 0.115, 1.2, 0.5, 0.01, C(0x2ab8d8)); B.box(1.1, 1.5, 0.115, 0.8, 0.8, 0.01, C(0xf0d030)); B.box(-0.3, 1.9, 0.115, 2.0, 0.12, 0.01, C(0x222226)); }
};
BUILD.garden_gnome = (B, v) => {
  const hat = v ? C(0x2a8a3a) : C(0xd02a24), coat = v ? C(0xc83030) : C(0x2a5ab0);
  B.cyl(0, 0, 0.0, 0.11, 0.1, 0.05, 6, C(0x222)); B.box(-0.05, 0.03, 0.08, 0.07, 0.05, 0.1, C(0x3a2a1a)); B.box(0.05, 0.03, 0.08, 0.07, 0.05, 0.1, C(0x3a2a1a));
  B.tube([0, 0.05, 0], [0, 0.3, 0], 0.12, 0.09, 7, coat); B.blob(0, 0.36, 0.0, 0.1, 0.09, 0.1, C(0xf0c8a0), { detail: 1, jitter: 0 }); B.cone(0, 0.22, 0.07, 0.085, 0.14, 6, C(0xf2f2ee));
  B.blob(0, 0.36, 0.1, 0.03, 0.03, 0.03, C(0xe89a80), { detail: 0, jitter: 0 }); B.cone(0, 0.39, 0, 0.11, 0.22, 7, hat);
};
BUILD.utility_pole = (B) => {
  const w = C(0x6e5238), wl = C(0x8a6a4a), ins = C(0xe8e8e0);
  B.cyl(0, 0, 0, 0.19, 0.12, 10, 8, grad(0, 10, w, wl), { caps: true });
  for (const [y, len] of [[9.3, 2.4], [8.4, 1.8]]) { B.box(0, y, 0, 0.12, 0.14, len, w); B.beam([0, y - 0.05, -len * 0.3], [0, y - 0.9, 0], 0.07, 0.07, w); B.beam([0, y - 0.05, len * 0.3], [0, y - 0.9, 0], 0.07, 0.07, w); for (const z of [-len / 2 + 0.1, 0, len / 2 - 0.1]) { B.cyl(0, y + 0.07, z, 0.045, 0.04, 0.2, 6, ins); } }
  B.cyl(0.35, 7.6, 0, 0.26, 0.26, 0.75, 9, C(0x7a8086), { caps: true }); B.box(0.17, 7.8, 0, 0.3, 0.05, 0.05, PAL.steelD); B.cyl(0.35, 8.35, 0, 0.29, 0.29, 0.05, 9, PAL.steelD);
  for (let i = 0; i < 5; i++) B.box(0.12, 2.2 + i * 0.55, (i % 2) * 0.05, 0.22, 0.03, 0.03, PAL.steelD);
  B.box(0, 3.4, 0.17, 0.3, 0.2, 0.01, C(0xd8d8c8));
  for (const z of [-1.0, 0, 1.0]) B.beam([0, 9.55, z], [0, 9.3, z + 0.9 * (z >= 0 ? 1 : -1)], 0.015, 0.015, C(0x151515));
};
BUILD.planter = (B, v) => {
  const c = C(0xa8a49a), cd = C(0x85827a);
  if (v === 0) {
    B.cyl(0, 0, 0, 0.55, 0.62, 0.78, 10, grad(0, 0.8, cd, c), { caps: false }); B.cyl(0, 0.78, 0, 0.66, 0.66, 0.08, 10, c); B.cyl(0, 0.84, 0, 0.56, 0.56, 0.02, 10, C(0x4a3826));
    [[0, 0, 0.45, 0.45], [0.3, 0.15, 0.3, 0.3], [-0.3, -0.1, 0.32, 0.32]].forEach(([x, z, r, h], i) => B.blob(x, 0.88 + h * 0.6, z, r, h, r, grad(0.85, 1.6, C(0x2a6a32), C(0x5aa84a)), { detail: 1, jitter: 0.14, seed: i }));
    B.tube([0, 0.85, 0], [0.05, 1.3, 0], 0.05, 0.03, 5, C(0x5a4a36)); B.blob(0.0, 1.45, 0, 0.35, 0.3, 0.35, grad(1.2, 1.8, C(0x2a6a32), C(0x7acc5c)), { detail: 1, jitter: 0.15, seed: 9 });
  } else {
    B.box(0, 0.4, 0, 1.3, 0.8, 0.6, grad(0, 0.8, cd, c)); B.box(0, 0.82, 0, 1.4, 0.06, 0.7, c); B.box(0, 0.86, 0, 1.2, 0.03, 0.5, C(0x4a3826));
    for (let i = 0; i < 14; i++) B.blob(-0.55 + (i % 7) * 0.18, 1.0 + (i % 3) * 0.05, (i < 7 ? -0.13 : 0.13), 0.1, 0.12, 0.1, [C(0xe8508a), C(0xf0d040), C(0xf06a20), C(0xf4f0f0)][i % 4], { detail: 0, jitter: 0.1 }); for (let i = 0; i < 6; i++) B.blob(-0.5 + i * 0.2, 0.93, 0, 0.12, 0.08, 0.26, C(0x3a8a3a), { detail: 0, jitter: 0.1 });
  }
};
BUILD.jersey_barrier = (B, v) => {
  const prof = [[-0.3, 0], [0.3, 0], [0.3, 0.1], [0.17, 0.45], [0.12, 0.85], [-0.12, 0.85], [-0.17, 0.45], [-0.3, 0.1]];
  if (v === 0) extrudeZY(B, prof, -1.5, 1.5, C(0x9b9a94));
  else for (let i = 0; i < 6; i++) extrudeZY(B, prof, -1.5 + i * 0.5, -1.0 + i * 0.5, i % 2 ? C(0xf0f0ea) : C(0xe8641a));
  B.box(0, 0.88, 0, 2.9, 0.02, 0.22, v ? C(0x3a3a3a) : C(0xb4b3ac));
};
BUILD.foodcart = (B, v) => {
  const a = v ? C(0xf0c020) : C(0xd8342a), b = v ? C(0x2a6ab0) : C(0xf4f0e8);
  B.box(0, 0.78, 0, 1.5, 0.8, 0.85, a); B.box(0, 0.4, 0, 1.56, 0.06, 0.9, C(0x25272b)); B.box(0, 1.2, 0.1, 1.6, 0.05, 0.96, b);
  B.box(0, 0.78, 0.435, 1.3, 0.5, 0.02, C(0x2a2c30)); B.box(0, 0.95, 0.445, 1.1, 0.06, 0.02, PAL.steelL);
  for (const sx of [-0.85, 0.85]) B.cyl(sx, 0.3, 0.0, 0.3, 0.3, 0.08, 12, C(0x1c1c1e)), B.cyl(sx, 0.3, 0.0, 0.14, 0.14, 0.1, 8, PAL.steelL);
  for (const sx of [-0.85, 0.85]) { }
  B.beam([-0.8, 0.9, -0.45], [-1.15, 1.0, -0.8], 0.04, 0.04, PAL.steelD);
  B.cyl(0.0, 1.22, -0.2, 0.03, 0.03, 1.3, 6, PAL.steelL);
  const n = 8, R = 1.25; for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; const c = i % 2 ? b : a; const p0 = [Math.cos(a0) * R, 2.2, -0.2 + Math.sin(a0) * R], p1 = [Math.cos(a1) * R, 2.2, -0.2 + Math.sin(a1) * R]; B.tri([0, 2.6, -0.2], p1, p0, c); B.tri([0, 2.58, -0.2], p0, p1, mul(c, 0.8)); }
  B.box(0.45, 1.36, 0.1, 0.4, 0.22, 0.3, PAL.steelL); B.cyl(-0.4, 1.3, 0.1, 0.1, 0.1, 0.16, 8, C(0xe8e0d0));
};
BUILD.bike_rack = (B) => {
  const m = C(0x8e949c);
  for (let i = 0; i < 4; i++) { const x = -0.6 + i * 0.4; B.tube([x, 0, 0], [x, 0.7, 0], 0.025, 0.025, 6, m, { caps: false }); B.tube([x, 0.7, 0], [x + 0.14, 0.82, 0], 0.025, 0.025, 6, m, { caps: false }); B.tube([x + 0.14, 0.82, 0], [x + 0.26, 0.7, 0], 0.025, 0.025, 6, m, { caps: false }); B.tube([x + 0.26, 0.7, 0], [x + 0.26, 0, 0], 0.025, 0.025, 6, m, { caps: false }); B.box(x + 0.13, 0.01, 0, 0.36, 0.02, 0.08, PAL.steelD); }
  B.beam([-0.6, 0.35, 0], [0.86, 0.35, 0], 0.03, 0.03, m);
};

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------
const geoCache = new Map();
/** Merged vertex-coloured geometry (cached & shared between calls: do NOT dispose it). Base at y=0, origin at centre of the base. */
export function createPropGeometry(kind, variant = 0) {
  const n = propVariantCount(kind); const v = ((variant | 0) % n + n) % n;
  const key = kind + ':' + v; let g = geoCache.get(key); if (g) return g;
  const fn = BUILD[kind]; if (!fn) throw new Error('unknown prop kind ' + kind);
  const B = new PB(); fn(B, v); g = B.build();
  if (g.boundingBox.min.y < -0.005) { g.translate(0, -g.boundingBox.min.y, 0); g.computeBoundingBox(); g.computeBoundingSphere(); } g.userData = { kind, variant: v, height: PROP_DEFS[kind] ? PROP_DEFS[kind].height : g.boundingBox.max.y };
  geoCache.set(key, g); return g;
}
/** Circle colliders of a prop in local coordinates (empty if not solid). */
export function propColliders(kind) {
  const d = PROP_DEFS[kind]; if (!d || !d.solid) return [];
  return d.colliders ? d.colliders.map(c => ({ ...c })) : [{ x: 0, z: 0, r: d.radius }];
}
let MAT = null;
/** The shared vertex-colour material. Vertex colours with a channel > 1 are emissive (lamp lenses, signals, billboards ...). */
export function createPropMaterial() {
  if (MAT) return MAT;
  const uGlow = { value: 0.5 };
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = uGlow;
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform float uGlow;\nvoid main() {')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n float eMax = max(vColor.r, max(vColor.g, vColor.b));\n totalEmissiveRadiance += vColor.rgb * smoothstep(1.02, 1.35, eMax) * uGlow;\n#endif');
  };
  m.customProgramCacheKey = () => 'lsr-prop-emissive';
  m.userData.setNight = (n01) => { uGlow.value = 0.25 + 0.75 * clamp(n01, 0, 1); };
  MAT = m; return m;
}
/** Convenience: 0 = day (emissive parts barely glow) .. 1 = night (full glow). */
export function setPropNight(material, n01) { if (material && material.userData.setNight) material.userData.setNight(n01); }
export function disposePropCaches() { geoCache.forEach(g => g.dispose()); geoCache.clear(); if (MAT) { MAT.dispose(); MAT = null; } }
export function propTriangleCount(kind, variant = 0) { return Math.round(createPropGeometry(kind, variant).attributes.position.count / 3); }
