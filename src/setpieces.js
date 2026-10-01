// Hand-authored set-pieces layered on top of the procedural city: Vinewood sign, Santa Maria pier + Ferris wheel,
// airport aircraft / helipads / runway lights / control tower, dock cranes, flood-light towers.
// layoutSetpieces(pl) decides WHERE things go (reserving space + adding colliders in the Placement);
// buildSetpieceMeshes(layout, terrain, material) creates the (few, merged) static meshes.
import * as THREE from 'three';
import { CLS, ZONE } from './mapdata.js';
import { GeoBuilder, glow } from './geomutil.js';
import { obbOverlap } from './util.js';

// Santa Maria pier: the map has a narrow sand spit at about world (-552, 350..400); we extend it into the sea.
export function pierSpec(map) {
  const cx = -552, z0 = 344, z1 = 474;
  if (!map || map.classAt(cx, 366) !== CLS.SAND) return null;
  return { cx, z0, z1, hw: 8, deck: 1.5 };
}

// ============================================================================================ layout
function freeRect(pl, x, z, hw, hd, yaw, o = {}) {
  const m = pl.map, cs = Math.cos(yaw), sn = Math.sin(yaw);
  let hmin = 1e9, hmax = -1e9;
  for (const [lx, lz] of [[0, 0], [-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, -hd], [0, hd], [-hw, 0], [hw, 0]]) {
    const px = x + lx * cs + lz * sn, pz = z - lx * sn + lz * cs;
    const c = m.classAt(px, pz);
    if (o.cls ? !o.cls.includes(c) : (c === CLS.WATER || c === CLS.RUNWAY || (c >= CLS.STREET && c <= CLS.FREEWAY))) return false;
    if (m.roadDistAt(px, pz) < (o.roadDist ?? 4)) return false;
    const h = pl.terrain.groundY(px, pz); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
  }
  if (hmin < 0.5 || hmax - hmin > (o.slope ?? 2.5)) return false;
  const box = { x, z, hw, hd, yaw };
  for (const b of pl.occ.queryRadius(x, z, Math.hypot(hw, hd) + 40)) if (obbOverlap(box, b.obb)) return false;
  return true;
}

export function layoutSetpieces(pl) {
  const L = { sign: null, pier: null, planes: [], helis: [], rwLights: null, tower: null, cranes: [], floods: [], windsock: null, ships: [], boats: [] };
  try { L.sign = layoutSign(pl); } catch (e) { console.warn('sign layout', e); }
  try { L.pier = layoutPier(pl); } catch (e) { console.warn('pier layout', e); }
  try { layoutAirport(pl, L); } catch (e) { console.warn('airport layout', e); }
  try { layoutDocks(pl, L); } catch (e) { console.warn('docks layout', e); }
  try { layoutFloods(pl, L); } catch (e) { console.warn('flood layout', e); }
  try { layoutBoats(pl, L); } catch (e) { console.warn('boat layout', e); }
  pl.setpieces = L;
  if (L.sign) pl.landmarks.vinewood_sign = { id: 'vinewood_sign', x: L.sign.x, z: L.sign.z, y: L.sign.y, yaw: 0, w: L.sign.width, h: 14, name: 'Vinewood Sign' };
  if (L.pier) pl.landmarks.pier = { id: 'pier', x: L.pier.cx, z: (L.pier.z0 + L.pier.z1) / 2, yaw: 0, name: 'Santa Maria Pier' };
  return L;
}

// ---- Vinewood sign ---------------------------------------------------------------------------
const LETTERS = 'VINEWOOD';
const LW = { V: 9, I: 3.6, N: 9, E: 7.6, W: 11.5, O: 9, D: 9 };
const GAP = 3.4, LH = 14;
function signWidth() { let w = 0; for (const c of LETTERS) w += LW[c]; return w + GAP * (LETTERS.length - 1); }

function layoutSign(pl) {
  const m = pl.map, T = pl.terrain, W = signWidth();
  let best = null, bs = -1e9;
  for (let cx = -160; cx <= 260; cx += 20) for (let cz = -980; cz <= -790; cz += 10) {
    let hmin = 1e9, hmax = -1e9, ok = true;
    for (let x = cx - W / 2 - 4; x <= cx + W / 2 + 4; x += 6) {
      const h = T.groundY(x, cz); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
      if (m.roadDistAt(x, cz) < 25 || m.classAt(x, cz) === CLS.WATER) { ok = false; break; }
    }
    if (!ok) continue;
    const gy = T.groundY(cx, cz);
    if (gy < 45) continue;
    // behind the sign the hill should rise (backdrop), in front it falls away (visible from the city)
    const back = T.groundY(cx, cz - 30) - gy, front = T.groundY(cx, cz + 60) - gy;
    const sc = -(hmax - hmin) * 1.5 - Math.abs(cx - 40) * 0.06 + Math.min(back, 25) * 0.4 + Math.min(0, front) * 0.02 - Math.abs(gy - 62) * 0.2;
    if (sc > bs) { bs = sc; best = { x: cx, z: cz, y: gy }; }
  }
  if (!best) return null;
  best.width = W;
  pl.reserve(best.x, best.z, W / 2 + 6, 8, 0, { collide: false, h: 14 });
  return best;
}

