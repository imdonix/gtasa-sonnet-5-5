// =====================================================================================
//  src/buildings.js  --  procedural building generator + facade atlas for "Los Santos Rising"
//
//  EXPORTS
//    createBuildingMaterial() -> { material, map, emissiveMap, setNight(n01), dispose() }
//    generateBuilding({type, w, d, h, seed, style?, crown?, color?, floorHeight?}) -> THREE.BufferGeometry | null
//    bakeTransform(geometry, x, y, z, yaw) -> cloned geometry rotated about Y by yaw then translated
//    BUILDING_TYPES (ids), BUILDING_INFO[type] = {minW,maxW,minD,maxD,minH,maxH,floorHeight,name,category}
//    SIGN_TYPES, ATLAS_INFO, getFacadeAtlas() (debug: canvases + tile table)
//
//  GEOMETRY CONTRACT (for the engine / chunk merger)
//   * Every geometry is INDEXED (Uint16 or Uint32 index, chosen automatically) with exactly these attributes:
//       position(3f) normal(3f) uv(2f) color(3f, linear RGB)    -> safe for BufferGeometryUtils.mergeGeometries
//   * Local frame: footprint centred on x/z origin, building base at y=0, foundation skirt down to y=-2,
//     street side / front faces +Z.  geometry.userData = { type, bounds:{w,d,h}, roofY, bbox:{minX,maxX,minZ,maxZ,minY,maxY}, tris }
//     bounds.w/d = actual footprint extent (never larger than the requested w/d), bounds.h = highest point (incl. antennas/stacks).
//   * One shared material for all buildings (createBuildingMaterial): Lambert, vertexColors, map = facade atlas
//     (alpha cut-outs for railings / fences via alphaTest 0.4), emissiveMap = lit windows / neon signs / glow strips.
//     setNight(0..1) drives material.emissiveIntensity (0 = day: nothing glows).  Emissive atlas is half resolution.
//   * spec.style (optional): house_small 'hip'|'gable'|'gableS'|'flat'; apartment_low 'court'|'block';
//     skyscraper / office_mid 'glass'|'deco'|'concrete' (skyscraper spec.crown: 'flat'|'sign'|'heli'|'slant'|'pyramid');
//     office_low 'ribbon'|'punched'|'glass'; fast_food 'BURGERS'|'PIZZA'|'TACOS'|'DONUTS'|'CAFE'; garage_shop 'GARAGE'|'AUTO'|'TIRES'.
//   * spec.color (hex) overrides the wall colour of the house types + villa.  spec.floorHeight / groundY are accepted but unused.
//   * Deterministic: same spec (incl. seed) -> identical geometry.
// =====================================================================================
import * as THREE from 'three';

/* ------------------------------------------------------------------ rng / utils */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strHash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
class Rng {
  constructor(seed) { this.r = mulberry32(seed >>> 0); }
  f() { return this.r(); }
  range(a, b) { return a + (b - a) * this.r(); }
  int(a, b) { return a + Math.floor(this.r() * (b - a + 1)); }
  chance(p) { return this.r() < p; }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  sign() { return this.r() < 0.5 ? -1 : 1; }
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const _tc = new THREE.Color();
/** hex (sRGB) -> linear [r,g,b] */
function C(hex) { _tc.setHex(hex); return [_tc.r, _tc.g, _tc.b]; }
const mulc = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const WHITE = [1, 1, 1];

/* ------------------------------------------------------------------ atlas layout (no DOM needed) */
const AW = 4096, AH = 2048, PAD = 8, INSET = 1.5;
const DEFS = [];
const TILES = {};
/** def(name, w px, h px, world width m, world height m, drawFn, {seam}) */
function def(name, w, h, wm, hm, draw, opt = {}) { DEFS.push({ name, w, h, wm, hm, draw, seam: !!opt.seam, p: opt.p, base: opt.base || name }); }
/** lit family: name+'d' (mostly dark, lit prob pD) and name+'l' (lit prob pL) share the same design */
function defLit(base, w, h, wm, hm, draw, pD = 0, pL = 1) {
  def(base + 'd', w, h, wm, hm, draw, { p: pD, base });
  def(base + 'l', w, h, wm, hm, draw, { p: pL, base });
}
function layoutAtlas() {
  const order = DEFS.slice().sort((a, b) => (b.h - a.h) || (b.w - a.w) || (a.name < b.name ? -1 : 1));
  let x = 0, y = 0, rowH = 0;
  for (const dft of order) {
    const cw = dft.w + 2 * PAD, ch = dft.h + 2 * PAD;
    if (x + cw > AW) { x = 0; y += rowH; rowH = 0; }
    dft.x = x + PAD; dft.y = y + PAD;
    x += cw; rowH = Math.max(rowH, ch);
    TILES[dft.name] = {
      name: dft.name, x: dft.x, y: dft.y, w: dft.w, h: dft.h, wm: dft.wm, hm: dft.hm,
      u0: (dft.x + INSET) / AW, u1: (dft.x + dft.w - INSET) / AW,
      v1: 1 - (dft.y + INSET) / AH, v0: 1 - (dft.y + dft.h - INSET) / AH,
    };
  }
  if (y + rowH > AH) console.error('[buildings] atlas overflow: needs height', y + rowH);
  return y + rowH;
}

/* ------------------------------------------------------------------ geometry builder */
class GB {
  constructor(rng) {
    this.rng = rng;
    this.p = []; this.n = []; this.uv = []; this.c = []; this.i = [];
    this.nv = 0;
  }
  vtx(x, y, z, nx, ny, nz, u, v, c) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(c[0], c[1], c[2]);
    return this.nv++;
  }
  /** quad a,b,c,d = bottom-left, bottom-right, top-right, top-left seen from the front.
   *  c0 = colour of the a/b edge, c1 = colour of the c/d edge.
   *  o: {dir:[x,y,z] force facing, up:true, flip:true (mirror u), u:[f0,f1], v:[f0,f1], dbl:true (second, mirrored back face)} */
  q(a, b, c, d, tile, c0, c1, o) {
    const t = typeof tile === 'string' ? TILES[tile] : tile;
    if (!t) throw new Error('unknown tile ' + tile);
    const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
    const vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-10) return;
    nx /= len; ny /= len; nz /= len;
    let flip = false;
    if (o) {
      if (o.dir) { if (nx * o.dir[0] + ny * o.dir[1] + nz * o.dir[2] < 0) flip = true; }
      else if (o.up) { if (ny < 0) flip = true; }
      else if (o.down) { if (ny > 0) flip = true; }
    }
    let fu0 = 0, fu1 = 1, fv0 = 0, fv1 = 1;
    if (o) {
      if (o.u) { fu0 = o.u[0]; fu1 = o.u[1]; }
      if (o.v) { fv0 = o.v[0]; fv1 = o.v[1]; }
      if (o.flip) { const s = fu0; fu0 = fu1; fu1 = s; }
    }
    const U0 = t.u0 + (t.u1 - t.u0) * fu0, U1 = t.u0 + (t.u1 - t.u0) * fu1;
    const V0 = t.v0 + (t.v1 - t.v0) * fv0, V1 = t.v0 + (t.v1 - t.v0) * fv1;
    c1 = c1 || c0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const i0 = this.vtx(a[0], a[1], a[2], nx, ny, nz, U0, V0, c0);
    const i1 = this.vtx(b[0], b[1], b[2], nx, ny, nz, U1, V0, c0);
    const i2 = this.vtx(c[0], c[1], c[2], nx, ny, nz, U1, V1, c1);
    const i3 = this.vtx(d[0], d[1], d[2], nx, ny, nz, U0, V1, c1);
    if (flip) this.i.push(i0, i2, i1, i0, i3, i2); else this.i.push(i0, i1, i2, i0, i2, i3);
    if (o && o.dbl) {
      const o2 = Object.assign({}, o, { dbl: false, dir: [-nx, -ny, -nz], up: false, down: false });
      this.q(b, a, d, c, t, c0, c1, o2);
    }
  }
  /** triangle with explicit uv fractions [[u,v],[u,v],[u,v]] */
  tri(a, b, c, tile, col, uvs, o) {
    const t = typeof tile === 'string' ? TILES[tile] : tile;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-10) return;
    nx /= len; ny /= len; nz /= len;
    let flip = false;
    if (o) {
      if (o.dir) { if (nx * o.dir[0] + ny * o.dir[1] + nz * o.dir[2] < 0) flip = true; }
      else if (o.up) { if (ny < 0) flip = true; }
    }
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    uvs = uvs || [[0, 0], [1, 0], [0.5, 1]];
    const f = (p) => [t.u0 + (t.u1 - t.u0) * p[0], t.v0 + (t.v1 - t.v0) * p[1]];
    const A = f(uvs[0]), Bq = f(uvs[1]), Cq = f(uvs[2]);
    const c0 = col, c1 = (o && o.c1) || col, c2 = (o && o.c2) || col;
    const i0 = this.vtx(a[0], a[1], a[2], nx, ny, nz, A[0], A[1], c0);
    const i1 = this.vtx(b[0], b[1], b[2], nx, ny, nz, Bq[0], Bq[1], c1);
    const i2 = this.vtx(c[0], c[1], c[2], nx, ny, nz, Cq[0], Cq[1], c2);
    if (flip) this.i.push(i0, i2, i1); else this.i.push(i0, i1, i2);
  }
  /** quad subdivided so that cells approximate the tile's world size (bilinear in a,b,c,d) */
  qt(a, b, c, d, tile, c0, c1, o) {
    const t = typeof tile === 'string' ? TILES[tile] : tile;
    const tw = (o && o.tw) || t.wm, th = (o && o.th) || t.hm;
    const lu = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const lv = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    const nu = Math.max(1, Math.round(lu / tw)), nv = Math.max(1, Math.round(lv / th));
    if (nu === 1 && nv === 1) return this.q(a, b, c, d, t, c0, c1, o);
    c1 = c1 || c0;
    const P = (u, v) => {
      const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w11 = u * v, w01 = (1 - u) * v;
      return [a[0] * w00 + b[0] * w10 + c[0] * w11 + d[0] * w01,
              a[1] * w00 + b[1] * w10 + c[1] * w11 + d[1] * w01,
              a[2] * w00 + b[2] * w10 + c[2] * w11 + d[2] * w01];
    };
    const o2 = o ? Object.assign({}, o, { dbl: false }) : null;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const u0 = i / nu, u1 = (i + 1) / nu, v0 = j / nv, v1 = (j + 1) / nv;
      const flipc = (o && o.rflip) && ((i + j) & 1);
      const oo = flipc ? Object.assign({}, o2, { flip: !o2.flip }) : o2;
      this.q(P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), t, mixc(c0, c1, v0), mixc(c0, c1, v1), oo);
    }
    if (o && o.dbl) { this.qt(b, a, d, c, t, c0, c1, Object.assign({}, o, { dbl: false, dir: null, up: false })); }
  }
  /** vertical wall between footprint points A(ax,az)->B(bx,bz); faces left of the direction of travel (n = (-dz,dx)) */
  wall(ax, az, bx, bz, y0, y1, tile, c0, c1, o) {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    const oo = Object.assign({ dir: [-dz / l, 0, dx / l] }, o || {});
    this.qt([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], tile, c0, c1, oo);
  }
  /** horizontal quad facing up (or down if o.down) over the rectangle */
  flat(x0, z0, x1, z1, y, tile, col, o) {
    const oo = Object.assign({ up: true }, o || {});
    if (oo.down) { oo.up = false; }
    this.qt([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], tile, col, col, oo);
  }
  /** axis aligned box. o: {side, top, bottom?, front, back, left, right (tile names), c, ct, cb (colours), tw, th, noSide:[..], grad} */
  box(x0, y0, z0, x1, y1, z1, o) {
    const side = o.side || 'flat';
    const c = o.c || WHITE, ct = o.ct || c;
    const cb = o.grad ? mulc(c, o.grad) : c;
    const tw = o.tw, th = o.th;
    const so = { tw, th, flip: o.flip };
    const no = o.no || '';
    if (!no.includes('f')) this.wall(x0, z1, x1, z1, y0, y1, o.front || side, cb, c, so);            // +z
    if (!no.includes('r')) this.wall(x1, z1, x1, z0, y0, y1, o.right || side, cb, c, so);             // +x
    if (!no.includes('b')) this.wall(x1, z0, x0, z0, y0, y1, o.back || side, cb, c, so);              // -z
    if (!no.includes('l')) this.wall(x0, z0, x0, z1, y0, y1, o.left || side, cb, c, so);              // -x
    if (!no.includes('t')) this.flat(x0, z0, x1, z1, y1, o.top || side, ct, { tw, th });
    if (o.bottom) this.flat(x0, z0, x1, z1, y0, o.bottom, cb, { down: true, tw, th });
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);   // three picks Uint16 / Uint32 automatically
    return g;
  }
}

/* ====================================================================================
 *  FACADE ATLAS  --  procedural canvas tiles (colour atlas 4096x2048 + emissive atlas at half resolution)
 *  Tiles are near-white / neutral so vertex colours tint them.  Each tile is drawn twice with identical
 *  design-RNG: once for the colour atlas (emit=false) and once for the emissive atlas (emit=true).
 * ==================================================================================== */
const rgb = (c, k = 1, a) => {
  const r = Math.max(0, Math.min(255, c[0] * k)) | 0, g = Math.max(0, Math.min(255, c[1] * k)) | 0, b = Math.max(0, Math.min(255, c[2] * k)) | 0;
  return a === undefined ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
};
function R(ctx, c, x, y, w, h) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
function speckle(k, amp) {
  const { ctx, w, h, brng } = k;
  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const n = (brng.f() - 0.5) * amp;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(id, 0, 0);
}
/** seamless soft blobs */
function blobs(k, n, rmin, rmax, dark, alpha) {
  const { ctx, w, h, brng } = k;
  for (let i = 0; i < n; i++) {
    const x = brng.f() * w, y = brng.f() * h, r = rmin + brng.f() * (rmax - rmin);
    const isDark = brng.f() < dark;
    const a = alpha * (0.4 + brng.f() * 0.6);
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
      const cx = x + ox, cy = y + oy;
      if (cx + r < 0 || cx - r > w || cy + r < 0 || cy - r > h) continue;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const col = isDark ? '40,36,30' : '255,255,250';
      g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
}
function stuccoBg(k, base = [238, 234, 224], amp = 12, fine = true) {
  if (k.emit) return;
  const { ctx, w, h } = k;
  R(ctx, rgb(base), 0, 0, w, h);
  blobs(k, 22, 12, 50, 0.4, 0.06);
  if (fine) speckle(k, amp);
}
function vgrad(ctx, x, y, w, h, c0, c1) {
  const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, c0); g.addColorStop(1, c1);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
}
function rpath(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function archPath(ctx, x, y, w, h) {
  const r = w / 2;
  ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.arc(x + r, y + r, r, Math.PI, 0); ctx.lineTo(x + w, y + h); ctx.closePath();
}
const GL_T = [156, 194, 226], GL_B = [70, 98, 128];
const CURT = [[236, 228, 208], [214, 184, 168], [186, 198, 214], [208, 218, 194], [238, 238, 236], [204, 192, 150]];
const LITC = [[255, 214, 130], [255, 206, 120], [255, 190, 100], [255, 225, 160], [222, 234, 255], [150, 185, 255], [255, 170, 90], [210, 255, 210]];
const LITW = [5, 5, 3, 3, 1.5, 1.2, 1, .5];
function litColor(lr) {
  let s = LITW.reduce((a, b) => a + b, 0), r = lr.f() * s;
  for (let i = 0; i < LITC.length; i++) { r -= LITW[i]; if (r <= 0) return LITC[i]; }
  return LITC[0];
}
/** one glazed pane.  Always consumes the same RNG values in both passes. */
function pane(k, x, y, w, h, opt = {}) {
  const { ctx, rng, emit } = k;
  const intr = rng.int(0, 6), cc = CURT[rng.int(0, CURT.length - 1)], shade = 0.82 + rng.f() * 0.36;
  const lit = opt.lit !== undefined ? opt.lit : (k.lrng.f() < k.p);
  const lc = litColor(k.lrng); const lk = 0.75 + k.lrng.f() * 0.25;
  if (!emit) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, rgb(opt.top || GL_T, shade)); g.addColorStop(1, rgb(opt.bot || GL_B, shade));
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    if (intr === 1 || intr === 3) { // curtains
      ctx.fillStyle = rgb(cc, 0.92); const cw = intr === 1 ? w * 0.3 : w * 0.55;
      ctx.fillRect(x, y, cw, h); if (intr === 1) ctx.fillRect(x + w - cw, y, cw, h);
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < cw; i += 6) ctx.fillRect(x + i, y, 2, h);
    } else if (intr === 2) { // blinds
      const hh = h * (0.35 + rng.f() * 0.45);
      for (let yy = y; yy < y + hh; yy += 5) { ctx.fillStyle = rgb([226, 222, 210], 0.95); ctx.fillRect(x, yy, w, 3); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x, yy + 3, w, 2); }
    } else if (intr === 4) { // plant / lamp silhouette
      ctx.fillStyle = 'rgba(20,30,20,0.55)'; ctx.beginPath(); ctx.ellipse(x + w * 0.75, y + h * 0.75, w * 0.14, h * 0.22, 0, 0, 6.3); ctx.fill();
    }
    if (!opt.noStreak) {
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.beginPath();
      ctx.moveTo(x + w * 0.1, y + h); ctx.lineTo(x + w * 0.55, y); ctx.lineTo(x + w * 0.78, y); ctx.lineTo(x + w * 0.33, y + h); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillRect(x, y, w, Math.max(2, h * 0.04)); ctx.fillRect(x, y, Math.max(2, w * 0.03), h);
  } else if (lit) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, rgb(lc, lk)); g.addColorStop(1, rgb(lc, lk * 0.72));
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    if (intr === 1 || intr === 3) {
      const cw = intr === 1 ? w * 0.3 : w * 0.55;
      ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillRect(x, y, cw, h); if (intr === 1) ctx.fillRect(x + w - cw, y, cw, h);
    } else if (intr === 2) {
      const hh = h * 0.5; for (let yy = y; yy < y + hh; yy += 5) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x, yy + 3, w, 2); }
    } else if (intr === 4) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.ellipse(x + w * 0.75, y + h * 0.75, w * 0.14, h * 0.22, 0, 0, 6.3); ctx.fill(); }
  }
}
const FRAME_W = [250, 250, 246];
/** framed sash window with grid of panes */
function sash(k, x, y, w, h, cols, rows, ft, o = {}) {
  const { ctx, emit } = k;
  const fc = o.frame || FRAME_W;
  if (!emit) {
    R(ctx, 'rgba(0,0,0,0.22)', x - ft - 2, y - ft - 2, w + 2 * ft + 4, h + 2 * ft + 4);
    R(ctx, rgb(fc), x - ft, y - ft, w + 2 * ft, h + 2 * ft);
  }
  const mt = Math.max(2, ft * 0.7);
  const pw = (w - (cols - 1) * mt) / cols, ph = (h - (rows - 1) * mt) / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) pane(k, x + i * (pw + mt), y + j * (ph + mt), pw, ph, o.pane);
}
function sill(k, x, y, w, o = {}) {
  if (k.emit) return;
  const { ctx } = k;
  R(ctx, 'rgba(0,0,0,0.20)', x + 4, y + 9, w - 8, 7);
  R(ctx, rgb(o.c || [232, 230, 224]), x - 6, y, w + 12, 9);
  R(ctx, 'rgba(255,255,255,0.5)', x - 6, y, w + 12, 2);
  R(ctx, 'rgba(0,0,0,0.18)', x - 6, y + 8, w + 12, 1);
}
function lintelShadow(k, x, y, w) { if (!k.emit) R(k.ctx, 'rgba(0,0,0,0.14)', x - 10, y - 14, w + 20, 10); }

/* ---------------- materials ---------------- */
def('stucco', 256, 256, 3, 3, (k) => { stuccoBg(k, [238, 234, 224], 14); }, { seam: true });
def('brick', 256, 224, 2.4, 2.1, (k) => {
  if (k.emit) return; const { ctx, w, h, brng } = k;
  R(ctx, rgb([196, 190, 178]), 0, 0, w, h); const rh = 16, bw = 64;
  for (let r = 0; r < h / rh; r++) {
    const off = (r & 1) ? bw / 2 : 0;
    for (let i = -1; i < w / bw + 1; i++) {
      const v = 0.82 + brng.f() * 0.3, hue = brng.f();
      const col = [176 * v + hue * 14, 92 * v + hue * 16, 70 * v];
      const x = i * bw + off; ctx.fillStyle = rgb(col); ctx.fillRect(x + 1.5, r * rh + 1.5, bw - 3, rh - 3);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x + 1.5, r * rh + 1.5, bw - 3, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + 1.5, r * rh + rh - 3.5, bw - 3, 2);
    }
  }
  blobs(k, 18, 14, 50, 0.6, 0.12); speckle(k, 16);
}, { seam: true });
def('concrete', 256, 256, 4, 4, (k) => {
  if (k.emit) return; const { ctx, w, h, brng } = k;
  R(ctx, rgb([186, 184, 178]), 0, 0, w, h); blobs(k, 40, 12, 60, 0.5, 0.14); speckle(k, 18);
  ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillRect(0, 0, w, 2); ctx.fillRect(0, 0, 2, h);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, 2, w, 1); ctx.fillRect(2, 0, 1, h);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; for (const [x, y] of [[24, 24], [232, 24], [24, 232], [232, 232], [128, 24], [128, 232]]) { ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.3); ctx.fill(); }
  for (let i = 0; i < 6; i++) { const x = brng.f() * w; const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(40,36,30,0.0)'); g.addColorStop(1, 'rgba(40,36,30,0.13)'); ctx.fillStyle = g; ctx.fillRect(x, 0, 5 + brng.f() * 8, h); }
}, { seam: true });
def('corrug', 256, 256, 4, 4, (k) => {
  if (k.emit) return; const { ctx, w, h, brng } = k;
  const id = ctx.createImageData(w, h), d = id.data;
  for (let x = 0; x < w; x++) {
    const ph = (x % 16) / 16 * Math.PI * 2; const s = 0.78 + 0.22 * Math.cos(ph) - (Math.sin(ph) < 0 ? 0.05 : 0);
    for (let y = 0; y < h; y++) { const i = (y * w + x) * 4; const n = (brng.f() - 0.5) * 12; const v = 222 * s; d[i] = v + n; d[i + 1] = v + n; d[i + 2] = v + n; d[i + 3] = 255; }
  }
  ctx.putImageData(id, 0, 0);
  for (let i = 0; i < 9; i++) { const x = brng.f() * w; const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(120,70,40,0.0)'); g.addColorStop(1, `rgba(120,70,40,${0.10 + brng.f() * 0.15})`); ctx.fillStyle = g; ctx.fillRect(x, 0, 3 + brng.f() * 6, h); }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, w, 2);
}, { seam: true });
def('siding', 256, 256, 2, 2, (k) => {
  if (k.emit) return; const { ctx, w, h, brng } = k;
  R(ctx, rgb([232, 230, 222]), 0, 0, w, h);
  for (let y = 0; y < h; y += 16) {
    const v = 0.95 + brng.f() * 0.06; R(ctx, rgb([236, 234, 226], v), 0, y, w, 16);
    R(ctx, 'rgba(0,0,0,0.28)', 0, y + 13, w, 3); R(ctx, 'rgba(255,255,255,0.35)', 0, y, w, 2);
  }
  speckle(k, 10);
}, { seam: true });
def('stone', 256, 256, 3, 3, (k) => {
  if (k.emit) return; const { ctx, w, h, brng } = k;
  R(ctx, rgb([196, 190, 176]), 0, 0, w, h); const rows = 4, rh = h / rows;
  for (let r = 0; r < rows; r++) {
    const n = (r & 1) ? 3 : 2, bw = w / n; const off = (r & 1) ? 0 : bw / 2;
    for (let i = -1; i <= n; i++) {
      const x = i * bw + (r & 1 ? 0 : off - bw / 2 + bw / 2); const v = 0.9 + brng.f() * 0.14;
      ctx.fillStyle = rgb([234, 228, 214], v); ctx.fillRect(x + 2, r * rh + 2, bw - 4, rh - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(x + 2, r * rh + 2, bw - 4, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + 2, r * rh + rh - 4, bw - 4, 2);
    }
  }
  blobs(k, 20, 10, 40, 0.5, 0.1); speckle(k, 14);
}, { seam: true });
def('gravel', 128, 128, 3, 3, (k) => { if (k.emit) return; R(k.ctx, rgb([128, 126, 120]), 0, 0, 128, 128); blobs(k, 14, 8, 30, 0.5, 0.18); speckle(k, 46); }, { seam: true });
def('asphalt', 128, 128, 4, 4, (k) => { if (k.emit) return; R(k.ctx, rgb([84, 84, 86]), 0, 0, 128, 128); blobs(k, 10, 10, 40, 0.5, 0.14); speckle(k, 26); }, { seam: true });
def('rtile', 256, 256, 2.4, 2.4, (k) => {
  if (k.emit) return; const { ctx, w, h, brng } = k;
  R(ctx, rgb([200, 196, 190]), 0, 0, w, h);
  const rows = 8, rh = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < w; x++) {
      const s = 0.72 + 0.28 * Math.cos((x % 21.33) / 21.33 * 6.283);
      const g = ctx.createLinearGradient(0, r * rh, 0, (r + 1) * rh);
      g.addColorStop(0, `rgba(255,255,255,${0.35 * s})`); g.addColorStop(0.75, `rgba(0,0,0,${0.12 * (1 - s)})`); g.addColorStop(1, 'rgba(0,0,0,0.42)');
      ctx.fillStyle = g; ctx.fillRect(x, r * rh, 1, rh);
    }
    for (let i = 0; i < 12; i++) { ctx.fillStyle = `rgba(${brng.f() < 0.5 ? '0,0,0' : '255,255,255'},${0.05 + brng.f() * 0.08})`; ctx.fillRect(i * 21.33, r * rh, 21.33, rh); }
  }
  speckle(k, 16);
}, { seam: true });
def('shingle', 256, 256, 2.4, 2.4, (k) => {
  if (k.emit) return; const { ctx, w, h, brng } = k;
  R(ctx, rgb([176, 174, 170]), 0, 0, w, h); const rows = 12, rh = h / rows;
  for (let r = 0; r < rows; r++) {
    const bw = 32, off = (r % 2) * 16 + (r % 3) * 7;
    for (let i = -1; i < w / bw + 1; i++) { const v = 0.78 + brng.f() * 0.3; ctx.fillStyle = rgb([190, 188, 184], v); ctx.fillRect(i * bw + off + 1, r * rh, bw - 2, rh - 1); }
    R(ctx, 'rgba(0,0,0,0.3)', 0, r * rh + rh - 3, w, 3);
  }
  speckle(k, 24);
}, { seam: true });
def('rmetal', 128, 128, 3, 3, (k) => {
  if (k.emit) return; const { ctx, w, h } = k;
  R(ctx, rgb([200, 204, 206]), 0, 0, w, h);
  for (let x = 0; x < w; x += 32) { R(ctx, 'rgba(0,0,0,0.3)', x, 0, 2, h); R(ctx, 'rgba(255,255,255,0.35)', x + 2, 0, 2, h); }
  blobs(k, 8, 10, 30, 0.6, 0.15); speckle(k, 14);
}, { seam: true });
def('lawn', 128, 128, 3, 3, (k) => {
  if (k.emit) return; const { ctx, w, h, brng } = k;
  R(ctx, rgb([104, 146, 70]), 0, 0, w, h); blobs(k, 16, 8, 30, 0.45, 0.22);
  for (let i = 0; i < 700; i++) { ctx.fillStyle = brng.f() < 0.5 ? 'rgba(40,80,30,0.3)' : 'rgba(170,200,100,0.3)'; ctx.fillRect(brng.f() * w, brng.f() * h, 1.5, 3); }
  speckle(k, 12);
}, { seam: true });
def('deck', 128, 128, 2, 2, (k) => {
  if (k.emit) return; const { ctx, w, h, brng } = k;
  for (let y = 0; y < h; y += 16) { R(ctx, rgb([180, 140, 100], 0.85 + brng.f() * 0.25), 0, y, w, 16); R(ctx, 'rgba(0,0,0,0.4)', 0, y + 14, w, 2); }
  speckle(k, 16);
}, { seam: true });
def('pool', 128, 128, 3, 3, (k) => {
  if (k.emit) return; const { ctx, w, h } = k;
  vgrad(ctx, 0, 0, w, h, 'rgb(70,200,225)', 'rgb(40,160,205)');
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(0, 14 + i * 26); ctx.bezierCurveTo(30, 4 + i * 26, 70, 30 + i * 26, 128, 12 + i * 26); ctx.stroke(); }
}, { seam: true });
def('lot', 256, 256, 5, 5, (k) => {
  if (k.emit) return; const { ctx, w, h } = k;
  R(ctx, rgb([86, 86, 88]), 0, 0, w, h); blobs(k, 14, 12, 50, 0.5, 0.12); speckle(k, 24);
  ctx.fillStyle = 'rgba(235,235,225,0.85)'; for (const x of [0, 128]) ctx.fillRect(x, 40, 4, 216);
  ctx.fillRect(0, 40, 256, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(64, 160, 14, 70);
}, { seam: true });
def('flat', 16, 16, 1, 1, (k) => { if (!k.emit) R(k.ctx, '#fff', 0, 0, 16, 16); });
/* glow tiles: emissive in the emissive atlas, same colour in the colour atlas */
for (const [nm, col] of [['gw_w', [255, 250, 235]], ['gw_r', [255, 50, 40]], ['gw_y', [255, 210, 60]], ['gw_b', [70, 140, 255]], ['gw_m', [255, 50, 200]], ['gw_c', [60, 240, 255]], ['gw_g', [80, 255, 100]], ['gw_o', [255, 150, 40]]])
  def(nm, 16, 16, 1, 1, (k) => { R(k.ctx, rgb(col), 0, 0, 16, 16); });

/* ---------------- railings / fences (alpha cut-outs) ---------------- */
def('rail', 256, 64, 2.0, 0.9, (k) => {
  if (k.emit) return; const { ctx, w, h } = k;
  ctx.fillStyle = '#e9e9e4'; ctx.fillRect(0, 3, w, 7); ctx.fillRect(0, h - 10, w, 5);
  for (let x = 6; x < w; x += 16) ctx.fillRect(x, 3, 4, h - 6);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 8, w, 2); ctx.fillRect(0, h - 7, w, 2);
}, { seam: false });
def('picket', 128, 64, 2.0, 1.0, (k) => {
  if (k.emit) return; const { ctx, w, h } = k;
  ctx.fillStyle = '#f2f0ea';
  for (let x = 4; x < w; x += 16) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x, 12); ctx.lineTo(x + 5, 2); ctx.lineTo(x + 10, 12); ctx.lineTo(x + 10, h); ctx.fill(); }
  ctx.fillRect(0, 20, w, 6); ctx.fillRect(0, 46, w, 6);
  ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(0, 25, w, 1); ctx.fillRect(0, 51, w, 1);
});
def('chain', 128, 128, 2.0, 2.0, (k) => {
  if (k.emit) return; const { ctx, w, h } = k;
  ctx.strokeStyle = 'rgba(190,194,198,1)'; ctx.lineWidth = 2;
  for (let i = -h; i < w + h; i += 16) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i + h, 0); ctx.lineTo(i, h); ctx.stroke(); }
  ctx.fillStyle = '#9a9ea2'; ctx.fillRect(0, 0, w, 5);
});
def('awn', 128, 64, 2.0, 0.8, (k) => {
  if (k.emit) return; const { ctx, w, h } = k;
  for (let x = 0; x < w; x += 32) { R(ctx, '#ffffff', x, 0, 16, h); R(ctx, rgb([225, 225, 225]), x + 16, 0, 16, h); }
  vgrad(ctx, 0, 0, w, h, 'rgba(255,255,255,0.15)', 'rgba(0,0,0,0.12)'); speckle(k, 8);
});

