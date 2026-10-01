// Fast merging of many transformed copies of small geometries into one BufferGeometry.
import * as THREE from 'three';

// items: [{geo, x, y, z, yaw, sx?, sy?, sz?}]
// opts: {uv:boolean, colorSize:3|4}
export function mergeInstances(items, opts = {}) {
  const useUV = opts.uv !== false;
  let nv = 0, ni = 0;
  for (const it of items) {
    const g = it.geo;
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  if (nv === 0) return out;
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const uv = useUV ? new Float32Array(nv * 2) : null;
  const idx = nv > 65000 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const it of items) {
    const g = it.geo, P = g.attributes.position, Nn = g.attributes.normal, C = g.attributes.color, U = g.attributes.uv;
    const n = P.count;
    const cs = Math.cos(it.yaw || 0), sn = Math.sin(it.yaw || 0);
    const sx = it.sx ?? it.s ?? 1, sy = it.sy ?? it.s ?? 1, sz = it.sz ?? it.s ?? 1;
    const ox = it.x || 0, oy = it.y || 0, oz = it.z || 0;
    const cm = it.colorMul;
    for (let i = 0; i < n; i++) {
      const x = P.getX(i) * sx, y = P.getY(i) * sy, z = P.getZ(i) * sz;
      const k = (vo + i) * 3;
      pos[k] = x * cs + z * sn + ox; pos[k + 1] = y + oy; pos[k + 2] = -x * sn + z * cs + oz;
      if (Nn) { const nx = Nn.getX(i), ny = Nn.getY(i), nz = Nn.getZ(i); nor[k] = nx * cs + nz * sn; nor[k + 1] = ny; nor[k + 2] = -nx * sn + nz * cs; }
      else { nor[k + 1] = 1; }
      if (C) { col[k] = C.getX(i); col[k + 1] = C.getY(i); col[k + 2] = C.getZ(i); } else { col[k] = col[k + 1] = col[k + 2] = 1; }
      if (cm) { col[k] *= cm[0]; col[k + 1] *= cm[1]; col[k + 2] *= cm[2]; }
      if (uv) { if (U) { uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i); } }
    }
    if (g.index) { const I = g.index; for (let i = 0; i < I.count; i++) idx[io + i] = I.getX(i) + vo; io += I.count; }
    else { for (let i = 0; i < n; i++) idx[io + i] = vo + i; io += n; }
    vo += n;
  }
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

export function disposeMesh(m) {
  if (!m) return;
  if (m.geometry) m.geometry.dispose();
  if (m.material && m.material.map && m.userData.ownTexture) m.material.map.dispose();
  if (m.userData.ownMaterial && m.material) m.material.dispose();
}

// simple coloured box geometry (vertex coloured, indexed) used for fallbacks
export function boxGeo(w, h, d, color = 0xffffff, y0 = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, y0 + h / 2, 0);
  const c = new THREE.Color(color); const n = g.attributes.position.count; const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ---------------------------------------------------------------------------------------------