function buildSign(B, S, T) {
  const col = [1.42, 1.42, 1.36];      // emissive white (lit letters)
  let x = S.x - S.width / 2;
  const steel = 0x55595f;
  for (const ch of LETTERS) {
    const w = LW[ch];
    let gmax = -1e9; for (let u = x; u <= x + w; u += 2) gmax = Math.max(gmax, T.groundY(u, S.z));
    const y0 = gmax + 2.2, z = S.z;
    const stroke = (ax, ay, bx, by, sw = 1.9) => B.beam([x + ax, y0 + ay, z], [x + bx, y0 + by, z], sw, 1.5, col, [0, 0, 1]);
    const H = LH, sw = 1.9;
    switch (ch) {
      case 'V': stroke(0.6, H, w / 2, 0.1); stroke(w - 0.6, H, w / 2, 0.1); break;
      case 'I': stroke(w / 2, 0, w / 2, H); stroke(0.2, H - 0.9, w - 0.2, H - 0.9, 1.7); stroke(0.2, 0.9, w - 0.2, 0.9, 1.7); break;
      case 'N': stroke(sw / 2, 0, sw / 2, H); stroke(sw / 2, H, w - sw / 2, 0); stroke(w - sw / 2, 0, w - sw / 2, H); break;
      case 'E': stroke(sw / 2, 0, sw / 2, H); stroke(0, H - sw / 2, w, H - sw / 2); stroke(0, H / 2, w - 1.2, H / 2, 1.7); stroke(0, sw / 2, w, sw / 2); break;
      case 'W': stroke(0.6, H, 2.8, 0.1); stroke(2.8, 0.1, w / 2, H * 0.62); stroke(w / 2, H * 0.62, w - 2.8, 0.1); stroke(w - 2.8, 0.1, w - 0.6, H); break;
      case 'O': { const n = 10; for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; const rx = w / 2 - sw / 2, ry = H / 2 - sw / 2; stroke(w / 2 + Math.cos(a0) * rx, H / 2 + Math.sin(a0) * ry, w / 2 + Math.cos(a1) * rx, H / 2 + Math.sin(a1) * ry); } break; }
      case 'D': stroke(sw / 2, 0, sw / 2, H); stroke(0, H - sw / 2, w - 3.2, H - sw / 2); stroke(w - 3.4, H - sw / 2, w - sw / 2, H - 4.2); stroke(w - sw / 2, H - 4.2, w - sw / 2, 4.2); stroke(w - sw / 2, 4.2, w - 3.4, sw / 2); stroke(w - 3.2, sw / 2, 0, sw / 2); break;
    }
    // scaffold: two legs down to the hill + diagonal back struts + a base rail
    for (const fx of [0.22, 0.78]) {
      const px = x + w * fx, g = T.groundY(px, z), gb = T.groundY(px, z - 7);
      B.beam([px, y0 + 3, z - 0.9], [px, g - 1.5, z - 0.9], 0.55, 0.55, steel);
      B.beam([px, y0 + H * 0.72, z - 0.9], [px, gb + 0.2, z - 7], 0.4, 0.4, steel);
    }
    B.beam([x + 0.5, y0 + 1.4, z - 0.9], [x + w - 0.5, y0 + 1.4, z - 0.9], 0.35, 0.35, steel);
    x += w + GAP;
  }
}

// ---- Santa Maria pier ----------------------------------------------------------------------------
function layoutPier(pl) {
  const P = pierSpec(pl.map); if (!P) return null;
  pl.reserve(P.cx, (P.z0 + P.z1) / 2, P.hw + 3, (P.z1 - P.z0) / 2 + 3, 0);
  P.kiosks = [
    { x: P.cx + 5.4, z: P.z0 + 26, w: 5, d: 10, h: 4.4, side: 1, col: 0xd9487a, roof: 0xf2f0e6 },
    { x: P.cx - 5.4, z: P.z0 + 26, w: 5, d: 10, h: 4.4, side: -1, col: 0x2fa7b5, roof: 0xf2f0e6 },
    { x: P.cx + 5.6, z: P.z0 + 52, w: 4.4, d: 8, h: 3.8, side: 1, col: 0xf0b43c, roof: 0xd04b3a },
    { x: P.cx - 5.6, z: P.z0 + 52, w: 4.4, d: 8, h: 3.8, side: -1, col: 0x8b5cc2, roof: 0xf2f0e6 },
    { x: P.cx + 5.6, z: P.z0 + 76, w: 4.4, d: 8, h: 3.8, side: 1, col: 0x4f9fe0, roof: 0xf2f0e6 }
  ];
  for (const k of P.kiosks) pl.colliders.push({ x: k.x, z: k.z, hw: k.w / 2, hd: k.d / 2, yaw: 0, h: k.h, kind: 'setpiece' });
  P.wheel = { x: P.cx, z: P.z0 + 100, R: 14, hubY: P.deck + 16.6 };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pl.colliders.push({ x: P.wheel.x + sx * 3.6, z: P.wheel.z + sz * 8, r: 1.0, h: 6, kind: 'setpiece' });
  return P;
}