/* ---------------- residential window bays (3 x 3 m) ---------------- */
function resBay(fn) {
  return (k) => { stuccoBg(k); fn(k); };
}
defLit('r0', 256, 256, 3, 3, resBay((k) => { // single-hung
  const x = 82, y = 50, w = 92, h = 124;
  lintelShadow(k, x, y - 6, w + 12);
  sash(k, x, y, w, h, 1, 2, 7); sill(k, x - 4, y + h + 7, w + 8);
}));
defLit('r1', 256, 256, 3, 3, resBay((k) => { // horizontal slider
  const x = 42, y = 80, w = 172, h = 86;
  lintelShadow(k, x, y - 6, w + 12);
  sash(k, x, y, w, h, 2, 1, 7); sill(k, x - 4, y + h + 7, w + 8);
}));
defLit('r2', 256, 256, 3, 3, resBay((k) => { // shuttered
  const x = 92, y = 54, w = 72, h = 118;
  if (!k.emit) {
    const { ctx } = k;
    for (const sx of [x - 44, x + w + 14]) {
      R(ctx, rgb([150, 158, 150]), sx, y - 6, 30, h + 12);
      for (let yy = y; yy < y + h + 4; yy += 6) { R(ctx, 'rgba(0,0,0,0.35)', sx + 3, yy, 24, 2); R(ctx, 'rgba(255,255,255,0.3)', sx + 3, yy + 2, 24, 1); }
      R(ctx, 'rgba(0,0,0,0.2)', sx + 30, y - 4, 4, h + 12);
    }
  }
  sash(k, x, y, w, h, 1, 2, 6); sill(k, x - 4, y + h + 7, w + 8);
}));
defLit('r3', 256, 256, 3, 3, resBay((k) => { // arched Spanish window
  const { ctx, emit } = k; const x = 80, y = 44, w = 96, h = 134;
  if (!emit) { archPath(ctx, x - 12, y - 12, w + 24, h + 24); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill(); archPath(ctx, x - 8, y - 8, w + 16, h + 16); ctx.fillStyle = rgb([248, 246, 240]); ctx.fill(); }
  ctx.save(); archPath(ctx, x, y, w, h); ctx.clip();
  pane(k, x, y, w, h);
  if (!emit) { ctx.strokeStyle = rgb(FRAME_W); ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.moveTo(x, y + h * 0.55); ctx.lineTo(x + w, y + h * 0.55); ctx.stroke(); }
  ctx.restore();
  sill(k, x - 6, y + h + 8, w + 12);
}));
defLit('r4', 256, 256, 3, 3, resBay((k) => { // barred window
  const { ctx, emit } = k; const x = 82, y = 84, w = 92, h = 80;
  sash(k, x, y, w, h, 2, 1, 6); sill(k, x - 4, y + h + 7, w + 8);
  if (!emit) {
    ctx.fillStyle = 'rgba(30,30,34,0.95)';
    for (let bx = x - 4; bx <= x + w + 4; bx += 13) ctx.fillRect(bx, y - 10, 4, h + 22);
    ctx.fillRect(x - 10, y - 10, w + 20, 5); ctx.fillRect(x - 10, y + h + 6, w + 20, 5); ctx.fillRect(x - 10, y + h * 0.45, w + 20, 4);
  }
}));
defLit('r5', 256, 256, 3, 3, resBay((k) => { // picture window + flower box
  const { ctx, emit } = k; const x = 50, y = 62, w = 156, h = 100;
  sash(k, x, y, w, h, 3, 1, 6);
  if (!emit) {
    R(ctx, 'rgba(0,0,0,0.25)', x - 4, y + h + 14, w + 8, 22);
    R(ctx, rgb([120, 88, 60]), x - 6, y + h + 8, w + 12, 20);
    for (let i = 0; i < 26; i++) { const bx = x - 2 + (i / 26) * (w + 4); ctx.fillStyle = `rgb(${50 + (i * 37) % 60},${120 + (i * 53) % 70},${50 + (i * 11) % 40})`; ctx.beginPath(); ctx.arc(bx, y + h + 6 - ((i * 7) % 6), 6, 0, 6.3); ctx.fill(); }
    for (let i = 0; i < 7; i++) { ctx.fillStyle = ['#e85a6a', '#f4d04a', '#fff', '#e8884a'][i % 4]; ctx.beginPath(); ctx.arc(x + 6 + i * (w / 7), y + h + 2 - (i % 3) * 3, 3, 0, 6.3); ctx.fill(); }
  }
}));
/* doors */
function porchLamp(k, x, y) {
  const { ctx, emit } = k;
  if (!emit) { R(ctx, rgb([50, 44, 40]), x - 6, y - 8, 12, 4); R(ctx, rgb([240, 230, 200]), x - 5, y - 4, 10, 14); R(ctx, rgb([50, 44, 40]), x - 6, y + 10, 12, 3); }
  else {
    const g = ctx.createRadialGradient(x, y + 3, 1, x, y + 3, 36); g.addColorStop(0, 'rgba(255,220,140,0.8)'); g.addColorStop(1, 'rgba(255,200,100,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 40, y - 40, 80, 90); R(ctx, rgb([255, 236, 170]), x - 5, y - 4, 10, 14);
  }
}
def('rd0', 256, 256, 3, 3, (k) => { // dark wood panel door
  stuccoBg(k); const { ctx, emit } = k;
  const x = 90, y = 66, w = 76, h = 186;
  if (!emit) {
    R(ctx, 'rgba(0,0,0,0.25)', x - 10, y - 10, w + 20, h + 12);
    R(ctx, rgb(FRAME_W), x - 7, y - 7, w + 14, h + 9);
    R(ctx, rgb([94, 62, 44]), x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; for (const [a, b, c, d] of [[8, 10, 26, 62], [42, 10, 26, 62], [8, 82, 26, 90], [42, 82, 26, 90]]) { ctx.fillRect(x + a, y + b, c, d); ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x + a + 1, y + b + 1, c - 2, 2); ctx.fillStyle = 'rgba(0,0,0,0.3)'; }
    R(ctx, rgb([210, 180, 90]), x + w - 14, y + h * 0.5, 6, 6);
    R(ctx, rgb([196, 194, 188]), x - 14, 246, w + 28, 10);
  }
  porchLamp(k, 196, 92);
});
def('rd1', 256, 256, 3, 3, (k) => { // white door + sidelights
  stuccoBg(k); const { ctx, emit } = k;
  const x = 92, y = 66, w = 72, h = 186;
  if (!emit) {
    R(ctx, 'rgba(0,0,0,0.22)', 48, y - 10, 160, h + 12);
    R(ctx, rgb(FRAME_W), 52, y - 7, 152, h + 9);
    R(ctx, rgb([238, 238, 232]), x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + 8, y + 100, w - 16, 70); ctx.fillRect(x + 8, y + 10, w - 16, 4);
    R(ctx, rgb([196, 194, 188]), 44, 246, 168, 10);
  }
  pane(k, x + 14, y + 16, w - 28, 72, { lit: true });
  pane(k, 58, y + 6, 26, 170); pane(k, 172, y + 6, 26, 170);
  if (!emit) { R(ctx, rgb([210, 180, 90]), x + w - 12, y + h * 0.55, 6, 6); }
  porchLamp(k, 226, 100);
});
def('rd2', 256, 256, 3, 3, (k) => { // arched green door
  stuccoBg(k); const { ctx, emit } = k;
  const x = 88, y = 52, w = 80, h = 200;
  if (!emit) {
    archPath(ctx, x - 14, y - 14, w + 28, h + 14); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
    archPath(ctx, x - 8, y - 8, w + 16, h + 8); ctx.fillStyle = rgb([236, 226, 206]); ctx.fill();
    archPath(ctx, x, y, w, h); ctx.fillStyle = rgb([60, 96, 72]); ctx.fill();
    ctx.save(); archPath(ctx, x, y, w, h); ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; for (let i = 1; i < 4; i++) ctx.fillRect(x + i * w / 4 - 1, y, 2, h);
    ctx.fillStyle = 'rgba(20,20,20,0.7)'; for (let yy = y + 50; yy < y + h - 20; yy += 26) for (let xx = x + 10; xx < x + w; xx += 20) { ctx.beginPath(); ctx.arc(xx, yy, 3, 0, 6.3); ctx.fill(); }
    ctx.restore();
    R(ctx, rgb([196, 194, 188]), x - 12, 246, w + 24, 10);
  }
  porchLamp(k, 206, 96);
});
/* garages */
function garageTile(w, h, cols) {
  return (k) => {
    if (k.emit) return; const { ctx } = k;
    R(ctx, rgb([238, 236, 230]), 0, 0, w, h);
    R(ctx, 'rgba(0,0,0,0.3)', 0, 0, w, 8);
    const ph = (h - 12) / 4;
    for (let r = 0; r < 4; r++) {
      const y = 8 + r * ph;
      vgrad(ctx, 6, y, w - 12, ph, 'rgba(255,255,255,0.0)', 'rgba(0,0,0,0.10)');
      R(ctx, 'rgba(0,0,0,0.35)', 6, y + ph - 3, w - 12, 3); R(ctx, 'rgba(255,255,255,0.55)', 6, y, w - 12, 2);
      if (r > 0) { for (let i = 0; i < cols; i++) { const pw = (w - 28) / cols; const x = 14 + i * pw; ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 2; ctx.strokeRect(x + 4, y + 8, pw - 12, ph - 18); } }
    }
    for (let i = 0; i < cols; i++) { const pw = (w - 28) / cols; const x = 14 + i * pw + 6; const g = ctx.createLinearGradient(0, 10, 0, 8 + ph); g.addColorStop(0, rgb(GL_T, 0.9)); g.addColorStop(1, rgb(GL_B)); ctx.fillStyle = g; ctx.fillRect(x, 14, pw - 16, ph - 12); }
    R(ctx, rgb([60, 60, 60]), w / 2 - 14, h * 0.62, 28, 5);
    R(ctx, 'rgba(0,0,0,0.25)', 0, 0, 6, h); R(ctx, 'rgba(0,0,0,0.25)', w - 6, 0, 6, h);
    speckle(k, 10);
  };
}
def('g1', 256, 224, 2.7, 2.3, garageTile(256, 224, 4));
def('g2', 512, 224, 5.2, 2.3, garageTile(512, 224, 8));

/* ---------------- shopfronts (3.2 x 3.6 m), lit interiors ---------------- */
function shopShell(k, o = {}) {
  const { ctx, emit } = k;
  const gx = o.gx ?? 10, gy = o.gy ?? 58, gw = o.gw ?? 236, gh = o.gh ?? 152;
  stuccoBg(k, [232, 228, 218]);
  if (!emit) {
    R(ctx, 'rgba(0,0,0,0.3)', 0, gy - 10, 256, 10);
    R(ctx, rgb([188, 186, 180]), 0, gy + gh, 256, 256 - gy - gh); speckle(k, 14);
    R(ctx, 'rgba(0,0,0,0.3)', 0, gy + gh, 256, 4);
    R(ctx, rgb([60, 62, 66]), gx - 4, gy - 4, gw + 8, gh + 8);
  }
  return { gx, gy, gw, gh };
}
function interiorShelves(k, gx, gy, gw, gh, warm) {
  const { ctx, emit, rng } = k;
  if (!emit) {
    vgrad(ctx, gx, gy, gw, gh, rgb([120, 135, 150]), rgb([70, 72, 78]));
    for (let s = 0; s < 3; s++) { const y = gy + 30 + s * 38; R(ctx, 'rgba(30,25,20,0.7)', gx + 6, y, gw - 12, 4);
      for (let x = gx + 10; x < gx + gw - 14; x += 9) { ctx.fillStyle = `hsl(${(rng.f() * 360) | 0},60%,55%)`; ctx.fillRect(x, y - 9 - rng.f() * 8, 6, 9 + 4); } }
  } else {
    const g = ctx.createLinearGradient(0, gy, 0, gy + gh); g.addColorStop(0, rgb(warm, 0.78)); g.addColorStop(1, rgb(warm, 0.5));
    ctx.fillStyle = g; ctx.fillRect(gx, gy, gw, gh);
    for (let s = 0; s < 3; s++) { const y = gy + 30 + s * 38; R(ctx, 'rgba(0,0,0,0.55)', gx + 6, y, gw - 12, 4);
      for (let x = gx + 10; x < gx + gw - 14; x += 9) { ctx.fillStyle = `hsla(${(rng.f() * 360) | 0},60%,55%,0.55)`; ctx.fillRect(x, y - 9 - rng.f() * 8, 6, 9 + 4); } }
  }
  if (!emit) { ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.beginPath(); ctx.moveTo(gx + 20, gy + gh); ctx.lineTo(gx + 90, gy); ctx.lineTo(gx + 120, gy); ctx.lineTo(gx + 50, gy + gh); ctx.fill(); }
}
def('shop0', 256, 256, 3.2, 3.6, (k) => {
  const { ctx, emit } = k; const s = shopShell(k);
  interiorShelves(k, s.gx, s.gy, s.gw, s.gh, [255, 212, 138]);
  if (!emit) { R(ctx, rgb([60, 62, 66]), 122, s.gy, 12, s.gh); R(ctx, rgb([60, 62, 66]), s.gx, s.gy + 34, s.gw, 6); }
});
def('shop1', 256, 256, 3.2, 3.6, (k) => { // glass door + sidelights
  const { ctx, emit } = k; const s = shopShell(k, { gy: 54, gh: 202 });
  interiorShelves(k, s.gx, s.gy, s.gw, 150, [255, 208, 128]);
  if (!emit) {
    R(ctx, rgb([188, 186, 180]), 0, 206, 256, 50); R(ctx, rgb([60, 62, 66]), 84, 70, 88, 186);
    const g = ctx.createLinearGradient(0, 76, 0, 250); g.addColorStop(0, rgb(GL_T)); g.addColorStop(1, rgb([90, 100, 110])); ctx.fillStyle = g;
    ctx.fillRect(90, 76, 34, 174); ctx.fillRect(132, 76, 34, 174);
    R(ctx, rgb([220, 220, 220]), 116, 150, 4, 34); R(ctx, rgb([220, 220, 220]), 136, 150, 4, 34);
    R(ctx, rgb([196, 194, 188]), 70, 250, 116, 6);
  } else {
    const g = ctx.createLinearGradient(0, 76, 0, 250); g.addColorStop(0, rgb([255, 240, 200], 0.9)); g.addColorStop(1, rgb([255, 240, 200], 0.6)); ctx.fillStyle = g; ctx.fillRect(90, 76, 34, 174); ctx.fillRect(132, 76, 34, 174);
  }
});
def('shop2', 256, 256, 3.2, 3.6, (k) => { // liquor: posters, neon, bars
  const { ctx, emit, rng } = k; const s = shopShell(k, { gy: 62, gh: 146 });
  const cols = ['#e8463c', '#f4c430', '#2f8fe0', '#44b864', '#e056c0', '#ff8c22'];
  const neon = [[255, 60, 90], [60, 160, 255], [255, 200, 60]];
  const posters = []; for (let i = 0; i < 7; i++) posters.push([s.gx + 10 + rng.f() * (s.gw - 50), s.gy + 12 + rng.f() * (s.gh - 70), 22 + rng.f() * 18, 30 + rng.f() * 22, cols[rng.int(0, 5)]]);
  if (!emit) {
    vgrad(ctx, s.gx, s.gy, s.gw, s.gh, rgb([96, 82, 70]), rgb([50, 44, 40]));
    for (let x = s.gx + 8; x < s.gx + s.gw - 8; x += 12) R(ctx, rgb([60, 40, 30]), x, s.gy + 18, 7, 40);
    for (const p of posters) { R(ctx, p[4], p[0], p[1], p[2], p[3]); R(ctx, 'rgba(255,255,255,0.4)', p[0] + 3, p[1] + 4, p[2] - 6, 4); R(ctx, 'rgba(0,0,0,0.25)', p[0] + 3, p[1] + 14, p[2] - 6, 3); }
    ctx.fillStyle = 'rgba(25,25,28,0.95)';
    for (let x = s.gx + 4; x < s.gx + s.gw; x += 16) ctx.fillRect(x, s.gy, 4, s.gh);
    ctx.fillRect(s.gx, s.gy + 40, s.gw, 4); ctx.fillRect(s.gx, s.gy + 100, s.gw, 4);
    R(ctx, rgb([236, 236, 232]), 96, 70, 64, 20); R(ctx, '#d22', 100, 74, 56, 12);
  } else {
    ctx.fillStyle = 'rgba(255,190,110,0.30)'; ctx.fillRect(s.gx, s.gy, s.gw, s.gh);
    for (const p of posters) { ctx.fillStyle = p[4]; ctx.globalAlpha = 0.5; ctx.fillRect(p[0], p[1], p[2], p[3]); ctx.globalAlpha = 1; }
    ctx.shadowBlur = 10; ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) { ctx.strokeStyle = ctx.shadowColor = rgb(neon[i]); ctx.beginPath(); const x = 24 + i * 70, y = 100 + (i % 2) * 28; ctx.moveTo(x, y); ctx.lineTo(x + 40, y); ctx.lineTo(x + 40, y + 20); ctx.lineTo(x + 6, y + 20); ctx.stroke(); }
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(0,0,0,0.85)';
    for (let x = s.gx + 4; x < s.gx + s.gw; x += 16) ctx.fillRect(x, s.gy, 3, s.gh);
    R(ctx, rgb([255, 80, 70]), 100, 74, 56, 12);
  }
});
def('shop3', 256, 256, 3.2, 3.6, (k) => { // roll-down shutter with tags
  const { ctx, emit, rng } = k;
  stuccoBg(k, [232, 228, 218]);
  const tags = []; for (let i = 0; i < 5; i++) tags.push({ x: 20 + rng.f() * 200, y: 90 + rng.f() * 120, c: ['#ff3c78', '#3ce0ff', '#ffe03c', '#7cff3c', '#ffffff', '#b03cff'][rng.int(0, 5)], a: rng.f() * 6.28, s: 18 + rng.f() * 26 });
  if (!emit) {
    R(ctx, 'rgba(0,0,0,0.3)', 0, 48, 256, 10);
    R(ctx, rgb([60, 62, 66]), 6, 58, 244, 198);
    for (let y = 62; y < 250; y += 7) { vgrad(ctx, 10, y, 236, 7, rgb([214, 214, 210]), rgb([150, 150, 146])); }
    R(ctx, rgb([70, 70, 74]), 10, 246, 236, 10);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const t of tags) { ctx.strokeStyle = t.c; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(t.x, t.y); for (let i = 1; i < 6; i++) ctx.lineTo(t.x + Math.cos(t.a + i * 1.4) * t.s * (i % 2 ? 0.5 : 1) + i * 8, t.y + Math.sin(t.a + i * 2.1) * t.s * 0.5); ctx.stroke(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    speckle(k, 10);
  }
});
def('shop4', 256, 256, 3.2, 3.6, (k) => { // cafe
  const { ctx, emit, rng } = k; const s = shopShell(k, { gy: 62, gh: 146 });
  if (!emit) {
    vgrad(ctx, s.gx, s.gy, s.gw, s.gh, rgb([200, 170, 130]), rgb([110, 80, 55]));
    R(ctx, rgb([30, 50, 40]), s.gx + 14, s.gy + 14, 70, 56); R(ctx, 'rgba(255,255,255,0.7)', s.gx + 22, s.gy + 24, 54, 3); R(ctx, 'rgba(255,255,255,0.5)', s.gx + 22, s.gy + 34, 40, 3); R(ctx, 'rgba(255,255,255,0.5)', s.gx + 22, s.gy + 44, 46, 3);
    for (let i = 0; i < 3; i++) { const x = s.gx + 100 + i * 46; ctx.fillStyle = 'rgba(30,20,10,0.6)'; ctx.beginPath(); ctx.ellipse(x, s.gy + 100, 16, 5, 0, 0, 6.3); ctx.fill(); ctx.fillRect(x - 2, s.gy + 100, 4, 36); }
    R(ctx, rgb([60, 62, 66]), 120, s.gy, 10, s.gh);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.moveTo(s.gx + 120, s.gy + s.gh); ctx.lineTo(s.gx + 190, s.gy); ctx.lineTo(s.gx + 215, s.gy); ctx.lineTo(s.gx + 145, s.gy + s.gh); ctx.fill();
  } else {
    const g = ctx.createLinearGradient(0, s.gy, 0, s.gy + s.gh); g.addColorStop(0, 'rgba(255,190,110,0.9)'); g.addColorStop(1, 'rgba(255,160,80,0.6)'); ctx.fillStyle = g; ctx.fillRect(s.gx, s.gy, s.gw, s.gh);
    R(ctx, 'rgba(0,0,0,0.6)', s.gx + 14, s.gy + 14, 70, 56); for (let i = 0; i < 3; i++) R(ctx, 'rgba(255,255,255,0.8)', s.gx + 22, s.gy + 24 + i * 10, 54 - i * 8, 3);
    R(ctx, 'rgb(0,0,0)', 120, s.gy, 10, s.gh);
  }
});
def('shop5', 256, 256, 3.2, 3.6, (k) => { // dark glass lobby / bank
  const { ctx, emit } = k; const s = shopShell(k, { gy: 50, gh: 206 });
  if (!emit) {
    R(ctx, rgb([200, 196, 184]), 0, 226, 256, 30); speckle(k, 12);
    const g = ctx.createLinearGradient(0, 50, 0, 226); g.addColorStop(0, 'rgb(70,100,120)'); g.addColorStop(1, 'rgb(22,30,38)'); ctx.fillStyle = g; ctx.fillRect(s.gx, 54, s.gw, 172);
    ctx.fillStyle = 'rgb(186,156,80)'; for (const x of [s.gx, 70, 122, 174, s.gx + s.gw - 4]) ctx.fillRect(x, 54, 4, 172); ctx.fillRect(s.gx, 54, s.gw, 4); ctx.fillRect(s.gx, 90, s.gw, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.beginPath(); ctx.moveTo(24, 226); ctx.lineTo(100, 54); ctx.lineTo(132, 54); ctx.lineTo(56, 226); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255,215,140,0.38)'; ctx.fillRect(s.gx + 4, 96, s.gw - 8, 130);
    R(ctx, 'rgba(255,230,170,0.6)', 30, 100, 60, 10); R(ctx, 'rgba(255,230,170,0.6)', 160, 100, 60, 10);
    ctx.fillStyle = 'rgb(0,0,0)'; for (const x of [70, 122, 174]) ctx.fillRect(x, 54, 4, 172);
  }
});


/* ---------------- brick window bays ---------------- */
function brickBg(k) {
  if (k.emit) return; const { ctx, w, h, brng } = k;
  R(ctx, rgb([196, 190, 178]), 0, 0, w, h); const rh = 16, bw = 64;
  for (let r = 0; r < h / rh; r++) {
    const off = (r & 1) ? bw / 2 : 0;
    for (let i = -1; i < w / bw + 1; i++) {
      const v = 0.82 + brng.f() * 0.3, hue = brng.f(); const col = [176 * v + hue * 14, 92 * v + hue * 16, 70 * v];
      const x = i * bw + off; ctx.fillStyle = rgb(col); ctx.fillRect(x + 1.5, r * rh + 1.5, bw - 3, rh - 3);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x + 1.5, r * rh + 1.5, bw - 3, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + 1.5, r * rh + rh - 3.5, bw - 3, 2);
    }
  }
  blobs(k, 18, 14, 50, 0.6, 0.12); speckle(k, 16);
}
defLit('bk0', 256, 256, 3, 3, (k) => {
  brickBg(k); const { ctx, emit } = k; const x = 78, y = 54, w = 100, h = 126;
  if (!emit) { R(ctx, rgb([214, 208, 196]), x - 14, y - 16, w + 28, 12); R(ctx, 'rgba(0,0,0,0.3)', x - 14, y - 4, w + 28, 4); }
  sash(k, x, y, w, h, 1, 2, 6, { frame: [236, 232, 222] }); sill(k, x - 6, y + h + 7, w + 12, { c: [214, 208, 196] });
}, 0.0, 1.0);
defLit('bk1', 256, 256, 3, 3, (k) => {
  brickBg(k); const { ctx, emit } = k;
  if (!emit) { R(ctx, rgb([214, 208, 196]), 38, 40, 180, 10); }
  sash(k, 46, 62, 164, 100, 3, 1, 6, { frame: [60, 64, 70] }); sill(k, 40, 170, 176, { c: [214, 208, 196] });
}, 0.0, 1.0);
defLit('bk2', 256, 256, 3, 3, (k) => { // brick with arched window
  brickBg(k); const { ctx, emit } = k; const x = 84, y = 50, w = 88, h = 130;
  if (!emit) { archPath(ctx, x - 10, y - 10, w + 20, h + 10); ctx.fillStyle = rgb([220, 214, 200]); ctx.fill(); }
  ctx.save(); archPath(ctx, x, y, w, h); ctx.clip(); pane(k, x, y, w, h);
  if (!emit) { ctx.strokeStyle = rgb([236, 232, 222]); ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.moveTo(x, y + h * 0.5); ctx.lineTo(x + w, y + h * 0.5); ctx.stroke(); }
  ctx.restore(); sill(k, x - 6, y + h + 8, w + 12, { c: [214, 208, 196] });
}, 0.0, 1.0);

/* ---------------- office / mid-rise bays ---------------- */
function concreteBg(k, base = [214, 212, 206]) {
  if (k.emit) return;
  const { ctx, w, h } = k; R(ctx, rgb(base), 0, 0, w, h); blobs(k, 22, 12, 50, 0.5, 0.12); speckle(k, 14);
}
const ALU = [70, 76, 84];
defLit('of0', 256, 256, 3.2, 3.6, (k) => { // punched wide windows
  concreteBg(k); const { ctx, emit } = k;
  if (!emit) { R(ctx, 'rgba(0,0,0,0.22)', 0, 0, 256, 4); R(ctx, rgb([196, 194, 188]), 0, 196, 256, 60); R(ctx, 'rgba(0,0,0,0.12)', 0, 196, 256, 3); }
  lintelShadow(k, 36, 70, 184);
  sash(k, 36, 70, 184, 122, 2, 1, 6, { frame: ALU, pane: { noStreak: false } });
  sill(k, 34, 200, 188, { c: [214, 212, 206] });
}, 0.0, 1.0);
defLit('of1', 256, 256, 3.2, 3.6, (k) => { // twin tall windows + fins
  concreteBg(k); const { ctx, emit } = k;
  if (!emit) { R(ctx, 'rgba(0,0,0,0.22)', 0, 0, 256, 4); for (const x of [0, 246]) R(ctx, rgb([184, 182, 176]), x, 0, 10, 256); R(ctx, rgb([196, 194, 188]), 0, 204, 256, 52); }
  sash(k, 28, 54, 82, 146, 1, 2, 6, { frame: ALU }); sash(k, 146, 54, 82, 146, 1, 2, 6, { frame: ALU });
}, 0.0, 1.0);
defLit('of2', 256, 256, 3.2, 3.6, (k) => { // ribbon window
  concreteBg(k); const { ctx, emit } = k;
  if (!emit) { R(ctx, 'rgba(0,0,0,0.22)', 0, 54, 256, 6); R(ctx, rgb([206, 204, 198]), 0, 0, 256, 58); R(ctx, rgb([196, 194, 188]), 0, 204, 256, 52); R(ctx, rgb(ALU), 0, 60, 256, 144); }
  for (let i = 0; i < 4; i++) pane(k, 4 + i * 62, 66, 58, 132);
  if (!emit) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, 60, 256, 3); }
}, 0.0, 1.0);
defLit('ap0', 256, 256, 3.2, 3.6, (k) => { // apartment: slider door + wall window, balcony-ready
  stuccoBg(k, [236, 232, 222]); const { ctx, emit } = k;
  lintelShadow(k, 60, 56, 136);
  sash(k, 60, 56, 136, 150, 2, 1, 6, { frame: [230, 232, 232] });
  if (!emit) { R(ctx, rgb([200, 198, 192]), 0, 232, 256, 24); R(ctx, 'rgba(0,0,0,0.2)', 0, 232, 256, 3); }
}, 0.0, 1.0);

/* ---------------- curtain wall (6 x 7.2 m = 2 x 2 windows) ---------------- */
const CW_FRAME = [58, 64, 72];
defLit('cw0', 256, 256, 6, 7.2, (k) => {
  const { ctx, emit } = k; if (!emit) R(ctx, rgb(CW_FRAME), 0, 0, 256, 256);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const x = 3 + i * 127, y = 3 + j * 127;
    pane(k, x, y, 122, 88, { top: [178, 210, 236], bot: [92, 122, 152] });
    if (!emit) { vgrad(ctx, x, y + 88, 122, 34, rgb([44, 58, 72]), rgb([30, 40, 50])); }
  }
}, 0.14, 0.55);
defLit('cw1', 256, 256, 6, 7.2, (k) => {
  const { ctx, emit } = k; if (!emit) R(ctx, rgb(CW_FRAME), 0, 0, 256, 256);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) {
    const x = 2 + i * 64, y = 3 + j * 127;
    pane(k, x, y, 60, 98, { top: [170, 204, 232], bot: [88, 118, 148] });
    if (!emit) vgrad(ctx, x, y + 98, 60, 24, rgb([36, 48, 60]), rgb([26, 34, 44]));
  }
}, 0.12, 0.5);
defLit('cw2', 256, 256, 6, 7.2, (k) => { // ribbon bands
  const { ctx, emit } = k; if (!emit) { R(ctx, rgb([176, 180, 184]), 0, 0, 256, 256); speckle(k, 10); }
  for (let j = 0; j < 2; j++) {
    const y = 18 + j * 127;
    if (!emit) R(ctx, rgb(CW_FRAME), 0, y - 3, 256, 98);
    for (let i = 0; i < 4; i++) pane(k, 2 + i * 64, y, 60, 92, { top: [182, 212, 236], bot: [94, 124, 154] });
  }
}, 0.14, 0.5);
defLit('cw3', 256, 256, 6, 7.2, (k) => { // punched on light panels
  const { ctx, emit } = k; if (!emit) { R(ctx, rgb([204, 206, 208]), 0, 0, 256, 256); blobs(k, 20, 10, 40, 0.5, 0.1); speckle(k, 12); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, 256, 2); ctx.fillRect(0, 127, 256, 2); ctx.fillRect(0, 0, 2, 256); ctx.fillRect(127, 0, 2, 256); }
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) sash(k, 22 + i * 128, 26 + j * 128, 84, 74, 2, 1, 5, { frame: ALU });
}, 0.12, 0.5);

/** draws a single-floor design twice (two floors stacked in one tile; vertical resolution halved). p = fraction of floors lit */
function twoFloor(fn) {
  return (k) => {
    const { ctx } = k; const base = k.p;
    for (let f = 0; f < 2; f++) {
      ctx.save(); ctx.translate(0, f * k.h / 2); ctx.scale(1, 0.5);
      k.p = k.lrng.f() < base ? 1 : 0; fn(k);
      ctx.restore();
    }
    k.p = base;
  };
}
/* ---------------- art deco piers (two floors per tile: 3.6 x 7.4 m) ---------------- */
function pier(k, x, w) {
  if (k.emit) return; const { ctx } = k;
  R(ctx, rgb([226, 216, 196]), x, 0, w, 256);
  ctx.fillStyle = 'rgba(0,0,0,0.16)'; for (let i = 4; i < w - 2; i += 8) ctx.fillRect(x + i, 0, 2, 256);
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; for (let i = 6; i < w - 2; i += 8) ctx.fillRect(x + i, 0, 1, 256);
  R(ctx, 'rgba(0,0,0,0.25)', x + w - 3, 0, 3, 256);
}
defLit('dc0', 256, 256, 3.6, 7.4, twoFloor((k) => {
  const { ctx, emit } = k;
  if (!emit) { R(ctx, rgb([214, 204, 184]), 0, 0, 256, 256); speckle(k, 10); }
  pier(k, 0, 36); pier(k, 220, 36);
  if (!emit) { R(ctx, 'rgba(0,0,0,0.3)', 36, 0, 184, 12);
    R(ctx, rgb([150, 120, 70]), 36, 190, 184, 66); ctx.strokeStyle = rgb([236, 210, 130]); ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(40 + i * 30, 252); ctx.lineTo(55 + i * 30, 196); ctx.lineTo(70 + i * 30, 252); ctx.stroke(); }
    R(ctx, rgb([236, 210, 130]), 36, 188, 184, 4); }
  sash(k, 66, 40, 124, 136, 2, 2, 5, { frame: [90, 82, 62] });
}), 0.12, 0.5);
defLit('dc1', 256, 256, 3.6, 7.4, twoFloor((k) => {
  const { ctx, emit } = k;
  if (!emit) { R(ctx, rgb([216, 206, 188]), 0, 0, 256, 256); speckle(k, 10); }
  pier(k, 0, 24); pier(k, 232, 24); pier(k, 112, 32);
  if (!emit) { R(ctx, 'rgba(0,0,0,0.3)', 24, 0, 208, 12); R(ctx, rgb([130, 110, 76]), 24, 196, 208, 60); ctx.strokeStyle = rgb([220, 196, 120]); ctx.lineWidth = 2; for (let i = 0; i < 13; i++) { ctx.beginPath(); ctx.moveTo(30 + i * 15.5, 200); ctx.lineTo(30 + i * 15.5, 252); ctx.stroke(); } }
  sash(k, 34, 30, 68, 154, 1, 3, 4, { frame: [90, 82, 62] }); sash(k, 154, 30, 68, 154, 1, 3, 4, { frame: [90, 82, 62] });
}), 0.12, 0.5);

/* ---------------- industrial ---------------- */
def('rol', 256, 256, 4, 4, (k) => { // roller shutter door
  const { ctx, emit } = k;
  if (!emit) {
    R(ctx, rgb([176, 174, 168]), 0, 0, 256, 256); speckle(k, 16);
    R(ctx, rgb([70, 70, 72]), 16, 36, 224, 220);
    for (let y = 40; y < 246; y += 8) vgrad(ctx, 22, y, 212, 8, rgb([226, 226, 222]), rgb([160, 160, 156]));
    R(ctx, rgb([60, 60, 62]), 22, 244, 212, 12); R(ctx, rgb([240, 200, 40]), 22, 246, 212, 4);
    R(ctx, rgb([50, 50, 52]), 12, 36, 10, 220); R(ctx, rgb([50, 50, 52]), 234, 36, 10, 220);
    R(ctx, 'rgba(0,0,0,0.3)', 0, 30, 256, 6);
    for (let i = 0; i < 5; i++) { const x = 30 + Math.random() * 0; ctx.fillStyle = 'rgba(90,60,30,0.10)'; ctx.fillRect(x + i * 40, 40, 6, 200); }
  } else { R(ctx, rgb([255, 214, 120]), 118, 14, 20, 6); const g = ctx.createRadialGradient(128, 17, 1, 128, 17, 40); g.addColorStop(0, 'rgba(255,214,120,0.6)'); g.addColorStop(1, 'rgba(255,214,120,0)'); ctx.fillStyle = g; ctx.fillRect(80, 0, 96, 60); }
});
def('mand', 256, 256, 3, 3, (k) => { // steel man-door bay
  const { ctx, emit } = k; concreteBg(k, [196, 194, 188]);
  if (!emit) {
    R(ctx, rgb([80, 88, 84]), 94, 70, 72, 186); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(100, 78, 60, 170);
    R(ctx, rgb([50, 52, 56]), 88, 64, 84, 6); R(ctx, rgb([50, 52, 56]), 88, 64, 6, 192); R(ctx, rgb([50, 52, 56]), 166, 64, 6, 192);
    R(ctx, rgb([220, 220, 215]), 104, 28, 48, 24); R(ctx, rgb([200, 40, 40]), 108, 32, 40, 16);
    R(ctx, rgb([200, 200, 196]), 150, 150, 6, 6); R(ctx, rgb([90, 90, 92]), 40, 120, 26, 10); R(ctx, rgb([60, 60, 60]), 190, 70, 20, 10);
  } else { R(ctx, rgb([255, 214, 120]), 192, 70, 16, 6); const g = ctx.createRadialGradient(200, 73, 1, 200, 73, 34); g.addColorStop(0, 'rgba(255,214,120,0.55)'); g.addColorStop(1, 'rgba(255,214,120,0)'); ctx.fillStyle = g; ctx.fillRect(160, 40, 80, 70); }
});
def('hangar', 512, 256, 12, 6, (k) => {
  const { ctx, emit } = k; if (emit) return;
  R(ctx, rgb([190, 192, 192]), 0, 0, 512, 256);
  for (let i = 0; i < 6; i++) { const x = 4 + i * 84; vgrad(ctx, x, 4, 80, 248, rgb([214, 216, 214]), rgb([168, 170, 168])); R(ctx, 'rgba(0,0,0,0.4)', x + 79, 4, 3, 248); for (let y = 20; y < 250; y += 28) R(ctx, 'rgba(0,0,0,0.12)', x, y, 80, 2); }
  for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#222' : '#f0c820'; ctx.beginPath(); ctx.moveTo(i * 64, 236); ctx.lineTo(i * 64 + 32, 236); ctx.lineTo(i * 64 + 32 + 14, 256); ctx.lineTo(i * 64 + 14, 256); ctx.fill(); }
  speckle(k, 14);
});