// GeoBuilder: tiny vertex-coloured mesh accumulator for set-pieces (signs, piers, cranes, planes ...).
// Colours: hex number | [r,g,b] (linear, may exceed 1.0 = emissive with the shared prop material).
// ---------------------------------------------------------------------------------------------
const _c = new THREE.Color();
const colCache = new Map();
export function rgb(c) {
  if (Array.isArray(c)) return c;
  let v = colCache.get(c); if (!v) { _c.setHex(c); v = [_c.r, _c.g, _c.b]; colCache.set(c, v); }
  return v;
}
export const glow = (hex, k = 2.2) => { const c = rgb(hex); return [c[0] * k, c[1] * k, c[2] * k]; };
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.c = []; }
  get count() { return this.p.length / 3; }
  _v(p, n, c) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.c.push(c[0], c[1], c[2]); }
  tri(a, b, c, col) {
    const n = cross3(sub3(b, a), sub3(c, a)); const l = Math.hypot(n[0], n[1], n[2]); if (l < 1e-10) return;
    const nn = [n[0] / l, n[1] / l, n[2] / l]; const k = rgb(col); this._v(a, nn, k); this._v(b, nn, k); this._v(c, nn, k);
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  // quad whose front face points along dir
  quadF(a, b, c, d, dir, col) {
    const n = cross3(sub3(b, a), sub3(c, a));
    if (dot3(n, dir) < 0) this.quad(a, d, c, b, col); else this.quad(a, b, c, d, col);
  }
  quad2(a, b, c, d, col) { this.quad(a, b, c, d, col); this.quad(a, d, c, b, col); }
  poly(pts, dir, col) {
    for (let i = 1; i < pts.length - 1; i++) { const n = cross3(sub3(pts[i], pts[0]), sub3(pts[i + 1], pts[0])); if (dot3(n, dir) >= 0) this.tri(pts[0], pts[i], pts[i + 1], col); else this.tri(pts[0], pts[i + 1], pts[i], col); }
  }
  // box with its BASE at y0, footprint centred on cx,cz, rotated ry about Y (yaw convention: x' = x cos + z sin, z' = -x sin + z cos)
  box(cx, y0, cz, sx, sy, sz, col, ry = 0, top = null) {
    const hx = sx / 2, hz = sz / 2, co = Math.cos(ry), si = Math.sin(ry);
    const P = (x, y, z) => [cx + x * co + z * si, y0 + y, cz - x * si + z * co];
    const v = [P(-hx, 0, -hz), P(hx, 0, -hz), P(hx, sy, -hz), P(-hx, sy, -hz), P(-hx, 0, hz), P(hx, 0, hz), P(hx, sy, hz), P(-hx, sy, hz)];
    const ctr = [cx, y0 + sy / 2, cz];
    const f = (a, b, c2, d, cc) => { const m = [(v[a][0] + v[b][0] + v[c2][0] + v[d][0]) / 4 - ctr[0], (v[a][1] + v[b][1] + v[c2][1] + v[d][1]) / 4 - ctr[1], (v[a][2] + v[b][2] + v[c2][2] + v[d][2]) / 4 - ctr[2]]; this.quadF(v[a], v[b], v[c2], v[d], m, cc); };
    f(4, 5, 6, 7, col); f(1, 0, 3, 2, col); f(5, 1, 2, 6, col); f(0, 4, 7, 3, col); f(7, 6, 2, 3, top || col); f(0, 1, 5, 4, col);
  }
  // box between two points with cross-section w x h
  beam(p0, p1, w, h, col, hint = [0, 1, 0]) {
    const d = norm3(sub3(p1, p0)); let s = cross3(d, hint); if (Math.hypot(s[0], s[1], s[2]) < 1e-3) s = cross3(d, [1, 0, 0]);
    s = norm3(s); const t = norm3(cross3(s, d));
    const cc = (p, i, j) => [p[0] + s[0] * w / 2 * i + t[0] * h / 2 * j, p[1] + s[1] * w / 2 * i + t[1] * h / 2 * j, p[2] + s[2] * w / 2 * i + t[2] * h / 2 * j];
    const A0 = [cc(p0, -1, -1), cc(p0, 1, -1), cc(p0, 1, 1), cc(p0, -1, 1)], A1 = [cc(p1, -1, -1), cc(p1, 1, -1), cc(p1, 1, 1), cc(p1, -1, 1)];
    const ctr = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; const q = [A0[i], A0[j], A1[j], A1[i]]; const m = [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4 - ctr[0], (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4 - ctr[1], (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4 - ctr[2]]; this.quadF(q[0], q[1], q[2], q[3], m, col); }
    this.poly(A0, sub3(p0, p1), col); this.poly(A1, sub3(p1, p0), col);
  }
  // tapered tube between two points
  tube(p0, p1, r0, r1, segs, col, caps = true) {
    const d = norm3(sub3(p1, p0)); const hint = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm3(cross3(d, hint)), v = norm3(cross3(d, u)); const k = rgb(col);
    const len = Math.hypot(...sub3(p1, p0)) || 1; const slope = (r0 - r1) / len;
    const ring = (p, r, i) => { const a = i / segs * Math.PI * 2; const dir = [u[0] * Math.cos(a) + v[0] * Math.sin(a), u[1] * Math.cos(a) + v[1] * Math.sin(a), u[2] * Math.cos(a) + v[2] * Math.sin(a)]; return { p: [p[0] + dir[0] * r, p[1] + dir[1] * r, p[2] + dir[2] * r], n: norm3([dir[0] + d[0] * slope, dir[1] + d[1] * slope, dir[2] + d[2] * slope]) }; };
    for (let i = 0; i < segs; i++) {
      const a0 = ring(p0, r0, i), a1 = ring(p0, r0, i + 1), b0 = ring(p1, r1, i), b1 = ring(p1, r1, i + 1);
      const put = (A, B, C) => { const g = cross3(sub3(B.p, A.p), sub3(C.p, A.p)); if (Math.hypot(g[0], g[1], g[2]) < 1e-12) return; if (dot3(g, A.n) < 0) { this._v(A.p, A.n, k); this._v(C.p, C.n, k); this._v(B.p, B.n, k); } else { this._v(A.p, A.n, k); this._v(B.p, B.n, k); this._v(C.p, C.n, k); } };
      put(a0, a1, b1); put(a0, b1, b0);
    }
    if (caps) {
      const top = [], bot = []; for (let i = 0; i < segs; i++) { top.push(ring(p1, r1, i).p); bot.push(ring(p0, r0, i).p); }
      if (r1 > 1e-4) this.poly(top, d, col); if (r0 > 1e-4) this.poly(bot, [-d[0], -d[1], -d[2]], col);
    }
  }
  cyl(cx, y0, cz, rb, rt, h, segs, col, caps = true) { this.tube([cx, y0, cz], [cx, y0 + h, cz], rb, rt, segs, col, caps); }
  // convex polygon [[x,z],...] extruded from y0 to y1
  prism(pts, y0, y1, col, topCol = null) {
    const n = pts.length; const cx = pts.reduce((s, p) => s + p[0], 0) / n, cz = pts.reduce((s, p) => s + p[1], 0) / n;
    this.poly(pts.map(p => [p[0], y1, p[1]]), [0, 1, 0], topCol || col); this.poly(pts.map(p => [p[0], y0, p[1]]), [0, -1, 0], col);
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; this.quadF([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [(a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz], col); }
  }
  // flat disc facing up
  disc(cx, y, cz, r, segs, col) { const pts = []; for (let i = 0; i < segs; i++) { const a = i / segs * Math.PI * 2; pts.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]); } this.poly(pts, [0, 1, 0], col); }
  // apply a THREE.Matrix4 to everything added by fn()
  xf(fn, m) {
    const s = this.count; fn(); const e = this.count; const v = new THREE.Vector3(); const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = s; i < e; i++) {
      v.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]).applyMatrix4(m); this.p[i * 3] = v.x; this.p[i * 3 + 1] = v.y; this.p[i * 3 + 2] = v.z;
      v.set(this.n[i * 3], this.n[i * 3 + 1], this.n[i * 3 + 2]).applyMatrix3(nm).normalize(); this.n[i * 3] = v.x; this.n[i * 3 + 1] = v.y; this.n[i * 3 + 2] = v.z;
    }
  }
  // translate + yaw everything added by fn()
  place(x, y, z, yaw, fn) { this.xf(fn, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1))); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
}