function buildPier(B, P, T) {
  const dy = P.deck, hw = P.hw + 1.0, z0 = P.z0 - 1, z1 = P.z1 + 0.5, cx = P.cx;
  const W1 = 0x8a6238, W2 = 0x7a5530, W3 = 0x966b3f, dark = 0x3b2a1a, rail = 0xe9e4d6;
  B.box(cx, dy - 0.45, (z0 + z1) / 2, hw * 2, 0.51, z1 - z0, dark);
  let i = 0;
  for (let z = z0; z < z1; z += 0.75, i++) {
    const c = [W1, W2, W3][i % 3], zz = Math.min(z + 0.73, z1);
    B.quad([cx - hw, dy + 0.06, z], [cx - hw, dy + 0.06, zz], [cx + hw, dy + 0.06, zz], [cx + hw, dy + 0.06, z], c);
  }
  // piles (seabed -> deck)
  for (let z = z0 + 2; z < z1; z += 6) for (const x of [cx - hw + 0.6, cx, cx + hw - 0.6]) {
    const g = T.groundY(x, z);
    if (g > dy - 0.6) continue;
    const yb = Math.min(g, -1) - 1.5;
    B.cyl(x, yb, z, 0.42, 0.36, dy - yb - 0.3, 7, 0x5a4330, false);
  }
  // railing
  for (const sx of [-1, 1]) {
    const x = cx + sx * (hw - 0.15);
    for (let z = z0 + 1; z < z1 - 0.5; z += 3) B.box(x, dy + 0.06, z, 0.14, 1.1, 0.14, rail);
    B.box(x, dy + 1.02, (z0 + z1) / 2, 0.12, 0.1, z1 - z0 - 1, rail);
    B.box(x, dy + 0.55, (z0 + z1) / 2, 0.08, 0.07, z1 - z0 - 1, rail);
  }
  B.box(cx, dy + 0.06, z1 - 0.25, hw * 2, 1.1, 0.14, rail);
  // lamps
  for (let z = z0 + 10; z < z1 - 4; z += 14) for (const sx of [-1, 1]) {
    const x = cx + sx * (hw - 0.45);
    B.cyl(x, dy + 0.06, z, 0.11, 0.08, 4.2, 6, 0x23262b);
    B.box(x, dy + 4.2, z, 0.5, 0.22, 0.5, 0x23262b);
    B.box(x, dy + 3.95, z, 0.36, 0.14, 0.36, glow(0xffd690, 2.4));
  }
  // entrance arch
  const az = z0 + 4;
  for (const sx of [-1, 1]) B.box(cx + sx * (hw - 1.0), dy + 0.06, az, 0.9, 6.2, 0.9, 0xf2f0e6);
  B.box(cx, dy + 6.26, az, hw * 2 - 0.4, 1.7, 0.7, 0x1e5fa8);
  B.box(cx, dy + 6.6, az + 0.4, hw * 2 - 1.6, 0.9, 0.12, glow(0xffe36a, 1.9));
  B.box(cx, dy + 7.96, az, hw * 2 - 0.4, 0.22, 0.9, 0xf2f0e6);
  // kiosks
  for (const k of P.kiosks) {
    const y0 = dy + 0.06, inward = -k.side;
    B.box(k.x, y0, k.z, k.w, k.h, k.d, k.col);
    B.box(k.x, y0 + k.h, k.z, k.w + 0.8, 0.3, k.d + 0.8, k.roof);
    const fx = k.x + inward * (k.w / 2 + 0.25), nS = Math.floor(k.d / 1.0);
    for (let s = 0; s < nS; s++) B.box(fx, y0 + 2.75, k.z - k.d / 2 + (s + 0.5) * (k.d / nS), 0.9, 0.12, k.d / nS, s % 2 ? 0xf2f0e6 : 0xd13b3b);
    B.box(k.x + inward * (k.w / 2 + 0.03), y0 + 1.0, k.z, 0.1, 1.5, k.d * 0.72, 0x1c2f48);
    B.box(k.x + inward * (k.w / 2 + 0.07), y0 + k.h - 1.1, k.z, 0.14, 0.7, k.d * 0.6, glow(k.side > 0 ? 0xff5ac8 : 0x50e0ff, 1.9));
    B.box(k.x, y0 + k.h + 0.3, k.z, 1.0, 0.9, 1.0, 0x8a8f96);
  }
  // benches
  for (let z = z0 + 22; z < z1 - 40; z += 18) { B.box(cx + hw - 1.6, dy + 0.06, z, 0.7, 0.45, 1.8, 0x6b4a2a); B.box(cx + hw - 1.9, dy + 0.5, z, 0.12, 0.5, 1.8, 0x6b4a2a); }
  // mast with flag at the end
  B.cyl(cx + hw - 2, dy + 0.06, z1 - 3, 0.12, 0.08, 9, 6, 0xc9ccd2);
  B.box(cx + hw - 1.0, dy + 8.0, z1 - 3, 1.8, 1.1, 0.06, 0xd13b3b);
}

function buildFerrisStatic(B, W, dy) {
  const steel = 0xdfe3e8, red = 0xd13b3b;
  for (const sx of [-1, 1]) {
    const x = W.x + sx * 2.9;
    for (const sz of [-1, 1]) B.beam([x, W.hubY, W.z], [x + sx * 0.8, dy + 0.06, W.z + sz * 8], 0.65, 0.65, steel, [1, 0, 0]);
    B.box(x + sx * 0.8, dy + 0.06, W.z - 8, 1.6, 0.35, 1.6, 0x555a60); B.box(x + sx * 0.8, dy + 0.06, W.z + 8, 1.6, 0.35, 1.6, 0x555a60);
    B.beam([x + sx * 0.8, dy + 2.4, W.z - 6.0], [x + sx * 0.8, dy + 2.4, W.z + 6.0], 0.35, 0.35, steel);
    B.cyl(x, W.hubY - 0.9, W.z, 0.6, 0.6, 1.8, 10, red);
  }
}
function buildFerrisWheel(B, W) {
  const R = W.R, steel = 0xeef0f2, cols = [0xff4fa6, 0x3fd0ff, 0xffe14a, 0x6bff7a];
  for (const sx of [-1, 1]) {
    const x = sx * 1.5, n = 24;
    for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; B.beam([x, Math.cos(a0) * R, Math.sin(a0) * R], [x, Math.cos(a1) * R, Math.sin(a1) * R], 0.36, 0.36, steel, [1, 0, 0]); }
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; B.beam([x, 0, 0], [x, Math.cos(a) * R, Math.sin(a) * R], 0.22, 0.22, steel, [1, 0, 0]); }
    for (let i = 0; i < 24; i++) { const a = (i + 0.5) / 24 * Math.PI * 2; B.box(x, Math.cos(a) * R - 0.13, Math.sin(a) * R, 0.26, 0.26, 0.26, glow(cols[i % 4], 2.0)); }
  }
  B.tube([-2.6, 0, 0], [2.6, 0, 0], 0.5, 0.5, 10, 0xc8ccd2);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; B.beam([-1.5, Math.cos(a) * R, Math.sin(a) * R], [1.5, Math.cos(a) * R, Math.sin(a) * R], 0.2, 0.2, steel); }
}
function gondolaGeo() {
  const B = new GeoBuilder();
  B.box(0, -2.3, 0, 2.3, 0.22, 1.7, 0x444a52);
  B.box(0, -2.3, 0.8, 2.3, 1.45, 0.1, 0xffffff); B.box(0, -2.3, -0.8, 2.3, 1.45, 0.1, 0xffffff);
  B.box(1.1, -2.3, 0, 0.1, 1.45, 1.7, 0xffffff); B.box(-1.1, -2.3, 0, 0.1, 1.45, 1.7, 0xffffff);
  B.box(0, -0.85, 0, 2.5, 0.16, 1.9, 0xffffff);
  B.beam([-1.0, -0.85, 0], [0, 0, 0], 0.08, 0.08, 0x555a60); B.beam([1.0, -0.85, 0], [0, 0, 0], 0.08, 0.08, 0x555a60);
  return B.build();
}