/* ---------------- church / civic / glass ---------------- */
def('cwin', 128, 256, 2, 4, (k) => {
  const { ctx, emit, rng } = k;
  const pal = [[220, 50, 50], [60, 100, 220], [240, 190, 50], [60, 170, 90], [170, 70, 190]];
  const cc = []; for (let i = 0; i < 12; i++) cc.push(pal[rng.int(0, 4)]);
  stuccoBg(k, [236, 232, 222]);
  const x = 26, y = 26, w = 76, h = 222;
  if (!emit) { archPath(ctx, x - 9, y - 9, w + 18, h + 9); ctx.fillStyle = rgb([214, 208, 192]); ctx.fill(); }
  ctx.save(); archPath(ctx, x, y, w, h); ctx.clip();
  let n = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++) {
    const c = cc[n++ % 12]; const cx = x + i * w / 2, cy = y + j * 56;
    if (!emit) { ctx.fillStyle = rgb(c, 0.9); ctx.fillRect(cx, cy, w / 2, 56); ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(cx + 4, cy + 4, w / 2 - 8, 8); }
    else { const g = ctx.createLinearGradient(0, cy, 0, cy + 56); g.addColorStop(0, rgb(c, 0.95)); g.addColorStop(1, rgb(c, 0.6)); ctx.fillStyle = g; ctx.fillRect(cx, cy, w / 2, 56); }
  }
  if (!emit) { ctx.strokeStyle = 'rgba(30,30,30,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); for (let j = 0; j <= 4; j++) { ctx.moveTo(x, y + j * 56); ctx.lineTo(x + w, y + j * 56); } ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke(); }
  else { ctx.strokeStyle = 'rgb(0,0,0)'; ctx.lineWidth = 3; ctx.beginPath(); for (let j = 0; j <= 4; j++) { ctx.moveTo(x, y + j * 56); ctx.lineTo(x + w, y + j * 56); } ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke(); }
  ctx.restore();
});
def('cdoor', 192, 256, 3, 4, (k) => {
  const { ctx, emit } = k; stuccoBg(k, [236, 232, 222]);
  const x = 40, y = 46, w = 112, h = 210;
  if (!emit) {
    archPath(ctx, x - 14, y - 14, w + 28, h + 14); ctx.fillStyle = rgb([206, 198, 180]); ctx.fill();
    archPath(ctx, x, y, w, h); ctx.fillStyle = rgb([92, 58, 40]); ctx.fill();
    ctx.save(); archPath(ctx, x, y, w, h); ctx.clip(); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x + w / 2 - 1.5, y, 3, h);
    for (let yy = y + 70; yy < y + h; yy += 50) { ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(x + 8, yy, w / 2 - 14, 40); ctx.strokeRect(x + w / 2 + 6, yy, w / 2 - 14, 40); }
    ctx.restore(); R(ctx, rgb([190, 186, 176]), x - 18, 244, w + 36, 12);
  } else { const g = ctx.createRadialGradient(x + w / 2, y + 10, 1, x + w / 2, y + 10, 70); g.addColorStop(0, 'rgba(255,210,120,0.55)'); g.addColorStop(1, 'rgba(255,210,120,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 192, 130); }
});
def('rose', 128, 128, 2, 2, (k) => {
  const { ctx, emit, rng } = k; stuccoBg(k, [236, 232, 222]); const cx = 64, cy = 64;
  const pal = [[220, 50, 50], [60, 100, 220], [240, 190, 50], [60, 170, 90], [170, 70, 190]];
  if (!emit) { ctx.fillStyle = rgb([206, 198, 180]); ctx.beginPath(); ctx.arc(cx, cy, 58, 0, 6.3); ctx.fill(); }
  for (let i = 0; i < 12; i++) { const c = pal[rng.int(0, 4)]; ctx.fillStyle = rgb(c, emit ? 0.95 : 0.9); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 50, i * Math.PI / 6, (i + 1) * Math.PI / 6); ctx.fill(); }
  ctx.strokeStyle = emit ? '#000' : '#222'; ctx.lineWidth = 3; for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(i * Math.PI / 6) * 50, cy + Math.sin(i * Math.PI / 6) * 50); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(cx, cy, 50, 0, 6.3); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy, 20, 0, 6.3); ctx.stroke();
});
defLit('cv', 192, 256, 3.6, 4.8, (k) => { // civic tall window in stone
  const { ctx, emit } = k;
  if (!emit) { R(ctx, rgb([220, 212, 194]), 0, 0, 192, 256); blobs(k, 14, 10, 40, 0.5, 0.1); speckle(k, 12); R(ctx, 'rgba(0,0,0,0.25)', 0, 0, 192, 6); R(ctx, rgb([200, 192, 174]), 0, 226, 192, 30); }
  const x = 42, y = 40, w = 108, h = 166;
  if (!emit) { R(ctx, rgb([236, 230, 214]), x - 12, y - 12, w + 24, 12); R(ctx, 'rgba(0,0,0,0.25)', x - 12, y + h, w + 24, 6); R(ctx, rgb([236, 230, 214]), x - 12, y - 12, 10, h + 12); R(ctx, rgb([236, 230, 214]), x + w + 2, y - 12, 10, h + 12); }
  sash(k, x, y, w, h, 2, 3, 5, { frame: [236, 230, 214] });
}, 0.0, 1.0);
def('cvdoor', 256, 256, 5, 5, (k) => {
  const { ctx, emit } = k; concreteBg(k, [222, 214, 196]);
  if (!emit) {
    R(ctx, rgb([60, 46, 30]), 40, 36, 176, 220);
    for (const [x, w] of [[46, 76], [134, 76]]) { const g = ctx.createLinearGradient(0, 70, 0, 250); g.addColorStop(0, rgb(GL_T, 0.8)); g.addColorStop(1, rgb([60, 70, 80])); ctx.fillStyle = g; ctx.fillRect(x, 84, w, 166); R(ctx, rgb([150, 120, 60]), x + (x < 100 ? w - 8 : 0), 160, 6, 30); }
    R(ctx, rgb([150, 120, 60]), 126, 84, 4, 166); R(ctx, rgb([196, 186, 168]), 30, 244, 196, 12);
    ctx.fillStyle = rgb(GL_B); ctx.fillRect(46, 44, 164, 30);
  } else { const g = ctx.createLinearGradient(0, 84, 0, 250); g.addColorStop(0, 'rgba(255,225,160,0.85)'); g.addColorStop(1, 'rgba(255,200,120,0.55)'); ctx.fillStyle = g; ctx.fillRect(46, 84, 76, 166); ctx.fillRect(134, 84, 76, 166); ctx.fillStyle = 'rgba(255,225,160,0.7)'; ctx.fillRect(46, 44, 164, 30); }
});
defLit('gbg', 256, 256, 4.5, 4.5, (k) => { // big glazed terminal bay
  const { ctx, emit } = k; if (!emit) R(ctx, rgb([68, 74, 82]), 0, 0, 256, 256);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const x = 4 + i * 126, y = 4 + j * 126; pane(k, x, y, 122, 122, { top: [190, 218, 240], bot: [104, 134, 162], noStreak: false });
    if (!emit) { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x, y + 50, 122, 6); }
  }
}, 0.3, 0.7);
def('pk', 256, 256, 4, 3.6, (k) => { // parking deck bay
  const { ctx, emit, rng } = k;
  const cars = []; for (let i = 0; i < 3; i++) cars.push([24 + i * 78 + rng.f() * 12, rng.f() < 0.7, [rng.f() * 255, rng.f() * 255, rng.f() * 255]]);
  if (!emit) {
    R(ctx, rgb([60, 60, 66]), 0, 0, 256, 256);
    vgrad(ctx, 0, 40, 256, 216, rgb([86, 86, 92]), rgb([44, 44, 50]));
    for (const c of cars) { if (!c[1]) continue; ctx.fillStyle = rgb(c[2], 0.5); rpath(ctx, c[0], 200, 62, 26, 7); ctx.fill(); ctx.fillStyle = 'rgba(10,10,10,0.6)'; ctx.fillRect(c[0] + 12, 192, 38, 12); }
    R(ctx, rgb([170, 168, 162]), 0, 0, 256, 44); speckle(k, 12); R(ctx, 'rgba(0,0,0,0.35)', 0, 40, 256, 5);
    R(ctx, rgb([176, 174, 168]), 0, 0, 12, 256); R(ctx, rgb([176, 174, 168]), 244, 0, 12, 256);
    R(ctx, rgb([200, 198, 190]), 0, 232, 256, 24); R(ctx, 'rgba(0,0,0,0.25)', 0, 232, 256, 2);
    R(ctx, rgb([240, 240, 230]), 40, 84, 50, 4); R(ctx, rgb([240, 240, 230]), 160, 84, 50, 4);
  } else { R(ctx, 'rgba(230,240,220,0.85)', 40, 84, 50, 4); R(ctx, 'rgba(230,240,220,0.85)', 160, 84, 50, 4); const g = ctx.createLinearGradient(0, 88, 0, 200); g.addColorStop(0, 'rgba(200,220,180,0.25)'); g.addColorStop(1, 'rgba(200,220,180,0)'); ctx.fillStyle = g; ctx.fillRect(12, 88, 232, 112); }
});
def('arc', 256, 256, 6, 7, (k) => { // stadium arcade
  const { ctx, emit } = k;
  if (!emit) {
    R(ctx, rgb([190, 188, 182]), 0, 0, 256, 256); blobs(k, 26, 12, 50, 0.5, 0.14); speckle(k, 16);
    for (let i = 0; i < 3; i++) { const x = 14 + i * 80; archPath(ctx, x, 70, 64, 186); ctx.fillStyle = rgb([40, 40, 46]); ctx.fill(); archPath(ctx, x + 6, 76, 52, 180); vgrad(ctx, x + 6, 76, 52, 180, 'rgb(70,70,78)', 'rgb(24,24,28)'); }
    R(ctx, 'rgba(0,0,0,0.3)', 0, 0, 256, 6); R(ctx, rgb([176, 174, 168]), 0, 0, 256, 34); R(ctx, 'rgba(0,0,0,0.3)', 0, 34, 256, 4);
  } else { for (let i = 0; i < 3; i++) { const x = 14 + i * 80; const g = ctx.createLinearGradient(0, 100, 0, 256); g.addColorStop(0, 'rgba(255,220,150,0.0)'); g.addColorStop(1, 'rgba(255,220,150,0.5)'); ctx.fillStyle = g; archPath(ctx, x + 6, 76, 52, 180); ctx.fill(); } }
});
def('stand', 256, 128, 8, 2.4, (k) => { // stadium seating rows (tinted)
  const { ctx, emit, rng } = k; if (emit) return;
  R(ctx, rgb([170, 168, 162]), 0, 0, 256, 128);
  for (let r = 0; r < 4; r++) {
    const y = r * 32; vgrad(ctx, 0, y, 256, 32, rgb([190, 188, 182]), rgb([150, 148, 144])); R(ctx, 'rgba(0,0,0,0.35)', 0, y + 30, 256, 2);
    for (let x = 4; x < 256; x += 12) { const v = 0.85 + rng.f() * 0.2; ctx.fillStyle = rgb([255, 255, 255], v); rpath(ctx, x, y + 6, 9, 14, 2); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(x, y + 18, 9, 3); }
  }
  speckle(k, 10);
}, { seam: true });
def('track', 128, 128, 4, 4, (k) => { if (k.emit) { R(k.ctx, 'rgb(70,36,28)', 0, 0, 128, 128); return; } const { ctx } = k; R(ctx, rgb([200, 110, 86]), 0, 0, 128, 128); blobs(k, 10, 10, 34, 0.5, 0.14); speckle(k, 26); R(ctx, 'rgba(255,255,255,0.8)', 0, 0, 128, 3); }, { seam: true });
def('pitch', 512, 320, 105, 68, (k) => {
  if (k.emit) { R(k.ctx, 'rgb(46,84,36)', 0, 0, 512, 320); return; } const { ctx, brng } = k;
  for (let i = 0; i < 14; i++) R(ctx, rgb(i & 1 ? [92, 150, 70] : [82, 138, 62]), i * 512 / 14, 0, 512 / 14 + 1, 320);
  speckle(k, 14);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.strokeRect(10, 10, 492, 300);
  ctx.beginPath(); ctx.moveTo(256, 10); ctx.lineTo(256, 310); ctx.stroke(); ctx.beginPath(); ctx.arc(256, 160, 40, 0, 6.3); ctx.stroke();
  ctx.strokeRect(10, 100, 70, 120); ctx.strokeRect(432, 100, 70, 120); ctx.strokeRect(10, 130, 26, 60); ctx.strokeRect(476, 130, 26, 60);
});
def('flood', 128, 64, 4, 2, (k) => {
  const { ctx, emit } = k;
  if (!emit) { R(ctx, rgb([70, 72, 76]), 0, 0, 128, 64); for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) R(ctx, rgb([245, 245, 235]), 4 + i * 15.5, 4 + j * 15, 12, 11); }
  else for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) R(ctx, rgb([255, 255, 240]), 4 + i * 15.5, 4 + j * 15, 12, 11);
});
def('helipad', 256, 256, 10, 10, (k) => {
  const { ctx, emit } = k; if (emit) { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 4; for (const p of [[14, 14], [242, 14], [14, 242], [242, 242]]) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6); } return; }
  R(ctx, rgb([86, 88, 92]), 0, 0, 256, 256); blobs(k, 14, 20, 60, 0.5, 0.12); speckle(k, 16);
  ctx.strokeStyle = '#f0d020'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(128, 128, 104, 0, 6.3); ctx.stroke();
  ctx.fillStyle = '#f4f4f0'; ctx.fillRect(84, 80, 18, 96); ctx.fillRect(154, 80, 18, 96); ctx.fillRect(84, 118, 88, 18);
  ctx.strokeStyle = '#f0d020'; ctx.lineWidth = 4; ctx.strokeRect(4, 4, 248, 248);
});
/* ---------------- icons ---------------- */
def('ic_cross', 128, 128, 2, 2, (k) => {
  const { ctx, emit } = k;
  if (!emit) { R(ctx, '#f6f6f4', 0, 0, 128, 128); R(ctx, '#d42020', 46, 16, 36, 96); R(ctx, '#d42020', 16, 46, 96, 36); ctx.strokeStyle = '#d42020'; ctx.lineWidth = 5; ctx.strokeRect(4, 4, 120, 120); }
  else { R(ctx, 'rgb(255,60,50)', 46, 16, 36, 96); R(ctx, 'rgb(255,60,50)', 16, 46, 96, 36); }
});
def('ic_burger', 192, 192, 2, 2, (k) => {
  const { ctx, emit } = k;
  const draw = (f) => {
    ctx.fillStyle = f ? 'rgb(255,200,60)' : '#f2b640'; ctx.beginPath(); ctx.ellipse(96, 66, 66, 40, 0, Math.PI, 0); ctx.fill(); ctx.fillRect(30, 66, 132, 8);
    ctx.fillStyle = f ? 'rgb(120,255,80)' : '#5ab540'; ctx.fillRect(24, 76, 144, 12);
    ctx.fillStyle = f ? 'rgb(255,80,60)' : '#d83a2a'; ctx.fillRect(30, 88, 132, 12);
    ctx.fillStyle = f ? 'rgb(255,180,60)' : '#8a4a24'; ctx.fillRect(28, 100, 136, 18);
    ctx.fillStyle = f ? 'rgb(255,200,60)' : '#f2b640'; rpath(ctx, 26, 120, 140, 26, 12); ctx.fill();
  };
  if (!emit) { R(ctx, '#c8201c', 0, 0, 192, 192); ctx.strokeStyle = '#ffd230'; ctx.lineWidth = 8; ctx.strokeRect(6, 6, 180, 180); draw(false); }
  else { ctx.strokeStyle = 'rgb(255,220,60)'; ctx.lineWidth = 8; ctx.strokeRect(6, 6, 180, 180); draw(true); }
});
def('ic_gas', 192, 256, 3, 4, (k) => {
  const { ctx, emit } = k;
  if (!emit) {
    R(ctx, '#1c2b60', 0, 0, 192, 256); R(ctx, '#d42a2a', 0, 0, 192, 76); ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.strokeRect(5, 5, 182, 246);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 56px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('GAS', 96, 56);
    ctx.fillStyle = '#ffd040'; ctx.font = 'bold 32px Arial, sans-serif'; for (let i = 0; i < 3; i++) { ctx.fillText(['3.79', '3.99', '4.19'][i], 96, 120 + i * 50); }
  } else {
    ctx.strokeStyle = 'rgb(255,255,255)'; ctx.lineWidth = 5; ctx.strokeRect(5, 5, 182, 246);
    ctx.fillStyle = 'rgba(255,120,120,0.9)'; ctx.font = 'bold 56px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('GAS', 96, 56);
    ctx.fillStyle = 'rgb(255,220,70)'; ctx.font = 'bold 32px Arial, sans-serif'; for (let i = 0; i < 3; i++) ctx.fillText(['3.79', '3.99', '4.19'][i], 96, 120 + i * 50);
  }
});