// ---- Airport ---------------------------------------------------------------------------------------
function layoutAirport(pl, L) {
  const m = pl.map, rw = m.runways[0]; if (!rw) return;
  const ux = rw.dirx, uz = rw.dirz, px = uz, pz = -ux;     // u along the runway, p = a normal
  const cx = rw.x + ux * rw.cu - uz * rw.cv, cz = rw.z + uz * rw.cu + ux * rw.cv;
  const term = pl.landmarks.terminal; let side = -1;
  if (term) side = ((term.x - cx) * px + (term.z - cz) * pz) > 0 ? 1 : -1;
  const at = (u, v) => ({ x: cx + ux * u + px * v * side, z: cz + uz * u + pz * v * side });   // v>0: towards the terminal side
  const edge = [];
  for (let u = -rw.len / 2 + 10; u <= rw.len / 2 - 10; u += 24) for (const sv of [-1, 1]) { const q = at(u, sv * (rw.wid / 2 - 0.9)); edge.push({ x: q.x, z: q.z, c: Math.abs(u) > rw.len / 2 - 40 ? 1 : 0 }); }
  L.rwLights = edge;
  // helipads
  for (const v of [44, 50, 38]) for (const u of [rw.len / 2 - 22, -rw.len / 2 + 22, rw.len / 2 - 50, -rw.len / 2 + 50]) {
    if (L.helis.length >= 3) break;
    const q = at(u, v);
    if (freeRect(pl, q.x, q.z, 11, 11, 0, { cls: [CLS.CONCRETE, CLS.LAND], roadDist: 8, slope: 1.0 }) && !L.helis.some(h => Math.hypot(h.x - q.x, h.z - q.z) < 40)) {
      L.helis.push({ x: q.x, z: q.z, heli: L.helis.length < 2 }); pl.reserve(q.x, q.z, 9, 9, 0);
    }
  }
  // aircraft parked nose-in on the apron
  const heading = Math.atan2(-px * side, -pz * side);      // nose towards the terminal
  let nAir = 0, nBiz = 0, n = 0;
  for (const v of [47, 45, 49]) for (let u = -rw.len / 2 + 50; u < rw.len / 2 - 40; u += 38) {
    if (nAir >= 5 && nBiz >= 4) break;
    const q = at(u, v), big = (n % 3) !== 2;
    if (big && nAir >= 5) continue; if (!big && nBiz >= 4) continue;
    const hw = big ? 16 : 9.5, hd = big ? 18 : 9.5;
    if (!freeRect(pl, q.x, q.z, hw, hd, heading, { cls: [CLS.CONCRETE, CLS.LAND], roadDist: 1.0, slope: 1.5 })) continue;
    if (L.planes.some(p => Math.hypot(p.x - q.x, p.z - q.z) < 30)) continue;
    L.planes.push({ x: q.x, z: q.z, yaw: heading, big, color: [0x1f5fa8, 0xc8372d, 0x2a9d6a, 0xe0a020, 0x6a3fa8][n % 5] });
    big ? nAir++ : nBiz++; n++;
    pl.reserve(q.x, q.z, big ? 2.1 : 1.4, big ? 15 : 7.5, heading, { collide: true, h: big ? 5.5 : 3 });
    pl.reserve(q.x, q.z, big ? 15 : 8.5, 4, heading, { collide: false });
  }
  // control tower beside the terminal
  if (term) {
    const tx = Math.cos(term.yaw), tz = -Math.sin(term.yaw);
    for (const off of [term.w / 2 + 26, -(term.w / 2 + 26), term.w / 2 + 40, -(term.w / 2 + 40)]) {
      const x = term.x + tx * off, z = term.z + tz * off;
      if (freeRect(pl, x, z, 5, 5, term.yaw, { cls: [CLS.CONCRETE, CLS.LAND, CLS.GRASS], roadDist: 6, slope: 2 })) {
        L.tower = { x, z, yaw: term.yaw, y: pl.terrain.groundY(x, z) };
        pl.reserve(x, z, 4.2, 4.2, term.yaw, { collide: true, h: 34 });
        break;
      }
    }
  }
  { const q = at(rw.len / 2 - 70, rw.wid / 2 + 14); L.windsock = { x: q.x, z: q.z }; }
}

function aircraft(B, colr, big) {
  // local: +Z nose, origin on the ground between the main gear
  const white = 0xf2f3f4, belly = 0xc9ced4, dark = 0x1b2838, steel = 0x7a8088;
  if (big) {
    const yc = 3.6, R = 2.15;
    B.tube([0, yc, -15], [0, yc, 13], R, R, 12, white);
    B.tube([0, yc, 13], [0, yc - 0.15, 19], R, 0.55, 12, white);
    B.tube([0, yc, -15], [0, yc + 0.9, -21], R, 0.45, 12, white);
    B.box(0, yc - R - 0.1, -2, 2.6, 0.5, 26, belly);
    for (const sx of [-1, 1]) { B.box(sx * (R - 0.02), yc + 0.15, -1, 0.1, 0.42, 24, dark); B.box(sx * (R - 0.02), yc - 0.7, -1, 0.11, 0.12, 24, colr); }
    B.box(0, yc + 0.95, 15.4, 1.9, 0.6, 1.5, dark);
    for (const sx of [-1, 1]) {
      B.prism([[sx * 1.6, 3.8], [sx * 17.5, -6.5], [sx * 17.5, -8.4], [sx * 1.6, -4.8]], yc - 1.15, yc - 0.75, 0xd9dde2);
      B.prism([[sx * 1.0, -15], [sx * 7.5, -19.5], [sx * 7.5, -20.8], [sx * 1.0, -19]], yc + 0.3, yc + 0.6, 0xd9dde2);
      B.box(sx * 17.4, yc - 0.6, -7.6, 0.14, 1.5, 1.4, colr);
      const ex = sx * 6.6; B.tube([ex, yc - 2.0, 0.6], [ex, yc - 2.0, 5.2], 1.15, 1.05, 10, steel); B.tube([ex, yc - 2.0, 5.2], [ex, yc - 2.0, 5.3], 0.95, 0.8, 10, 0x222529);
      B.beam([ex, yc - 1.0, 3.2], [ex, yc - 1.8, 3.2], 0.3, 1.4, steel);
    }
    B.beam([0, yc + 1.2, -15], [0, yc + 8.6, -20.5], 0.4, 4.4, colr, [1, 0, 0]);
    for (const [x, z] of [[-3.2, 0.5], [3.2, 0.5], [0, 12.5]]) { B.beam([x, yc - 1.5, z], [x, 0.9, z], 0.25, 0.25, steel); const dx = x === 0 ? 0.3 : 0.35; B.tube([x - dx, 0.62, z], [x + dx, 0.62, z], 0.62, 0.62, 8, 0x1b1c1f); }
  } else { // business jet ~15 m (caller scales x1.7 -> 25 m class would be too big: scale is applied by the caller)
    B.tube([0, 2.2, -5.5], [0, 2.2, 4.5], 1.1, 1.1, 10, white);
    B.tube([0, 2.2, 4.5], [0, 2.15, 7.5], 1.1, 0.35, 10, white);
    B.tube([0, 2.2, -5.5], [0, 2.7, -8.6], 1.1, 0.3, 10, white);
    B.box(0, 2.2 - 1.15, -0.5, 1.4, 0.3, 9, belly);
    for (const sx of [-1, 1]) { B.box(sx * 1.09, 2.35, 0.8, 0.08, 0.3, 6, dark); B.box(sx * 1.09, 1.95, 0.8, 0.09, 0.1, 6, colr); }
    B.box(0, 2.75, 5.5, 1.3, 0.35, 1.0, dark);
    for (const sx of [-1, 1]) {
      B.prism([[sx * 1.0, 1.6], [sx * 7.6, -0.8], [sx * 7.6, -2.3], [sx * 1.0, -2.3]], 1.65, 1.9, 0xd9dde2);
      B.prism([[sx * 0.4, -7.8], [sx * 2.8, -8.6], [sx * 2.8, -9.5], [sx * 0.4, -9.3]], 4.3, 4.45, 0xd9dde2);
      B.tube([sx * 1.4, 2.35, -5.6], [sx * 1.4, 2.35, -8.3], 0.5, 0.4, 8, steel);
    }
    B.beam([0, 2.7, -7.4], [0, 4.6, -9.0], 0.25, 1.6, colr, [1, 0, 0]);
    for (const [x, z] of [[-1.3, 0.5], [1.3, 0.5], [0, 4.6]]) { B.beam([x, 1.4, z], [x, 0.4, z], 0.15, 0.15, steel); B.tube([x - 0.12, 0.3, z], [x + 0.12, 0.3, z], 0.3, 0.3, 8, 0x1b1c1f); }
  }
}
function helicopter(B) {
  const bodyC = 0xd13b3b, dark = 0x1b2838;
  B.tube([0, 1.9, -0.9], [0, 1.9, 2.4], 1.15, 0.9, 10, bodyC); B.tube([0, 1.9, 2.4], [0, 1.85, 3.3], 0.9, 0.3, 10, dark);
  B.beam([0, 2.0, -1.0], [0, 2.4, -7.0], 0.45, 0.45, bodyC); B.box(0, 1.6, -7.0, 0.14, 1.4, 0.9, bodyC);
  B.cyl(0, 3.0, 0.3, 0.16, 0.16, 0.6, 6, 0x333840);
  B.beam([-5.2, 3.65, 0.3], [5.2, 3.65, 0.3], 0.35, 0.05, 0x24272c); B.beam([0, 3.65, -4.8], [0, 3.65, 5.4], 0.35, 0.05, 0x24272c);
  for (const sx of [-1, 1]) { B.beam([sx * 1.05, 0.25, -1.4], [sx * 1.05, 0.25, 2.6], 0.12, 0.12, 0x24272c); B.beam([sx * 0.8, 1.2, -0.3], [sx * 1.05, 0.3, -0.3], 0.1, 0.1, 0x24272c); B.beam([sx * 0.8, 1.2, 1.6], [sx * 1.05, 0.3, 1.6], 0.1, 0.1, 0x24272c); }
}

function buildAirport(B, L, T) {
  for (const p of L.planes) {
    const y = T.groundY(p.x, p.z);
    B.place(p.x, y, p.z, p.yaw, () => { const k = p.big ? 0.85 : 1.15; B.xf(() => aircraft(B, p.color, p.big), new THREE.Matrix4().makeScale(k, k, k)); });
  }
  for (const h of L.helis) {
    const y = T.groundY(h.x, h.z) + 0.05;
    B.disc(h.x, y + 0.02, h.z, 9.2, 28, 0x4a4d52);
    for (let i = 0; i < 28; i++) { const a0 = i / 28 * Math.PI * 2, a1 = (i + 1) / 28 * Math.PI * 2, r0 = 8.4, r1 = 7.7; B.quad([h.x + Math.cos(a0) * r0, y + 0.05, h.z + Math.sin(a0) * r0], [h.x + Math.cos(a1) * r0, y + 0.05, h.z + Math.sin(a1) * r0], [h.x + Math.cos(a1) * r1, y + 0.05, h.z + Math.sin(a1) * r1], [h.x + Math.cos(a0) * r1, y + 0.05, h.z + Math.sin(a0) * r1], 0xe6c220); }
    B.box(h.x - 2, y + 0.04, h.z, 0.9, 0.03, 6, 0xf2f2ee); B.box(h.x + 2, y + 0.04, h.z, 0.9, 0.03, 6, 0xf2f2ee); B.box(h.x, y + 0.04, h.z, 4, 0.03, 0.9, 0xf2f2ee);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + 0.2; B.box(h.x + Math.cos(a) * 9.6, y, h.z + Math.sin(a) * 9.6, 0.4, 0.3, 0.4, glow(0x60ff90, 1.8)); }
    if (h.heli) B.place(h.x, y + 0.02, h.z, 0.6, () => helicopter(B));
  }
  if (L.tower) {
    const t = L.tower;
    B.place(t.x, t.y, t.z, t.yaw, () => {
      B.box(0, 0, 0, 7, 3.5, 7, 0xcfd2d4);
      B.box(0, 3.5, 0, 4.4, 26, 4.4, 0xe4e6e8);
      for (let f = 0; f < 6; f++) B.box(0, 6 + f * 4, 0, 4.6, 0.3, 4.6, 0x9a9da0);
      B.box(0, 29.5, 0, 10, 0.6, 10, 0x60646a);
      B.box(0, 30.1, 0, 9, 3.6, 9, 0x1c3a52);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; B.box(Math.sin(a) * 4.52, 30.5, Math.cos(a) * 4.52, i % 2 ? 0.1 : 8.6, 1.9, i % 2 ? 8.6 : 0.1, glow(0x9fe2ff, 1.5)); }
      B.box(0, 33.7, 0, 10.4, 0.5, 10.4, 0xd9dcde);
      B.cyl(0, 34.2, 0, 0.12, 0.05, 8, 6, 0xbfc3c8);
      B.box(0, 41.5, 0, 0.5, 0.5, 0.5, glow(0xff3030, 2.2));
    });
  }
  if (L.windsock) {
    const w = L.windsock, y = T.groundY(w.x, w.z);
    B.cyl(w.x, y, w.z, 0.12, 0.08, 7.5, 6, 0xd8d8d8);
    B.tube([w.x, y + 7.2, w.z], [w.x + 3.2, y + 7.0, w.z + 0.8], 0.6, 0.32, 8, 0xf26a1b);
  }
}