/* ---------------- murals (painted side walls) ---------------- */
function muralTile(variant) {
  return (k) => {
    if (k.emit) return; const { ctx, w, h, rng } = k;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    if (variant === 0) { g.addColorStop(0, '#3a2a7a'); g.addColorStop(0.35, '#d0407a'); g.addColorStop(0.62, '#ff9a3a'); g.addColorStop(0.63, '#1c2a4a'); g.addColorStop(1, '#10182c'); }
    else { g.addColorStop(0, '#1aa6b8'); g.addColorStop(0.5, '#f2d04a'); g.addColorStop(1, '#e8583a'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    if (variant === 0) {
      ctx.fillStyle = '#ffe070'; ctx.beginPath(); ctx.arc(w * 0.72, h * 0.6, 46, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#16182e'; for (let i = 0; i < 18; i++) { const bx = i * 22, bh = 14 + rng.f() * 40; ctx.fillRect(bx, h * 0.63 - bh, 18, bh); }
      for (const px of [40, 330]) { ctx.strokeStyle = '#0c1020'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(px, h); ctx.quadraticCurveTo(px + 10, h * 0.5, px - 4, h * 0.22); ctx.stroke(); ctx.fillStyle = '#0c1020'; for (let a = 0; a < 7; a++) { const an = a / 7 * 6.28; ctx.beginPath(); ctx.moveTo(px - 4, h * 0.22); ctx.quadraticCurveTo(px - 4 + Math.cos(an) * 30, h * 0.22 + Math.sin(an) * 14 - 8, px - 4 + Math.cos(an) * 52, h * 0.22 + Math.sin(an) * 30); ctx.quadraticCurveTo(px - 4 + Math.cos(an) * 30, h * 0.22 + Math.sin(an) * 20, px - 4, h * 0.22); ctx.fill(); } }
      ctx.font = 'bold 120px "Arial Black", "DejaVu Sans", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = 12; ctx.strokeStyle = '#101010'; ctx.strokeText('LS', w * 0.5, h * 0.52);
      ctx.fillStyle = '#ffffff'; ctx.fillText('LS', w * 0.5, h * 0.52); ctx.lineWidth = 3; ctx.strokeStyle = '#2ad0ff'; ctx.strokeText('LS', w * 0.5 - 3, h * 0.52 - 3);
    } else {
      for (let i = 0; i < 14; i++) { ctx.fillStyle = `hsl(${(rng.f() * 360) | 0},85%,55%)`; ctx.globalAlpha = 0.85; const x = rng.f() * w, y = rng.f() * h; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 40 + rng.f() * 70, y + rng.f() * 30 - 15); ctx.lineTo(x + 30 + rng.f() * 60, y + 30 + rng.f() * 50); ctx.closePath(); ctx.fill(); }
      ctx.globalAlpha = 1; ctx.font = 'bold 76px "Arial Black", "DejaVu Sans", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      for (const [t, y, c] of [['WEST', h * 0.32, '#ffffff'], ['SIDE', h * 0.68, '#ffe03c']]) { ctx.lineWidth = 12; ctx.strokeStyle = '#141414'; ctx.strokeText(t, w * 0.5, y); ctx.fillStyle = c; ctx.fillText(t, w * 0.5, y); }
      ctx.fillStyle = '#ff3c78'; ctx.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 12 : 26, an = i / 10 * 6.283 - 1.57; ctx.lineTo(56 + Math.cos(an) * r, 50 + Math.sin(an) * r); } ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.strokeRect(4, 4, w - 8, h - 8);
    }
    ctx.globalAlpha = 0.25; for (let i = 0; i < 80; i++) { ctx.fillStyle = rng.f() < 0.5 ? '#000' : '#fff'; ctx.fillRect(rng.f() * w, rng.f() * h, 2, 2); } ctx.globalAlpha = 1;
  };
}
def('mural0', 384, 192, 10, 5, muralTile(0));
def('mural1', 384, 192, 10, 5, muralTile(1));

/* ---------------- sign panels (4:1) with real text ---------------- */
const SIGN_DEFS = {
  LIQUOR: ['LIQUOR', [28, 10, 12], [255, 90, 70], [255, 200, 80]],
  PIZZA: ['PIZZA', [190, 38, 30], [255, 246, 214], [60, 200, 90]],
  BURGERS: ['BURGERS', [255, 204, 50], [200, 30, 24], [200, 30, 24]],
  MOTEL: ['MOTEL', [14, 20, 50], [255, 90, 200], [70, 220, 255]],
  GARAGE: ['GARAGE', [26, 26, 30], [255, 214, 50], [255, 214, 50]],
  BANK: ['BANK', [20, 48, 108], [240, 200, 90], [240, 200, 90]],
  HOTEL: ['HOTEL', [42, 12, 52], [255, 160, 60], [255, 100, 60]],
  CLUB: ['CLUB', [14, 6, 26], [255, 60, 220], [60, 230, 255]],
  GYM: ['GYM', [24, 24, 26], [150, 255, 60], [150, 255, 60]],
  H24: ['24H', [10, 60, 130], [255, 255, 255], [255, 220, 60]],
  GAS: ['GAS', [212, 34, 34], [255, 255, 255], [255, 255, 255]],
  CAFE: ['CAFE', [60, 34, 20], [250, 232, 200], [255, 190, 100]],
  TACOS: ['TACOS', [230, 120, 24], [255, 250, 230], [60, 170, 70]],
  DONUTS: ['DONUTS', [244, 130, 180], [120, 50, 40], [255, 255, 255]],
  CLINIC: ['CLINIC', [242, 246, 250], [20, 130, 140], [20, 130, 140]],
  PAWN: ['PAWN', [18, 18, 56], [255, 210, 70], [255, 210, 70]],
  AUTO: ['AUTO', [240, 222, 40], [20, 20, 20], [20, 20, 20]],
  POLICE: ['POLICE', [14, 28, 80], [255, 255, 255], [90, 140, 255]],
  CITYHALL: ['CITY HALL', [58, 58, 62], [240, 210, 120], [240, 210, 120]],
  SCHOOL: ['SCHOOL', [30, 80, 50], [255, 255, 255], [255, 220, 80]],
  HOSPITAL: ['HOSPITAL', [246, 246, 246], [210, 30, 30], [210, 30, 30]],
  AIRPORT: ['AIRPORT', [10, 30, 62], [255, 255, 255], [255, 210, 40]],
  MARKET: ['MARKET', [28, 110, 40], [255, 255, 255], [255, 230, 80]],
  BAR: ['BAR', [18, 12, 12], [255, 200, 60], [255, 70, 70]],
  TIRES: ['TIRES', [240, 240, 240], [20, 20, 20], [230, 40, 30]],
  NAILS: ['NAILS', [255, 130, 200], [255, 255, 255], [255, 255, 255]],
};
const SIGN_KEYS = Object.keys(SIGN_DEFS);
function signDraw(text, bg, fg, bd) {
  return (k) => {
    const { ctx, w, h, emit } = k;
    const light = (bg[0] * 0.3 + bg[1] * 0.59 + bg[2] * 0.11) > 110;   // light panels are back-lit boxes: they glow as a whole at night
    if (!emit) { rpath(ctx, 1, 1, w - 2, h - 2, 8); ctx.fillStyle = rgb(bg); ctx.fill(); }
    else if (light) { rpath(ctx, 1, 1, w - 2, h - 2, 8); ctx.fillStyle = rgb(bg, 0.8); ctx.fill(); }
    ctx.lineWidth = 5; ctx.strokeStyle = rgb(bd, emit ? 1 : 0.95); rpath(ctx, 7, 7, w - 14, h - 14, 6);
    if (emit) { ctx.shadowColor = rgb(bd); ctx.shadowBlur = 6; } ctx.stroke(); ctx.shadowBlur = 0;
    let size = h * 0.56; ctx.font = `bold 100px "Arial Black", "DejaVu Sans", Arial, sans-serif`;
    const mw = ctx.measureText(text).width; size = Math.min(size, (w * 0.80) / mw * 100);
    ctx.font = `bold ${size}px "Arial Black", "DejaVu Sans", Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (emit && light) { ctx.fillStyle = rgb(fg, 0.55); ctx.fillText(text, w / 2, h / 2 + 2); }
    else if (emit) { ctx.shadowColor = rgb(fg); ctx.shadowBlur = 8; ctx.fillStyle = rgb(fg); ctx.fillText(text, w / 2, h / 2 + 2); ctx.shadowBlur = 0; ctx.fillText(text, w / 2, h / 2 + 2); }
    else { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillText(text, w / 2 + 2, h / 2 + 4); ctx.fillStyle = rgb(fg); ctx.fillText(text, w / 2, h / 2 + 2); }
  };
}
for (const key of SIGN_KEYS) { const [t, bg, fg, bd] = SIGN_DEFS[key]; def('sg_' + key, 384, 96, 4, 1, signDraw(t, bg, fg, bd)); }

/* ====================================================================================
 *  atlas construction (needs DOM)
 * ==================================================================================== */
function mkCanvas(w, h) {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}
function blit(dst, src, x, y, w, h, pad, seam) {
  dst.imageSmoothingEnabled = false;
  if (seam) {
    dst.save(); dst.beginPath(); dst.rect(x - pad, y - pad, w + 2 * pad, h + 2 * pad); dst.clip();
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) dst.drawImage(src, x + ox * w, y + oy * h);
    dst.restore();
  } else {
    dst.drawImage(src, x, y);
    dst.drawImage(src, 0, 0, w, 1, x, y - pad, w, pad); dst.drawImage(src, 0, h - 1, w, 1, x, y + h, w, pad);
    dst.drawImage(src, 0, 0, 1, h, x - pad, y, pad, h); dst.drawImage(src, w - 1, 0, 1, h, x + w, y, pad, h);
    dst.drawImage(src, 0, 0, 1, 1, x - pad, y - pad, pad, pad); dst.drawImage(src, w - 1, 0, 1, 1, x + w, y - pad, pad, pad);
    dst.drawImage(src, 0, h - 1, 1, 1, x - pad, y + h, pad, pad); dst.drawImage(src, w - 1, h - 1, 1, 1, x + w, y + h, pad, pad);
  }
}
let _atlas = null;
function buildAtlasCanvases() {
  if (_atlas) return _atlas;
  const colorC = mkCanvas(AW, AH), emitC = mkCanvas(AW / 2, AH / 2);
  const cctx = colorC.getContext('2d'), ectx = emitC.getContext('2d');
  ectx.fillStyle = '#000'; ectx.fillRect(0, 0, AW / 2, AH / 2);
  for (const dft of DEFS) {
    for (let pass = 0; pass < 2; pass++) {
      const emit = pass === 1; const sc = emit ? 0.5 : 1;
      const tw = dft.w * sc, th = dft.h * sc;
      const tmp = mkCanvas(tw, th); const tctx = tmp.getContext('2d', { willReadFrequently: true });
      if (emit) { tctx.fillStyle = '#000'; tctx.fillRect(0, 0, tw, th); tctx.scale(0.5, 0.5); }
      const k = { ctx: tctx, w: dft.w, h: dft.h, emit, p: dft.p ?? 0,
        rng: new Rng(strHash(dft.base) + 11), brng: new Rng(strHash(dft.name) + 77), lrng: new Rng(strHash(dft.name) + 991) };
      dft.draw(k);
      blit(emit ? ectx : cctx, tmp, dft.x * sc, dft.y * sc, tw, th, PAD * sc, dft.seam);
    }
  }
  _atlas = { colorC, emitC };
  return _atlas;
}

/* ====================================================================================
 *  PALETTES + PRIMITIVES
 * ==================================================================================== */
const PAL_PASTEL = [0xf3d9d2, 0xf6e7b8, 0xd0e8da, 0xc9deec, 0xeac8a0, 0xf5efe4, 0xdccbe8, 0xf1b9a2, 0xbfdcd2, 0xf0d0a8, 0x7fd0c8, 0xf08c78, 0xe8c050, 0x8fc0e8, 0xf0a8b8];
const PAL_BLEACH = [0xe8dfcb, 0xdacfb6, 0xcac3b5, 0xc2baa8, 0xe2d9d0, 0xd6d2c6, 0xe6dcc0];
const PAL_EARTH = [0xc08c62, 0xa97e5d, 0x96835f, 0xc6a272, 0xa06f52, 0x8a9c76, 0x7394ab, 0xd6ab7c, 0xb98a7a, 0x9c6a58];
const PAL_GANG = [0x7fb56a, 0x9a7ab8, 0xe3c65a, 0x6a8cc0];
const PAL_NEUTRAL = [0xdedbd2, 0xcfcac0, 0xb9b6ae, 0xe6e2d6, 0xc8c2b4, 0xa8aeb4, 0xd8d4c8];
const ROOF_TILE = [0xc2613a, 0xb5562f, 0xa8523a, 0x9a4a30, 0xd06c40];
const ROOF_SHINGLE = [0x5a5a60, 0x6a5a4a, 0x4e5258, 0x7a6a58, 0x5a4c42, 0x687068, 0x8a8a86];
function houseColor(rng) {
  const r = rng.f();
  if (r < 0.50) return rng.pick(PAL_PASTEL);
  if (r < 0.70) return rng.pick(PAL_BLEACH);
  if (r < 0.94) return rng.pick(PAL_EARTH);
  return rng.pick(PAL_GANG);
}
/** 'light' wall colours brighten (tile base is ~0.93) */
const wallCol = (hex, k = 1.07) => mulc(C(hex), k);
const litP = (rng, base, p) => base + (rng.chance(p) ? 'l' : 'd');

/* face frames: 0:+z 1:+x 2:-z 3:-x.  local (s = lateral to viewer's right, t = outward) */
const FACES = [[0, 1], [1, 0], [0, -1], [-1, 0]];
function frameOf(face, cx, cz) {
  const [nx, nz] = FACES[face]; const rx = nz, rz = -nx;
  return { nx, nz, rx, rz, P: (s, t, y) => [cx + rx * s + nx * t, y, cz + rz * s + nz * t], dir: [nx, 0, nz] };
}

/* ---- smooth quad (explicit normals) for cylinders / domes ---- */
GB.prototype.sq = function (p, n, c, tile, o) {
  const t = typeof tile === 'string' ? TILES[tile] : tile;
  const f = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]], g = [p[3][0] - p[1][0], p[3][1] - p[1][1], p[3][2] - p[1][2]];
  const fn = [f[1] * g[2] - f[2] * g[1], f[2] * g[0] - f[0] * g[2], f[0] * g[1] - f[1] * g[0]];
  const an = [n[0][0] + n[1][0] + n[2][0] + n[3][0], n[0][1] + n[1][1] + n[2][1] + n[3][1], n[0][2] + n[1][2] + n[2][2] + n[3][2]];
  const flip = fn[0] * an[0] + fn[1] * an[1] + fn[2] * an[2] < 0;
  const uu = [[t.u0, t.v0], [t.u1, t.v0], [t.u1, t.v1], [t.u0, t.v1]];
  const ix = [];
  for (let i = 0; i < 4; i++) ix.push(this.vtx(p[i][0], p[i][1], p[i][2], n[i][0], n[i][1], n[i][2], uu[i][0], uu[i][1], c[i]));
  if (flip) this.i.push(ix[0], ix[2], ix[1], ix[0], ix[3], ix[2]); else this.i.push(ix[0], ix[1], ix[2], ix[0], ix[2], ix[3]);
};

/** frustum / cylinder with smooth sides.  o:{cap:tile, capCol, th (ring height), a0,a1 (partial arc), thin} */
function cyl(gb, cx, cz, y0, y1, r0, r1, seg, tile, c0, c1, o = {}) {
  const t = TILES[tile]; const th = o.th || t.hm;
  const nv = Math.max(1, Math.round((y1 - y0) / th));
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? Math.PI * 2;
  const ny = (r0 - r1) / Math.max(1e-6, y1 - y0);
  for (let s = 0; s < seg; s++) {
    const A = a0 + (a1 - a0) * s / seg, B = a0 + (a1 - a0) * (s + 1) / seg;
    const nA = [Math.sin(A), ny, Math.cos(A)], nB = [Math.sin(B), ny, Math.cos(B)];
    const lA = Math.hypot(...nA), lB = Math.hypot(...nB);
    nA[0] /= lA; nA[1] /= lA; nA[2] /= lA; nB[0] /= lB; nB[1] /= lB; nB[2] /= lB;
    for (let j = 0; j < nv; j++) {
      const v0 = j / nv, v1 = (j + 1) / nv, ya = lerp(y0, y1, v0), yb = lerp(y0, y1, v1);
      const ra = lerp(r0, r1, v0), rb = lerp(r0, r1, v1);
      gb.sq([[cx + Math.sin(A) * ra, ya, cz + Math.cos(A) * ra], [cx + Math.sin(B) * ra, ya, cz + Math.cos(B) * ra], [cx + Math.sin(B) * rb, yb, cz + Math.cos(B) * rb], [cx + Math.sin(A) * rb, yb, cz + Math.cos(A) * rb]],
        [nA, nB, nB, nA], [mixc(c0, c1, v0), mixc(c0, c1, v0), mixc(c0, c1, v1), mixc(c0, c1, v1)], t);
    }
  }
  if (o.cap) {
    const ct = TILES[o.cap], cc = o.capCol || c1; const ctr = gb.vtx(cx, y1, cz, 0, 1, 0, (ct.u0 + ct.u1) / 2, (ct.v0 + ct.v1) / 2, cc);
    const ring = [];
    for (let s = 0; s <= seg; s++) { const A = a0 + (a1 - a0) * s / seg; ring.push(gb.vtx(cx + Math.sin(A) * r1, y1, cz + Math.cos(A) * r1, 0, 1, 0, lerp(ct.u0, ct.u1, 0.5 + Math.sin(A) * 0.5), lerp(ct.v0, ct.v1, 0.5 + Math.cos(A) * 0.5), cc)); }
    for (let s = 0; s < seg; s++) gb.i.push(ctr, ring[s + 1], ring[s]);
  }
}
/** hemispherical dome */
function dome(gb, cx, cy, cz, r, seg, rings, tile, c0, c1, sy = 1) {
  const t = TILES[tile];
  for (let j = 0; j < rings; j++) {
    const p0 = (j / rings) * Math.PI / 2, p1 = ((j + 1) / rings) * Math.PI / 2;
    for (let s = 0; s < seg; s++) {
      const A = s / seg * Math.PI * 2, B = (s + 1) / seg * Math.PI * 2;
      const P = (a, p) => [cx + Math.sin(a) * Math.cos(p) * r, cy + Math.sin(p) * r * sy, cz + Math.cos(a) * Math.cos(p) * r];
      const N = (a, p) => [Math.sin(a) * Math.cos(p), Math.sin(p) / Math.max(0.3, sy), Math.cos(a) * Math.cos(p)];
      const cA = mixc(c0, c1, j / rings), cB = mixc(c0, c1, (j + 1) / rings);
      if (j === rings - 1) { // apex triangle-ish (degenerate quad ok)
        gb.sq([P(A, p0), P(B, p0), P(B, p1), P(A, p1)], [N(A, p0), N(B, p0), N(B, p1), N(A, p1)], [cA, cA, cB, cB], t);
      } else gb.sq([P(A, p0), P(B, p0), P(B, p1), P(A, p1)], [N(A, p0), N(B, p0), N(B, p1), N(A, p1)], [cA, cA, cB, cB], t);
    }
  }
}

/* ---- horizontal cells / strips ---- */
function strip(gb, ax, az, bx, bz, y0, y1, cells, c0, c1, jit = 0.03) {
  let tot = 0; for (const c of cells) tot += c.w || 1;
  const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1; const dir = [-dz / l, 0, dx / l];
  let acc = 0;
  for (const c of cells) {
    const t0 = acc / tot; acc += (c.w || 1); const t1 = acc / tot;
    const x0 = ax + dx * t0, z0 = az + dz * t0, x1 = ax + dx * t1, z1 = az + dz * t1;
    const j = (1 + (gb.rng.f() - 0.5) * 2 * jit) * (c.k || 1);
    let k0 = mulc(c0, j), k1 = mulc(c1, j);
    if (c.col) { k0 = [k0[0] * c.col[0], k0[1] * c.col[1], k0[2] * c.col[2]]; k1 = [k1[0] * c.col[0], k1[1] * c.col[1], k1[2] * c.col[2]]; }
    gb.q([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], c.t, k0, k1, { dir, flip: c.flip, v: c.v, u: c.u });
  }
}
/** multi-floor facade along A->B.  o:{fam:[base names], lit:p, bay, col, rows, ground:{h,fam,cell(i,n),dark,lit}, edge:{t,w}, pick(f,i,n)->name|{t,flip}, n, jit} */
function facade(gb, A, Bp, y0, floors, fh, o) {
  const rng = gb.rng; const len = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]);
  const n = Math.max(1, o.n || Math.round(len / (o.bay || 3)));
  const col = o.col || WHITE; const rows = o.rows || 1;
  const nameOf = (base, p) => (TILES[base] ? base : litP(rng, base, p));
  const cellFor = (fam, p, prev, f, i) => {
    if (o.pick) { const r = o.pick(f, i, n); if (r) return typeof r === 'string' ? { t: r, flip: rng.chance(0.5) } : r; }
    let b = rng.pick(fam), tries = 0; while (fam.length > 1 && b === prev.last && tries++ < 4) b = rng.pick(fam);
    prev.last = b; return { t: nameOf(b, p), flip: rng.chance(0.5) };
  };
  let y = y0, f = 0; const prev = { last: null };
  if (o.ground) {
    const g = o.ground, gh = g.h || fh; const cells = [];
    for (let i = 0; i < n; i++) {
      let c = g.cell ? g.cell(i, n) : null;
      if (!c) c = cellFor(g.fam || o.fam, g.lit ?? o.lit ?? 0.4, prev, 0, i);
      cells.push(c);
    }
    if (o.edge) { cells.unshift({ t: o.edge.t, w: o.edge.w || 0.3 }); cells.push({ t: o.edge.t, w: o.edge.w || 0.3 }); }
    strip(gb, A[0], A[1], Bp[0], Bp[1], y, y + gh, cells, mulc(col, g.dark ?? 0.8), mulc(col, 0.97), o.jit);
    y += gh; f = 1;
  }
  while (f < floors) {
    const r = Math.min(rows, floors - f); const cells = [];
    for (let i = 0; i < n; i++) {
      const c = cellFor(o.fam, o.lit ?? 0.4, prev, f, i);
      if (r < rows) c.v = [0, r / rows];
      cells.push(c);
    }
    if (o.edge) { cells.unshift({ t: o.edge.t, w: o.edge.w || 0.3 }); cells.push({ t: o.edge.t, w: o.edge.w || 0.3 }); }
    strip(gb, A[0], A[1], Bp[0], Bp[1], y, y + r * fh, cells, mulc(col, 0.955), col, o.jit);
    y += r * fh; f += r;
  }
  return y;
}
/** 4-sided box mass with facades; specs = {f,r,b,l} each facade options (or null => plain wall) */
function massing(gb, x0, z0, x1, z1, y0, floors, fh, specs, col, o = {}) {
  const sides = [
    ['f', [x0, z1], [x1, z1]], ['r', [x1, z1], [x1, z0]], ['b', [x1, z0], [x0, z0]], ['l', [x0, z0], [x0, z1]],
  ];
  let top = y0;
  for (const [k, A, B] of sides) {
    const sp = specs[k];
    if (sp === 'skip') continue;
    if (!sp) { gb.wall(A[0], A[1], B[0], B[1], y0, y0 + floors * fh, o.plain || 'stucco', mulc(col, 0.85), col); top = y0 + floors * fh; continue; }
    top = facade(gb, A, B, y0, floors, fh, Object.assign({ col }, sp));
  }
  return top;
}
function skirt(gb, x0, z0, x1, z1, col = [0.42, 0.41, 0.4], depth = 2) {
  const c0 = mulc(col, 0.7);
  const W = [[x0, z1, x1, z1], [x1, z1, x1, z0], [x1, z0, x0, z0], [x0, z0, x0, z1]];
  for (const [a, b, c, d] of W) gb.wall(a, b, c, d, -depth, 0, 'concrete', c0, col, { tw: 8, th: 8 });
}
function ledgeRing(gb, x0, z0, x1, z1, y0, y1, out, tile, col, o = {}) {
  const P = [[x0 - out, z0 - out], [x1 + out, z0 - out], [x1 + out, z1 + out], [x0 - out, z1 + out]];
  const I = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const so = { tw: 99, th: 99 };
  gb.wall(P[3][0], P[3][1], P[2][0], P[2][1], y0, y1, tile, col, col, so); gb.wall(P[2][0], P[2][1], P[1][0], P[1][1], y0, y1, tile, col, col, so);
  gb.wall(P[1][0], P[1][1], P[0][0], P[0][1], y0, y1, tile, col, col, so); gb.wall(P[0][0], P[0][1], P[3][0], P[3][1], y0, y1, tile, col, col, so);
  const top = mulc(col, 1.06), bot = mulc(col, 0.7);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    gb.q([P[i][0], y1, P[i][1]], [P[j][0], y1, P[j][1]], [I[j][0], y1, I[j][1]], [I[i][0], y1, I[i][1]], tile, top, top, { up: true });
    if (!o.noBottom) gb.q([P[i][0], y0, P[i][1]], [P[j][0], y0, P[j][1]], [I[j][0], y0, I[j][1]], [I[i][0], y0, I[i][1]], tile, bot, bot, { down: true });
  }
}
/** parapet around a closed polygon traversed front->east->back->west (outward = left of travel). */
function parapetLoop(gb, pts, y, ph, t, wt, col, o = {}) {
  const n = pts.length; const N = [];
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; N.push([-dz / l, dx / l]); }
  const I = pts.map((p, i) => { const a = N[(i + n - 1) % n], b = N[i]; return [p[0] - t * (a[0] + b[0]), p[1] - t * (a[1] + b[1])]; });
  const so = { tw: o.tw, th: o.th }; const ic = mulc(col, 0.85), oc = mulc(col, 0.97);
  const cc = o.capCol || C(0xd8d6d0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n; const a = pts[i], b = pts[j], ia = I[i], ib = I[j];
    gb.wall(a[0], a[1], b[0], b[1], y, y + ph, wt, oc, col, so);
    gb.wall(ib[0], ib[1], ia[0], ia[1], y, y + ph, wt, ic, ic, so);
    gb.q([a[0], y + ph, a[1]], [b[0], y + ph, b[1]], [ib[0], y + ph, ib[1]], [ia[0], y + ph, ia[1]], o.cap || 'concrete', cc, cc, { up: true, tw: 9, th: 9 });
  }
}
/** flat roof w/ parapet; returns top y.  o.poly: outline (for non rectangular), o.decks: list of [x0,z0,x1,z1] */
function roofFlat(gb, x0, z0, x1, z1, y, o = {}) {
  const ph = o.ph ?? 0.55, t = o.t ?? 0.24, wt = o.wall || 'stucco', col = o.col || WHITE;
  const dk = o.deck || [0.62, 0.62, 0.6];
  const decks = o.decks || [[x0, z0, x1, z1]];
  for (const d of decks) gb.flat(d[0], d[1], d[2], d[3], y, o.deckTile || 'gravel', dk);
  if (ph > 0) parapetLoop(gb, o.poly || [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], y, ph, t, wt, col, o);
  return y + ph;
}
/** roof over wall-top rect.  hip(k=1)/gable.  y = wall top, rise = ridge height above y, ov = overhang */
function roofPitched(gb, x0, z0, x1, z1, y, rise, ov, tile, col, o = {}) {
  const gable = !!o.gable;
  let alongX;
  if (o.ridge === 'x') alongX = true; else if (o.ridge === 'z') alongX = false; else alongX = (x1 - x0) > (z1 - z0);
  const S0 = alongX ? z0 : x0, S1 = alongX ? z1 : x1, L0 = alongX ? x0 : z0, L1 = alongX ? x1 : z1;
  const hw = (S1 - S0) / 2, sm = (S0 + S1) / 2;
  const P = (s, l, yy) => (alongX ? [l, yy, s] : [s, yy, l]);
  const drop = rise * ov / hw, ye = y - drop, ry = y + rise;
  const lr0 = gable ? L0 - ov : Math.min(L0 + hw, (L0 + L1) / 2), lr1 = gable ? L1 + ov : Math.max(L1 - hw, (L0 + L1) / 2);
  const se0 = S0 - ov, se1 = S1 + ov, le0 = L0 - ov, le1 = L1 + ov;
  const ro = { up: true, tw: o.tw, th: o.th };
  const cR = col, cE = mulc(col, 0.88);
  // slopes (ridge endpoints) - for gable the ridge spans le0..le1 (rake overhang)
  const rA = gable ? le0 : lr0, rB = gable ? le1 : lr1;
  gb.qt(P(se0, le0, ye), P(se0, le1, ye), P(sm, rB, ry), P(sm, rA, ry), tile, cE, cR, ro);
  gb.qt(P(se1, le1, ye), P(se1, le0, ye), P(sm, rA, ry), P(sm, rB, ry), tile, cE, cR, ro);
  if (!gable) {
    gb.tri(P(se1, le0, ye), P(se0, le0, ye), P(sm, lr0, ry), tile, cE, [[0, 0], [1, 0], [0.5, 1]], { up: true, c2: cR });
    gb.tri(P(se0, le1, ye), P(se1, le1, ye), P(sm, lr1, ry), tile, cE, [[0, 0], [1, 0], [0.5, 1]], { up: true, c2: cR });
  } else {
    const gt = o.gableTile || 'stucco', gc = o.gableCol || WHITE;
    const dirA = alongX ? [-1, 0, 0] : [0, 0, -1], dirB = alongX ? [1, 0, 0] : [0, 0, 1];
    gb.tri(P(S0, L0, y), P(S1, L0, y), P(sm, L0, ry), gt, mulc(gc, 0.9), [[0, 0], [1, 0], [0.5, 1]], { dir: dirA, c2: gc });
    gb.tri(P(S1, L1, y), P(S0, L1, y), P(sm, L1, ry), gt, mulc(gc, 0.9), [[0, 0], [1, 0], [0.5, 1]], { dir: dirB, c2: gc });
  }
  if (o.soffit !== false) { // underside of the eaves + fascia
    const sc = mulc(C(o.trim || 0xf0ece4), 0.95);
    const ring = [[S0, L0], [S1, L0], [S1, L1], [S0, L1]]; const eav = [[se0, le0], [se1, le0], [se1, le1], [se0, le1]];
    const pick = (i) => { const a = ring[i], b = eav[i]; return [a, b]; };
    const mk = (s, l, yy) => P(s, l, yy);
    const sides = gable ? [[0, 3], [1, 2]] : [[0, 1], [1, 2], [2, 3], [3, 0]];
    for (const [i, j] of sides) {
      const a = ring[i], b = ring[j], ea = eav[i], eb = eav[j];
      gb.q(mk(a[0], a[1], y), mk(b[0], b[1], y), mk(eb[0], eb[1], ye), mk(ea[0], ea[1], ye), 'flat', sc, sc, { down: true });
      const em = mk((ea[0] + eb[0]) / 2, (ea[1] + eb[1]) / 2, ye), cc0 = mk((se0 + se1) / 2, (le0 + le1) / 2, ye);
      gb.q(mk(ea[0], ea[1], ye - 0.16), mk(eb[0], eb[1], ye - 0.16), mk(eb[0], eb[1], ye), mk(ea[0], ea[1], ye), 'flat', sc, sc, { dir: [em[0] - cc0[0], 0, em[2] - cc0[2]] });
    }
  }
  return ry;
}
/** thin sloped slab (shed roof / awning-ish).  low edge on side 'face' (0:+z,1:+x,2:-z,3:-x) */
function roofShed(gb, x0, z0, x1, z1, yLow, yHigh, face, tile, col, o = {}) {
  const th = o.th ?? 0.22; const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // corners depending on face: low side at the face
  const H = (x, z) => {
    let t;
    if (face === 0) t = (z1 - z) / (z1 - z0); else if (face === 2) t = (z - z0) / (z1 - z0);
    else if (face === 1) t = (x1 - x) / (x1 - x0); else t = (x - x0) / (x1 - x0);
    return lerp(yLow, yHigh, t);
  };
  const p = (x, z, d = 0) => [x, H(x, z) - d, z];
  const c = col, cs = mulc(col, 0.9), cb = mulc(col, 0.7);
  gb.qt(p(x0, z1), p(x1, z1), p(x1, z0), p(x0, z0), tile, c, c, { up: true });
  gb.q(p(x0, z1, th), p(x1, z1, th), p(x1, z0, th), p(x0, z0, th), 'flat', cb, cb, { down: true });
  const side = (a, b) => gb.q(p(a[0], a[1], th), p(b[0], b[1], th), p(b[0], b[1]), p(a[0], a[1]), 'flat', cs, cs, { dir: [(a[1] - b[1]) * 0 + ((a[0] + b[0]) / 2 - cx), 0, (a[1] + b[1]) / 2 - cz] });
  side([x0, z1], [x1, z1]); side([x1, z1], [x1, z0]); side([x1, z0], [x0, z0]); side([x0, z0], [x0, z1]);
}
/** striped awning over the wall, centred at cx, front face `face` */
function awning(gb, cx, y, cz, w, depth, drop, col, face = 0) {
  const F = frameOf(face, cx, cz); const hw = w / 2;
  const a = F.P(-hw, depth, y - drop), b = F.P(hw, depth, y - drop), c = F.P(hw, 0, y), d = F.P(-hw, 0, y);
  gb.qt(a, b, c, d, 'awn', col, mulc(col, 1.05), { up: true, tw: 2, th: 99 });
  gb.q(F.P(-hw, depth, y - drop - 0.28), F.P(hw, depth, y - drop - 0.28), b, a, 'awn', col, col, { dir: F.dir, tw: 2 });
  const dk = mulc(col, 0.55);
  gb.tri(F.P(-hw, 0, y), a, F.P(-hw, depth, y - drop - 0.28), 'flat', dk, [[0, 0], [1, 0], [1, 1]], { dir: [-F.rx, 0, -F.rz] });
  gb.tri(F.P(hw, 0, y), F.P(hw, depth, y - drop - 0.28), b, 'flat', dk, [[0, 0], [1, 0], [1, 1]], { dir: [F.rx, 0, F.rz] });
  gb.q(F.P(-hw, 0, y - 0.3), F.P(hw, 0, y - 0.3), F.P(hw, depth, y - drop - 0.28), F.P(-hw, depth, y - drop - 0.28), 'flat', dk, dk, { down: true });
}
/** sign panel (aspect from the tile), centre cx,cy,cz, width w, facing `face`. o: {dbl, off, c} */
function signPanel(gb, cx, cy, cz, w, key, face = 0, o = {}) {
  const tn = key.startsWith('sg_') || TILES[key] ? key : 'sg_' + key; const t = TILES[tn];
  const h = o.h || w * t.h / t.w; const F = frameOf(face, cx, cz); const off = o.off ?? 0.06;
  const c = o.c || WHITE;
  gb.q(F.P(-w / 2, off, cy - h / 2), F.P(w / 2, off, cy - h / 2), F.P(w / 2, off, cy + h / 2), F.P(-w / 2, off, cy + h / 2), tn, c, c, { dir: F.dir, dbl: !!o.dbl });
  return h;
}
function railing(gb, ax, az, bx, bz, y, h, col = WHITE, o = {}) {
  const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
  gb.qt([ax, y, az], [bx, y, bz], [bx, y + h, bz], [ax, y + h, az], o.tile || 'rail', col, col, { dir: [-dz / l, 0, dx / l], dbl: true, tw: 2, th: 99 });
}
function stairs(gb, x, y0, z, dx, dz, width, rise, run, n, col, o = {}) {
  const px = -dz, pz = dx; const hw = width / 2; const tile = o.tile || 'concrete';
  const so = { tw: 99, th: 99 };
  const P = (t, s, y) => [x + dx * t + px * s, y, z + dz * t + pz * s];
  const cT = col, cR = mulc(col, 0.78);
  for (let i = 0; i < n; i++) {
    const t0 = run * i / n, t1 = run * (i + 1) / n, yb = y0 + rise * i / n, yt = y0 + rise * (i + 1) / n;
    gb.q(P(t0, -hw, yb), P(t0, hw, yb), P(t0, hw, yt), P(t0, -hw, yt), tile, cR, cR, Object.assign({ dir: [-dx, 0, -dz] }, so));
    gb.q(P(t0, -hw, yt), P(t0, hw, yt), P(t1, hw, yt), P(t1, -hw, yt), tile, cT, cT, Object.assign({ up: true }, so));
  }
  const cS = mulc(col, 0.7);
  gb.tri(P(0, hw, y0), P(run, hw, y0), P(run, hw, y0 + rise), 'flat', cS, null, { dir: [px, 0, pz] });
  gb.tri(P(run, -hw, y0), P(0, -hw, y0), P(run, -hw, y0 + rise), 'flat', cS, null, { dir: [-px, 0, -pz] });
}
function balcony(gb, cx, y, cz, face, w, dep, col = [0.75, 0.74, 0.72], o = {}) {
  const F = frameOf(face, cx, cz); const hw = w / 2;
  const a = F.P(-hw, 0, y), b = F.P(hw, 0, y), c = F.P(hw, dep, y), d = F.P(-hw, dep, y);
  const slab = 0.18;
  gb.q([d[0], y, d[2]], [c[0], y, c[2]], [b[0], y, b[2]], [a[0], y, a[2]], 'concrete', col, col, { up: true, tw: 99, th: 99 });
  const dk = mulc(col, 0.9);
  gb.q(F.P(-hw, dep, y - slab), F.P(hw, dep, y - slab), F.P(hw, dep, y), F.P(-hw, dep, y), 'concrete', dk, dk, { dir: F.dir, tw: 99, th: 99 });
  gb.q(F.P(-hw, 0, y - slab), F.P(hw, 0, y - slab), F.P(hw, dep, y - slab), F.P(-hw, dep, y - slab), 'flat', mulc(col, 0.6), mulc(col, 0.6), { down: true });
  gb.q(F.P(hw, dep, y - slab), F.P(hw, 0, y - slab), F.P(hw, 0, y), F.P(hw, dep, y), 'concrete', dk, dk, { dir: [F.rx, 0, F.rz], tw: 99, th: 99 });
  gb.q(F.P(-hw, 0, y - slab), F.P(-hw, dep, y - slab), F.P(-hw, dep, y), F.P(-hw, 0, y), 'concrete', dk, dk, { dir: [-F.rx, 0, -F.rz], tw: 99, th: 99 });
  const rc = o.rail || WHITE, rh = 0.95;
  const pa = F.P(-hw + 0.04, dep - 0.04, y), pb = F.P(hw - 0.04, dep - 0.04, y);
  railing(gb, pa[0], pa[2], pb[0], pb[2], y, rh, rc);
  if (!o.noSides) {
    const p0 = F.P(-hw + 0.04, 0, y), p1 = F.P(-hw + 0.04, dep - 0.04, y), q0 = F.P(hw - 0.04, 0, y), q1 = F.P(hw - 0.04, dep - 0.04, y);
    railing(gb, p0[0], p0[2], p1[0], p1[2], y, rh, rc); railing(gb, q0[0], q0[2], q1[0], q1[2], y, rh, rc);
  }
}
/** asphalt / concrete lot slab with kerb */
function lotPad(gb, x0, z0, x1, z1, y = 0.08, o = {}) {
  const c = o.col || [0.8, 0.8, 0.8];
  gb.flat(x0, z0, x1, z1, y, o.tile || 'lot', c, { tw: o.tw, th: o.th });
  const s = mulc(C(0xa8a49c), 0.8);
  gb.wall(x0, z1, x1, z1, -0.5, y, 'concrete', s, s, { tw: 99, th: 99 }); gb.wall(x1, z1, x1, z0, -0.5, y, 'concrete', s, s, { tw: 99, th: 99 });
  gb.wall(x1, z0, x0, z0, -0.5, y, 'concrete', s, s, { tw: 99, th: 99 }); gb.wall(x0, z0, x0, z1, -0.5, y, 'concrete', s, s, { tw: 99, th: 99 });
}
function lawnPad(gb, x0, z0, x1, z1, y = 0.1) {
  gb.flat(x0, z0, x1, z1, y, 'lawn', [0.85, 0.9, 0.8]);
  const s = mulc(C(0x7a7a70), 0.7);
  gb.wall(x0, z1, x1, z1, -0.5, y, 'concrete', s, s, { tw: 99, th: 99 }); gb.wall(x1, z1, x1, z0, -0.5, y, 'concrete', s, s, { tw: 99, th: 99 });
  gb.wall(x1, z0, x0, z0, -0.5, y, 'concrete', s, s, { tw: 99, th: 99 }); gb.wall(x0, z0, x0, z1, -0.5, y, 'concrete', s, s, { tw: 99, th: 99 });
}
function fence(gb, ax, az, bx, bz, h, tile, col, y = 0.1, o = {}) {
  const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
  gb.qt([ax, y, az], [bx, y, bz], [bx, y + h, bz], [ax, y + h, az], tile, col, col, { dir: [-dz / l, 0, dx / l], dbl: true, tw: o.tw || 2, th: 99 });
}
function blockWall(gb, ax, az, bx, bz, h, col, y = 0) {
  const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, t = 0.18;
  const nx = -dz / l * t / 2, nz = dx / l * t / 2;
  gb.wall(ax - nx, az - nz, bx - nx, bz - nz, y, y + h, 'concrete', mulc(col, 0.8), col, { tw: 4, th: 4 });
  gb.wall(bx + nx, bz + nz, ax + nx, az + nz, y, y + h, 'concrete', mulc(col, 0.8), col, { tw: 4, th: 4 });
  const n = [dx / l, 0, dz / l];
  gb.q([ax - nx, y + h, az - nz], [bx - nx, y + h, bz - nz], [bx + nx, y + h, bz + nz], [ax + nx, y + h, az + nz], 'concrete', col, col, { up: true, tw: 99, th: 99 });
}
function acUnit(gb, x, y, z, s = 1, col = [0.66, 0.68, 0.7]) {
  gb.box(x - 0.45 * s, y, z - 0.4 * s, x + 0.45 * s, y + 0.75 * s, z + 0.4 * s, { side: 'rmetal', c: col, ct: mulc(col, 0.9), tw: 3, th: 3 });
  gb.flat(x - 0.32 * s, z - 0.28 * s, x + 0.32 * s, z + 0.28 * s, y + 0.76 * s, 'flat', [0.12, 0.12, 0.13]);
}
function waterTank(gb, x, y, z, r = 1.3, h = 2.4) {
  const leg = [0.36, 0.34, 0.32];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) gb.box(x + sx * r * 0.7 - 0.07, y, z + sz * r * 0.7 - 0.07, x + sx * r * 0.7 + 0.07, y + 1.2, z + sz * r * 0.7 + 0.07, { side: 'flat', c: leg, tw: 99, th: 99 });
  cyl(gb, x, z, y + 1.2, y + 1.2 + h, r, r, 10, 'siding', mulc(C(0x8a6a4a), 0.8), C(0x9a7a58), { th: 99 });
  cyl(gb, x, z, y + 1.2 + h, y + 1.2 + h + 0.7, r, 0.05, 10, 'flat', C(0x6a4a30), C(0x6a4a30), { th: 99 });
}
/** random rooftop mech clutter inside the rectangle (no overlap with parapet) */
function rooftop(gb, rng, x0, z0, x1, z1, y, n, o = {}) {
  const W = x1 - x0, D = z1 - z0; if (W < 4 || D < 4) return;
  const cols = Math.max(1, Math.floor(W / 4.2)), rowsN = Math.max(1, Math.floor(D / 4.2));
  const cells = []; for (let i = 0; i < cols; i++) for (let j = 0; j < rowsN; j++) cells.push([i, j]);
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rng.f() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  for (let k = 0; k < Math.min(n, cells.length); k++) {
    const [i, j] = cells[k]; const cx = x0 + (i + 0.5) * W / cols + rng.range(-0.3, 0.3), cz = z0 + (j + 0.5) * D / rowsN + rng.range(-0.3, 0.3);
    const r = rng.f();
    if (r < 0.40) { acUnit(gb, cx, y, cz, rng.range(0.9, 1.5)); if (rng.chance(0.5)) acUnit(gb, cx + 1.1, y, cz + 0.1, rng.range(0.8, 1.2)); }
    else if (r < 0.62) { const s = rng.range(2.2, 3.2), hh = rng.range(2.2, 3.0); gb.box(cx - s / 2, y, cz - s / 2, cx + s / 2, y + hh, cz + s / 2, { side: 'concrete', top: 'gravel', c: [0.8, 0.79, 0.76], ct: [0.55, 0.55, 0.53], tw: 4, th: 4 }); gb.wall(cx - 0.5, cz + s / 2 + 0.03, cx + 0.5, cz + s / 2 + 0.03, y, y + 2.0, 'mand', [0.9, 0.9, 0.9], [0.9, 0.9, 0.9], { tw: 99, th: 99, dir: null }); }
    else if (r < 0.78 && !o.noTank) waterTank(gb, cx, y, cz, rng.range(1.0, 1.5), rng.range(1.8, 2.6));
    else { cyl(gb, cx, cz, y, y + rng.range(0.6, 1.2), 0.3, 0.3, 6, 'rmetal', [0.6, 0.6, 0.6], [0.7, 0.7, 0.7], { cap: 'flat', th: 99 }); gb.box(cx + 0.8, y, cz - 0.3, cx + 1.6, y + 0.5, cz + 0.3, { side: 'rmetal', c: [0.6, 0.62, 0.64], tw: 3, th: 3 }); }
  }
}
/** low-poly shrub */
function bush(gb, rng, x, y, z, r) {
  const g = C(rng.pick([0x4a7a3a, 0x5f8f45, 0x3f6f3a, 0x6a9a48, 0x4a8a4a]));
  const flower = rng.chance(0.25) ? C(rng.pick([0xe85a7a, 0xf0d040, 0xe88030, 0xffffff])) : null;
  dome(gb, x, y, z, r, 7, 2, 'flat', mulc(g, 0.6), flower ? mixc(g, flower, 0.7) : mulc(g, 1.15), 0.75);
}
function frontBushes(gb, rng, xa, xb, z, y, n, avoid) {
  for (let i = 0; i < n; i++) {
    const x = lerp(xa, xb, (i + 0.5 + rng.range(-0.25, 0.25)) / n);
    if (avoid && avoid.some(([a, b]) => x > a - 0.9 && x < b + 0.9)) continue;
    bush(gb, rng, x, y, z, rng.range(0.45, 0.8));
  }
}
function chimney(gb, x, y0, z, yTop, s = 0.7, face = 'brick') {
  gb.box(x - s / 2, y0, z - s / 2, x + s / 2, yTop, z + s / 2, { side: face, c: face === 'brick' ? [0.85, 0.8, 0.78] : [0.85, 0.83, 0.8], tw: 1.6, th: 1.6, top: 'concrete', ct: [0.6, 0.6, 0.6] });
  gb.box(x - s / 2 - 0.08, yTop, z - s / 2 - 0.08, x + s / 2 + 0.08, yTop + 0.14, z + s / 2 + 0.08, { side: 'concrete', c: [0.75, 0.74, 0.72], tw: 99, th: 99 });
  gb.flat(x - s / 4, z - s / 4, x + s / 4, z + s / 4, yTop + 0.15, 'flat', [0.05, 0.05, 0.05]);
}
/** porch: slab + posts + shed roof, centered cx in front of wall at z, face 0 only (front) */
function porch(gb, rng, cx, zWall, w, dep, wallTop, col, roofCol, style) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = zWall, z1 = zWall + dep;
  const trim = C(0xf4f0e8);
  gb.box(x0, -0.2, z0, x1, 0.22, z1, { side: 'concrete', top: 'concrete', c: [0.78, 0.77, 0.74], ct: [0.85, 0.84, 0.8], tw: 4, th: 4, no: 'b' });
  const ph = Math.min(2.55, wallTop - 0.35);
  for (const sx of [x0 + 0.12, x1 - 0.12]) gb.box(sx - 0.08, 0.22, z1 - 0.2, sx + 0.08, ph, z1 - 0.04, { side: 'flat', c: trim, tw: 99, th: 99 });
  if (style === 0) roofShed(gb, x0 - 0.15, z0, x1 + 0.15, z1 + 0.25, ph + 0.05, ph + 0.05 + (wallTop - ph - 0.15), 0, 'rtile', roofCol, {});
  else { gb.box(x0 - 0.2, ph, z0, x1 + 0.2, ph + 0.2, z1 + 0.25, { side: 'flat', c: trim, top: 'gravel', ct: [0.55, 0.55, 0.52], tw: 99, th: 99 }); }
  // steps
  gb.box(cx - 0.8, -0.2, z1, cx + 0.8, 0.11, z1 + 0.35, { side: 'concrete', top: 'concrete', c: [0.7, 0.69, 0.66], ct: [0.8, 0.79, 0.76], tw: 4, th: 4, no: 'b' });
}
function pole(gb, x, y0, z, y1, r = 0.12, col = [0.4, 0.4, 0.42]) {
  gb.box(x - r, y0, z - r, x + r, y1, z + r, { side: 'flat', c: col, tw: 99, th: 99 });
}
function glowBar(gb, x0, y0, z0, x1, y1, z1, tile = 'gw_w') {
  gb.box(x0, y0, z0, x1, y1, z1, { side: tile, c: WHITE, tw: 99, th: 99 });
}

/* ====================================================================================
 *  BUILDERS -- residential
 *  Each builder(B) gets B = {gb, rng, w, d, h, fh, spec, color(hex)} and returns {roofY}
 * ==================================================================================== */
const R_FAM = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'];
function pickRoof(rng) {
  if (rng.chance(0.5)) return { tile: 'rtile', col: C(rng.pick(ROOF_TILE)) };
  return { tile: 'shingle', col: C(rng.pick(ROOF_SHINGLE)) };
}
function sideSpec(rng, fam, lit, bay, plainP, plain = 'stucco') {
  return { fam, lit, bay, pick: (f, i, n) => (rng.chance(plainP) ? plain : null) };
}
/** front yard: concrete ranges (driveways / walks) + lawn gaps + fence */
function yard(B, xL, xR, zA, zB, conc, fenceKind) {
  const { gb, rng } = B;
  conc = conc.filter(Boolean).sort((a, b) => a[0] - b[0]);
  let x = xL; const gaps = [];
  for (const [a, b] of conc) { if (a - x > 0.35) gaps.push([x, a]); x = Math.max(x, b); }
  if (xR - x > 0.35) gaps.push([x, xR]);
  for (const [a, b] of conc) lotPad(gb, a, zA, b, zB, 0.07, { tile: 'concrete', col: [0.92, 0.9, 0.86], tw: 4, th: 4 });
  for (const [a, b] of gaps) lawnPad(gb, a, zA, b, zB, 0.1);
  if (fenceKind) {
    const fz = zB - 0.12;
    for (const [a, b] of gaps) {
      if (fenceKind === 'picket') fence(gb, a, fz, b, fz, 0.95, 'picket', [0.97, 0.96, 0.92], 0.1);
      else if (fenceKind === 'chain') fence(gb, a, fz, b, fz, 1.3, 'chain', [0.85, 0.87, 0.9], 0.1);
      else if (fenceKind === 'block') blockWall(gb, a, fz, b, fz, 1.0, C(0xdcd6c8), 0.1);
    }
  }
}
function cellsToRanges(cells, x0, x1) {
  let tot = 0; for (const c of cells) tot += c.w || 1; const s = (x1 - x0) / tot; let x = x0; const out = [];
  for (const c of cells) { const w = (c.w || 1) * s; out.push([x, x + w]); x += w; }
  return out;
}

function houseSmall(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(B.color);
  const bw = Math.min(W - 1.6, 10.2), yd = clamp(D * 0.2, 2.2, 3.4);
  const x0 = -bw / 2, x1 = bw / 2, z1 = D / 2 - yd, z0 = Math.max(-D / 2 + 0.65, z1 - Math.min(D - yd - 0.65, 9.4));
  const fh = 2.9;
  const kinds = ['hip', 'hip', 'gable', 'gableS', 'flat', 'flat'];
  const rk = B.spec.style || rng.pick(kinds);
  const rise = clamp(B.h - fh, 0.8, 2.3);
  const hasG = bw >= 8.0 && rng.chance(0.32);
  const doorT = rng.pick(['rd0', 'rd1', 'rd2']);
  const mkWin = () => ({ t: litP(rng, rng.pick(R_FAM), 0.35), w: 3, flip: rng.chance(0.5) });
  let cells;
  if (hasG) { cells = [{ t: 'g1', w: 2.7 }, { t: doorT, w: 3.0 }, mkWin()]; if (rng.chance(0.5)) cells.reverse(); }
  else { cells = [mkWin(), mkWin()]; cells.splice(rng.int(0, 2), 0, { t: doorT, w: 3.0 }); }
  const ranges = cellsToRanges(cells, x0, x1);
  strip(gb, x0, z1, x1, z1, 0, fh, cells, mulc(col, 0.8), mulc(col, 0.97));
  const di = cells.findIndex((c) => c.t === doorT), gi = cells.findIndex((c) => c.t === 'g1');
  const dcx = (ranges[di][0] + ranges[di][1]) / 2;
  const sp = sideSpec(rng, R_FAM, 0.35, 3.3, 0.25);
  massing(gb, x0, z0, x1, z1, 0, 1, fh, { f: 'skip', r: sp, b: sideSpec(rng, R_FAM, 0.3, 3.2, 0.3), l: sideSpec(rng, R_FAM, 0.35, 3.3, 0.25) }, col);
  // roof
  const rf = pickRoof(rng); let roofY;
  if (rk === 'flat') roofY = roofFlat(gb, x0, z0, x1, z1, fh, { ph: 0.5, col, wall: 'stucco' });
  else {
    roofPitched(gb, x0, z0, x1, z1, fh, rise, 0.5, rf.tile, rf.col, { gable: rk.startsWith('gable'), ridge: rk === 'gable' ? 'z' : rk === 'gableS' ? 'x' : undefined, gableTile: 'stucco', gableCol: col });
    roofY = fh + rise;
  }
  if (rng.chance(0.45)) {
    const cx = rng.chance(0.5) ? x0 + bw * 0.28 : x1 - bw * 0.28, cz = (z0 + z1) / 2 - 0.5;
    chimney(gb, cx, rk === 'flat' ? fh : fh - 0.4, cz, (rk === 'flat' ? fh + 0.5 : fh + rise * 0.72) + 0.95);
  }
  // porch
  if (rng.chance(0.65)) {
    const dw = clamp(ranges[di][1] - ranges[di][0], 2.2, 3.2);
    porch(gb, rng, dcx, z1, dw, Math.min(1.7, yd - 0.45), fh, col, rf.col, rng.chance(0.5) ? 0 : 1);
  }
  ledgeRing(gb, x0, z0, x1, z1, 0, 0.3, 0.05, 'concrete', [0.74, 0.73, 0.7]);
  skirt(gb, x0, z0, x1, z1);
  // yard
  const conc = [[dcx - 0.55, dcx + 0.55]];
  if (gi >= 0) conc.push([ranges[gi][0] + 0.1, ranges[gi][1] - 0.1]);
  yard(B, -W / 2 + 0.15, W / 2 - 0.15, z1 + (rng.chance(0.65) ? 1.7 : 0.05), D / 2 - 0.15, conc, rng.pick(['picket', 'picket', 'chain', 'block', null, null]));
  if (rng.chance(0.5)) acUnit(gb, rng.chance(0.5) ? x1 + 0.5 : x0 - 0.5, 0.05, z0 + rng.range(1.5, 4), 0.8);
  frontBushes(gb, rng, x0 + 0.5, x1 - 0.5, z1 + 0.55, 0.1, rng.int(2, 4), [[dcx - 1.4, dcx + 1.4]].concat(gi >= 0 ? [ranges[gi]] : []));
  return { roofY };
}

function houseRanch(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(B.color);
  const bw = Math.min(W - 1.6, 16), yd = clamp(D * 0.17, 2.2, 3.2);
  const x0 = -bw / 2, x1 = bw / 2, zF = D / 2 - yd;
  const gd = clamp((zF + D / 2) * 0.36, 3.6, 5.4);      // garage wing depth
  const zM = zF - gd;                                     // main block front wall z
  const zB = Math.max(-D / 2 + 0.65, zM - 7.4);
  const fh = 2.8, rise = clamp(B.h - fh, 1.0, 2.0);
  const rf = pickRoof(rng); const left = rng.chance(0.5);
  const gw = Math.min(6.0, bw * 0.4);
  const gx0 = left ? x0 : x1 - gw, gx1 = left ? x0 + gw : x1;
  const mx0 = left ? gx1 : x0, mx1 = left ? x1 : gx0;
  const doorT = rng.pick(['rd0', 'rd1', 'rd2']);
  const nW = Math.max(1, Math.round((mx1 - mx0) / 3.3) - 1);
  const cells = []; for (let i = 0; i < nW; i++) cells.push({ t: litP(rng, rng.pick(['r1', 'r5', 'r1', 'r0']), 0.35), w: 3.3, flip: rng.chance(0.5) });
  const di = rng.int(0, cells.length); cells.splice(di, 0, { t: doorT, w: 3.0 });
  strip(gb, mx0, zM, mx1, zM, 0, fh, cells, mulc(col, 0.8), mulc(col, 0.97));
  const rgs = cellsToRanges(cells, mx0, mx1); const dcx = (rgs[di][0] + rgs[di][1]) / 2;
  if (rng.chance(0.6)) { const sw = 1.5, sx = dcx + (dcx - mx0 > mx1 - dcx ? -1 : 1) * 2.1; gb.box(sx - sw / 2, 0, zM, sx + sw / 2, 2.3, zM + 0.14, { side: 'stone', c: [0.9, 0.86, 0.8], top: 'stone', tw: 1.5, th: 1.5 }); }
  // garage wing front
  gb.q([gx0, 0, zF], [gx1, 0, zF], [gx1, fh, zF], [gx0, fh, zF], 'g2', [0.78, 0.78, 0.78], [0.97, 0.97, 0.97], { dir: [0, 0, 1] });
  const sp = () => Object.assign({ col }, sideSpec(rng, ['r0', 'r1', 'r5', 'r2'], 0.3, 3.6, 0.3));
  // wing inner wall (faces the main block front) and outer wall, main outer end wall, back wall
  if (left) {
    gb.wall(gx1, zF, gx1, zM, 0, fh, 'stucco', mulc(col, 0.85), col, {});
    facade(gb, [x0, zB], [x0, zF], 0, 1, fh, sp());
    facade(gb, [x1, zM], [x1, zB], 0, 1, fh, sp());
  } else {
    gb.wall(gx0, zM, gx0, zF, 0, fh, 'stucco', mulc(col, 0.85), col, {});
    facade(gb, [x1, zF], [x1, zB], 0, 1, fh, sp());
    facade(gb, [x0, zB], [x0, zM], 0, 1, fh, sp());
  }
  facade(gb, [x1, zB], [x0, zB], 0, 1, fh, sp());
  const ov = 0.55;
  roofPitched(gb, x0, zB, x1, zM, fh, rise, ov, rf.tile, rf.col, { gable: true, ridge: 'x', gableTile: 'stucco', gableCol: col });
  roofPitched(gb, gx0, zM - 3.3, gx1, zF, fh, rise * 0.8, ov, rf.tile, rf.col, { gable: true, ridge: 'z', gableTile: 'stucco', gableCol: col });
  if (rng.chance(0.6)) chimney(gb, (mx0 + mx1) / 2 + rng.range(-1, 1), fh - 0.4, (zB + zM) / 2 - 1, fh + rise * 0.8 + 1.0);
  ledgeRing(gb, x0, zB, x1, zM, 0, 0.3, 0.05, 'concrete', [0.74, 0.73, 0.7], { noBottom: true });
  skirt(gb, x0, zB, x1, zM); skirt(gb, gx0, zM, gx1, zF);
  const conc = [[dcx - 0.55, dcx + 0.55], [gx0 + 0.3, gx1 - 0.3]];
  yard(B, -W / 2 + 0.15, W / 2 - 0.15, zM + 0.05, D / 2 - 0.15, conc, rng.pick(['picket', 'block', null, 'chain']));
  frontBushes(gb, rng, mx0 + 0.4, mx1 - 0.4, zM + 0.55, 0.1, rng.int(3, 5), [[dcx - 1.4, dcx + 1.4]]);
  return { roofY: fh + rise };
}

function houseTwoStory(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(B.color);
  const bw = Math.min(W - 1.6, 11.6), yd = clamp(D * 0.17, 2.4, 3.4);
  const x0 = -bw / 2, x1 = bw / 2, z1 = D / 2 - yd, z0 = Math.max(-D / 2 + 0.65, z1 - Math.min(D - yd - 0.65, 10));
  const fh = 2.85, rise = clamp(B.h - 2 * fh, 0.9, 2.6);
  const hasG = bw >= 9 && rng.chance(0.5);
  const doorT = rng.pick(['rd0', 'rd1', 'rd2']);
  const mkWin = (fam) => ({ t: litP(rng, rng.pick(fam), 0.4), w: 3, flip: rng.chance(0.5) });
  let g = hasG ? [{ t: 'g1', w: 2.7 }, { t: doorT, w: 3.0 }, mkWin(R_FAM)] : [mkWin(R_FAM), { t: doorT, w: 3.0 }, mkWin(R_FAM)];
  if (rng.chance(0.5)) g.reverse();
  const ranges = cellsToRanges(g, x0, x1);
  strip(gb, x0, z1, x1, z1, 0, fh, g, mulc(col, 0.8), mulc(col, 0.97));
  const up = g.map((c) => (c.t === 'g1' ? { t: litP(rng, rng.pick(['r1', 'r5']), 0.4), w: 2.7, flip: rng.chance(0.5) } : c.t === doorT ? { t: litP(rng, 'ap0', 0.4), w: 3 } : mkWin(['r0', 'r1', 'r3', 'r2'])));
  strip(gb, x0, z1, x1, z1, fh, 2 * fh, up, mulc(col, 0.96), col);
  massing(gb, x0, z0, x1, z1, 0, 2, fh, { f: 'skip', r: sideSpec(rng, R_FAM, 0.35, 3.3, 0.22), b: sideSpec(rng, R_FAM, 0.3, 3.2, 0.25), l: sideSpec(rng, R_FAM, 0.35, 3.3, 0.22) }, col);
  ledgeRing(gb, x0, z0, x1, z1, fh - 0.12, fh + 0.12, 0.08, 'concrete', [0.9, 0.88, 0.84]);
  const di = g.findIndex((c) => c.t === doorT), gi = g.findIndex((c) => c.t === 'g1');
  const dcx = (ranges[di][0] + ranges[di][1]) / 2;
  const rf = pickRoof(rng); const flat = B.spec.style === 'flat' || rng.chance(0.25);
  let roofY;
  if (flat) roofY = roofFlat(gb, x0, z0, x1, z1, 2 * fh, { ph: 0.5, col, wall: 'stucco' });
  else { roofPitched(gb, x0, z0, x1, z1, 2 * fh, rise, 0.6, rf.tile, rf.col, { gable: rng.chance(0.5), ridge: rng.chance(0.5) ? 'z' : 'x', gableTile: 'stucco', gableCol: col }); roofY = 2 * fh + rise; }
  // porch with balcony above
  const pw = clamp(ranges[di][1] - ranges[di][0], 2.4, 3.4), dep = Math.min(1.7, yd - 0.45);
  gb.box(dcx - pw / 2, -0.2, z1, dcx + pw / 2, 0.22, z1 + dep, { side: 'concrete', top: 'concrete', c: [0.78, 0.77, 0.74], ct: [0.85, 0.84, 0.8], tw: 4, th: 4, no: 'b' });
  for (const sx of [dcx - pw / 2 + 0.12, dcx + pw / 2 - 0.12]) gb.box(sx - 0.08, 0.22, z1 + dep - 0.2, sx + 0.08, fh, z1 + dep - 0.04, { side: 'flat', c: C(0xf4f0e8), tw: 99, th: 99 });
  balcony(gb, dcx, fh, z1, 0, pw, dep, [0.85, 0.84, 0.8]);
  if (rng.chance(0.45)) chimney(gb, rng.chance(0.5) ? x0 + 1.2 : x1 - 1.2, fh, (z0 + z1) / 2, 2 * fh + (flat ? 1.6 : rise * 0.8 + 1.1));
  ledgeRing(gb, x0, z0, x1, z1, 0, 0.3, 0.05, 'concrete', [0.74, 0.73, 0.7]);
  skirt(gb, x0, z0, x1, z1);
  const conc = [[dcx - 0.55, dcx + 0.55]]; if (gi >= 0) conc.push([ranges[gi][0] + 0.1, ranges[gi][1] - 0.1]);
  yard(B, -W / 2 + 0.15, W / 2 - 0.15, z1 + dep, D / 2 - 0.15, conc, rng.pick(['picket', 'block', null, 'picket']));
  frontBushes(gb, rng, x0 + 0.5, x1 - 0.5, z1 + 0.55, 0.1, rng.int(2, 4), [[dcx - 1.6, dcx + 1.6]].concat(gi >= 0 ? [ranges[gi]] : []));
  return { roofY };
}

function duplex(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const colA = wallCol(B.color), colB = rng.chance(0.6) ? wallCol(houseColor(rng)) : colA;
  const bw = Math.min(W - 1.6, 14), yd = clamp(D * 0.17, 2.2, 3.2);
  const x0 = -bw / 2, x1 = bw / 2, xm = 0, z1 = D / 2 - yd, z0 = Math.max(-D / 2 + 0.65, z1 - Math.min(D - yd - 0.65, 11));
  const floors = B.h > 6.4 ? 2 : 1, fh = 2.85, rise = clamp(B.h - floors * fh, 0.9, 2.2);
  const rf = pickRoof(rng);
  const doorA = rng.pick(['rd0', 'rd1', 'rd2']), doorB = rng.pick(['rd0', 'rd1', 'rd2']);
  const half = (door, side) => { const c = [{ t: litP(rng, rng.pick(R_FAM), 0.4), w: 3, flip: rng.chance(0.5) }, { t: door, w: 3 }]; if (side) c.reverse(); return c; };
  const hw = bw / 2; const conc = [];
  for (const [xa, xb, col, door, side] of [[x0, xm, colA, doorA, 0], [xm, x1, colB, doorB, 1]]) {
    const cells = half(door, side);
    strip(gb, xa, z1, xb, z1, 0, fh, cells, mulc(col, 0.8), mulc(col, 0.97));
    if (floors === 2) strip(gb, xa, z1, xb, z1, fh, 2 * fh, cells.map((c) => (c.t === door ? { t: litP(rng, 'ap0', 0.4), w: 3 } : { t: litP(rng, rng.pick(['r1', 'r0', 'r5']), 0.4), w: 3, flip: rng.chance(0.5) })), mulc(col, 0.96), col);
    const rg = cellsToRanges(cells, xa, xb); const di = cells.findIndex((c) => c.t === door); const dcx = (rg[di][0] + rg[di][1]) / 2;
    porch(gb, rng, dcx, z1, 2.4, Math.min(1.6, yd - 0.45), floors * fh, col, rf.col, 1);
    conc.push([dcx - 0.55, dcx + 0.55]);
    // back & side
    const sideX = side ? x1 : x0;
    const A = side ? [x1, z1] : [x0, z0], Bp = side ? [x1, z0] : [x0, z1];
    facade(gb, A, Bp, 0, floors, fh, Object.assign({ col }, sideSpec(rng, R_FAM, 0.35, 3.3, 0.22)));
    facade(gb, side ? [xb, z0] : [xb, z0], side ? [xa, z0] : [xa, z0], 0, floors, fh, Object.assign({ col }, sideSpec(rng, R_FAM, 0.3, 3.2, 0.25)));
  }
  ledgeRing(gb, x0, z0, x1, z1, 0, 0.3, 0.05, 'concrete', [0.74, 0.73, 0.7]);
  let roofY;
  if (B.spec.style === 'flat' || rng.chance(0.3)) roofY = roofFlat(gb, x0, z0, x1, z1, floors * fh, { ph: 0.5, col: colA, wall: 'stucco' });
  else { roofPitched(gb, x0, z0, x1, z1, floors * fh, rise, 0.55, rf.tile, rf.col, { gable: true, ridge: 'x', gableTile: 'stucco', gableCol: colA }); roofY = floors * fh + rise; }
  // gable ends of duplex on x sides are visible; the 'ridge x' has gable triangles at x0/x1
  chimney(gb, xm, floors * fh - 0.4, (z0 + z1) / 2, floors * fh + rise * 0.8 + 1, 0.8);
  skirt(gb, x0, z0, x1, z1);
  yard(B, -W / 2 + 0.15, W / 2 - 0.15, z1 + 1.65, D / 2 - 0.15, conc, rng.pick(['picket', 'chain', null]));
  frontBushes(gb, rng, x0 + 0.5, x1 - 0.5, z1 + 0.55, 0.1, 4, conc.map(([a, b]) => [a - 0.6, b + 0.6]));
  return { roofY };
}

function apartmentLow(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(rng.chance(0.75) ? rng.pick([...PAL_PASTEL, ...PAL_BLEACH]) : rng.pick(PAL_EARTH));
  const floors = clamp(Math.round(B.h / 3.0), 2, 4), fh = 3.0;
  const court = B.spec.style ? B.spec.style === 'court' : (W >= 16 && D >= 16 && rng.chance(0.55));
  const fam = ['ap0', 'r1', 'r4', 'r0'];
  const top = floors * fh;
  let roofY;
  if (court) {
    const x0 = -W / 2 + 0.3, x1 = W / 2 - 0.3, z0 = -D / 2 + 0.3, z1 = D / 2 - 0.3;
    const ww = clamp(W * 0.28, 5, 7), bd = clamp(D * 0.3, 6, 8.5);
    const xiL = x0 + ww, xiR = x1 - ww, zbf = z0 + bd;
    const spec = () => Object.assign({ col }, sideSpec(rng, fam, 0.4, 3.2, 0.2));
    // outer walls
    facade(gb, [x0, z1], [xiL, z1], 0, floors, fh, Object.assign(spec(), { ground: { fam: ['ap0', 'r1', 'rd1'] } }));
    facade(gb, [xiR, z1], [x1, z1], 0, floors, fh, Object.assign(spec(), { ground: { fam: ['ap0', 'r1', 'rd1'] } }));
    facade(gb, [x1, z1], [x1, z0], 0, floors, fh, spec());
    facade(gb, [x1, z0], [x0, z0], 0, floors, fh, spec());
    facade(gb, [x0, z0], [x0, z1], 0, floors, fh, spec());
    // wing end faces (toward the court) are the inner facades with galleries
    const inner = (A, Bp) => {
      facade(gb, A, Bp, 0, floors, fh, { col, fam, lit: 0.4, bay: 3.4, pick: (f, i, n) => ((i & 1) ? rng.pick(['rd0', 'rd1', 'rd2']) : null) });
    };
    inner([xiL, z1], [xiL, zbf]);     // faces +x ... direction z1->zbf has dz<0 => n=+x  (faces the court)
    inner([xiR, zbf], [xiR, z1]);     // dz>0 => n=-x
    inner([xiL, zbf], [xiR, zbf]);    // faces +z
    // galleries (walkways)
    const gd = 1.35;
    for (let f = 1; f < floors; f++) {
      const y = f * fh;
      const slab = (xa, za, xb, zb, nxv, nzv) => { /* thin slab */ };
      gb.box(xiL, y - 0.18, zbf, xiR, y, zbf + gd, { side: 'concrete', top: 'concrete', c: [0.78, 0.77, 0.74], tw: 99, th: 99, no: 'b' });
      gb.box(xiL, y - 0.18, zbf + gd, xiL + gd, y, z1, { side: 'concrete', top: 'concrete', c: [0.78, 0.77, 0.74], tw: 99, th: 99, no: 'l' });
      gb.box(xiR - gd, y - 0.18, zbf + gd, xiR, y, z1, { side: 'concrete', top: 'concrete', c: [0.78, 0.77, 0.74], tw: 99, th: 99, no: 'r' });
      railing(gb, xiL + 0.05, zbf + gd, xiR - 0.05, zbf + gd, y, 0.95, WHITE);
      railing(gb, xiL + gd, zbf + gd, xiL + gd, z1, y, 0.95, WHITE);
      railing(gb, xiR - gd, zbf + gd, xiR - gd, z1, y, 0.95, WHITE);
    }
    // courtyard floor
    gb.flat(xiL, zbf, xiR, z1, 0.06, 'concrete', [0.85, 0.83, 0.78], { tw: 5, th: 5 });
    gb.flat(xiL + gd + 0.1, zbf + gd + 0.2, xiR - gd - 0.1, z1 - 1.0, 0.09, 'lawn', [0.85, 0.9, 0.8]);
    // stairs from the court up to each gallery level (straight runs alongside the gallery edge)
    for (let f = 0; f < floors - 1; f++) {
      const sx = f % 2 === 0 ? xiL + gd + 0.9 : xiR - gd - 0.9;
      const run = 4.0;
      stairs(gb, sx, f * fh, zbf + gd + run, 0, -1, 1.1, fh, run, 10, [0.8, 0.79, 0.76]);
      for (const s of [-0.6, 0.6]) { // slanted rails
        const a = [sx + s, f * fh + 0.05, zbf + gd + run], b = [sx + s, f * fh + fh + 0.05, zbf + gd], c = [sx + s, f * fh + fh + 1.0, zbf + gd], d = [sx + s, f * fh + 1.0, zbf + gd + run];
        gb.q(a, b, c, d, 'rail', WHITE, WHITE, { dir: [1, 0, 0], dbl: true });
      }
    }
    const poly = [[x0, z1], [xiL, z1], [xiL, zbf], [xiR, zbf], [xiR, z1], [x1, z1], [x1, z0], [x0, z0]];
    roofY = roofFlat(gb, x0, z0, x1, z1, top, { ph: 0.5, col, wall: 'stucco', poly, decks: [[x0, z0, x1, zbf], [x0, zbf, xiL, z1], [xiR, zbf, x1, z1]] });
    rooftop(gb, rng, x0 + 0.5, z0 + 0.5, x1 - 0.5, zbf - 0.5, top, 3);
    ledgeRing(gb, x0, z0, x1, z1, 0, 0.3, 0.05, 'concrete', [0.72, 0.71, 0.68], { noBottom: true });
    skirt(gb, x0, z0, x1, z1);
    return { roofY };
  }
  // simple block with balconies and external stair tower
  const x0 = -W / 2 + 0.3, x1 = W / 2 - 1.9, z0 = -D / 2 + 0.3, z1 = D / 2 - 1.5;
  const nB = Math.max(1, Math.round((x1 - x0) / 3.4));
  const bg = balconyGrid(rng, floors, nB, 'ap0', ['r1', 'r4', 'r0', 'r5'], 0.9);
  const frontSpec = { col, fam, lit: 0.4, bay: 3.4, ground: { fam: ['ap0', 'r1', 'rd1'], dark: 0.8 }, pick: (f, i) => bg.pick(f, i) };
  facade(gb, [x0, z1], [x1, z1], 0, floors, fh, frontSpec);
  facade(gb, [x1, z1], [x1, z0], 0, floors, fh, Object.assign({ col }, sideSpec(rng, fam, 0.35, 3.3, 0.2)));
  facade(gb, [x1, z0], [x0, z0], 0, floors, fh, Object.assign({ col }, sideSpec(rng, fam, 0.35, 3.3, 0.2)));
  facade(gb, [x0, z0], [x0, z1], 0, floors, fh, Object.assign({ col }, sideSpec(rng, fam, 0.35, 3.3, 0.2)));
  const n = Math.max(1, Math.round((x1 - x0) / 3.4)), bayW = (x1 - x0) / n;
  for (let f = 1; f < floors; f++) for (let i = 0; i < n; i++) if (bg.has(f, i)) balcony(gb, x0 + (i + 0.5) * bayW, f * fh, z1, 0, bayW - 0.5, 1.35, [0.78, 0.77, 0.74]);
  ledgeRing(gb, x0, z0, x1, z1, top - 0.2, top, 0.12, 'concrete', [0.9, 0.88, 0.84]);
  ledgeRing(gb, x0, z0, x1, z1, 0, 0.35, 0.05, 'concrete', [0.72, 0.71, 0.68]);
  roofY = roofFlat(gb, x0, z0, x1, z1, top, { ph: 0.55, col, wall: 'stucco' });
  rooftop(gb, rng, x0 + 0.6, z0 + 0.6, x1 - 0.6, z1 - 0.6, top, 3);
  // external stair on the east side (zig-zag)
  const sx = x1 + 0.8;
  for (let f = 0; f < floors - 1; f++) {
    const dirz = f % 2 === 0 ? -1 : 1; const zs = dirz < 0 ? z1 - 0.8 : z0 + 0.8 + 4.5;
    stairs(gb, sx, f * fh, zs, 0, dirz, 1.2, fh, 4.5, 12, [0.78, 0.77, 0.74]);
  }
  for (let f = 1; f < floors; f++) gb.box(x1, f * fh - 0.18, z0 + 0.3, x1 + 1.6, f * fh, z1 - 0.3, { side: 'concrete', top: 'concrete', c: [0.78, 0.77, 0.74], tw: 99, th: 99, no: 'l' });
  skirt(gb, x0, z0, x1 + 1.4, z1);
  lawnPad(gb, -W / 2 + 0.2, z1 + 1.6, W / 2 - 0.2, D / 2 - 0.2, 0.08);
  return { roofY };
}

/* ====================================================================================
 *  BUILDERS -- commercial / industrial
 * ==================================================================================== */
const SIGN_POOL = ['PIZZA', 'NAILS', 'CAFE', 'TACOS', 'DONUTS', 'MARKET', 'CLINIC', 'PAWN', 'BAR', 'TIRES', 'H24', 'LIQUOR'];
const AWN_COLS = [0xd23a2a, 0x2a7ab8, 0x2e8a4a, 0xe8b020, 0xf0f0ea, 0x8a3aa8, 0xe86a20];
/** painted mural on a side wall; side: +1 = east (+x) wall, -1 = west wall; wall spans z from zA (front) to zB (back) */
function mural(gb, rng, x, zA, zB, hMax, side) {
  const len = Math.abs(zA - zB) - 1.2; if (len < 4) return;
  const w = Math.min(len, 10), h = Math.min(hMax, w * 0.5), zc = (zA + zB) / 2, off = 0.04 * side;
  const a = zc + w / 2, b = zc - w / 2; const t = rng.chance(0.5) ? 'mural0' : 'mural1';
  if (side > 0) gb.wall(x + off, a, x + off, b, 0.35, 0.35 + h, t, WHITE, WHITE, { tw: 99, th: 99 });
  else gb.wall(x + off, b, x + off, a, 0.35, 0.35 + h, t, WHITE, WHITE, { tw: 99, th: 99 });
}
function blankWalls(gb, x0, z0, x1, z1, y0, y1, tile, col, sides = 'rbl', o = {}) {
  const cb = mulc(col, 0.82);
  if (sides.includes('f')) gb.wall(x0, z1, x1, z1, y0, y1, tile, cb, col, o);
  if (sides.includes('r')) gb.wall(x1, z1, x1, z0, y0, y1, tile, cb, col, o);
  if (sides.includes('b')) gb.wall(x1, z0, x0, z0, y0, y1, tile, cb, col, o);
  if (sides.includes('l')) gb.wall(x0, z0, x0, z1, y0, y1, tile, cb, col, o);
}
function sideMat(rng, col) {
  const r = rng.f();
  if (r < 0.5) return { tile: 'stucco', col };
  if (r < 0.78) return { tile: 'brick', col: mulc([1, 0.94, 0.9], rng.range(0.85, 1.0)) };
  return { tile: 'concrete', col: mulc(C(rng.pick(PAL_NEUTRAL)), 1.0) };
}
/** unit front cells (tile names) for n bays */
function unitCells(rng, nb, kind) {
  const win = kind === 'closed' ? 'shop3' : kind;
  const cells = [];
  for (let i = 0; i < nb; i++) cells.push({ t: win, w: 1, flip: rng.chance(0.5) });
  if (kind !== 'closed') { const di = nb === 1 ? 0 : nb === 2 ? rng.int(0, 1) : rng.int(1, nb - 2); cells[di] = { t: 'shop1', w: 1, flip: rng.chance(0.5) }; }
  return cells;
}

function liquorStore(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(rng.pick([0xf4d85a, 0x7fd0c8, 0xf0a8b8, 0xe8e0cc, 0xf08c78, 0xc9deec, 0xa8d880]));
  const bw = Math.min(W - 1.0, 13), lotD = clamp(D * 0.32, 4.5, 7.5);
  const x0 = -bw / 2, x1 = bw / 2, z1 = D / 2 - lotD, z0 = -D / 2 + 0.4;
  const fh = 3.6;
  const nb = Math.max(2, Math.round(bw / 3.2));
  const cells = [];
  for (let i = 0; i < nb; i++) cells.push({ t: 'shop2', w: 1, flip: rng.chance(0.5) });
  cells[Math.floor(nb / 2)] = { t: 'shop1', w: 1 };
  if (nb >= 4 && rng.chance(0.5)) cells[rng.chance(0.5) ? 0 : nb - 1] = { t: 'shop3', w: 1 };
  strip(gb, x0, z1, x1, z1, 0, fh, cells, mulc(col, 0.8), mulc(col, 0.97));
  const sm = sideMat(rng, col);
  blankWalls(gb, x0, z0, x1, z1, 0, fh, sm.tile, sm.col);
  if (rng.chance(0.55)) { const ms = rng.chance(0.5) ? 1 : -1; mural(gb, rng, ms > 0 ? x1 : x0, z1, z0, fh - 0.5, ms); }
  const sw = Math.min(bw * 0.78, 7.2), sh = sw / 4, ph = sh + 0.45;
  const top = roofFlat(gb, x0, z0, x1, z1, fh, { ph, col, wall: 'stucco' });
  signPanel(gb, (x0 + x1) / 2, fh + ph / 2 - 0.05, z1, sw, 'LIQUOR', 0, { off: 0.07 });
  // painted stripe band
  gb.wall(x0, z1 + 0.02, x1, z1 + 0.02, fh + 0.02, fh + 0.22, 'flat', C(rng.pick(AWN_COLS)), C(rng.pick(AWN_COLS)), { tw: 99, th: 99 });
  awning(gb, (x0 + x1) / 2, 3.0, z1, bw - 1.6, 1.25, 0.55, C(rng.pick(AWN_COLS)));
  ledgeRing(gb, x0, z0, x1, z1, 0, 0.3, 0.04, 'concrete', [0.72, 0.71, 0.68], { noBottom: true });
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.2, z1 + 0.1, W / 2 - 0.2, D / 2 - 0.15, 0.06);
  if (rng.chance(0.6)) { // pole sign
    const px = rng.chance(0.5) ? W / 2 - 1.8 : -W / 2 + 1.8, pz = D / 2 - 0.9;
    pole(gb, px, 0, pz, 6.2, 0.09, [0.3, 0.3, 0.32]);
    signPanel(gb, px, 6.6, pz, 2.8, rng.pick(['sg_LIQUOR', 'sg_H24', 'sg_BAR']), rng.chance(0.5) ? 0 : 0, { dbl: true, off: 0.0 });
  }
  rooftop(gb, rng, x0 + 0.6, z0 + 0.6, x1 - 0.6, z1 - 0.9, fh, 2, { noTank: true });
  return { roofY: top };
}

function shopStrip(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(rng.pick([...PAL_BLEACH, ...PAL_PASTEL.slice(0, 6), 0xe0a060]));
  const bw = Math.min(W - 0.8, 34), lotD = clamp(D * 0.42, 6, 9);
  const x0 = -bw / 2, x1 = bw / 2, z1 = D / 2 - lotD, z0 = -D / 2 + 0.4;
  const fh = 3.6;
  const nUnits = clamp(Math.round(bw / 6.6), 2, 5); const uw = bw / nUnits;
  const kinds = ['shop0', 'shop4', 'shop2', 'shop0', 'closed', 'shop5'];
  const signW = Math.min(uw * 0.86, 5.4), sh = signW / 4, ph = sh + 0.5;
  const signs = []; const pool = SIGN_POOL.slice();
  let cells = [];
  for (let u = 0; u < nUnits; u++) {
    const nb = Math.max(2, Math.round(uw / 3.2)); const kind = rng.pick(kinds);
    const uc = unitCells(rng, nb, kind === 'shop5' ? 'shop5' : kind);
    for (const c of uc) c.w = uw / nb; if (kind === 'shop5') { uc[Math.floor(nb / 2)] = { t: 'shop1', w: uw / nb }; }
    cells = cells.concat(uc);
    const si = rng.int(0, pool.length - 1); signs.push(pool.splice(si, 1)[0]);
  }
  strip(gb, x0, z1, x1, z1, 0, fh, cells, mulc(col, 0.8), mulc(col, 0.97));
  const sm = sideMat(rng, col); blankWalls(gb, x0, z0, x1, z1, 0, fh, sm.tile, sm.col);
  if (rng.chance(0.5)) { const ms = rng.chance(0.5) ? 1 : -1; mural(gb, rng, ms > 0 ? x1 : x0, z1, z0, fh - 0.4, ms); }
  const top = roofFlat(gb, x0, z0, x1, z1, fh, { ph, col, wall: 'stucco' });
  for (let u = 0; u < nUnits; u++) {
    const cx = x0 + (u + 0.5) * uw;
    signPanel(gb, cx, fh + ph / 2 - 0.02, z1, signW, signs[u], 0, { off: 0.07 });
    if (rng.chance(0.7)) awning(gb, cx, 3.05, z1, uw - 0.6, 1.2, 0.5, C(rng.pick(AWN_COLS)));
    if (u > 0) gb.box(x0 + u * uw - 0.15, 0, z1, x0 + u * uw + 0.15, fh, z1 + 0.16, { side: 'concrete', c: [0.8, 0.78, 0.74], tw: 99, th: 99, no: 'b' });
  }
  ledgeRing(gb, x0, z0, x1, z1, 0, 0.3, 0.04, 'concrete', [0.72, 0.71, 0.68], { noBottom: true });
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.2, z1 + 0.1, W / 2 - 0.2, D / 2 - 0.15, 0.06);
  rooftop(gb, rng, x0 + 0.6, z0 + 0.6, x1 - 0.6, z1 - 1.0, fh, Math.round(bw / 7) + 1);
  if (rng.chance(0.5)) { // pylon sign
    const px = W / 2 - 2.0, pz = D / 2 - 1.0;
    pole(gb, px, 0, pz, 7.2, 0.12, [0.32, 0.32, 0.35]);
    signPanel(gb, px, 7.9, pz, 3.2, 'sg_' + rng.pick(['H24', 'MARKET', 'PIZZA', 'CAFE']), 0, { dbl: true, off: 0 });
  }
  return { roofY: top };
}

function fastFood(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const variants = [['BURGERS', 0xf4d04a, 0xc8201c, true], ['PIZZA', 0xf0e0c0, 0xc8301c, false], ['TACOS', 0xf4a040, 0x2e8a4a, false], ['DONUTS', 0xf0a0c0, 0x7a3a28, false], ['CAFE', 0xe8d8c0, 0x5a3520, false]];
  const v = B.spec.style ? (variants.find((x) => x[0] === B.spec.style.toUpperCase()) || variants[0]) : rng.pick(variants);
  const col = wallCol(v[1]), col2 = C(v[2]);
  const bw = Math.min(W - 2, 14), bd = Math.min(D * 0.45, 10), lotD = D - bd - 0.6;
  const x0 = -bw / 2, x1 = bw / 2, z1 = D / 2 - lotD, z0 = z1 - bd;
  const fh = 3.6;
  const nb = Math.max(3, Math.round(bw / 3.2));
  const cells = [];
  for (let i = 0; i < nb; i++) cells.push({ t: i % 3 === 1 ? 'shop4' : 'shop0', w: 1, flip: rng.chance(0.5) });
  cells[rng.int(1, nb - 2)] = { t: 'shop1', w: 1 };
  strip(gb, x0, z1, x1, z1, 0, fh, cells, mulc(col, 0.8), mulc(col, 0.97));
  // side glass on the drive-thru side and blank back
  facade(gb, [x1, z1], [x1, z0], 0, 1, fh, { col, fam: ['shop0', 'shop4'], lit: 0, bay: 3.2, pick: (f, i) => (i === 1 ? 'shop1' : null) });
  blankWalls(gb, x0, z0, x1, z1, 0, fh, 'stucco', col, 'bl');
  // coloured parapet band & roof
  const top = roofFlat(gb, x0, z0, x1, z1, fh, { ph: 1.0, col: col2, wall: 'stucco', capCol: C(0xe8e4dc) });
  // slanted canopy stripe at entrance
  awning(gb, (x0 + x1) / 2, fh - 0.2, z1, bw * 0.6, 1.6, 0.35, col2);
  const k = 'sg_' + v[0];
  signPanel(gb, (x0 + x1) / 2, fh + 0.5, z1, Math.min(bw * 0.5, 6), k, 0, { off: 0.07 });
  // roof sign (big pylon)
  const px = W / 2 - 2.1, pz = D / 2 - 1.3;
  pole(gb, px, 0, pz, 8.0, 0.16, [0.85, 0.85, 0.85]);
  if (v[3]) { signPanel(gb, px, 9.2, pz, 2.6, 'ic_burger', 0, { dbl: true, h: 2.6, off: 0 }); }
  signPanel(gb, px, v[3] ? 7.3 : 8.6, pz, 3.6, k, 0, { dbl: true, off: 0 });
  ledgeRing(gb, x0, z0, x1, z1, 0, 0.3, 0.04, 'concrete', [0.72, 0.71, 0.68], { noBottom: true });
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.2, z1 + 0.1, W / 2 - 0.2, D / 2 - 0.15, 0.06);
  lotPad(gb, -W / 2 + 0.2, -D / 2 + 0.2, x0 - 0.01, z1, 0.06, { tile: 'asphalt' });
  lotPad(gb, x1 + 0.01, -D / 2 + 0.2, W / 2 - 0.2, z1, 0.06, { tile: 'asphalt' });
  rooftop(gb, rng, x0 + 0.6, z0 + 0.6, x1 - 0.6, z1 - 0.9, fh, 2, { noTank: true });
  return { roofY: top };
}

function gasStation(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(rng.pick([0xf0ece0, 0xe8e0cc, 0xd8e4ee, 0xf0f0f0]));
  const accent = C(rng.pick([0xd42a2a, 0x2a5ab8, 0x2e8a4a, 0xe8a020]));
  const sw = Math.min(W - 2, 12), sd = Math.min(D * 0.28, 7.5);
  const x0 = -sw / 2, x1 = sw / 2, z0 = -D / 2 + 0.6, z1 = z0 + sd, fh = 3.4;
  const nb = Math.max(2, Math.round(sw / 3.2)); const cells = [];
  for (let i = 0; i < nb; i++) cells.push({ t: i === Math.floor(nb / 2) ? 'shop1' : 'shop0', w: 1, flip: rng.chance(0.5) });
  strip(gb, x0, z1, x1, z1, 0, fh, cells, mulc(col, 0.8), mulc(col, 0.97));
  blankWalls(gb, x0, z0, x1, z1, 0, fh, 'stucco', col);
  const top = roofFlat(gb, x0, z0, x1, z1, fh, { ph: 0.9, col: accent, wall: 'stucco' });
  signPanel(gb, (x0 + x1) / 2, fh + 0.45, z1, Math.min(sw * 0.45, 5), 'sg_GAS', 0, { off: 0.07 });
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.2, -D / 2 + 0.2, W / 2 - 0.2, D / 2 - 0.15, 0.06, { tile: 'asphalt', col: [0.9, 0.9, 0.9] });
  // canopy
  const cw = Math.min(W - 3, 16), cd = Math.min(D * 0.3, 9), cz = D / 2 - cd / 2 - 3.2, cy = 5.0;
  const cx0 = -cw / 2, cx1 = cw / 2, cz0 = cz - cd / 2, cz1 = cz + cd / 2;
  gb.box(cx0, cy, cz0, cx1, cy + 0.55, cz1, { side: 'flat', top: 'gravel', c: accent, ct: [0.7, 0.7, 0.7], tw: 99, th: 99 });
  gb.wall(cx0, cz1 + 0.01, cx1, cz1 + 0.01, cy + 0.06, cy + 0.5, 'flat', [1, 1, 1], [1, 1, 1], { tw: 99, th: 99 });
  gb.wall(cx1 + 0.01, cz1, cx1 + 0.01, cz0, cy + 0.06, cy + 0.5, 'flat', [1, 1, 1], [1, 1, 1], { tw: 99, th: 99 });
  gb.wall(cx0 - 0.01, cz0, cx0 - 0.01, cz1, cy + 0.06, cy + 0.5, 'flat', [1, 1, 1], [1, 1, 1], { tw: 99, th: 99 });
  glowBar(gb, cx0, cy - 0.06, cz1 - 0.05, cx1, cy + 0.0, cz1 + 0.06, 'gw_w');
  signPanel(gb, cx0 + cw * 0.5, cy + 0.28, cz1 + 0.03, cw * 0.28, 'sg_GAS', 0, { off: 0.04, h: 0.42 });
  // under-canopy lights
  for (const fx of [0.25, 0.75]) for (const fz of [0.3, 0.7]) gb.q([cx0 + cw * fx - 0.5, cy - 0.01, cz0 + cd * fz + 0.5], [cx0 + cw * fx + 0.5, cy - 0.01, cz0 + cd * fz + 0.5], [cx0 + cw * fx + 0.5, cy - 0.01, cz0 + cd * fz - 0.5], [cx0 + cw * fx - 0.5, cy - 0.01, cz0 + cd * fz - 0.5], 'gw_w', WHITE, WHITE, { down: true });
  for (const px of [cx0 + 1.2, cx1 - 1.2]) for (const pz of [cz0 + 1.0, cz1 - 1.0]) cyl(gb, px, pz, 0, cy, 0.22, 0.22, 8, 'concrete', [0.75, 0.74, 0.72], [0.8, 0.79, 0.77], { th: 99 });
  // pumps
  for (const fx of [0.3, 0.7]) {
    const px = cx0 + cw * fx, pz = cz;
    gb.box(px - 0.55, 0, pz - 2.6, px + 0.55, 0.22, pz + 2.6, { side: 'concrete', top: 'concrete', c: [0.8, 0.8, 0.78], tw: 99, th: 99 });
    for (const sz of [-1, 1]) { const zz = pz + sz * 1.2; gb.box(px - 0.3, 0.22, zz - 0.25, px + 0.3, 1.45, zz + 0.25, { side: 'flat', c: accent, tw: 99, th: 99, top: 'flat', ct: [0.9, 0.9, 0.9] }); gb.box(px - 0.22, 1.0, zz - 0.26, px + 0.22, 1.3, zz + 0.26, { side: 'gw_w', c: WHITE, tw: 99, th: 99, no: 'tb' }); }
  }
  const px = W / 2 - 1.7, pz = D / 2 - 0.9; pole(gb, px, 0, pz, 7.4, 0.14, [0.35, 0.35, 0.38]); signPanel(gb, px, 8.5, pz, 2.4, 'ic_gas', 0, { dbl: true, h: 3.2, off: 0 });
  rooftop(gb, rng, x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, fh, 2, { noTank: true });
  return { roofY: cy + 0.55 };
}

function garageShop(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(rng.pick([0xe8e0cc, 0xd8d4c8, 0x9ab8d0, 0xe0c060, 0xf0f0ea, 0xc8a080]));
  const bw = Math.min(W - 1.0, 16), bd = Math.min(D - 6.5, 11);
  const x0 = -bw / 2, x1 = bw / 2, z0 = -D / 2 + 0.4, z1 = z0 + bd, fh = 4.4;
  const nDoor = bw > 13 ? 3 : 2; const cells = [];
  for (let i = 0; i < nDoor; i++) cells.push({ t: 'rol', w: 4.2, flip: rng.chance(0.5), col: mixc(WHITE, col, 0.6) });
  cells.push({ t: 'shop0', w: 3.2 }); cells.splice(rng.chance(0.5) ? 0 : cells.length, 0, { t: 'mand', w: 3.0 });
  const cw = cells.reduce((s, c) => s + c.w, 0);
  strip(gb, x0, z1, x1, z1, 0, fh, cells, mulc(col, 0.85), mulc(col, 0.97));
  const sm = sideMat(rng, col); blankWalls(gb, x0, z0, x1, z1, 0, fh, sm.tile, sm.col);
  if (rng.chance(0.5)) { const ms = rng.chance(0.5) ? 1 : -1; mural(gb, rng, ms > 0 ? x1 : x0, z1, z0, fh - 0.6, ms); }
  const ph = 1.3; const top = roofFlat(gb, x0, z0, x1, z1, fh, { ph, col, wall: 'stucco' });
  signPanel(gb, 0, fh + ph / 2 - 0.05, z1, Math.min(bw * 0.5, 5.2), 'sg_' + (B.spec.style ? B.spec.style.toUpperCase() : rng.pick(['GARAGE', 'AUTO', 'TIRES'])), 0, { off: 0.07 });
  gb.wall(x0, z1 + 0.03, x1, z1 + 0.03, fh - 0.1, fh + 0.06, 'gw_y', WHITE, WHITE, { tw: 99, th: 99 });
  ledgeRing(gb, x0, z0, x1, z1, 0, 0.3, 0.04, 'concrete', [0.72, 0.71, 0.68], { noBottom: true });
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.2, z1 + 0.1, W / 2 - 0.2, D / 2 - 0.15, 0.06, { tile: 'concrete', col: [0.85, 0.83, 0.8], tw: 4, th: 4 });
  // oil drums + tyre stacks
  for (let i = 0; i < 3; i++) cyl(gb, x1 + 0.0 - 0.5 - i * 0.65, z1 + 1.0, 0.06, 0.95, 0.27, 0.27, 8, 'rmetal', C(rng.pick([0x2a5ab8, 0xd23a2a, 0x2a7a4a])), C(rng.pick([0x2a5ab8, 0xd23a2a, 0x2a7a4a])), { th: 99, cap: 'flat' });
  rooftop(gb, rng, x0 + 0.6, z0 + 0.6, x1 - 0.6, z1 - 0.6, fh, 2, { noTank: true });
  return { roofY: top };
}

function gym(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(rng.pick([0x2a2a30, 0xe8e8ea, 0x3a4a5a, 0xd8d0c0]));
  const bw = Math.min(W - 1.0, 22), bd = Math.min(D - 6, 15), floors = B.h > 8 ? 2 : 1, fh = floors === 2 ? 4.0 : 4.8;
  const x0 = -bw / 2, x1 = bw / 2, z0 = -D / 2 + 0.4, z1 = z0 + bd, top = floors * fh;
  const nb = Math.max(3, Math.round(bw / 3.2));
  facade(gb, [x0, z1], [x1, z1], 0, 1, floors === 2 ? 4.6 : fh, { col, n: nb, fam: ['shop0'], lit: 0, pick: (f, i, n) => (i === Math.floor(n / 2) ? 'shop1' : 'shop0') });
  if (floors === 2) facade(gb, [x0, z1], [x1, z1], 4.6, 1, 3.8, { col: mulc(C(0x9ab8d0), 1), n: Math.max(2, Math.round(bw / 6)), rows: 2, fam: ['cw2'], lit: 0.4 });
  const sm = sideMat(rng, col); blankWalls(gb, x0, z0, x1, z1, 0, floors === 2 ? 8.4 : fh, sm.tile, sm.col);
  const t = floors === 2 ? 8.4 : fh;
  const r = roofFlat(gb, x0, z0, x1, z1, t, { ph: 1.0, col, wall: 'stucco' });
  signPanel(gb, (x0 + x1) / 2, t + 0.5, z1, Math.min(bw * 0.4, 5.5), 'sg_GYM', 0, { off: 0.07 });
  gb.wall(x0 + 0.5, z1 + 0.05, x0 + 0.85, z1 + 0.05, 0.3, t - 0.2, 'gw_g', WHITE, WHITE, { tw: 99, th: 99 });
  gb.wall(x1 - 0.85, z1 + 0.05, x1 - 0.5, z1 + 0.05, 0.3, t - 0.2, 'gw_g', WHITE, WHITE, { tw: 99, th: 99 });
  ledgeRing(gb, x0, z0, x1, z1, 0, 0.3, 0.04, 'concrete', [0.6, 0.6, 0.58], { noBottom: true });
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.2, z1 + 0.1, W / 2 - 0.2, D / 2 - 0.15, 0.06);
  rooftop(gb, rng, x0 + 0.6, z0 + 0.6, x1 - 0.6, z1 - 0.6, t, 3);
  return { roofY: r };
}

function nightclub(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = mulc(C(rng.pick([0x3a2a4a, 0x2a2a3a, 0x4a2a3a, 0x222830])), 1.0);
  const bw = Math.min(W - 1.0, 22), bd = Math.min(D - 5, 16), fh = 6.2;
  const x0 = -bw / 2, x1 = bw / 2, z0 = -D / 2 + 0.4, z1 = z0 + bd;
  const nb = Math.max(3, Math.round(bw / 3.2)); const cells = [];
  for (let i = 0; i < nb; i++) cells.push({ t: 'corrug', w: 1 });
  const dcell = Math.floor(nb / 2);
  // dark ribbed walls; entrance bay with door
  gb.wall(x0, z1, x1, z1, 0, fh, 'corrug', mulc(col, 0.8), col, { tw: 4, th: 6 });
  gb.wall(x1, z1, x1, z0, 0, fh, 'corrug', mulc(col, 0.8), col, { tw: 4, th: 6 }); gb.wall(x1, z0, x0, z0, 0, fh, 'corrug', mulc(col, 0.8), col, { tw: 4, th: 6 }); gb.wall(x0, z0, x0, z1, 0, fh, 'corrug', mulc(col, 0.8), col, { tw: 4, th: 6 });
  const dx = 0; gb.q([dx - 1.9, 0, z1 + 0.05], [dx + 1.9, 0, z1 + 0.05], [dx + 1.9, 3.3, z1 + 0.05], [dx - 1.9, 3.3, z1 + 0.05], 'shop5', [0.7, 0.6, 0.8], [0.9, 0.8, 1], { dir: [0, 0, 1] });
  const top = roofFlat(gb, x0, z0, x1, z1, fh, { ph: 0.8, col: mulc(col, 1.2), wall: 'concrete' });
  const nc = C(rng.pick([0xff3cc8, 0x3cf0ff, 0xa040ff]));
  signPanel(gb, 0, fh - 1.4, z1, Math.min(bw * 0.6, 8), 'sg_CLUB', 0, { off: 0.08 });
  // neon trims
  glowBar(gb, x0 + 0.1, fh - 0.25, z1 + 0.02, x1 - 0.1, fh - 0.12, z1 + 0.1, 'gw_m');
  glowBar(gb, x0 + 0.1, 0.4, z1 + 0.02, x1 - 0.1, 0.5, z1 + 0.1, 'gw_c');
  for (const sx of [x0 + 0.2, x1 - 0.5]) glowBar(gb, sx, 0.4, z1 + 0.02, sx + 0.3, fh - 0.2, z1 + 0.1, 'gw_b');
  awning(gb, dx, 3.6, z1, 4.6, 2.2, 0.5, [0.1, 0.05, 0.12]);
  for (const sx of [-1.8, 1.8]) for (const sz of [2.2, 3.4]) pole(gb, sx, 0, z1 + sz + 0.4, 1.0, 0.05, [0.7, 0.6, 0.2]);
  for (const sx of [-2.0, 2.0]) gb.box(sx - 0.5, 0, z1 + 0.6, sx + 0.5, 0.06, z1 + 4.0, { side: 'flat', top: 'flat', c: [0.6, 0.05, 0.1], ct: [0.6, 0.05, 0.1], tw: 99, th: 99 });
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.2, z1 + 0.1, W / 2 - 0.2, D / 2 - 0.15, 0.06);
  rooftop(gb, rng, x0 + 0.6, z0 + 0.6, x1 - 0.6, z1 - 1.5, fh, 3, { noTank: true });
  return { roofY: top };
}

function motel(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(rng.pick([0xf0d0c0, 0xbfdcd2, 0xf0e0a8, 0xe8c8d8, 0xc9deec, 0xf5efe4]));
  const trim = C(rng.pick([0xd23a7a, 0x2aa8b8, 0xe8a020, 0x6a4ac8]));
  const bw = Math.min(W - 1, 40), wingD = 7.0, gal = 1.5;
  const x0 = -bw / 2, x1 = bw / 2, z0 = -D / 2 + 0.5, z1 = z0 + wingD;
  const fh = 3.1, floors = 2, top = 2 * fh;
  const nb = Math.max(4, Math.round(bw / 3.6));
  const tp = (i, isDoor) => (isDoor ? rng.pick(['rd0', 'rd1']) : litP(rng, rng.pick(['r1', 'r0', 'r5']), 0.4));
  // front of the long wing: alternating door / window, on both floors
  const row = (f) => { const cells = []; for (let i = 0; i < nb; i++) cells.push({ t: tp(i, (i % 2) === 0), w: 1, flip: rng.chance(0.5) }); return cells; };
  strip(gb, x0, z1, x1, z1, 0, fh, row(0), mulc(col, 0.8), mulc(col, 0.97));
  strip(gb, x0, z1, x1, z1, fh, top, row(1), mulc(col, 0.96), col);
  blankWalls(gb, x0, z0, x1, z1, 0, top, 'stucco', col);
  // gallery on the upper floor + stairs + posts
  gb.box(x0, fh - 0.2, z1, x1, fh, z1 + gal, { side: 'concrete', top: 'concrete', c: [0.78, 0.77, 0.74], tw: 99, th: 99, no: 'b' });
  railing(gb, x0 + 0.05, z1 + gal - 0.05, x1 - 0.05, z1 + gal - 0.05, fh, 0.95, WHITE);
  railing(gb, x0 + 0.05, z1, x0 + 0.05, z1 + gal - 0.05, fh, 0.95, WHITE); railing(gb, x1 - 0.05, z1, x1 - 0.05, z1 + gal - 0.05, fh, 0.95, WHITE);
  const np = Math.round(bw / 4);
  for (let i = 0; i <= np; i++) { const px = x0 + 0.2 + (bw - 0.4) * i / np; gb.box(px - 0.08, 0, z1 + gal - 0.2, px + 0.08, top - 0.05, z1 + gal - 0.04, { side: 'flat', c: C(0xf4f0e8), tw: 99, th: 99 }); }
  gb.box(x0 - 0.2, top - 0.05, z0 - 0.2, x1 + 0.2, top + 0.35, z1 + gal + 0.25, { side: 'flat', top: 'gravel', c: trim, ct: [0.6, 0.6, 0.58], tw: 99, th: 99 });
  stairs(gb, x1 - 1.6, 0, z1 + gal + 3.2, 0, -1, 1.2, fh, 3.2, 10, [0.78, 0.77, 0.74]);
  glowBar(gb, x0 - 0.2, top + 0.0, z1 + gal + 0.26, x1 + 0.2, top + 0.22, z1 + gal + 0.32, rng.chance(0.5) ? 'gw_m' : 'gw_c');
  // office block at one end, projecting toward the street
  const ox0 = rng.chance(0.5) ? x0 : x1 - 7.5, ox1 = ox0 + 7.5, oz1 = Math.min(D / 2 - 6.5, z1 + 6.0);
  gb.box(ox0, 0, z1 + gal + 0.3, ox1, 0.1, oz1, { side: 'concrete', top: 'concrete', c: [0.8, 0.8, 0.78], ct: [0.8, 0.8, 0.78], tw: 99, th: 99 }); // pad
  gb.wall(ox0, oz1, ox1, oz1, 0.1, 3.6, 'shop0', mulc(col, 0.85), col, { tw: 3.75, th: 3.6, dir: [0, 0, 1] });
  gb.wall(ox1, oz1, ox1, z1 + gal + 0.3, 0.1, 3.6, 'stucco', mulc(col, 0.85), col, {}); gb.wall(ox0, z1 + gal + 0.3, ox0, oz1, 0.1, 3.6, 'stucco', mulc(col, 0.85), col, {});
  gb.box(ox0 - 0.3, 3.6, z1 + gal + 0.2, ox1 + 0.3, 4.0, oz1 + 0.5, { side: 'flat', top: 'gravel', c: trim, ct: [0.6, 0.6, 0.58], tw: 99, th: 99 });
  signPanel(gb, (ox0 + ox1) / 2, 3.45, oz1 + 0.52, 3.6, 'sg_H24', 0, { off: 0.0, h: 0.0 || undefined });
  // big MOTEL pole sign
  const px = clamp((ox0 + ox1) / 2 + (ox0 > 0 ? -5 : 5), -W / 2 + 2.5, W / 2 - 2.5), pz = D / 2 - 1.3;
  pole(gb, px, 0, pz, 8.2, 0.18, [0.3, 0.3, 0.34]);
  signPanel(gb, px, 9.4, pz, 4.4, 'sg_MOTEL', 0, { dbl: true, off: 0 });
  signPanel(gb, px, 7.9, pz, 2.6, 'sg_H24', 0, { dbl: true, off: 0 });
  skirt(gb, x0, z0, x1, z1 + gal);
  lotPad(gb, -W / 2 + 0.2, z1 + gal + 0.4, W / 2 - 0.2, D / 2 - 0.15, 0.06);
  roofFlat(gb, x0, z0, x1, z1 + gal, top, { ph: 0.0, col, wall: 'stucco', deck: [0.6, 0.6, 0.58] });
  rooftop(gb, rng, x0 + 1, z0 + 0.5, x1 - 1, z1 - 0.5, top + 0.35, 3, { noTank: true });
  return { roofY: top + 0.35 };
}

function warehouseGeneric(B, small) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(rng.pick([0x8aa0b8, 0xc8b890, 0x7c9a80, 0xd8d8d0, 0xb8a090, 0x8a98a8, 0xc8d0d8]));
  const lotD = clamp(D * 0.18, 4, 9);
  const bw = W - 0.8, z1 = D / 2 - lotD, z0 = -D / 2 + 0.4; const x0 = -bw / 2, x1 = bw / 2;
  const wh = clamp(B.h - 1.6, small ? 4.2 : 6.5, 10), rise = clamp((bw * 0.5) * 0.12, 0.8, 2.2);
  const conc = mulc(C(0xb8b4aa), 1);
  // base + corrugated upper for all four walls
  const bandH = 1.3;
  for (const [a, b, c, d] of [[x0, z1, x1, z1], [x1, z1, x1, z0], [x1, z0, x0, z0], [x0, z0, x0, z1]]) {
    gb.wall(a, b, c, d, 0, bandH, 'concrete', mulc(conc, 0.8), conc, { tw: 4, th: 4 });
    gb.wall(a, b, c, d, bandH, wh, 'corrug', mulc(col, 0.8), col, { tw: 4, th: Math.max(3, (wh - bandH) / 2) });
  }
  // roller doors + man door on the front
  const nd = small ? 1 : clamp(Math.round(bw / 13), 1, 4); const dw = 4.2, dh = 4.4;
  for (let i = 0; i < nd; i++) {
    const cx = x0 + (i + 0.5) * bw / nd - (nd === 1 ? bw * 0.15 : 0);
    gb.q([cx - dw / 2, 0, z1 + 0.05], [cx + dw / 2, 0, z1 + 0.05], [cx + dw / 2, dh, z1 + 0.05], [cx - dw / 2, dh, z1 + 0.05], 'rol', [0.85, 0.85, 0.85], [0.95, 0.95, 0.95], { dir: [0, 0, 1], flip: rng.chance(0.5) });
  }
  const mx = x1 - 2.2; gb.q([mx - 1.5, 0, z1 + 0.05], [mx + 1.5, 0, z1 + 0.05], [mx + 1.5, 3.0, z1 + 0.05], [mx - 1.5, 3.0, z1 + 0.05], 'mand', [0.95, 0.95, 0.95], [1, 1, 1], { dir: [0, 0, 1] });
  // loading dock platform
  if (!small && rng.chance(0.5)) gb.box(x0 + 1, 0, z1, x0 + 10, 1.1, z1 + 1.8, { side: 'concrete', top: 'concrete', c: [0.75, 0.74, 0.7], tw: 4, th: 4, no: 'b' });
  // gable roof along x
  const rf = C(rng.pick([0x8a9098, 0xa0a4a8, 0x7a8a92, 0xb0a898]));
  roofPitched(gb, x0, z0, x1, z1, wh, rise, 0.4, 'rmetal', rf, { gable: true, ridge: 'x', gableTile: 'corrug', gableCol: col, trim: 0xb0b4b8 });
  // ridge vent + turbines
  gb.box(x0 + bw * 0.25, wh + rise - 0.05, (z0 + z1) / 2 - 0.45, x1 - bw * 0.25, wh + rise + 0.55, (z0 + z1) / 2 + 0.45, { side: 'rmetal', c: [0.6, 0.62, 0.64], tw: 3, th: 3 });
  const nt = small ? 1 : 3; for (let i = 0; i < nt; i++) cyl(gb, x0 + (i + 1) * bw / (nt + 1), (z0 + z1) / 2 + 2.2, wh + rise * 0.55, wh + rise * 0.55 + 0.9, 0.35, 0.35, 8, 'rmetal', [0.72, 0.72, 0.72], [0.8, 0.8, 0.8], { th: 99, cap: 'flat' });
  // office lean-to
  if (!small && rng.chance(0.6)) {
    const ox0 = x1 - 8, ox1 = x1, oz0 = z1 - 0.0, oz1 = z1 + 4.5 > D / 2 - 0.3 ? D / 2 - 0.3 : z1 + 4.5;
    gb.box(ox0, 0, oz0, ox1, 3.6, oz1, { side: 'stucco', top: 'gravel', c: wallCol(0xe8e0d0), ct: [0.55, 0.55, 0.52], tw: 3, th: 3, no: 'b' });
    gb.wall(ox0, oz1 + 0.03, ox1, oz1 + 0.03, 0, 3.6, 'shop0', [0.85, 0.85, 0.85], [0.97, 0.97, 0.97], { tw: 3.6, th: 3.6, dir: [0, 0, 1] });
  }
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.2, z1 + 0.1, W / 2 - 0.2, D / 2 - 0.15, 0.06, { tile: 'concrete', col: [0.78, 0.77, 0.74], tw: 4, th: 4 });
  if (small) signPanel(gb, x0 + 3.5, wh - 0.7, z1, 3.2, 'sg_' + rng.pick(['AUTO', 'GARAGE', 'TIRES']), 0, { off: 0.07 });
  if (!small) { acUnit(gb, x0 - 0.0 + 1.2, 0.05, z1 - 0.6, 0.9); }
  return { roofY: wh + rise };
}
const warehouse = (B) => warehouseGeneric(B, false);
const warehouseSmall = (B) => warehouseGeneric(B, true);

function factory(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(rng.pick([0xc8b89c, 0xb8b0a0, 0xa0a8b0, 0xc0a890]));
  const bw = W - 1.0, z1 = D / 2 - 0.6, z0 = -D / 2 + 0.6, x0 = -bw / 2, x1 = bw / 2;
  const hallX1 = x0 + bw * 0.62;           // main saw-tooth hall on the left
  const wh = clamp(B.h * 0.55, 7, 9);
  const brick = [0.95, 0.88, 0.85];
  // main hall: brick lower + corrugated upper
  for (const [a, b, c, d] of [[x0, z1, hallX1, z1], [hallX1, z1, hallX1, z0], [hallX1, z0, x0, z0], [x0, z0, x0, z1]]) {
    gb.wall(a, b, c, d, 0, 2.0, 'brick', mulc(brick, 0.8), brick, { tw: 2.4, th: 2.1 });
    gb.wall(a, b, c, d, 2.0, wh, 'corrug', mulc(col, 0.8), col, { tw: 4, th: Math.max(3, (wh - 2) / 2) });
  }
  // hall windows (high) on the front
  facade(gb, [x0 + 0.5, z1 + 0.03], [hallX1 - 0.5, z1 + 0.03], wh - 4.2, 1, 3.6, { col: [0.9, 0.9, 0.9], fam: ['of2'], lit: 0.3, bay: 4.4 });
  // doors
  gb.q([x0 + 4, 0, z1 + 0.05], [x0 + 8.2, 0, z1 + 0.05], [x0 + 8.2, 4.4, z1 + 0.05], [x0 + 4, 4.4, z1 + 0.05], 'rol', [0.85, 0.85, 0.85], [0.95, 0.95, 0.95], { dir: [0, 0, 1] });
  // saw-tooth roof along z teeth stepping along x
  const nt = Math.max(3, Math.round((hallX1 - x0) / 5)); const tw = (hallX1 - x0) / nt; const tr = 1.9;
  const rc = C(0x7a7e84);
  for (let i = 0; i < nt; i++) {
    const a = x0 + i * tw, b = a + tw;
    // sloped face rising to +x, then vertical glazing on the +x side dropping back
    gb.qt([a, wh, z1], [a, wh, z0], [b, wh + tr, z0], [b, wh + tr, z1], 'rmetal', mulc(rc, 0.9), rc, { up: true, tw: 3, th: 3 });
    gb.q([b, wh, z1], [b, wh, z0], [b, wh + tr, z0], [b, wh + tr, z1], 'cw2l', [0.85, 0.9, 1], [0.9, 0.95, 1], { dir: [1, 0, 0], tw: 99, u: [0, 1], v: [0, 0.27] });
    gb.tri([a, wh, z1], [b, wh, z1], [b, wh + tr, z1], 'corrug', mulc(col, 0.9), [[0, 0], [1, 0], [1, 0.5]], { dir: [0, 0, 1] });
    gb.tri([b, wh, z0], [a, wh, z0], [b, wh + tr, z0], 'corrug', mulc(col, 0.9), [[0, 0], [1, 0], [1, 0.5]], { dir: [0, 0, -1] });
  }
  // boiler house (taller brick block) on the right
  const bx0 = hallX1, bx1 = x1, bz0 = z0, bz1 = z1 - bw * 0.0 - Math.min(10, D * 0.3), bh = clamp(B.h * 0.85, 11, 15);
  const bcol = [0.85, 0.72, 0.68];
  for (const [a, b, c, d] of [[bx0, bz1, bx1, bz1], [bx1, bz1, bx1, bz0], [bx1, bz0, bx0, bz0], [bx0, bz0, bx0, bz1]]) gb.wall(a, b, c, d, 0, bh, 'brick', mulc(bcol, 0.8), bcol, { tw: 2.4, th: 2.1 });
  facade(gb, [bx0 + 0.6, bz1 + 0.04], [bx1 - 0.6, bz1 + 0.04], 4.5, 2, 3.5, { col: [0.9, 0.9, 0.9], fam: ['bk1'], lit: 0.25, bay: 3 });
  roofFlat(gb, bx0, bz0, bx1, bz1, bh, { ph: 0.6, col: [0.7, 0.66, 0.62], wall: 'brick' });
  // stacks
  const ns = rng.int(1, 3);
  for (let i = 0; i < ns; i++) {
    const sx = bx0 + 3 + i * 3.4, sz = (bz0 + bz1) / 2 + (i % 2) * 2 - 1, sH = rng.range(24, 34), r0 = 1.25, r1 = 0.85;
    const seg = (y0, y1, c0, c1) => cyl(gb, sx, sz, y0, y1, lerp(r0, r1, (y0 - bh) / sH), lerp(r0, r1, (y1 - bh) / sH), 12, 'brick', c0, c1, { th: 2.1 });
    const h0 = bh, h1 = bh + sH * 0.72; seg(h0, h1, [0.86, 0.72, 0.66], [0.9, 0.78, 0.72]);
    let y = h1; const step = sH * 0.07; for (let b = 0; b < 4; b++) { const y1 = y + step; seg(y, y1, b % 2 ? [0.85, 0.12, 0.1] : [0.95, 0.95, 0.95], b % 2 ? [0.9, 0.15, 0.1] : [1, 1, 1]); y = y1; }
    cyl(gb, sx, sz, y, y + 0.001, r1 + 0.1, r1 + 0.1, 12, 'flat', [0.2, 0.2, 0.2], [0.2, 0.2, 0.2], { cap: 'flat', th: 99 });
  }
  // silos
  for (let i = 0; i < 2; i++) { const sx = hallX1 + 3.5 + i * 7.4, sz = bz1 + 5.0; if (sz + 3.2 < D / 2 && sx + 3.2 < x1) { cyl(gb, sx, sz, 0, 11, 3.1, 3.1, 14, 'concrete', [0.72, 0.72, 0.7], [0.85, 0.85, 0.84], { th: 4 }); cyl(gb, sx, sz, 11, 13, 3.1, 0.3, 14, 'rmetal', [0.6, 0.62, 0.64], [0.75, 0.77, 0.8], { th: 99 }); } }
  // pipes
  gb.box(hallX1 - 0.2, 5.0, bz1 + 0.1, hallX1 + 9, 5.5, bz1 + 0.7, { side: 'rmetal', c: [0.55, 0.42, 0.3], tw: 3, th: 3 });
  skirt(gb, x0, z0, x1, z1 - 0.0);
  lotPad(gb, x0 + 0.0, z1 + 0.05, x1, D / 2 - 0.1, 0.05, { tile: 'concrete', col: [0.75, 0.74, 0.7], tw: 4, th: 4 });
  return { roofY: bh + 34 };
}

/* ====================================================================================
 *  BUILDERS -- mid/high rise, villas, civic, infrastructure
 * ==================================================================================== */
function towerMass(gb, rng, x0, z0, x1, z1, y0, floors, fh, style, col, o = {}) {
  let fam, rows = 1, bay, lit = o.lit ?? 0.42;
  if (style === 'glass') { fam = o.fam || [rng.pick(['cw0', 'cw1', 'cw2', 'cw3'])]; rows = 2; bay = 6; }
  else if (style === 'deco') { fam = o.fam || ['dc0', 'dc1']; rows = 2; bay = 3.6; }
  else { fam = o.fam || [rng.pick(['of0', 'of1', 'of2'])]; bay = 3.2; }
  const sp = { fam, lit, bay, rows, col, jit: o.jit };
  const A = [[x0, z1, x1, z1], [x1, z1, x1, z0], [x1, z0, x0, z0], [x0, z0, x0, z1]];
  let top = y0;
  for (const [ax, az, bx, bz] of A) top = facade(gb, [ax, az], [bx, bz], y0, floors, fh, sp);
  return top;
}
function antenna(gb, x, y, z, h) {
  gb.box(x - 0.15, y, z - 0.15, x + 0.15, y + h, z + 0.15, { side: 'flat', c: [0.55, 0.55, 0.58], tw: 99, th: 99 });
  gb.box(x - 0.4, y + h * 0.45, z - 0.4, x + 0.4, y + h * 0.45 + 0.3, z + 0.4, { side: 'flat', c: [0.6, 0.6, 0.62], tw: 99, th: 99 });
  gb.box(x - 0.3, y + h, z - 0.3, x + 0.3, y + h + 0.6, z + 0.3, { side: 'gw_r', c: WHITE, tw: 99, th: 99 });
}
function shopGround(rng, door = 'shop1') {
  return { h: 4.6, dark: 0.85, cell: (i, n) => ({ t: i === Math.floor(n / 2) ? door : rng.pick(['shop5', 'shop0', 'shop5', 'shop4']), flip: rng.chance(0.5) }) };
}

/** balcony grid: returns {has(f,i), pick(f,i) -> tile for that bay} so balconies line up with sliding-door bays */
function balconyGrid(rng, floors, n, door, others, p = 0.85) {
  const g = []; for (let f = 0; f < floors; f++) { g.push([]); for (let i = 0; i < n; i++) g[f].push(f > 0 && ((i + f) % 2 === 0) && rng.chance(p)); }
  return { has: (f, i) => !!(g[f] && g[f][i]), pick: (f, i) => (g[f] && g[f][i] ? litP(rng, door, 0.42) : litP(rng, rng.pick(others), 0.42)) };
}
function apartmentMid(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const brick = rng.chance(0.38);
  const col = brick ? mulc([1, 0.96, 0.92], rng.range(0.85, 1)) : wallCol(rng.pick([...PAL_PASTEL.slice(0, 8), ...PAL_BLEACH, 0xd0a080, 0xb8906a]));
  const floors = clamp(Math.round((B.h - 1.0) / 3.2), 4, 8), fh = 3.2, gh = 4.2;
  const x0 = -W / 2 + 0.3, x1 = W / 2 - 0.3, z0 = -D / 2 + 0.3, z1 = D / 2 - 1.8;
  const fam = brick ? ['bk0', 'bk1', 'bk2'] : ['ap0', 'r1', 'r4', 'r5', 'r0'];
  const top = gh + (floors - 1) * fh;
  const ground = { h: gh, dark: 0.82, cell: (i, n) => ({ t: i === Math.floor(n / 2) ? 'shop1' : rng.pick(['shop0', 'shop4', 'shop2', 'shop0']), flip: rng.chance(0.5) }) };
  const nB = Math.max(1, Math.round((x1 - x0) / 3.4));
  const bg = balconyGrid(rng, floors, nB, brick ? 'bk1' : 'ap0', brick ? ['bk0', 'bk2', 'bk0'] : ['r1', 'r4', 'r5', 'r0']);
  facade(gb, [x0, z1], [x1, z1], 0, floors, fh, { col, fam, lit: 0.42, bay: 3.4, ground, pick: (f, i) => bg.pick(f, i) });
  const sm = brick ? { tile: 'brick', col } : { tile: 'stucco', col };
  // sides: upper floors have windows, ground blank
  for (const [a, b] of [[[x1, z1], [x1, z0]], [[x1, z0], [x0, z0]], [[x0, z0], [x0, z1]]]) {
    facade(gb, a, b, 0, floors, fh, { col, fam, lit: 0.4, bay: 3.4, ground: { h: gh, dark: 0.82, cell: (i, n) => ({ t: rng.chance(0.55) ? 'stucco' : litP(rng, rng.pick(fam), 0.4) }) } });
  }
  // balconies
  const n = Math.max(1, Math.round((x1 - x0) / 3.4)), bayW = (x1 - x0) / n;
  for (let f = 1; f < floors; f++) for (let i = 0; i < n; i++) if (bg.has(f, i)) balcony(gb, x0 + (i + 0.5) * bayW, gh + (f - 1) * fh, z1, 0, bayW - 0.55, 1.45, [0.8, 0.79, 0.76]);
  ledgeRing(gb, x0, z0, x1, z1, gh - 0.25, gh + 0.05, 0.14, 'concrete', [0.85, 0.83, 0.8]);
  ledgeRing(gb, x0, z0, x1, z1, top - 0.05, top + 0.3, 0.3, 'concrete', [0.88, 0.86, 0.82]);
  // shop awnings + signs
  const sn = Math.max(1, Math.round((x1 - x0) / 6.6));
  for (let i = 0; i < sn; i++) { const cx = x0 + (i + 0.5) * (x1 - x0) / sn; if (rng.chance(0.75)) awning(gb, cx, 3.2, z1, (x1 - x0) / sn - 0.7, 1.3, 0.5, C(rng.pick(AWN_COLS))); }
  const r = roofFlat(gb, x0, z0, x1, z1, top + 0.3, { ph: 0.8, col, wall: brick ? 'brick' : 'stucco' });
  rooftop(gb, rng, x0 + 0.8, z0 + 0.8, x1 - 0.8, z1 - 0.8, top + 0.3, 4);
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.2, z1 + 0.05, W / 2 - 0.2, D / 2 - 0.15, 0.06, { tile: 'concrete', col: [0.85, 0.83, 0.8], tw: 4, th: 4 });
  if (rng.chance(0.5)) signPanel(gb, x0 + 3.0, top - 1.0, z1, 4.2, 'sg_HOTEL', 0, { off: 0.3 - 0.0 });
  return { roofY: r };
}

function officeLow(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const style = B.spec.style || rng.pick(['ribbon', 'punched', 'glass', 'punched']);
  const col = style === 'glass' ? mixc(C(rng.pick([0xa8c8e0, 0xa0d0c0, 0xc8b89a, 0xb0b8c0])), WHITE, 0.3) : wallCol(rng.pick([...PAL_NEUTRAL, 0xe0d0b0, 0xd0b898]));
  const floors = clamp(Math.round(B.h / 3.8), 2, 4), fh = 3.8, gh = 4.4;
  const lotD = clamp(D * 0.2, 3, 6);
  const x0 = -W / 2 + 0.4, x1 = W / 2 - 0.4, z0 = -D / 2 + 0.4, z1 = D / 2 - lotD;
  const fam = style === 'ribbon' ? ['of2'] : style === 'glass' ? ['cw1'] : ['of0', 'of1'];
  const rows = style === 'glass' ? 2 : 1;
  const ground = shopGround(rng);
  const upFloors = floors - 1;
  facade(gb, [x0, z1], [x1, z1], 0, 1, gh, { col: style === 'glass' ? WHITE : col, fam: ['shop5'], lit: 0, bay: 3.4, ground: null, pick: (f, i, n) => (i === Math.floor(n / 2) ? 'shop1' : 'shop5') });
  const upOpt = { col, fam, lit: 0.45, bay: style === 'glass' ? 6 : 3.4, rows };
  const A = [[[x0, z1], [x1, z1]], [[x1, z1], [x1, z0]], [[x1, z0], [x0, z0]], [[x0, z0], [x0, z1]]];
  for (let k = 0; k < 4; k++) {
    if (k > 0) facade(gb, A[k][0], A[k][1], 0, 1, gh, { col, fam: ['stucco'], lit: 0, bay: 3.4, pick: () => null });
    facade(gb, A[k][0], A[k][1], gh, upFloors, fh, upOpt);
  }
  const top = gh + upFloors * fh;
  ledgeRing(gb, x0, z0, x1, z1, gh - 0.2, gh + 0.05, 0.14, 'concrete', [0.85, 0.83, 0.8]);
  ledgeRing(gb, x0, z0, x1, z1, top - 0.05, top + 0.3, 0.25, 'concrete', [0.85, 0.83, 0.8]);
  // entrance canopy
  gb.box(-2.8, 3.7, z1, 2.8, 4.0, z1 + 2.6, { side: 'flat', top: 'gravel', c: [0.35, 0.36, 0.4], ct: [0.6, 0.6, 0.58], tw: 99, th: 99 });
  for (const sx of [-2.6, 2.6]) pole(gb, sx, 0, z1 + 2.4, 3.7, 0.07, [0.4, 0.4, 0.44]);
  const r = roofFlat(gb, x0, z0, x1, z1, top + 0.3, { ph: 0.7, col, wall: style === 'glass' ? 'concrete' : 'stucco' });
  rooftop(gb, rng, x0 + 0.8, z0 + 0.8, x1 - 0.8, z1 - 0.8, top + 0.3, 3);
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.2, z1 + 0.05, W / 2 - 0.2, D / 2 - 0.15, 0.06);
  return { roofY: r };
}

function officeMid(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const style = B.spec.style || rng.pick(['glass', 'glass', 'concrete', 'deco']);
  const glassCols = [0x9ac0e0, 0x9ad0c0, 0xc0a880, 0xb0b8c4, 0x80a0c8];
  const col = style === 'glass' ? mixc(C(rng.pick(glassCols)), WHITE, 0.35) : style === 'deco' ? C(rng.pick([0xe8dcc0, 0xd8c8a8, 0xc8d0d4])) : C(rng.pick([0xd8d4c8, 0xc8c4b8, 0xe0d8c0, 0xb8b0a0]));
  const floors = clamp(Math.round((B.h - 5) / 3.7), 7, 14), fh = 3.7;
  const x0 = -W / 2 + 0.6, x1 = W / 2 - 0.6, z0 = -D / 2 + 0.6, z1 = D / 2 - 0.6;
  // base: 2 tall floors (shop glass), tower above
  const baseH = 4.6;
  facade(gb, [x0, z1], [x1, z1], 0, 1, baseH, { col: WHITE, fam: ['shop5'], lit: 0, bay: 3.4, pick: (f, i, n) => (i === Math.floor(n / 2) ? 'shop1' : 'shop5') });
  for (const [a, b] of [[[x1, z1], [x1, z0]], [[x1, z0], [x0, z0]], [[x0, z0], [x0, z1]]]) facade(gb, a, b, 0, 1, baseH, { col: WHITE, fam: ['shop5'], lit: 0, bay: 3.4, pick: (f, i, n) => (rng.chance(0.3) ? 'shop0' : 'shop5') });
  const nmain = Math.max(2, Math.round(floors * 0.72)), ntop = floors - nmain;
  const mainTop = towerMass(gb, rng, x0, z0, x1, z1, baseH, nmain, fh, style, col, { lit: 0.42 });
  ledgeRing(gb, x0, z0, x1, z1, baseH - 0.15, baseH + 0.15, 0.2, 'concrete', [0.85, 0.83, 0.8]);
  let roofY;
  if (ntop > 0) {
    const ix = Math.min(2.4, W * 0.1), iz = Math.min(2.4, D * 0.1);
    ledgeRing(gb, x0, z0, x1, z1, mainTop - 0.05, mainTop + 0.3, 0.15, 'concrete', [0.85, 0.83, 0.8]);
    roofFlat(gb, x0, z0, x1, z1, mainTop + 0.3, { ph: 0.5, col: mulc(col, 0.9), wall: 'concrete' });
    const tt = towerMass(gb, rng, x0 + ix, z0 + iz, x1 - ix, z1 - iz, mainTop + 0.3, ntop, fh, style, col, { lit: 0.42 });
    ledgeRing(gb, x0 + ix, z0 + iz, x1 - ix, z1 - iz, tt - 0.05, tt + 0.3, 0.2, 'concrete', [0.85, 0.83, 0.8]);
    roofY = roofFlat(gb, x0 + ix, z0 + iz, x1 - ix, z1 - iz, tt + 0.3, { ph: 0.8, col: mulc(col, 0.9), wall: 'concrete' });
    rooftop(gb, rng, x0 + ix + 1, z0 + iz + 1, x1 - ix - 1, z1 - iz - 1, tt + 0.3, 3);
    if (rng.chance(0.5)) antenna(gb, (x0 + x1) / 2, tt + 0.3, (z0 + z1) / 2, rng.range(6, 12));
  } else {
    ledgeRing(gb, x0, z0, x1, z1, mainTop - 0.05, mainTop + 0.3, 0.2, 'concrete', [0.85, 0.83, 0.8]);
    roofY = roofFlat(gb, x0, z0, x1, z1, mainTop + 0.3, { ph: 0.8, col: mulc(col, 0.9), wall: 'concrete' });
    rooftop(gb, rng, x0 + 1, z0 + 1, x1 - 1, z1 - 1, mainTop + 0.3, 4);
  }
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.1, z1 + 0.02, W / 2 - 0.1, D / 2 - 0.05, 0.06, { tile: 'concrete', col: [0.85, 0.83, 0.8], tw: 4, th: 4 });
  return { roofY };
}

function skyscraper(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const style = B.spec.style || rng.pick(['glass', 'glass', 'deco', 'concrete']);
  const glassCols = [0x8ab8e0, 0x88c8b8, 0xb8a078, 0xa8b2c0, 0x6890c0, 0x90c0d0];
  const col = style === 'glass' ? mixc(C(rng.pick(glassCols)), WHITE, 0.35) : style === 'deco' ? C(rng.pick([0xe8dcc0, 0xd8c8a8, 0xc8d0d4, 0xe0d0b0])) : C(rng.pick([0xd8d4c8, 0xc0bcb0, 0xe0d8c0]));
  const F = clamp(Math.round(B.h / 3.7), 18, 46), fh = style === 'glass' ? 3.6 : style === 'deco' ? 3.7 : 3.6;
  const hx = W / 2 - 0.5, hz = D / 2 - 0.5;
  // podium
  const podF = 3, baseH = 5.0, podFh = style === 'deco' ? 3.7 : 4.2;
  const px0 = -hx, px1 = hx, pz0 = -hz, pz1 = hz;
  const podTop = baseH + (podF - 1) * podFh;
  const pfam = style === 'deco' ? ['dc0', 'dc1'] : ['of0', 'of1', 'of2'];
  const podCol = style === 'deco' ? col : mulc(C(rng.pick([0xd8d4c8, 0xc8c4b8, 0xe0d8c0])), 1);
  const sides = [[[px0, pz1], [px1, pz1]], [[px1, pz1], [px1, pz0]], [[px1, pz0], [px0, pz0]], [[px0, pz0], [px0, pz1]]];
  sides.forEach(([a, b], k) => {
    facade(gb, a, b, 0, 1, baseH, { col: WHITE, fam: ['shop5'], lit: 0, bay: 3.4, pick: (f, i, n) => (k === 0 && i === Math.floor(n / 2) ? 'shop1' : (rng.chance(0.25) ? 'shop0' : 'shop5')) });
    facade(gb, a, b, baseH, podF - 1, podFh, { col: podCol, fam: pfam, lit: 0.42, bay: 3.6, rows: style === 'deco' ? 2 : 1 });
  });
  ledgeRing(gb, px0, pz0, px1, pz1, baseH - 0.2, baseH + 0.1, 0.18, 'concrete', [0.85, 0.83, 0.8]);
  ledgeRing(gb, px0, pz0, px1, pz1, podTop - 0.05, podTop + 0.35, 0.3, 'concrete', [0.85, 0.83, 0.8]);
  roofFlat(gb, px0, pz0, px1, pz1, podTop + 0.35, { ph: 0.6, col: podCol, wall: 'concrete' });
  skirt(gb, px0, pz0, px1, pz1);
  awning(gb, 0, 3.6, pz1, Math.min(10, W * 0.3), 0.45, 0.3, C(rng.pick([0x202428, 0x284a78, 0x602020])));
  // tiers
  let y = podTop + 0.35; const tierInsets = style === 'deco' ? [0.14, 0.26, 0.36] : style === 'glass' ? [0.16, 0.24] : [0.15, 0.3];
  const nt = style === 'deco' ? 3 : rng.int(1, 2) + 1;
  const mainF = F - podF; const fr = nt === 3 ? [0.46, 0.3, 0.24] : nt === 2 ? [0.72, 0.28] : [1];
  const tierFam = style === 'glass' ? [rng.pick(['cw0', 'cw1', 'cw2', 'cw3'])] : style === 'concrete' ? [rng.pick(['cw3', 'cw3', 'cw2'])] : null;
  let cx0 = px0, cx1 = px1, cz0 = pz0, cz1 = pz1, roofY = y;
  for (let t = 0; t < nt; t++) {
    const ins = t === 0 ? 0.16 : tierInsets[Math.min(t, tierInsets.length - 1)];
    const ix = hx * (t === 0 ? 0.14 : ins), iz = hz * (t === 0 ? 0.14 : ins);
    cx0 = -hx + ix; cx1 = hx - ix; cz0 = -hz + iz; cz1 = hz - iz;
    if (t > 0) { cx0 = -hx + hx * tierInsets[t - 1] * 1.0 + hx * 0.12 * t; cx1 = -cx0; cz0 = -hz + hz * tierInsets[t - 1] + hz * 0.12 * t; cz1 = -cz0; }
    const fl = Math.max(2, t === nt - 1 ? mainF - fr.slice(0, t).reduce((s, v) => s + Math.round(mainF * v), 0) : Math.round(mainF * fr[t]));
    const fl2 = style !== 'deco' || true ? Math.round(fl / 2) * 2 : fl;
    const top = towerMass(gb, rng, cx0, cz0, cx1, cz1, y, fl2, fh, style === 'concrete' ? 'glass' : style, col, { fam: tierFam, lit: 0.45 });
    ledgeRing(gb, cx0, cz0, cx1, cz1, top - 0.05, top + 0.35, style === 'deco' ? 0.35 : 0.22, 'concrete', [0.86, 0.84, 0.8]);
    y = top + 0.35;
    if (t < nt - 1) roofFlat(gb, cx0, cz0, cx1, cz1, y, { ph: style === 'deco' ? 0.5 : 0.4, col: mulc(col, 0.9), wall: 'concrete' });
  }
  const ax = 0, az = 0; const crown = B.spec.crown || (style === 'deco' ? 'pyramid' : rng.pick(['flat', 'sign', 'heli', 'slant']));
  if (style === 'deco' || crown === 'pyramid') {
    const rc = C(rng.pick([0x5aa89a, 0xc8a040, 0x88a8b8, 0x9a9a9e]));
    const hw = Math.min(cx1 - cx0, cz1 - cz0) / 2; const rise = Math.min(14, hw * 1.3);
    roofPitched(gb, cx0, cz0, cx1, cz1, y, rise, 0.1, 'rmetal', rc, { soffit: false, tw: 3, th: 3 });
    cyl(gb, 0, 0, y + rise - 0.1, y + rise + 7, 0.3, 0.06, 6, 'rmetal', [0.7, 0.7, 0.72], [0.8, 0.8, 0.82], { th: 99 });
    gb.box(-0.25, y + rise + 7, -0.25, 0.25, y + rise + 7.6, 0.25, { side: 'gw_r', c: WHITE, tw: 99, th: 99 });
    roofY = y + rise + 7.6;
  } else {
    roofY = roofFlat(gb, cx0, cz0, cx1, cz1, y, { ph: 0.8, col: mulc(col, 0.9), wall: 'concrete' });
    if (crown === 'heli') {
      const hs = Math.min(cx1 - cx0, cz1 - cz0) - 3; const s = Math.min(hs, 14);
      gb.flat(-s / 2, -s / 2, s / 2, s / 2, y + 0.06, 'helipad', WHITE);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) gb.box(sx * s / 2 - 0.12 * (sx > 0 ? 1 : -1) * 0 - 0.12, y, sz * s / 2 - 0.12, sx * s / 2 + 0.12, y + 0.6, sz * s / 2 + 0.12, { side: 'gw_y', c: WHITE, tw: 99, th: 99 });
      rooftop(gb, rng, cx0 + 1, cz0 + 1, cx1 - 1, cz1 - 1, y, 0);
    } else if (crown === 'sign') {
      const pw = (cx1 - cx0) * 0.6, pd = (cz1 - cz0) * 0.6, ph = 4.6;
      gb.box(-pw / 2, y, -pd / 2, pw / 2, y + ph, pd / 2, { side: style === 'glass' ? 'cw2d' : 'concrete', c: style === 'glass' ? C(0x8aa8c0) : [0.8, 0.79, 0.76], top: 'gravel', ct: [0.55, 0.55, 0.52], tw: style === 'glass' ? 6 : 4, th: style === 'glass' ? 7.2 : 4 });
      const key = 'sg_' + rng.pick(['HOTEL', 'BANK', 'H24', 'AIRPORT']); const sw = Math.min(pw * 0.9, 9);
      for (let f = 0; f < 4; f++) { const F2 = frameOf(f, 0, 0); const half = (f % 2 === 0 ? pd : pw) / 2; signPanel(gb, 0, y + ph + 1.2, 0, sw, key, f, { off: (f % 2 === 0 ? pd : pw) / 2 + 0.05 }); }
      roofY = y + ph + 2.6;
    } else if (crown === 'slant') {
      const pw = (cx1 - cx0) * 0.94, pd = (cz1 - cz0) * 0.94; const rh = Math.min(10, pw * 0.3);
      roofShed(gb, -pw / 2, -pd / 2, pw / 2, pd / 2, y + 0.2, y + 0.2 + rh, rng.int(0, 3), 'rmetal', mulc(col, 0.8), { th: 0.4 });
      roofY = y + rh + 0.2;
    }
    if (crown !== 'heli') rooftop(gb, rng, cx0 + 1.2, cz0 + 1.2, cx1 - 1.2, cz1 - 1.2, y, 3, { noTank: true });
    if (rng.chance(0.75)) { const ah = rng.range(10, 26); antenna(gb, rng.range(-1.5, 1.5), roofY, rng.range(-1.5, 1.5), ah); roofY += ah + 0.6; }
  }
  lotPad(gb, -W / 2 + 0.05, hz + 0.0, W / 2 - 0.05, D / 2 - 0.0, 0.05, { tile: 'concrete', col: [0.85, 0.83, 0.8], tw: 4, th: 4 });
  return { roofY };
}

function villa(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const white = B.color ? wallCol(B.color) : C(rng.pick([0xf4f2ec, 0xf0ece4, 0xe8eef0, 0xf4efe0]));
  const wood = C(rng.pick([0x9a6a44, 0x7a5a42, 0xb08050]));
  const bw = Math.min(W - 1.4, 22), poolD = clamp(D * 0.28, 4, 8);
  const x0 = -bw / 2, x1 = bw / 2, z1 = D / 2 - poolD - 0.8, z0 = -D / 2 + 0.6;
  const f1 = 3.6, slab = 0.35, f2 = 3.3;
  // ground volume
  const cells = []; const nb = Math.max(3, Math.round(bw / 4.5));
  for (let i = 0; i < nb; i++) cells.push({ t: (i === 0 || i === nb - 1) && nb > 3 ? 'stucco' : litP(rng, 'gbg', 0.55), w: 1, flip: rng.chance(0.5), col: (i === 0 || i === nb - 1) && nb > 3 ? undefined : [0.8, 0.9, 1.0] });
  strip(gb, x0, z1, x1, z1, 0, f1, cells, mulc(white, 0.85), mulc(white, 0.98));
  gb.wall(x1, z1, x1, z0, 0, f1, 'stone', [0.75, 0.72, 0.68], [0.95, 0.92, 0.88], { tw: 3, th: 3 });
  gb.wall(x1, z0, x0, z0, 0, f1, 'stucco', mulc(white, 0.85), white, {});
  gb.wall(x0, z0, x0, z1, 0, f1, 'stucco', mulc(white, 0.85), white, {});
  // slab over ground volume (overhanging)
  gb.box(x0 - 0.6, f1, z0 - 0.3, x1 + 0.6, f1 + slab, z1 + 0.7, { side: 'flat', top: 'gravel', c: white, ct: [0.6, 0.6, 0.58], tw: 99, th: 99 });
  // upper volume (cantilevered over the front)
  const ux0 = x0 + bw * 0.12, ux1 = x1 - bw * 0.25, uz0 = z0 + 1.0, uz1 = z1 + 1.9;
  const y2 = f1 + slab;
  const ucells = []; const un = Math.max(2, Math.round((ux1 - ux0) / 4.5)); for (let i = 0; i < un; i++) ucells.push({ t: litP(rng, 'gbg', 0.5), w: 1, flip: rng.chance(0.5), col: [0.8, 0.9, 1.0] });
  strip(gb, ux0, uz1, ux1, uz1, y2, y2 + f2, ucells, mulc(white, 0.9), white);
  gb.wall(ux1, uz1, ux1, uz0, y2, y2 + f2, 'siding', mulc(wood, 0.85), wood, {});
  gb.wall(ux1, uz0, ux0, uz0, y2, y2 + f2, 'stucco', mulc(white, 0.85), white, {});
  gb.wall(ux0, uz0, ux0, uz1, y2, y2 + f2, 'siding', mulc(wood, 0.85), wood, {});
  gb.q([ux0, y2, uz1], [ux1, y2, uz1], [ux1, y2, z1 + 0.7], [ux0, y2, z1 + 0.7], 'flat', mulc(white, 0.6), mulc(white, 0.6), { down: true });
  gb.box(ux0 - 0.7, y2 + f2, uz0 - 0.4, ux1 + 0.7, y2 + f2 + slab, uz1 + 0.6, { side: 'flat', top: 'gravel', c: white, ct: [0.6, 0.6, 0.58], tw: 99, th: 99 });
  for (const px of [ux0 + 0.6, ux1 - 0.6]) gb.box(px - 0.12, 0, uz1 - 0.3, px + 0.12, y2, uz1 - 0.06, { side: 'flat', c: [0.88, 0.88, 0.86], tw: 99, th: 99 });
  // glass railing on the ground-floor slab in front of the upper volume (terrace)
  railing(gb, x0 - 0.5, z1 + 0.65, ux0 - 0.3, z1 + 0.65, f1 + slab, 1.0, [0.85, 0.95, 1]); railing(gb, ux1 + 0.3, z1 + 0.65, x1 + 0.5, z1 + 0.65, f1 + slab, 1.0, [0.85, 0.95, 1]);
  // pool terrace
  const poolZ0 = z1 + 1.4, poolZ1 = D / 2 - 0.5;
  gb.box(-W / 2 + 0.3, -0.5, z1 + 0.05, W / 2 - 0.3, 0.12, poolZ1, { side: 'concrete', top: 'deck', c: [0.8, 0.78, 0.74], ct: [1, 0.95, 0.9], tw: 4, th: 4, no: 'b' });
  const pw = Math.min(bw * 0.6, 12);
  gb.flat(-pw / 2, poolZ0 + 0.2, pw / 2, poolZ1 - 0.3, 0.13, 'pool', [1, 1, 1], { tw: 4, th: 4 });
  gb.box(-pw / 2 - 0.25, 0.12, poolZ0 - 0.05, pw / 2 + 0.25, 0.16, poolZ0 + 0.2, { side: 'flat', top: 'flat', c: [0.95, 0.95, 0.93], ct: [0.95, 0.95, 0.93], tw: 99, th: 99 });
  // loungers
  for (let i = 0; i < 3; i++) gb.box(pw / 2 + 0.6, 0.12, poolZ0 + 0.8 + i * 1.3, pw / 2 + 1.0 + 1.6, 0.4, poolZ0 + 1.3 + i * 1.3, { side: 'flat', top: 'flat', c: [0.95, 0.95, 0.92], ct: rng.chance(0.5) ? [0.2, 0.55, 0.9] : [0.95, 0.95, 0.95], tw: 99, th: 99 });
  skirt(gb, x0, z0, x1, z1);
  rooftop(gb, rng, ux0 + 0.3, uz0 + 0.3, ux1 - 0.3, uz1 - 1.0, y2 + f2 + slab, 2, { noTank: true });
  return { roofY: y2 + f2 + slab };
}

function mansion(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(rng.pick([0xf0e8d8, 0xf4efe4, 0xe8dcc0, 0xf2e0d0, 0xe0e4e8]));
  const bw = Math.min(W - 2, 30), bd = Math.min(D - 9, 15), fh = 3.7;
  const x0 = -bw / 2, x1 = bw / 2, z1 = D / 2 - 8.0, z0 = z1 - bd;
  const cw = bw * 0.44, cx0 = -cw / 2, cx1 = cw / 2, floors = 2;
  const rf = { tile: 'rtile', col: C(rng.pick(ROOF_TILE)) };
  // centre block (2 floors) + wings (2 floors but lower roof)
  const fam = ['r2', 'r3', 'r0', 'r2'];
  const win = (dor) => ({ col, fam, lit: 0.45, bay: 3.3, pick: dor ? (f, i, n) => (f === 0 && i === Math.floor(n / 2) ? null : null) : undefined });
  // centre front: custom so the door bay is cdoor (3x4)
  const nC = Math.max(3, Math.round(cw / 3.3));
  const mkRow = (f) => { const cells = []; for (let i = 0; i < nC; i++) cells.push({ t: (f === 0 && i === Math.floor(nC / 2)) ? 'cdoor' : litP(rng, rng.pick(fam), 0.45), w: (f === 0 && i === Math.floor(nC / 2)) ? 1.1 : 1, flip: rng.chance(0.5) }); return cells; };
  strip(gb, cx0, z1, cx1, z1, 0, fh, mkRow(0), mulc(col, 0.8), mulc(col, 0.97));
  strip(gb, cx0, z1, cx1, z1, fh, 2 * fh, mkRow(1), mulc(col, 0.96), col);
  for (const sgn of [-1, 1]) {
    const wx0 = sgn < 0 ? x0 : cx1, wx1 = sgn < 0 ? cx0 : x1;
    facade(gb, [wx0, z1 - 1.0], [wx1, z1 - 1.0], 0, floors, fh, { col, fam, lit: 0.45, bay: 3.4 });
    gb.wall(sgn < 0 ? cx0 : cx1, z1 - 1.0, sgn < 0 ? cx0 : cx1, z1, 0, 2 * fh, 'stucco', mulc(col, 0.85), col, {});
    const ox = sgn < 0 ? x0 : x1; const A = sgn < 0 ? [x0, z0] : [x1, z1 - 1.0], Bp = sgn < 0 ? [x0, z1 - 1.0] : [x1, z0];
    facade(gb, A, Bp, 0, floors, fh, { col, fam, lit: 0.4, bay: 3.4 });
  }
  facade(gb, [x1, z0], [x0, z0], 0, floors, fh, { col, fam, lit: 0.4, bay: 3.4 });
  // centre sides
  gb.wall(cx1, z1, cx1, z1 - 1.0, 0, 2 * fh, 'stucco', mulc(col, 0.85), col, {});
  ledgeRing(gb, x0, z0, x1, z1 - 1.0, fh - 0.12, fh + 0.12, 0.1, 'concrete', [0.92, 0.9, 0.86]);
  ledgeRing(gb, x0, z0, x1, z1 - 1.0, 0, 0.35, 0.06, 'concrete', [0.8, 0.78, 0.74]);
  // roofs
  roofPitched(gb, x0, z0, x1, z1 - 1.0, 2 * fh, 2.4, 0.6, rf.tile, rf.col, { gable: false });
  roofPitched(gb, cx0, z0, cx1, z1, 2 * fh, 3.4, 0.4, rf.tile, rf.col, { gable: true, ridge: 'z', gableTile: 'stucco', gableCol: col });
  chimney(gb, x0 + 2.0, 2 * fh - 0.6, (z0 + z1) / 2, 2 * fh + 2.5, 1.0); chimney(gb, x1 - 2.0, 2 * fh - 0.6, (z0 + z1) / 2, 2 * fh + 2.5, 1.0);
  // portico: columns + pediment
  const pw = cw * 0.8, pz0 = z1, pz1 = z1 + 3.4, ch = 2 * fh - 0.9;
  gb.box(-pw / 2 - 0.4, -0.2, pz0, pw / 2 + 0.4, 0.3, pz1 + 0.6, { side: 'concrete', top: 'concrete', c: [0.85, 0.84, 0.8], ct: [0.92, 0.9, 0.86], tw: 4, th: 4, no: 'b' });
  const nc = 4; for (let i = 0; i < nc; i++) { const cx = -pw / 2 + pw * i / (nc - 1); cyl(gb, cx, pz1 - 0.4, 0.3, ch, 0.36, 0.3, 10, 'stone', [0.9, 0.88, 0.84], [0.97, 0.95, 0.9], { th: 3 }); gb.box(cx - 0.45, ch, pz1 - 0.85, cx + 0.45, ch + 0.25, pz1 + 0.05, { side: 'concrete', c: [0.92, 0.9, 0.86], tw: 99, th: 99 }); }
  gb.box(-pw / 2 - 0.5, ch + 0.25, pz0, pw / 2 + 0.5, ch + 0.85, pz1 + 0.2, { side: 'concrete', top: 'concrete', c: [0.94, 0.92, 0.88], tw: 99, th: 99 });
  roofPitched(gb, -pw / 2 - 0.3, pz0, pw / 2 + 0.3, pz1 + 0.15, ch + 0.85, 1.6, 0.15, 'rtile', rf.col, { gable: true, ridge: 'z', gableTile: 'stucco', gableCol: col, soffit: false });
  stairs(gb, 0, 0, pz1 + 3.6, 0, -1, pw * 0.6, 0.3, 2.6, 3, [0.85, 0.84, 0.8]);
  // gate pillars + fence + lawn
  lawnPad(gb, -W / 2 + 0.3, pz1 + 0.6, W / 2 - 0.3, D / 2 - 0.4, 0.08);
  lotPad(gb, -2, pz1 + 0.6, 2, D / 2 - 0.4, 0.09, { tile: 'concrete', col: [0.9, 0.88, 0.84], tw: 4, th: 4 });
  const fz = D / 2 - 0.45;
  fence(gb, -W / 2 + 0.6, fz, -2.6, fz, 1.6, 'rail', [0.15, 0.15, 0.17], 0.1, { tw: 2 }); fence(gb, 2.6, fz, W / 2 - 0.6, fz, 1.6, 'rail', [0.15, 0.15, 0.17], 0.1, { tw: 2 });
  for (const gx of [-2.6, 2.6, -W / 2 + 0.6, W / 2 - 0.6]) gb.box(gx - 0.3, 0.1, fz - 0.3, gx + 0.3, 2.1, fz + 0.3, { side: 'stone', top: 'concrete', c: [0.95, 0.92, 0.88], tw: 1.2, th: 1.2 });
  skirt(gb, x0, z0, x1, z1 - 0.0);
  return { roofY: 2 * fh + 3.4 };
}

function beachHouse(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(rng.pick([0x7fd0c8, 0xf08c78, 0xf0d060, 0xf0a8b8, 0x8fc0e8, 0xf5efe4, 0xa8d880, 0xe8c8a0]));
  const bw = Math.min(W - 1.6, 12), bd = Math.min(D - 6.6, 10);
  const x0 = -bw / 2, x1 = bw / 2, z0 = -D / 2 + 0.8, z1 = z0 + bd;
  const y0 = 1.6, fh = 2.9, floors = B.h > 7 ? 2 : 1;
  const top = y0 + floors * fh;
  // stilts
  const npx = Math.max(2, Math.round(bw / 4)) + 1, npz = Math.max(2, Math.round(bd / 4)) + 1;
  for (let i = 0; i < npx; i++) for (let j = 0; j < npz; j++) { if (i > 0 && i < npx - 1 && j > 0 && j < npz - 1) continue; const px = lerp(x0 + 0.3, x1 - 0.3, i / (npx - 1)), pz = lerp(z0 + 0.3, z1 - 0.3, j / (npz - 1)); gb.box(px - 0.15, -2, pz - 0.15, px + 0.15, y0, pz + 0.15, { side: 'siding', c: [0.75, 0.68, 0.6], tw: 99, th: 99 }); }
  gb.box(x0, y0 - 0.3, z0, x1, y0, z1, { side: 'siding', top: 'deck', c: [0.7, 0.65, 0.58], tw: 99, th: 99 });
  const fam = ['r1', 'r5', 'ap0', 'r0'];
  const mk = () => { const c = []; const n = Math.max(2, Math.round(bw / 3.4)); for (let i = 0; i < n; i++) c.push({ t: i === 1 ? rng.pick(['rd1', 'rd0']) : litP(rng, rng.pick(fam), 0.45), w: 1, flip: rng.chance(0.5) }); return c; };
  for (let f = 0; f < floors; f++) strip(gb, x0, z1, x1, z1, y0 + f * fh, y0 + (f + 1) * fh, f === 0 ? mk() : mk().map((c) => (c.t.startsWith('rd') ? { t: litP(rng, 'ap0', 0.45), w: 1 } : c)), mulc(col, f ? 0.96 : 0.85), col);
  for (const [a, b] of [[[x1, z1], [x1, z0]], [[x1, z0], [x0, z0]], [[x0, z0], [x0, z1]]]) facade(gb, a, b, y0, floors, fh, { col, fam, lit: 0.4, bay: 3.4, pick: (f, i, n) => (rng.chance(0.3) ? 'stucco' : null) });
  // front deck with rails + stairs
  const dd = 1.7; gb.box(x0 - 0.3, y0 - 0.25, z1, x1 + 0.3, y0, z1 + dd, { side: 'siding', top: 'deck', c: [0.8, 0.74, 0.66], tw: 99, th: 99, no: 'b' });
  railing(gb, x0 - 0.25, z1 + dd - 0.05, x1 + 0.25, z1 + dd - 0.05, y0, 0.95, WHITE); railing(gb, x0 - 0.25, z1, x0 - 0.25, z1 + dd - 0.05, y0, 0.95, WHITE); railing(gb, x1 + 0.25, z1, x1 + 0.25, z1 + dd - 0.05, y0, 0.95, WHITE);
  for (const sx of [x0, x1]) gb.box(sx - 0.1, -2, z1 + dd - 0.25, sx + 0.1, y0, z1 + dd - 0.05, { side: 'siding', c: [0.75, 0.68, 0.6], tw: 99, th: 99 });
  stairs(gb, (x0 + x1) / 2 + 1, 0, z1 + dd + 2.6, 0, -1, 1.3, y0, 2.6, 8, [0.8, 0.75, 0.68], { tile: 'deck' });
  // roof
  if (rng.chance(0.55)) { roofShed(gb, x0 - 0.5, z0 - 0.4, x1 + 0.5, z1 + 0.6, top + 0.2, top + 1.5, 0, 'rmetal', [0.85, 0.88, 0.9], { th: 0.3 }); }
  else roofFlat(gb, x0, z0, x1, z1, top, { ph: 0.4, col, wall: 'stucco' });
  ledgeRing(gb, x0, z0, x1, z1, top - 0.1, top + 0.1, 0.25, 'flat', mulc(col, 0.9), { noBottom: false });
  // surfboards leaning on the wall
  for (let i = 0; i < 3; i++) { const bx = x0 + 1.2 + i * 0.45; const c = C(rng.pick([0xe8c030, 0x30a0e8, 0xe84070, 0xffffff, 0x40c070])); gb.q([bx, y0, z1 + dd + 0.05], [bx + 0.32, y0, z1 + dd + 0.05], [bx + 0.27, y0 + 1.9, z1 + dd - 0.1], [bx + 0.05, y0 + 1.9, z1 + dd - 0.1], 'flat', c, c, { dir: [0, 0.3, 1], dbl: true }); }
  return { roofY: top + 1.5 };
}

function church(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(rng.pick([0xf4efe4, 0xf0f0ea, 0xe8d8c0, 0xe8e0d0]));
  const bw = Math.min(W - 1, 13), z1 = D / 2 - 3.6, z0 = -D / 2 + 0.6; const x0 = -bw / 2, x1 = bw / 2;
  const wh = 5.5, rise = bw * 0.3;
  // side walls with stained glass
  const side = (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(2, Math.floor(len / 4.15)); const cells = [];
    cells.push({ t: 'stucco', w: 0.6 }); for (let i = 0; i < n; i++) { cells.push({ t: 'cwin', w: 2.75 }); cells.push({ t: 'stucco', w: i === n - 1 ? 0.6 : 1.4 }); }
    strip(gb, a[0], a[1], b[0], b[1], 0, wh, cells, mulc(col, 0.85), col, 0.02);
  };
  side([x1, z1], [x1, z0]); side([x1, z0], [x0, z0]); side([x0, z0], [x0, z1]);
  gb.wall(x0, z1, x1, z1, 0, wh, 'stucco', mulc(col, 0.85), col, {});
  // door, rose window
  gb.q([-1.5, 0.3, z1 + 0.05], [1.5, 0.3, z1 + 0.05], [1.5, 4.3, z1 + 0.05], [-1.5, 4.3, z1 + 0.05], 'cdoor', [0.95, 0.95, 0.95], WHITE, { dir: [0, 0, 1] });
  const rf = C(rng.pick([0x6a5a50, 0x8a8a90, 0x7a4a3a, 0x5a6a70]));
  roofPitched(gb, x0, z0, x1, z1, wh, rise, 0.45, rng.chance(0.5) ? 'rtile' : 'shingle', rf, { gable: true, ridge: 'z', gableTile: 'stucco', gableCol: col });
  gb.q([-1.1, wh + 0.9, z1 + 0.05], [1.1, wh + 0.9, z1 + 0.05], [1.1, wh + 3.1, z1 + 0.05], [-1.1, wh + 3.1, z1 + 0.05], 'rose', WHITE, WHITE, { dir: [0, 0, 1] });
  // bell tower (front left)
  const tw = 4.8, tx0 = x0 - 0.0, tx1 = x0 + tw, tz1 = z1 + 1.0, tz0 = tz1 - tw, th = 13.5;
  for (const [a, b, c, d] of [[tx0, tz1, tx1, tz1], [tx1, tz1, tx1, tz0], [tx1, tz0, tx0, tz0], [tx0, tz0, tx0, tz1]]) gb.wall(a, b, c, d, 0, th, 'stucco', mulc(col, 0.85), col, { tw: 3, th: 3 });
  const off = 0.04;
  gb.q([tx0 + 1.3, th - 4.4, tz1 + off], [tx1 - 1.3, th - 4.4, tz1 + off], [tx1 - 1.3, th - 0.4, tz1 + off], [tx0 + 1.3, th - 4.4 + 4, tz1 + off], 'cwin', WHITE, WHITE, { dir: [0, 0, 1] });
  gb.q([tx1 + off, th - 4.4, tz1 - 1.3], [tx1 + off, th - 4.4, tz0 + 1.3], [tx1 + off, th - 0.4, tz0 + 1.3], [tx1 + off, th - 0.4, tz1 - 1.3], 'cwin', WHITE, WHITE, { dir: [1, 0, 0] });
  gb.q([tx0 - off, th - 4.4, tz0 + 1.3], [tx0 - off, th - 4.4, tz1 - 1.3], [tx0 - off, th - 0.4, tz1 - 1.3], [tx0 - off, th - 0.4, tz0 + 1.3], 'cwin', WHITE, WHITE, { dir: [-1, 0, 0] });
  ledgeRing(gb, tx0, tz0, tx1, tz1, th - 0.1, th + 0.25, 0.22, 'concrete', [0.9, 0.88, 0.84]);
  roofPitched(gb, tx0, tz0, tx1, tz1, th + 0.25, 7.0, 0.05, 'rmetal', mulc(rf, 0.8), { soffit: false, tw: 3, th: 3 });
  gb.box(tx0 + tw / 2 - 0.08, th + 7.1, tz0 + tw / 2 - 0.08, tx0 + tw / 2 + 0.08, th + 9.2, tz0 + tw / 2 + 0.08, { side: 'flat', c: [0.9, 0.85, 0.6], tw: 99, th: 99 });
  gb.box(tx0 + tw / 2 - 0.5, th + 8.3, tz0 + tw / 2 - 0.08, tx0 + tw / 2 + 0.5, th + 8.5, tz0 + tw / 2 + 0.08, { side: 'flat', c: [0.9, 0.85, 0.6], tw: 99, th: 99 });
  // steps, plinth
  stairs(gb, 0, 0, z1 + 2.4, 0, -1, 4.2, 0.3, 2.4, 3, [0.85, 0.84, 0.8]);
  ledgeRing(gb, x0, z0, x1, z1, 0, 0.3, 0.05, 'concrete', [0.78, 0.76, 0.72], { noBottom: true });
  skirt(gb, x0, z0, x1, z1); skirt(gb, tx0, tz0, tx1, tz1);
  lawnPad(gb, -W / 2 + 0.2, z1 + 2.5, W / 2 - 0.2, D / 2 - 0.2, 0.08);
  lotPad(gb, -1.4, z1 + 2.5, 1.4, D / 2 - 0.2, 0.09, { tile: 'concrete', col: [0.9, 0.88, 0.84], tw: 4, th: 4 });
  return { roofY: th + 9.3 };
}

function school(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const brick = rng.chance(0.55);
  const col = brick ? [1, 0.97, 0.94] : wallCol(rng.pick([0xf0e4c8, 0xe8d8b8, 0xd8e0d0, 0xf0e0d0]));
  const bw = Math.min(W - 1, 58), bd = Math.min(D - 7, 18);
  const x0 = -bw / 2, x1 = bw / 2, z0 = -D / 2 + 0.6, z1 = z0 + bd;
  const floors = 2, fh = 3.7, top = floors * fh;
  const gymW = Math.min(16, bw * 0.3); const hx1 = x1 - gymW;    // main block x0..hx1, gym hx1..x1
  const fam = brick ? ['bk1', 'bk0'] : ['of0', 'of2'];
  const ground = { h: fh, dark: 0.85, cell: (i, n) => (i === Math.floor(n / 2) || i === Math.floor(n / 2) - 0 ? null : null) };
  // front of the main block: door bay in the middle
  const nb = Math.max(4, Math.round((hx1 - x0) / 3.4)); const mid = Math.floor(nb / 2);
  const cellsG = []; for (let i = 0; i < nb; i++) cellsG.push(i === mid ? { t: 'cvdoor', w: 1.45 } : { t: litP(rng, rng.pick(fam), 0.3), w: 1, flip: rng.chance(0.5) });
  const cellsU = []; for (let i = 0; i < nb; i++) cellsU.push(i === mid ? { t: litP(rng, 'cv', 0.3), w: 1.45 } : { t: litP(rng, rng.pick(fam), 0.42), w: 1, flip: rng.chance(0.5) });
  strip(gb, x0, z1, hx1, z1, 0, fh, cellsG, mulc(col, 0.85), mulc(col, 0.97));
  strip(gb, x0, z1, hx1, z1, fh, top, cellsU, mulc(col, 0.96), col);
  for (const [a, b] of [[[hx1, z1], [hx1, z0]], [[hx1, z0], [x0, z0]], [[x0, z0], [x0, z1]]]) facade(gb, a, b, 0, floors, fh, { col, fam, lit: 0.4, bay: 3.4 });
  ledgeRing(gb, x0, z0, hx1, z1, fh - 0.15, fh + 0.1, 0.12, 'concrete', [0.88, 0.86, 0.82]);
  ledgeRing(gb, x0, z0, hx1, z1, 0, 0.35, 0.05, 'concrete', [0.75, 0.74, 0.7], { noBottom: true });
  const r = roofFlat(gb, x0, z0, hx1, z1, top, { ph: 0.7, col, wall: brick ? 'brick' : 'stucco' });
  rooftop(gb, rng, x0 + 1, z0 + 1, hx1 - 1, z1 - 1, top, 3, { noTank: true });
  // gym block
  const gh = 8.0; const gcol = brick ? [0.95, 0.9, 0.86] : mulc(col, 0.95);
  for (const [a, b, c, d] of [[hx1, z1, x1, z1], [x1, z1, x1, z0], [x1, z0, hx1, z0]]) { gb.wall(a, b, c, d, 0, 2.2, 'brick', mulc(gcol, 0.8), gcol, { tw: 2.4, th: 2.1 }); gb.wall(a, b, c, d, 2.2, gh, 'corrug', mulc(C(0xc8c0a8), 0.85), C(0xc8c0a8), { tw: 4, th: 4 }); }
  gb.wall(hx1, z0, hx1, z1, 0, gh, 'stucco', mulc(col, 0.85), col, {});
  facade(gb, [hx1 + 1, z1 + 0.04], [x1 - 1, z1 + 0.04], 5.0, 1, 2.4, { col: [0.9, 0.9, 0.9], fam: ['of2'], lit: 0.25, bay: 4 });
  gb.q([hx1 + gymW / 2 - 2.0, 0.05, z1 + 0.05], [hx1 + gymW / 2 + 2.0, 0.05, z1 + 0.05], [hx1 + gymW / 2 + 2.0, 4.2, z1 + 0.05], [hx1 + gymW / 2 - 2.0, 4.2, z1 + 0.05], 'rol', [0.8, 0.8, 0.85], [0.9, 0.9, 0.95], { dir: [0, 0, 1] });
  roofFlat(gb, hx1, z0, x1, z1, gh, { ph: 0.6, col: [0.7, 0.68, 0.64], wall: 'concrete' });
  // portico over the door
  const dcx = x0 + (hx1 - x0) * ((mid + 0.725) / (nb + 0.45));
  gb.box(dcx - 3.6, 4.4, z1, dcx + 3.6, 4.85, z1 + 2.8, { side: 'flat', top: 'gravel', c: [0.85, 0.83, 0.78], ct: [0.6, 0.6, 0.58], tw: 99, th: 99 });
  for (const sx of [-3.3, 3.3]) gb.box(dcx + sx - 0.17, 0, z1 + 2.4, dcx + sx + 0.17, 4.4, z1 + 2.74, { side: 'concrete', c: [0.9, 0.88, 0.84], tw: 99, th: 99 });
  signPanel(gb, dcx, 5.3, z1 + 2.81, 5.6, 'sg_SCHOOL', 0, { off: 0.0, h: 1.0 });
  gb.box(dcx - 3.6, 4.85, z1 + 2.7, dcx + 3.6, 5.85, z1 + 2.8, { side: 'flat', c: [0.2, 0.3, 0.25], tw: 99, th: 99, no: 'rblt' });
  skirt(gb, x0, z0, x1, z1);
  lawnPad(gb, -W / 2 + 0.2, z1 + 0.2, W / 2 - 0.2, D / 2 - 0.2, 0.08);
  lotPad(gb, dcx - 1.8, z1 + 0.2, dcx + 1.8, D / 2 - 0.2, 0.09, { tile: 'concrete', col: [0.9, 0.88, 0.84], tw: 4, th: 4 });
  // flagpole
  const fx = dcx + 6.5, fz = z1 + 4.0;
  pole(gb, fx, 0, fz, 9.0, 0.06, [0.85, 0.85, 0.85]); gb.q([fx, 8.9, fz], [fx + 1.6, 8.9, fz], [fx + 1.6, 7.9, fz], [fx, 7.9, fz], 'flat', C(0xc02030), C(0xc02030), { dir: [0, 0, 1], dbl: true }); gb.q([fx, 8.9, fz], [fx + 0.7, 8.9, fz + 0.01], [fx + 0.7, 8.4, fz + 0.01], [fx, 8.4, fz], 'flat', C(0x2030a0), C(0x2030a0), { dir: [0, 0, 1], dbl: true });
  return { roofY: Math.max(r, gh + 0.6) };
}

function hospital(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = C(rng.pick([0xf0f0ee, 0xe8ecee, 0xf0e8e0, 0xe0e8ec]));
  const bw = Math.min(W - 1, 66), bd = Math.min(D - 9, 26);
  const x0 = -bw / 2, x1 = bw / 2, z0 = -D / 2 + 0.6, z1 = z0 + bd;
  const podF = 3, podFh = 4.2, podTop = podF * podFh;
  const A = [[[x0, z1], [x1, z1]], [[x1, z1], [x1, z0]], [[x1, z0], [x0, z0]], [[x0, z0], [x0, z1]]];
  A.forEach(([a, b], k) => {
    facade(gb, a, b, 0, 1, podFh, { col, fam: ['shop5'], lit: 0, bay: 3.4, pick: (f, i, n) => (k === 0 && i === Math.floor(n / 2) ? 'shop1' : (k === 0 ? 'shop5' : (rng.chance(0.4) ? 'stucco' : 'shop5'))) });
    facade(gb, a, b, podFh, podF - 1, podFh, { col, fam: ['of2'], lit: 0.45, bay: 3.4 });
  });
  ledgeRing(gb, x0, z0, x1, z1, podTop - 0.05, podTop + 0.35, 0.3, 'concrete', [0.9, 0.9, 0.88]);
  roofFlat(gb, x0, z0, x1, z1, podTop + 0.35, { ph: 0.6, col, wall: 'concrete' });
  // tower
  const tx0 = -bw * 0.26, tx1 = bw * 0.26, tz0 = z0 + 2, tz1 = z0 + bd * 0.62;
  const tF = clamp(Math.round(B.h / 3.8) - podF, 4, 10), tfh = 3.8;
  const tt = towerMass(gb, rng, tx0, tz0, tx1, tz1, podTop + 0.35, tF, tfh, 'concrete', col, { fam: ['of2'], lit: 0.45 });
  ledgeRing(gb, tx0, tz0, tx1, tz1, tt - 0.05, tt + 0.3, 0.2, 'concrete', [0.9, 0.9, 0.88]);
  const roofY = roofFlat(gb, tx0, tz0, tx1, tz1, tt + 0.3, { ph: 0.8, col, wall: 'concrete' });
  rooftop(gb, rng, tx0 + 1, tz0 + 1, tx1 - 1, tz1 - 1, tt + 0.3, 3, { noTank: true });
  // signage
  signPanel(gb, 0, podTop - 1.2, z1, 10, 'sg_HOSPITAL', 0, { off: 0.4 });
  for (const f of [0, 1, 3]) { const hx = (tx1 - tx0) / 2, hz = (tz1 - tz0) / 2; const cxs = (tx0 + tx1) / 2, czs = (tz0 + tz1) / 2; const F = frameOf(f, cxs, czs); const off = (f % 2 === 0 ? hz : hx) + 0.08; signPanel(gb, cxs, tt - 6.0, czs, 5.2, 'ic_cross', f, { off, h: 5.2 }); }
  // entrance canopy
  gb.box(-5, 4.2, z1, 5, 4.6, z1 + 4.5, { side: 'flat', top: 'gravel', c: [0.85, 0.15, 0.15], ct: [0.6, 0.6, 0.58], tw: 99, th: 99 });
  for (const sx of [-4.6, 4.6]) pole(gb, sx, 0, z1 + 4.2, 4.2, 0.12, [0.85, 0.85, 0.85]);
  // ER canopy (right)
  gb.box(x1 - 14, 4.6, z1, x1 - 2, 5.0, z1 + 5.0, { side: 'flat', top: 'gravel', c: [0.85, 0.15, 0.15], ct: [0.6, 0.6, 0.58], tw: 99, th: 99 });
  for (const sx of [x1 - 13.5, x1 - 2.5]) pole(gb, sx, 0, z1 + 4.6, 4.6, 0.12, [0.85, 0.85, 0.85]);
  glowBar(gb, x1 - 14, 4.55, z1 + 4.9, x1 - 2, 4.62, z1 + 5.05, 'gw_r');
  // helipad on the podium roof
  const hs = clamp(z1 - tz1 - 2.0, 6, 11), hx0 = x0 + 4, hz1 = z1 - 1.0; gb.flat(hx0, hz1 - hs, hx0 + hs, hz1, podTop + 0.4, 'helipad', WHITE);
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.2, z1 + 0.05, W / 2 - 0.2, D / 2 - 0.15, 0.06, { tile: 'concrete', col: [0.85, 0.83, 0.8], tw: 4, th: 4 });
  return { roofY };
}

function policeStation(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = C(rng.pick([0x9aaabe, 0xb8c0c8, 0xa8b0a8, 0xc8c0b0]));
  const bw = Math.min(W - 2, 32), bd = Math.min(D - 9, 20);
  const x0 = -bw / 2, x1 = bw / 2, z0 = -D / 2 + 0.6, z1 = z0 + bd;
  const floors = 3, fh = 3.8, gh = 4.4, top = gh + (floors - 1) * fh;
  const nb = Math.max(4, Math.round(bw / 3.6)); const mid = Math.floor(nb / 2);
  const cellsG = []; for (let i = 0; i < nb; i++) cellsG.push(i === mid ? { t: 'cvdoor', w: 1.4 } : { t: rng.chance(0.3) ? 'stucco' : 'shop5', w: 1 });
  strip(gb, x0, z1, x1, z1, 0, gh, cellsG, mulc(col, 0.85), mulc(col, 0.97));
  facade(gb, [x0, z1], [x1, z1], gh, floors - 1, fh, { col, fam: ['of0', 'of1'], lit: 0.45, bay: 3.6 });
  for (const [a, b] of [[[x1, z1], [x1, z0]], [[x1, z0], [x0, z0]], [[x0, z0], [x0, z1]]]) {
    facade(gb, a, b, 0, 1, gh, { col, fam: ['stucco'], bay: 3.6, pick: () => null });
    facade(gb, a, b, gh, floors - 1, fh, { col, fam: ['of0', 'of1'], lit: 0.4, bay: 3.6 });
  }
  ledgeRing(gb, x0, z0, x1, z1, gh - 0.2, gh + 0.05, 0.14, 'concrete', [0.85, 0.85, 0.85]);
  ledgeRing(gb, x0, z0, x1, z1, top - 0.05, top + 0.3, 0.25, 'concrete', [0.85, 0.85, 0.85]);
  const r = roofFlat(gb, x0, z0, x1, z1, top + 0.3, { ph: 0.7, col, wall: 'concrete' });
  const dcx = x0 + bw * ((mid + 0.7) / (nb + 0.4));
  gb.box(dcx - 3.4, 4.6, z1, dcx + 3.4, 5.0, z1 + 2.6, { side: 'flat', top: 'gravel', c: [0.12, 0.2, 0.42], ct: [0.6, 0.6, 0.58], tw: 99, th: 99 });
  for (const sx of [-3.1, 3.1]) gb.box(dcx + sx - 0.2, 0, z1 + 2.2, dcx + sx + 0.2, 4.6, z1 + 2.55, { side: 'concrete', c: [0.88, 0.88, 0.88], tw: 99, th: 99 });
  signPanel(gb, dcx, top - 0.3, z1, 8, 'sg_POLICE', 0, { off: 0.3 });
  for (const sx of [-2.6, 2.6]) gb.box(dcx + sx - 0.22, 2.4, z1 + 0.05, dcx + sx + 0.22, 3.1, z1 + 0.5, { side: 'gw_b', c: WHITE, tw: 99, th: 99 });
  stairs(gb, dcx, 0, z1 + 4.6, 0, -1, 4.5, 0.5, 1.8, 3, [0.85, 0.84, 0.8]);
  // antenna mast w/ dish
  const mx = x1 - 3, mz = z0 + 3;
  cyl(gb, mx, mz, top + 0.3, top + 12, 0.25, 0.12, 6, 'rmetal', [0.6, 0.6, 0.62], [0.7, 0.7, 0.72], { th: 99 }); gb.box(mx - 0.6, top + 9, mz - 0.1, mx + 0.6, top + 9.8, mz + 0.1, { side: 'flat', c: [0.85, 0.85, 0.85], tw: 99, th: 99 });
  gb.box(mx - 0.2, top + 12, mz - 0.2, mx + 0.2, top + 12.4, mz + 0.2, { side: 'gw_r', c: WHITE, tw: 99, th: 99 });
  rooftop(gb, rng, x0 + 1, z0 + 1, x1 - 6, z1 - 1, top + 0.3, 3, { noTank: true });
  // flagpoles
  for (const sx of [-1, 1]) pole(gb, dcx + sx * 7.5, 0, z1 + 4.0, 8.0, 0.06, [0.85, 0.85, 0.85]);
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.2, z1 + 0.05, W / 2 - 0.2, D / 2 - 0.15, 0.06);
  return { roofY: top + 12.4 };
}

function cityHall(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = C(rng.pick([0xf0e8d4, 0xe8dcc0, 0xf4efe0, 0xe0d8c8]));
  const bw = Math.min(W - 2, 58), bd = Math.min(D - 12, 30);
  const x0 = -bw / 2, x1 = bw / 2, z0 = -D / 2 + 0.6, z1 = z0 + bd;
  const fh = 4.8, wF = 3, cF = 4;
  const cw = bw * 0.36, cx0 = -cw / 2, cx1 = cw / 2;
  const wingTop = wF * fh, cTop = cF * fh;
  // wings
  for (const sg of [-1, 1]) {
    const wa = sg < 0 ? x0 : cx1, wb = sg < 0 ? cx0 : x1;
    facade(gb, [wa, z1], [wb, z1], 0, wF, fh, { col, fam: ['cv'], lit: 0.42, bay: 3.6 });
    facade(gb, sg < 0 ? [x0, z0] : [x1, z1], sg < 0 ? [x0, z1] : [x1, z0], 0, wF, fh, { col, fam: ['cv'], lit: 0.4, bay: 3.6 });
    gb.wall(sg < 0 ? cx0 : cx1, z1, sg < 0 ? cx0 : cx1, z1 - bd * 0.1, 0, wingTop, 'stone', mulc(col, 0.85), col, {});
    ledgeRing(gb, sg < 0 ? x0 : cx1, z0, sg < 0 ? cx0 : x1, z1, wingTop - 0.1, wingTop + 0.3, 0.3, 'concrete', [0.93, 0.9, 0.85]);
    roofFlat(gb, sg < 0 ? x0 : cx1, z0, sg < 0 ? cx0 : x1, z1, wingTop + 0.3, { ph: 0.8, col, wall: 'stone' });
  }
  facade(gb, [x1, z0], [x0, z0], 0, cF, fh, { col, fam: ['cv'], lit: 0.4, bay: 3.6 });
  // centre block: set back behind the colonnade
  const cz1 = z1 - 1.0;
  facade(gb, [cx0, cz1], [cx1, cz1], 0, cF, fh, { col, fam: ['cv'], lit: 0.45, bay: 3.6, ground: { h: fh, dark: 0.85, cell: (i, n) => (i === Math.floor(n / 2) ? { t: 'cvdoor', w: 1.3 } : null) } });
  for (const sx of [cx0, cx1]) facade(gb, sx < 0 ? [sx, z0] : [sx, cz1], sx < 0 ? [sx, cz1] : [sx, z0], wingTop + 0.3, cF - wF, fh, { col, fam: ['cv'], lit: 0.4, bay: 3.6 });
  ledgeRing(gb, cx0, z0, cx1, cz1, cTop - 0.1, cTop + 0.35, 0.35, 'concrete', [0.93, 0.9, 0.85]);
  roofFlat(gb, cx0, z0, cx1, cz1, cTop + 0.35, { ph: 0.6, col, wall: 'stone' });
  // colonnade
  const pz1 = z1 + 4.2, colH = 2 * fh + 1.0, nc = 8, cwid = cw * 1.1;
  gb.box(-cwid / 2 - 1, -0.2, z1 - 0.5, cwid / 2 + 1, 0.4, pz1 + 1.2, { side: 'stone', top: 'concrete', c: [0.92, 0.9, 0.85], ct: [0.92, 0.9, 0.85], tw: 3, th: 3, no: 'b' });
  for (let i = 0; i < nc; i++) { const cx = -cwid / 2 + cwid * i / (nc - 1); cyl(gb, cx, pz1 - 0.2, 0.4, colH, 0.55, 0.46, 12, 'stone', [0.92, 0.9, 0.85], [0.98, 0.96, 0.92], { th: 3 }); gb.box(cx - 0.7, colH, pz1 - 0.9, cx + 0.7, colH + 0.3, pz1 + 0.5, { side: 'concrete', c: [0.94, 0.92, 0.88], tw: 99, th: 99 }); gb.box(cx - 0.7, 0.4, pz1 - 0.9, cx + 0.7, 0.8, pz1 + 0.5, { side: 'concrete', c: [0.9, 0.88, 0.84], tw: 99, th: 99 }); }
  gb.box(-cwid / 2 - 0.8, colH + 0.3, z1 - 0.5, cwid / 2 + 0.8, colH + 1.3, pz1 + 0.8, { side: 'stone', top: 'concrete', c: [0.95, 0.93, 0.88], ct: [0.93, 0.9, 0.85], tw: 99, th: 99 });
  signPanel(gb, 0, colH + 0.8, pz1 + 0.85, Math.min(cwid * 0.5, 10), 'sg_CITYHALL', 0, { off: 0.0, h: 0.9 });
  roofPitched(gb, -cwid / 2 - 0.6, z1 - 0.5, cwid / 2 + 0.6, pz1 + 0.6, colH + 1.3, 3.0, 0.15, 'rmetal', [0.6, 0.65, 0.62], { gable: true, ridge: 'z', gableTile: 'stone', gableCol: col, soffit: false });
  stairs(gb, 0, 0, pz1 + 4.8, 0, -1, cwid * 0.85, 0.4, 3.6, 4, [0.9, 0.88, 0.84]);
  // rotunda + dome
  const cy = cTop + 0.95; const dr = Math.min(7.0, cw * 0.36);
  cyl(gb, 0, (z0 + cz1) / 2, cy, cy + 5.0, dr, dr, 16, 'stone', [0.9, 0.88, 0.84], [0.98, 0.96, 0.92], { th: 3 });
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; const sx = Math.sin(a) * (dr + 0.03), sz = (z0 + cz1) / 2 + Math.cos(a) * (dr + 0.03); const hw = 0.5; const rx = Math.cos(a), rz = -Math.sin(a); gb.q([sx - rx * hw, cy + 1.3, sz - rz * hw], [sx + rx * hw, cy + 1.3, sz + rz * hw], [sx + rx * hw, cy + 3.8, sz + rz * hw], [sx - rx * hw, cy + 3.8, sz - rz * hw], 'cvdoor', [0.5, 0.6, 0.7], [0.6, 0.7, 0.8], { dir: [Math.sin(a), 0, Math.cos(a)], v: [0.3, 1], u: [0.15, 0.85] }); }
  ledgeRing(gb, -dr, (z0 + cz1) / 2 - dr, dr, (z0 + cz1) / 2 + dr, cy + 4.6, cy + 5.1, 0.25, 'concrete', [0.94, 0.92, 0.88]);
  const dc = C(rng.pick([0x6aa89a, 0x5a9a8a, 0xc8a84a])); dome(gb, 0, cy + 5.1, (z0 + cz1) / 2, dr * 0.96, 18, 6, 'flat', mulc(dc, 0.8), mulc(dc, 1.15));
  cyl(gb, 0, (z0 + cz1) / 2, cy + 5.1 + dr * 0.96, cy + 5.1 + dr * 0.96 + 2.0, 0.7, 0.5, 8, 'stone', [0.9, 0.88, 0.84], [0.95, 0.93, 0.9], { th: 99 });
  cyl(gb, 0, (z0 + cz1) / 2, cy + 7.1 + dr * 0.96, cy + 7.6 + dr * 0.96, 0.5, 0.05, 8, 'flat', [0.85, 0.7, 0.3], [0.9, 0.75, 0.3], { th: 99 });
  pole(gb, 0, cy + 7.6 + dr * 0.96, (z0 + cz1) / 2, cy + 11 + dr * 0.96, 0.05, [0.85, 0.85, 0.85]);
  skirt(gb, x0, z0, x1, z1);
  lawnPad(gb, -W / 2 + 0.2, pz1 + 1.4, W / 2 - 0.2, D / 2 - 0.2, 0.08);
  return { roofY: cy + 11 + dr * 0.96 };
}

function bank(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = C(rng.pick([0xe8dcc8, 0xe0d8c8, 0xd8d0c0, 0xf0e8d8, 0xc8ccd0]));
  const bw = Math.min(W - 2, 22), bd = Math.min(D - 8, 18);
  const x0 = -bw / 2, x1 = bw / 2, z0 = -D / 2 + 0.6, z1 = z0 + bd;
  const fh = 4.8, floors = 2, top = floors * fh;
  facade(gb, [x0, z1], [x1, z1], 0, floors, fh, { col, fam: ['cv'], lit: 0.45, bay: 3.6, ground: { h: fh, dark: 0.85, cell: (i, n) => (i === Math.floor(n / 2) ? { t: 'cvdoor', w: 1.3 } : null) } });
  for (const [a, b] of [[[x1, z1], [x1, z0]], [[x1, z0], [x0, z0]], [[x0, z0], [x0, z1]]]) facade(gb, a, b, 0, floors, fh, { col, fam: ['cv'], lit: 0.4, bay: 3.6 });
  ledgeRing(gb, x0, z0, x1, z1, top - 0.1, top + 0.4, 0.4, 'concrete', [0.93, 0.9, 0.85]);
  const r = roofFlat(gb, x0, z0, x1, z1, top + 0.4, { ph: 0.6, col, wall: 'stone' });
  const pz1 = z1 + 3.4, colH = top - 0.9, nc = 4, pw = bw * 0.72;
  gb.box(-pw / 2 - 0.6, -0.2, z1 - 0.1, pw / 2 + 0.6, 0.4, pz1 + 0.9, { side: 'stone', top: 'concrete', c: [0.92, 0.9, 0.85], ct: [0.92, 0.9, 0.85], tw: 3, th: 3, no: 'b' });
  for (let i = 0; i < nc; i++) { const cx = -pw / 2 + pw * i / (nc - 1); cyl(gb, cx, pz1 - 0.2, 0.4, colH, 0.5, 0.42, 12, 'stone', [0.92, 0.9, 0.85], [0.98, 0.96, 0.92], { th: 3 }); gb.box(cx - 0.6, colH, pz1 - 0.8, cx + 0.6, colH + 0.3, pz1 + 0.4, { side: 'concrete', c: [0.94, 0.92, 0.88], tw: 99, th: 99 }); }
  gb.box(-pw / 2 - 0.5, colH + 0.3, z1 - 0.1, pw / 2 + 0.5, colH + 1.4, pz1 + 0.6, { side: 'stone', top: 'concrete', c: [0.95, 0.93, 0.88], ct: [0.93, 0.9, 0.85], tw: 99, th: 99 });
  signPanel(gb, 0, colH + 0.85, pz1 + 0.63, Math.min(pw * 0.42, 6), 'sg_BANK', 0, { off: 0.0, h: 0.8 });
  roofPitched(gb, -pw / 2 - 0.4, z1 - 0.1, pw / 2 + 0.4, pz1 + 0.4, colH + 1.4, 1.5, 0.12, 'rmetal', [0.6, 0.62, 0.64], { gable: true, ridge: 'z', gableTile: 'stone', gableCol: col, soffit: false });
  stairs(gb, 0, 0, pz1 + 3.6, 0, -1, pw * 0.8, 0.4, 2.8, 3, [0.9, 0.88, 0.84]);
  rooftop(gb, rng, x0 + 1, z0 + 1, x1 - 1, z1 - 1, top + 0.4, 2, { noTank: true });
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.2, z1 + 4.4, W / 2 - 0.2, D / 2 - 0.15, 0.06);
  return { roofY: r };
}

function terminal(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = C(rng.pick([0xe8eef2, 0xf0f0ee, 0xdce6ee]));
  const bw = W - 2.3, z1 = D / 2 - 9.5, z0 = -D / 2 + 9; const x0 = -bw / 2, x1 = bw / 2;
  const h1 = 6.4, h2 = 5.6, top = h1 + h2;
  const glass = [0.78, 0.88, 1.0];
  const A = [[[x0, z1], [x1, z1]], [[x1, z1], [x1, z0]], [[x1, z0], [x0, z0]], [[x0, z0], [x0, z1]]];
  A.forEach(([a, b], k) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(2, Math.round(len / 4.5));
    const mkc = () => { const c = []; for (let i = 0; i < n; i++) c.push({ t: litP(rng, 'gbg', 0.6), w: 1, flip: rng.chance(0.5), col: k === 1 || k === 3 ? [0.85, 0.85, 0.85] : glass }); return c; };
    strip(gb, a[0], a[1], b[0], b[1], 0, h1, mkc(), mulc(col, 0.85), col); strip(gb, a[0], a[1], b[0], b[1], h1, top, mkc(), mulc(col, 0.92), col);
  });
  // roof slab with overhang, mech
  gb.box(x0 - 1, top, z0 - 1, x1 + 1, top + 0.7, z1 + 1.2, { side: 'flat', top: 'rmetal', c: [0.93, 0.93, 0.93], ct: [0.85, 0.87, 0.9], tw: 99, th: 99 });
  // drop-off canopy
  gb.box(x0 + 2, h1 - 0.35, z1, x1 - 2, h1 + 0.25, z1 + 8.0, { side: 'flat', top: 'rmetal', c: [0.93, 0.93, 0.93], ct: [0.85, 0.87, 0.9], tw: 99, th: 99 });
  const nco = Math.max(3, Math.round((x1 - x0 - 4) / 12));
  for (let i = 0; i <= nco; i++) { const cx = lerp(x0 + 3, x1 - 3, i / nco); cyl(gb, cx, z1 + 7.4, 0, h1 - 0.35, 0.3, 0.3, 8, 'concrete', [0.85, 0.85, 0.85], [0.9, 0.9, 0.9], { th: 99 }); }
  glowBar(gb, x0 + 2, h1 - 0.42, z1 + 7.9, x1 - 2, h1 - 0.35, z1 + 8.05, 'gw_w');
  for (let i = 0; i < nco * 2; i++) { const cx = lerp(x0 + 6, x1 - 6, i / Math.max(1, nco * 2 - 1)); gb.q([cx - 0.6, h1 - 0.36, z1 + 4.6], [cx + 0.6, h1 - 0.36, z1 + 4.6], [cx + 0.6, h1 - 0.36, z1 + 3.4], [cx - 0.6, h1 - 0.36, z1 + 3.4], 'gw_w', WHITE, WHITE, { down: true }); }
  signPanel(gb, 0, top + 0.35 + 1.4, z1 + 1.2, Math.min(bw * 0.3, 18), 'sg_AIRPORT', 0, { off: 0.0 });
  gb.box(-Math.min(bw * 0.15, 9) - 0.4, top + 0.7, z1 + 1.0, Math.min(bw * 0.15, 9) + 0.4, top + 0.7 + 0.0, z1 + 1.1, { side: 'flat', c: WHITE, tw: 99, th: 99 });
  // airside gate fingers
  const nf = Math.max(2, Math.round(bw / 22));
  for (let i = 0; i < nf; i++) { const fx = lerp(x0 + 10, x1 - 10, nf === 1 ? 0.5 : i / (nf - 1)); gb.box(fx - 2, 2.6, -D / 2 + 0.6, fx + 2, 5.6, z0, { side: 'cw2d', c: [0.75, 0.82, 0.9], top: 'rmetal', ct: [0.8, 0.82, 0.85], tw: 6, th: 7.2 }); }
  // control tower
  const tx = x1 - 10, tz = z1 - 6;
  gb.box(tx - 2.2, top + 0.7, tz - 2.2, tx + 2.2, top + 26, tz + 2.2, { side: 'concrete', top: 'concrete', c: [0.88, 0.87, 0.84], tw: 4, th: 4 });
  gb.box(tx - 4, top + 26, tz - 4, tx + 4, top + 26.4, tz + 4, { side: 'flat', c: [0.8, 0.8, 0.8], tw: 99, th: 99 });
  gb.box(tx - 3.4, top + 26.4, tz - 3.4, tx + 3.4, top + 30.2, tz + 3.4, { side: 'cw2l', c: [0.7, 0.85, 1.0], top: 'flat', ct: [0.7, 0.7, 0.72], tw: 6.8, th: 7.2 });
  gb.box(tx - 4, top + 30.2, tz - 4, tx + 4, top + 30.7, tz + 4, { side: 'flat', top: 'rmetal', c: [0.9, 0.9, 0.9], ct: [0.85, 0.85, 0.88], tw: 99, th: 99 });
  antenna(gb, tx, top + 30.7, tz, 6);
  rooftop(gb, rng, x0 + 2, z0 + 2, x1 - 18, z1 - 2, top + 0.7, 6, { noTank: true });
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.3, z1 + 8.2, W / 2 - 0.3, D / 2 - 0.2, 0.05, { tile: 'concrete', col: [0.85, 0.83, 0.8], tw: 4, th: 4 });
  return { roofY: top + 37 };
}

function archRoof(gb, x0, x1, z0, z1, y, rise, segs, tile, col, capTile, capCol) {
  const hw = (x1 - x0) / 2, cx = (x0 + x1) / 2; const pts = [];
  for (let i = 0; i <= segs; i++) { const a = Math.PI * i / segs; pts.push([cx - Math.cos(a) * hw, y + Math.sin(a) * rise]); }
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[i + 1]; const c = mixc(mulc(col, 0.85), col, Math.sin(Math.PI * (i + 0.5) / segs));
    gb.qt([a[0], a[1], z1], [b[0], b[1], z1], [b[0], b[1], z0], [a[0], a[1], z0], tile, c, c, { up: true, tw: 3, th: 3 });
    gb.tri([cx, y, z1], [a[0], a[1], z1], [b[0], b[1], z1], capTile, capCol, [[0.5, 0.2], [0, 0.3], [1, 0.3]], { dir: [0, 0, 1] });
    gb.tri([cx, y, z0], [b[0], b[1], z0], [a[0], a[1], z0], capTile, capCol, [[0.5, 0.2], [0, 0.3], [1, 0.3]], { dir: [0, 0, -1] });
  }
}
function hangar(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = wallCol(rng.pick([0xd8dadc, 0xc8ccd0, 0xd0d4c8, 0xb8c0c8]));
  const bw = W - 2, z1 = D / 2 - 6, z0 = -D / 2 + 0.6; const x0 = -bw / 2, x1 = bw / 2;
  const wh = 8.5, rise = Math.min(8, bw * 0.16);
  const cb = mulc(col, 0.82);
  // side & back walls
  for (const [a, b, c, d] of [[x1, z1, x1, z0], [x1, z0, x0, z0], [x0, z0, x0, z1]]) { gb.wall(a, b, c, d, 0, 1.4, 'concrete', mulc([0.75, 0.74, 0.72], 0.8), [0.75, 0.74, 0.72], { tw: 4, th: 4 }); gb.wall(a, b, c, d, 1.4, wh, 'corrug', cb, col, { tw: 4, th: 5.5 }); }
  // front: big door
  const dw = bw * 0.84, dh = wh - 0.4; const dx0 = -dw / 2, dx1 = dw / 2;
  gb.qt([dx0, 0, z1 + 0.05], [dx1, 0, z1 + 0.05], [dx1, dh, z1 + 0.05], [dx0, dh, z1 + 0.05], 'hangar', [0.85, 0.85, 0.85], [0.97, 0.97, 0.97], { dir: [0, 0, 1], tw: 12, th: 99 });
  gb.wall(x0, z1, dx0, z1, 0, wh, 'corrug', cb, col, { tw: 4, th: 5.5 }); gb.wall(dx1, z1, x1, z1, 0, wh, 'corrug', cb, col, { tw: 4, th: 5.5 });
  gb.wall(dx0, z1, dx1, z1, dh, wh, 'corrug', cb, col, { tw: 4, th: 5.5 });
  archRoof(gb, x0, x1, z0, z1 + 0.6, wh, rise, 12, 'rmetal', mulc(C(rng.pick([0xc8ccd0, 0xb8bcc4, 0xd0d0cc])), 1), 'corrug', col);
  // lean-to offices on one side
  const left = rng.chance(0.5); const ox0 = left ? x0 - 0 : x1 - 9, ox1 = ox0 + 9, oz1 = z1 - 0, oz0 = z1 - 14;
  gb.box(ox0, 0, oz0, ox1, 3.8, oz1, { side: 'stucco', top: 'gravel', c: [0.92, 0.9, 0.86], ct: [0.55, 0.55, 0.52], tw: 3, th: 3, no: 'b' });
  gb.wall(ox0, oz1 + 0.03, ox1, oz1 + 0.03, 0, 3.8, 'shop0', [0.85, 0.85, 0.85], [0.97, 0.97, 0.97], { tw: 4.5, th: 3.8, dir: [0, 0, 1] });
  signPanel(gb, (ox0 + ox1) / 2, 3.3, oz1 + 0.06, 3.6, 'sg_AUTO', 0, { off: 0.0, h: 0.0 || undefined });
  // beacon lights
  for (const sx of [x0 + 1, x1 - 1]) gb.box(sx - 0.25, wh + rise - 0.2 - (rise * 0.0), (z0 + z1) / 2 - 0.25, sx + 0.25, wh + rise + 0.2, (z0 + z1) / 2 + 0.25, { side: 'flat', c: [0.5, 0.5, 0.5], tw: 99, th: 99 });
  for (const sx of [dx0 - 1.2, dx1 + 1.2]) gb.box(sx - 0.3, wh - 1, z1 + 0.05, sx + 0.3, wh - 0.2, z1 + 0.4, { side: 'gw_w', c: WHITE, tw: 99, th: 99 });
  skirt(gb, x0, z0, x1, z1);
  lotPad(gb, -W / 2 + 0.3, z1 + 0.5, W / 2 - 0.3, D / 2 - 0.2, 0.05, { tile: 'concrete', col: [0.78, 0.77, 0.74], tw: 4, th: 4 });
  return { roofY: wh + rise };
}

function parkingGarage(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const col = C(rng.pick([0xd8d4ca, 0xc8c4ba, 0xe0dcd0, 0xb8b4aa]));
  const floors = clamp(Math.round(B.h / 3.1), 3, 7), fh = 3.1;
  const x0 = -W / 2 + 0.3, x1 = W / 2 - 0.3, z0 = -D / 2 + 0.3, z1 = D / 2 - 0.3;
  const top = floors * fh;
  const A = [[[x0, z1], [x1, z1]], [[x1, z1], [x1, z0]], [[x1, z0], [x0, z0]], [[x0, z0], [x0, z1]]];
  A.forEach(([a, b], k) => facade(gb, a, b, 0, floors, fh, { col, fam: ['pk'], bay: 4, pick: (f, i, n) => (f === 0 && k === 0 && i === Math.floor(n / 2) ? 'shop5' : null) }));
  for (let f = 1; f <= floors; f++) ledgeRing(gb, x0, z0, x1, z1, f * fh - 0.25, f * fh + (f === floors ? 0.0 : 0.05), 0.1, 'concrete', mulc(col, 0.95), { noBottom: f !== floors });
  const r = roofFlat(gb, x0, z0, x1, z1, top, { ph: 1.0, col, wall: 'concrete', deckTile: 'asphalt', deck: [0.85, 0.85, 0.85] });
  // stair/lift core
  const cx = x1 - 5, cz = z1 - 5; gb.box(cx - 2.2, top, cz - 2.2, cx + 2.2, top + 3.6, cz + 2.2, { side: 'concrete', top: 'gravel', c: [0.85, 0.83, 0.8], ct: [0.55, 0.55, 0.52], tw: 4, th: 4 });
  gb.wall(cx - 1.6, cz + 2.23, cx + 1.6, cz + 2.23, top, top + 3.2, 'cw1d', [0.8, 0.9, 1], [0.9, 0.95, 1], { tw: 99, th: 99, dir: [0, 0, 1] });
  // roof cars + light poles
  for (let i = 0; i < 8; i++) { const px = rng.range(x0 + 4, x1 - 4), pz = rng.range(z0 + 4, z1 - 8); if (Math.abs(px - cx) < 5 && Math.abs(pz - cz) < 5) continue; const c = C(rng.pick([0xc83030, 0x2050b8, 0xe8e8e8, 0x202020, 0xd8c030, 0x30a060])); const vertical = rng.chance(0.5); const sx = vertical ? 0.95 : 2.2, sz = vertical ? 2.2 : 0.95; gb.box(px - sx, top, pz - sz, px + sx, top + 1.0, pz + sz, { side: 'flat', top: 'flat', c, ct: mulc(c, 0.85), tw: 99, th: 99 }); gb.box(px - sx * 0.7, top + 1.0, pz - sz * 0.7, px + sx * 0.7, top + 1.45, pz + sz * 0.7, { side: 'flat', top: 'flat', c: mulc(c, 0.6), ct: [0.05, 0.05, 0.08], tw: 99, th: 99 }); }
  for (const [sx, sz] of [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]]) { const px = sx * W, pz = sz * D; pole(gb, px, top, pz, top + 5.0, 0.08, [0.4, 0.4, 0.42]); gb.box(px - 0.5, top + 5.0, pz - 0.15, px + 0.5, top + 5.15, pz + 0.15, { side: 'gw_w', c: WHITE, tw: 99, th: 99 }); }
  signPanel(gb, (x0 + x1) / 2, floors * fh - 0.9, z1, Math.min(4.5, W * 0.3), 'sg_H24', 0, { off: 0.14 });
  skirt(gb, x0, z0, x1, z1);
  return { roofY: top + 5.2 };
}

function stadium(B) {
  const { gb, rng } = B; const W = B.w, D = B.d;
  const Rx = W / 2 - 0.5, Rz = D / 2 - 0.5; const N = 40;
  const S = Math.min(46, 0.42 * Math.min(Rx, Rz));            // stand depth from the outer wall to the pitch side
  const E = (d, a, y) => [(Rx - d) * Math.cos(a), y, (Rz - d) * Math.sin(a)];
  const ang = (i) => (i / N) * Math.PI * 2;
  const rad = (a) => [Math.cos(a) / Rx, 0, Math.sin(a) / Rz];
  const inw = (a) => rad(a).map((v) => -v);
  const conc = [0.78, 0.77, 0.74];
  const teamA = C(rng.pick([0xc83232, 0x2f5fb8, 0x2a8a4a, 0x7a3a9a])), teamB = C(rng.pick([0xe8d040, 0xf0f0f0, 0xe88030]));
  const seatCol = (i) => { const k = Math.floor(i / 4) % 4; return k === 0 ? mixc(teamA, WHITE, 0.25) : k === 1 ? mixc(teamB, WHITE, 0.2) : k === 2 ? mixc(teamA, WHITE, 0.25) : mixc(WHITE, teamA, 0.15); };
  const dUp0 = S * 0.05, dUp1 = S * 0.30, dLo0 = S * 0.34, dLo1 = S * 0.72, dTr = dLo1 + 6;
  const yW = 1.2;
  // lawn fan inside the track + pitch
  const lawn = [0.8, 0.9, 0.75];
  for (let i = 0; i < N; i++) { const a = ang(i), b = ang(i + 1); gb.tri(E(dTr, a, 0.04), E(dTr, b, 0.04), [0, 0.04, 0], 'lawn', lawn, [[0, 0], [1, 0], [0.5, 1]], { up: true }); }
  const ax = Rx - dTr, az = Rz - dTr;
  gb.flat(-ax * 0.70, -az * 0.70, ax * 0.70, az * 0.70, 0.07, 'pitch', WHITE);
  for (let i = 0; i < N; i++) {
    const a = ang(i), b = ang(i + 1), am = (a + b) / 2, sc = seatCol(i), r = rad(am);
    gb.qt(E(dLo1, a, 0.05), E(dLo1, b, 0.05), E(dTr, b, 0.05), E(dTr, a, 0.05), 'track', WHITE, WHITE, { up: true, tw: 10, th: 10 });
    gb.q(E(dLo1, a, 0.05), E(dLo1, b, 0.05), E(dLo1, b, yW), E(dLo1, a, yW), 'concrete', mulc(conc, 0.8), conc, { dir: inw(am), tw: 99, th: 99 });
    gb.qt(E(dLo1, a, yW), E(dLo1, b, yW), E(dLo0, b, 8.5), E(dLo0, a, 8.5), 'stand', sc, sc, { up: true, tw: 12, th: 4.5 });
    gb.q(E(dLo0, a, 8.5), E(dLo0, b, 8.5), E(dUp1, b, 8.5), E(dUp1, a, 8.5), 'concrete', conc, conc, { up: true, tw: 99, th: 99 });
    gb.q(E(dUp1, a, 8.5), E(dUp1, b, 8.5), E(dUp1, b, 10.5), E(dUp1, a, 10.5), 'concrete', mulc(conc, 0.7), mulc(conc, 0.85), { dir: inw(am), tw: 99, th: 99 });
    gb.qt(E(dUp1, a, 10.5), E(dUp1, b, 10.5), E(dUp0, b, 19), E(dUp0, a, 19), 'stand', sc, sc, { up: true, tw: 12, th: 4.5 });
    gb.q(E(dUp0, a, 19), E(dUp0, b, 19), E(0, b, 19), E(0, a, 19), 'concrete', conc, conc, { up: true, tw: 99, th: 99 });
    gb.qt(E(0, a, 0), E(0, b, 0), E(0, b, 14), E(0, a, 14), 'arc', mulc(conc, 0.9), [1, 1, 1], { dir: r, tw: 6, th: 7 });
    gb.q(E(0, a, 14), E(0, b, 14), E(0, b, 22), E(0, a, 22), 'concrete', mulc(conc, 0.85), conc, { dir: r, tw: 99, th: 99 });
    const ry0 = 22.0, ry1 = 25.0, dr = S * 0.26;
    gb.qt(E(0, a, ry0), E(0, b, ry0), E(dr, b, ry1), E(dr, a, ry1), 'rmetal', [0.85, 0.87, 0.9], [0.92, 0.94, 0.96], { up: true, tw: 10, th: 10 });
    gb.q(E(dr, a, ry1 - 0.5), E(dr, b, ry1 - 0.5), E(dr, b, ry1), E(dr, a, ry1), 'flat', [0.6, 0.62, 0.65], [0.6, 0.62, 0.65], { dir: inw(am) });
    gb.q(E(0, a, ry0 - 0.4), E(0, b, ry0 - 0.4), E(0, b, ry0), E(0, a, ry0), 'flat', [0.75, 0.77, 0.8], [0.75, 0.77, 0.8], { dir: r });
    gb.q(E(0, a, ry0 - 0.4), E(0, b, ry0 - 0.4), E(dr, b, ry1 - 0.5), E(dr, a, ry1 - 0.5), 'flat', [0.45, 0.46, 0.5], [0.45, 0.46, 0.5], { down: true });
    gb.q(E(0, a, -2), E(0, b, -2), E(0, b, 0), E(0, a, 0), 'concrete', mulc(conc, 0.5), mulc(conc, 0.7), { dir: r, tw: 99, th: 99 });
  }
  for (let i = 0; i < N; i += 2) { const p = E(1.0, ang(i), 0); cyl(gb, p[0], p[2], 0, 22, 0.3, 0.3, 6, 'flat', [0.7, 0.7, 0.72], [0.75, 0.75, 0.78], { th: 99 }); }
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) { const p = E(-0.12, a, 0), r = rad(a), l = Math.hypot(r[0], r[2]), nx = r[0] / l, nz = r[2] / l; const tx = -nz, tz = nx; const hw = 4; gb.q([p[0] - tx * hw, 0, p[2] - tz * hw], [p[0] + tx * hw, 0, p[2] + tz * hw], [p[0] + tx * hw, 6, p[2] + tz * hw], [p[0] - tx * hw, 6, p[2] - tz * hw], 'arc', [0.5, 0.5, 0.5], [0.8, 0.8, 0.8], { dir: [nx, 0, nz], v: [0.0, 0.85], u: [0.05, 0.4] }); }
  const tower = (a) => {
    const p = E(2.5, a, 0); const cx = p[0], cz = p[2]; const H = 38;
    cyl(gb, cx, cz, 0, H, 1.3, 0.65, 8, 'concrete', [0.72, 0.72, 0.74], [0.85, 0.85, 0.88], { th: 12 });
    const l = Math.hypot(cx, cz); const nx = -cx / l, nz = -cz / l; const tx = -nz, tz = nx;
    for (let row = 0; row < 3; row++) {
      const y = H - 0.6 + row * 1.9, hw = 4.2, hh = 0.95; const c0 = [cx + nx * 0.75, 0, cz + nz * 0.75];
      gb.q([c0[0] - tx * hw, y, c0[2] - tz * hw], [c0[0] + tx * hw, y, c0[2] + tz * hw], [c0[0] + tx * hw, y + hh * 1.8, c0[2] + tz * hw], [c0[0] - tx * hw, y + hh * 1.8, c0[2] - tz * hw], 'flood', WHITE, WHITE, { dir: [nx, 0, nz] });
      gb.q([c0[0] + tx * hw, y, c0[2] + tz * hw], [c0[0] - tx * hw, y, c0[2] - tz * hw], [c0[0] - tx * hw, y + hh * 1.8, c0[2] - tz * hw], [c0[0] + tx * hw, y + hh * 1.8, c0[2] + tz * hw], 'flood', [0.55, 0.55, 0.55], [0.55, 0.55, 0.55], { dir: [-nx, 0, -nz] });
    }
    return H + 6;
  };
  let hmax = 25;
  for (const a of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) hmax = Math.max(hmax, tower(a));
  gb.box(-ax * 0.14, 9.0, -(Rz - dLo0) + 1.5, ax * 0.14, 13.0, -(Rz - dLo0) + 2.0, { side: 'flood', c: [0.9, 0.9, 0.95], tw: 99, th: 99, top: 'flat', ct: [0.4, 0.4, 0.42] });
  return { roofY: hmax };
}

/* ====================================================================================
 *  PUBLIC API
 * ==================================================================================== */
const _info = (minW, maxW, minD, maxD, minH, maxH, floorHeight, name, category) => ({ minW, maxW, minD, maxD, minH, maxH, floorHeight, name, category });
/** sizes the engine may choose from per type (metres) */
export const BUILDING_INFO = {
  house_small:     _info(8, 11, 9, 13, 4.6, 6.0, 2.9, 'Bungalow', 'residential'),
  house_ranch:     _info(12, 18, 11, 15, 4.2, 5.4, 2.8, 'Ranch house', 'residential'),
  house_two_story: _info(9, 13, 10, 14, 7.6, 9.4, 2.85, 'Two-storey house', 'residential'),
  duplex:          _info(11, 15, 12, 16, 4.6, 7.4, 2.85, 'Duplex', 'residential'),
  apartment_low:   _info(14, 26, 14, 24, 9, 12.5, 3.0, 'Low-rise apartments', 'residential'),
  apartment_mid:   _info(16, 28, 16, 26, 16, 26, 3.2, 'Mid-rise apartments', 'residential'),
  liquor_store:    _info(8, 14, 10, 15, 4.2, 6.0, 3.6, 'Liquor store', 'commercial'),
  shop_strip:      _info(16, 34, 14, 20, 4.8, 6.2, 3.6, 'Strip mall', 'commercial'),
  office_low:      _info(14, 28, 14, 26, 9, 16, 3.8, 'Low-rise office', 'commercial'),
  office_mid:      _info(18, 34, 18, 32, 30, 54, 3.7, 'Mid-rise office', 'commercial'),
  skyscraper:      _info(24, 44, 24, 44, 80, 170, 3.8, 'Skyscraper', 'downtown'),
  warehouse:       _info(22, 50, 22, 42, 8, 12, 4.0, 'Warehouse', 'industrial'),
  warehouse_small: _info(10, 18, 12, 18, 5.5, 7.5, 3.5, 'Small warehouse', 'industrial'),
  factory:         _info(28, 52, 26, 42, 11, 16, 4.0, 'Factory', 'industrial'),
  villa:           _info(16, 26, 18, 28, 7.5, 11, 3.6, 'Modern villa', 'rich'),
  mansion:         _info(24, 36, 26, 38, 11, 16, 3.7, 'Mansion', 'rich'),
  beach_house:     _info(10, 15, 14, 19, 5, 9, 2.9, 'Beach house', 'beach'),
  motel:           _info(28, 44, 20, 28, 6.4, 8.4, 3.1, 'Motel', 'commercial'),
  gas_station:     _info(18, 26, 24, 32, 5.2, 7, 3.4, 'Gas station', 'commercial'),
  fast_food:       _info(16, 22, 22, 30, 5, 7.5, 3.6, 'Fast food', 'commercial'),
  church:          _info(14, 20, 28, 40, 9, 13, 5.5, 'Church', 'civic'),
  school:          _info(34, 66, 24, 34, 8, 12, 3.7, 'School', 'civic'),
  hospital:        _info(46, 76, 34, 52, 24, 44, 4.0, 'Hospital', 'civic'),
  police_station:  _info(26, 38, 26, 38, 13, 18, 3.8, 'Police station', 'civic'),
  city_hall:       _info(44, 66, 40, 58, 22, 32, 4.8, 'City hall', 'civic'),
  bank:            _info(18, 28, 22, 32, 9, 13, 4.8, 'Bank', 'commercial'),
  terminal:        _info(80, 130, 46, 70, 12, 20, 6.0, 'Airport terminal', 'airport'),
  hangar:          _info(40, 72, 44, 70, 14, 22, 8.5, 'Hangar', 'airport'),
  parking_garage:  _info(24, 46, 24, 46, 10, 22, 3.1, 'Parking garage', 'commercial'),
  stadium:         _info(110, 200, 100, 170, 25, 44, 10, 'Stadium', 'landmark'),
  garage_shop:     _info(10, 18, 14, 22, 4.6, 6, 4.4, 'Auto shop', 'commercial'),
  gym:             _info(14, 26, 16, 26, 5.6, 10, 4.0, 'Gym', 'commercial'),
  nightclub:       _info(14, 26, 16, 28, 6.4, 8.2, 6.2, 'Nightclub', 'commercial'),
};
export const BUILDING_TYPES = Object.keys(BUILDING_INFO);
export const SIGN_TYPES = SIGN_KEYS.slice();
const BUILDERS = {
  house_small: houseSmall, house_ranch: houseRanch, house_two_story: houseTwoStory, duplex, apartment_low: apartmentLow, apartment_mid: apartmentMid,
  liquor_store: liquorStore, shop_strip: shopStrip, office_low: officeLow, office_mid: officeMid, skyscraper, warehouse, warehouse_small: warehouseSmall,
  factory, villa, mansion, beach_house: beachHouse, motel, gas_station: gasStation, fast_food: fastFood, church, school, hospital, police_station: policeStation,
  city_hall: cityHall, bank, terminal, hangar, parking_garage: parkingGarage, stadium, garage_shop: garageShop, gym, nightclub,
};

/**
 * generateBuilding({type, w, d, h, seed, style?, floorHeight?, color?})
 *   w/d = footprint budget (never exceeded; actual size in userData.bounds), h = desired height (adapted).
 *   style (optional, per type): house_small 'hip'|'gable'|'gableS'|'flat'; apartment_low 'court'|'block';
 *     skyscraper/office_mid 'glass'|'deco'|'concrete' (skyscraper crown: spec.crown 'flat'|'sign'|'heli'|'slant'|'pyramid');
 *     office_low 'ribbon'|'punched'|'glass'; fast_food 'BURGERS'|'PIZZA'|'TACOS'|'DONUTS'|'CAFE'; garage_shop 'GARAGE'|'AUTO'|'TIRES'.
 *   color (optional hex) overrides the main wall colour of houses/villas.
 */
export function generateBuilding(spec) {
  const type = spec && spec.type; const info = BUILDING_INFO[type]; const fn = BUILDERS[type];
  if (!fn) return null;
  const seed = (spec.seed === undefined ? 1 : spec.seed) | 0;
  const rng = new Rng((strHash(type) ^ Math.imul(seed + 0x9e3779b9, 2654435761)) >>> 0);
  const w = Math.max(spec.w || (info.minW + info.maxW) / 2, info.minW * 0.55), d = Math.max(spec.d || (info.minD + info.maxD) / 2, info.minD * 0.55);
  const h = spec.h || (info.minH + info.maxH) / 2;
  const gb = new GB(rng);
  const B = { gb, rng, w, d, h, fh: spec.floorHeight || info.floorHeight, spec, color: spec.color !== undefined ? spec.color : houseColor(rng) };
  const res = fn(B) || {};
  const g = gb.build();
  // bounds
  const p = gb.p; let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9, mny = 1e9, mxy = -1e9;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (z < mnz) mnz = z; if (z > mxz) mxz = z; if (y < mny) mny = y; if (y > mxy) mxy = y;
  }
  g.userData = { type, bounds: { w: mxx - mnx, d: mxz - mnz, h: mxy }, roofY: res.roofY ?? mxy, bbox: { minX: mnx, maxX: mxx, minZ: mnz, maxZ: mxz, minY: mny, maxY: mxy }, tris: gb.i.length / 3 };
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

/** clone a building geometry and move it into world/chunk space (rotate about Y by yaw, then translate) */
export function bakeTransform(geometry, x, y, z, yaw) {
  const g = geometry.clone();
  const m = new THREE.Matrix4().makeRotationY(yaw || 0); m.setPosition(x || 0, y || 0, z || 0);
  g.applyMatrix4(m);
  g.computeBoundingSphere();
  return g;
}

/** facade atlas textures (shared, built on first use) */
export function createBuildingMaterial() {
  const { colorC, emitC } = buildAtlasCanvases();
  const mk = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8;
    t.needsUpdate = true; return t;
  };
  const map = mk(colorC), emissiveMap = mk(emitC);
  const material = new THREE.MeshLambertMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, alphaTest: 0.4 });
  material.name = 'buildings';
  return {
    material, map, emissiveMap,
    /** n01: 0 = day (no emission) .. 1 = full night (windows, neon and signs glow) */
    setNight(n01) { material.emissiveIntensity = clamp(n01, 0, 1); },
    dispose() { map.dispose(); emissiveMap.dispose(); material.dispose(); },
  };
}
/** debug: raw atlas canvases + tile table */
export function getFacadeAtlas() { const a = buildAtlasCanvases(); return { color: a.colorC, emissive: a.emitC, tiles: TILES }; }

const _usedH = layoutAtlas();
export const ATLAS_INFO = { width: AW, height: AH, usedHeight: _usedH, tiles: DEFS.length };