function buildRunwayLights(B, L, T) {
  for (const e of L.rwLights || []) { const y = T.groundY(e.x, e.z); B.box(e.x, y, e.z, 0.45, 0.42, 0.45, e.c ? glow(0x46ff78, 2.0) : glow(0xfff4d0, 2.0)); }
}

// ---- Docks -----------------------------------------------------------------------------------------
function layoutDocks(pl, L) {
  const m = pl.map;
  const isW = (x, z) => m.classAt(x, z) === CLS.WATER;
  const found = [];
  for (let z = 600; z < 1010; z += 4) {
    for (let x = 640; x < 1010; x += 2) {
      const a = isW(x, z), b = isW(x + 2, z);
      if (!a && b && isW(x + 34, z) && isW(x + 34, z + 20) && isW(x + 34, z - 20)) found.push({ x: x + 1, z, dir: 1 });
      if (a && !b && isW(x - 34, z) && isW(x - 34, z + 20) && isW(x - 34, z - 20)) found.push({ x: x + 1, z, dir: -1 });
    }
  }
  L._banks = found;
  for (const dir of [1, -1]) {
    const arr = found.filter(f => f.dir === dir).sort((a, b) => a.z - b.z);
    let lastZ = -1e9, cnt = 0;
    for (const f of arr) {
      if (f.z - lastZ < 44 || cnt >= 4) continue;
      const x = f.x - f.dir * 7, z = f.z, yaw = f.dir > 0 ? Math.PI / 2 : -Math.PI / 2;     // local +Z (boom) points over the water
      if (!freeRect(pl, x, z, 8.5, 5.5, yaw, { cls: [CLS.CONCRETE, CLS.LAND], roadDist: 3, slope: 2 })) continue;
      L.cranes.push({ x, z, yaw, col: [0xd9541e, 0x2c6fb5, 0xd9a620][L.cranes.length % 3] });
      pl.reserve(x, z, 8.5, 5.5, yaw);
      const sn = Math.sin(yaw), cs = Math.cos(yaw);
      for (const a of [-1, 1]) for (const b of [-1, 1]) pl.colliders.push({ x: x + cs * a * 7 + sn * b * 4.2, z: z - sn * a * 7 + cs * b * 4.2, r: 0.9, h: 30, kind: 'setpiece' });
      lastZ = f.z; cnt++;
    }
  }
}

function buildCrane(B, c, T) {
  const y = T.groundY(c.x, c.z);
  B.place(c.x, y, c.z, c.yaw, () => {
    // local: +Z over the water (boom), X along the quay
    const col = c.col, steel = 0x6d737a, light = 0xd7dadd, H = 26;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.beam([sx * 7, 0, sz * 4.2], [sx * 7, H, sz * 4.2], 0.9, 0.9, col, [1, 0, 0]);
    for (const sx of [-1, 1]) {
      B.box(sx * 7, 0, 0, 1.2, 0.6, 10.6, 0x4a4e54);
      B.beam([sx * 7, 1, -4.2], [sx * 7, H - 1, 4.2], 0.35, 0.35, steel, [1, 0, 0]); B.beam([sx * 7, 1, 4.2], [sx * 7, H - 1, -4.2], 0.35, 0.35, steel, [1, 0, 0]);
      B.beam([sx * 7, 12, -4.2], [sx * 7, 12, 4.2], 0.5, 0.5, col);
    }
    for (const sz of [-1, 1]) B.beam([-7, H, sz * 4.2], [7, H, sz * 4.2], 1.0, 1.0, col);
    B.box(0, H, 0, 15.6, 1.3, 11.4, col);
    for (const sx of [-2.6, 2.6]) { B.beam([sx, H + 0.8, 0], [sx, H + 0.8, 38], 1.1, 1.4, light, [1, 0, 0]); B.beam([sx, H + 0.8, 0], [sx, H + 0.8, -15], 1.1, 1.4, col, [1, 0, 0]); }
    B.box(0, H + 0.4, 10, 6.2, 0.4, 0.8, steel); B.box(0, H + 0.4, 26, 6.2, 0.4, 0.8, steel);
    B.box(0, H + 1.4, -14, 6.4, 3.2, 4, 0x3a3e44);
    B.beam([-2.6, H + 1, 1], [0, H + 13, 4], 0.6, 0.6, col, [1, 0, 0]); B.beam([2.6, H + 1, 1], [0, H + 13, 4], 0.6, 0.6, col, [1, 0, 0]);
    B.beam([0, H + 13, 4], [0, H + 1.5, 37], 0.2, 0.2, steel, [1, 0, 0]); B.beam([0, H + 13, 4], [0, H + 1.5, -14], 0.2, 0.2, steel, [1, 0, 0]);
    B.box(0, H - 1.0, 20, 5.4, 1.4, 4.2, 0x3a3e44);
    B.box(0, H - 6.6, 20, 4.6, 0.4, 2.6, 0x2a2d31); B.beam([-2, H - 1, 20], [-2, H - 6.2, 20], 0.12, 0.12, steel); B.beam([2, H - 1, 20], [2, H - 6.2, 20], 0.12, 0.12, steel);
    B.box(0, H - 9.2, 20, 2.45, 2.6, 6.1, [0xb5472a, 0x2c6f8f, 0xcaa12a][(c.col >> 4) % 3]);
    B.box(3.6, H - 4.6, 28, 2.4, 2.1, 2.4, 0xe9e9e4); B.box(3.6, H - 4.0, 29.25, 2.1, 0.9, 0.08, 0x1c3a52);
    B.box(0, H + 13.6, 4, 0.5, 0.5, 0.5, glow(0xff3030, 2.0)); B.box(0, H + 1.4, 38, 0.5, 0.5, 0.5, glow(0xff3030, 2.0));
    for (const sx of [-1, 1]) B.box(sx * 7.4, H + 1.3, 5.4, 0.6, 0.4, 0.4, glow(0xfff2c8, 2.0));
  });
}


// ---- ships + boats ---------------------------------------------------------------------------------
function layoutBoats(pl, L) {
  const m = pl.map, isW = (x, z) => m.classAt(x, z) === CLS.WATER;
  // a cargo ship moored in the dock basin (between a west bank and an east bank found by layoutDocks)
  const found = L._banks || []; delete L._banks;
  let best = null;
  for (const w of found.filter(f => f.dir === 1)) for (const e of found.filter(f => f.dir === -1)) {
    if (Math.abs(e.z - w.z) > 4 || e.x < w.x + 40 || e.x > w.x + 130) continue;
    const sc = Math.abs(w.z - 900); if (!best || sc < best.sc) best = { w, e, sc };
  }
  if (best) {
    const cx = (best.w.x + best.e.x) / 2, width = best.e.x - best.w.x;
    let zmin = best.w.z; while (isW(cx, zmin - 3) && isW(cx - 20, zmin - 3) && isW(cx + 20, zmin - 3)) zmin -= 3;
    const wid = Math.min(15, width - 20), len = 64;
    if (wid > 8) {
      const z = zmin + len / 2 + 14;
      L.ships.push({ x: cx, z, yaw: 0, len, wid });
      pl.colliders.push({ x: cx, z, hw: wid / 2, hd: len / 2, yaw: 0, h: 8, kind: 'setpiece' });
    }
  }
  // motor boats next to the Santa Maria pier
  if (L.pier) {
    const P = L.pier, cols = [0xf2f2ee, 0x2f7fd1, 0xd13b3b];
    [[P.cx + 13.5, P.z0 + 62, 0.1], [P.cx + 14, P.z0 + 84, -0.15], [P.cx - 13.5, P.z0 + 48, 0.05]].forEach(([x, z, yaw], i) => {
      if (isW(x, z) && isW(x, z + 6) && isW(x, z - 6)) L.boats.push({ x, z, yaw, col: cols[i % 3] });
    });
  }
}

function buildShip(B, s) {
  const { len: L, wid: W } = s; const hw = W / 2;
  B.place(s.x, 0, s.z, s.yaw, () => {
    const hull = [[-hw, -L / 2], [hw, -L / 2], [hw, L / 2 - 16], [hw * 0.55, L / 2 - 5], [0, L / 2], [-hw * 0.55, L / 2 - 5], [-hw, L / 2 - 16]];
    B.prism(hull, -3.2, 0.7, 0x7d1d1d); B.prism(hull.map(p => [p[0] * 1.0, p[1]]), 0.7, 3.4, 0x1e2b3c, 0x5d6167);
    // bulwark rim
    // superstructure (stern)
    const sz = -L / 2 + 8;
    B.box(0, 3.4, sz, W * 0.78, 9, 10, 0xf0f0ec);
    B.box(0, 12.4, sz + 0.6, W * 0.66, 3.6, 7.5, 0xf0f0ec);
    B.box(0, 12.9, sz + 4.42, W * 0.6, 1.4, 0.12, 0x1a2a3c);
    for (let f = 0; f < 3; f++) B.box(0, 5.4 + f * 2.6, sz + 5.05, W * 0.7, 1.0, 0.12, 0x1a2a3c);
    B.box(0, 16, sz, 0.3, 4, 0.3, 0x9aa0a6); B.box(0, 20, sz, 3, 0.2, 0.2, 0x9aa0a6);
    B.cyl(0, 16, sz - 2.2, 1.7, 1.4, 4.5, 10, 0xc4382b); B.cyl(0, 19.6, sz - 2.2, 1.45, 1.4, 1.0, 10, 0x1b1c1f);
    B.box(0, 20.6, sz, 0.5, 0.5, 0.5, glow(0xff3030, 2.0));
    // containers: 3 bays x 4 across x 3 tiers
    const cols = [0xb5472a, 0x2c6f8f, 0xcaa12a, 0x3f7d44, 0x8a8f96, 0x7a3fa8, 0xd9d9d2];
    let k = 0;
    for (let bay = 0; bay < 3; bay++) for (let ac = 0; ac < 4; ac++) {
      const x = (ac - 1.5) * (W / 4.4), z = -L / 2 + 19 + bay * 12.6, tiers = 1 + ((bay * 3 + ac * 2 + 1) % 3);
      for (let t = 0; t < tiers; t++) B.box(x, 3.4 + t * 2.6, z, Math.min(2.4, W / 4.8), 2.6, 12.0, cols[(k++ * 7 + bay) % cols.length]);
    }
    // deck lights + bow
    B.box(0, 3.4, L / 2 - 9, 0.4, 2.2, 0.4, 0x9aa0a6); B.box(0, 5.6, L / 2 - 9, 0.5, 0.5, 0.5, glow(0xfff2c8, 2.0));
    B.box(hw * 0.7, 3.4, -L / 2 + 15, 0.4, 0.4, 0.4, glow(0xff4040, 2.0)); B.box(-hw * 0.7, 3.4, -L / 2 + 15, 0.4, 0.4, 0.4, glow(0x40ff60, 2.0));
  });
}
function buildBoat(B, b) {
  B.place(b.x, 0, b.z, b.yaw, () => {
    const hull = [[-1.5, -4.5], [1.5, -4.5], [1.5, 1.5], [0, 4.6], [-1.5, 1.5]];
    B.prism(hull, -0.7, 0.8, b.col, 0xe8e2d2);
    B.box(0, 0.8, -1.4, 2.4, 1.3, 3.4, 0xf4f4f0); B.box(0, 1.35, -0.25, 2.2, 0.7, 0.1, 0x1c3a52);
    B.box(0, 2.1, -1.4, 2.6, 0.12, 3.6, 0xe8e2d2);
    B.cyl(0.7, 2.2, -2.4, 0.05, 0.04, 1.6, 5, 0xcccccc);
  });
}

// ---- flood-light towers ----------------------------------------------------------------------------
function layoutFloods(pl, L) {
  const m = pl.map;
  const place = (x, z) => {
    if (L.floods.some(f => Math.hypot(f.x - x, f.z - z) < 105)) return false;
    if (!freeRect(pl, x, z, 1.8, 1.8, 0, { cls: [CLS.CONCRETE, CLS.LAND], roadDist: 5, slope: 1.5 })) return false;
    L.floods.push({ x, z }); pl.reserve(x, z, 1.4, 1.4, 0, { collide: true, h: 26 }); return true;
  };
  for (let z = 600; z < 1000; z += 14) for (let x = 690; x < 1010; x += 14) if (m.zoneAt(x, z) === ZONE.DOCKS) place(x + ((z / 14) % 2) * 7, z);
  for (let z = 640; z < 740; z += 12) for (let x = 200; x < 660; x += 12) if (m.zoneAt(x, z) === ZONE.AIRPORT) place(x, z);
  for (let z = 100; z < 400; z += 16) for (let x = 700; x < 1000; x += 16) if (m.zoneAt(x, z) === ZONE.STADIUM) place(x, z);
}

function buildFlood(B, f, T) {
  const y = T.groundY(f.x, f.z);
  B.cyl(f.x, y, f.z, 0.42, 0.26, 24, 8, 0x8a9097);
  B.box(f.x, y + 23.8, f.z, 5.6, 0.35, 0.35, 0x40444a); B.box(f.x, y + 25.4, f.z, 5.6, 0.35, 0.35, 0x40444a);
  for (let i = 0; i < 4; i++) for (const r of [23.9, 25.5]) B.box(f.x - 2.1 + i * 1.4, y + r - 0.0, f.z + 0.35, 1.0, 0.75, 0.35, glow(0xfff0c8, 2.0));
  B.box(f.x, y + 26.3, f.z, 0.3, 0.3, 0.3, glow(0xff3030, 2.0));
  B.box(f.x, y, f.z, 1.6, 0.5, 1.6, 0x55595f);
}

// ============================================================================================ meshes
export function buildSetpieceMeshes(L, terrain, material) {
  const group = new THREE.Group(); group.name = 'setpieces';
  const anim = [];
  const add = (geo, name, o = {}) => {
    if (!geo || !geo.attributes.position || !geo.attributes.position.count) return null;
    const mesh = new THREE.Mesh(geo, material); mesh.name = name; mesh.castShadow = o.shadow !== false; mesh.receiveShadow = false;
    if (o.static !== false) { mesh.matrixAutoUpdate = false; mesh.updateMatrix(); }
    group.add(mesh); return mesh;
  };
  if (L.sign) { const B = new GeoBuilder(); buildSign(B, L.sign, terrain); add(B.build(), 'vinewood_sign'); }
  if (L.pier) {
    const B = new GeoBuilder(); buildPier(B, L.pier, terrain);
    buildFerrisStatic(B, L.pier.wheel, L.pier.deck);
    add(B.build(), 'pier');
    const W = L.pier.wheel, WB = new GeoBuilder(); buildFerrisWheel(WB, W);
    const wheel = add(WB.build(), 'ferris_wheel', { static: false });
    wheel.position.set(W.x, W.hubY, W.z);
    const gm = new THREE.InstancedMesh(gondolaGeo(), material, 12); gm.castShadow = true; gm.frustumCulled = false; gm.name = 'gondolas';
    const cols = [0xff4fa6, 0x3fd0ff, 0xffe14a, 0x6bff7a, 0xff8a3c, 0xb98bff]; const tc = new THREE.Color();
    for (let i = 0; i < 12; i++) gm.setColorAt(i, tc.setHex(cols[i % cols.length]));
    group.add(gm);
    const tmp = new THREE.Object3D(); let th = 0;
    const upd = (dt) => {
      th += dt * 0.11; wheel.rotation.x = th; wheel.updateMatrix();
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + th; tmp.position.set(W.x, W.hubY + Math.cos(a) * W.R, W.z + Math.sin(a) * W.R); tmp.updateMatrix(); gm.setMatrixAt(i, tmp.matrix); }
      gm.instanceMatrix.needsUpdate = true;
    };
    upd(0); anim.push(upd);
  }
  { const B = new GeoBuilder(); buildAirport(B, L, terrain); add(B.build(), 'airport'); }
  { const B = new GeoBuilder(); buildRunwayLights(B, L, terrain); add(B.build(), 'runway_lights', { shadow: false }); }
  if (L.cranes.length) { const B = new GeoBuilder(); for (const c of L.cranes) buildCrane(B, c, terrain); add(B.build(), 'cranes'); }
  if (L.floods.length) { const B = new GeoBuilder(); for (const f of L.floods) buildFlood(B, f, terrain); add(B.build(), 'floods', { shadow: false }); }
  if (L.ships.length || L.boats.length) { const B = new GeoBuilder(); for (const sh of L.ships) buildShip(B, sh); for (const bt of L.boats) buildBoat(B, bt); add(B.build(), 'ships'); }
  return { group, update(dt) { for (const f of anim) f(dt); } };
}
