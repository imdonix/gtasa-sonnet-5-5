// Ambient scene builders.  Each entry: weight(ctx, A) -> spawn weight for the current place / time, make(A, ctx) -> Scene | null.
// Scenes queue their peds as jobs (A.runJobs creates one rig per simulation step), every ped gets p.life (see lifebrain.js).
import * as THREE from 'three';
import { G } from './state.js';
import { rrange, pick, TAU, dist2 } from './util.js';
import { ZONE, CLS } from './mapdata.js';

const loc = (pr, lx, lz) => { const c = Math.cos(pr.yaw), s = Math.sin(pr.yaw); return { x: pr.x + lx * c + lz * s, z: pr.z - lx * s + lz * c }; };
const URBAN = new Set([ZONE.RES_LOW, ZONE.RES_MID, ZONE.COMMERCIAL, ZONE.DOWNTOWN, ZONE.BEACH, ZONE.PARK, ZONE.RICH]);
const zoneK = (c, set, off = 0.05) => set.includes(c.zone) ? 1 : off;
const hourK = (h, a, b) => (h >= a && h <= b) ? 1 : 0;
const pk = (arr) => arr[(Math.random() * arr.length) | 0];

// ---- shared props for scenes (chairs, towels, net, ball)
let _shared = null;
function shared() {
  if (_shared) return _shared;
  const L = (c) => new THREE.MeshLambertMaterial({ color: c });
  const cols = [0xe0523a, 0x3a8ae0, 0xf0c030, 0x40b070, 0xe06aa0, 0xf4f4f4];
  const mats = cols.map(L);
  _shared = {
    mats, white: L(0xf2f2ec), wood: L(0x8a5a30), dark: L(0x2a2c30),
    net: new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
    seat: new THREE.BoxGeometry(0.62, 0.05, 0.95), back: new THREE.BoxGeometry(0.62, 0.05, 0.8), towel: new THREE.BoxGeometry(0.85, 0.02, 1.9),
    pole: new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6), netG: new THREE.PlaneGeometry(5.2, 0.9), ball: new THREE.SphereGeometry(0.14, 10, 8),
    barrel: new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10, 1, true),
    cartBody: new THREE.BoxGeometry(1.5, 0.8, 0.85), cartTop: new THREE.BoxGeometry(1.56, 0.06, 0.92), cartWheel: new THREE.CylinderGeometry(0.25, 0.25, 0.08, 10),
    canopy: new THREE.ConeGeometry(1.45, 0.5, 8), umbPole: new THREE.CylinderGeometry(0.035, 0.035, 2.2, 6), steel: L(0xb8bcc0), red: L(0xc83232), cream: L(0xe8dcc0)
  };
  return _shared;
}
function deckChair(col = 0) {
  const S = shared(), g = new THREE.Group(), m = S.mats[col % S.mats.length];
  const seat = new THREE.Mesh(S.seat, m); seat.position.set(0, 0.22, 0.25); g.add(seat);
  const back = new THREE.Mesh(S.back, m); back.position.set(0, 0.5, -0.32); back.rotation.x = -0.95; g.add(back);
  for (const x of [-0.3, 0.3]) { const l = new THREE.Mesh(S.pole, S.wood); l.scale.set(1, 0.17, 1); l.position.set(x, 0.1, 0.0); g.add(l); const l2 = l.clone(); l2.position.set(x, 0.1, 0.65); g.add(l2); }
  return g;
}
function hotdogCart(col = 0) {
  const S = shared(), g = new THREE.Group();
  const body = new THREE.Mesh(S.cartBody, S.red); body.position.set(0, 0.75, 0); g.add(body);
  const top = new THREE.Mesh(S.cartTop, S.steel); top.position.set(0, 1.18, 0); g.add(top);
  for (const x of [-0.8, 0.8]) { const w = new THREE.Mesh(S.cartWheel, S.dark); w.rotation.z = Math.PI / 2; w.position.set(x, 0.27, 0.0); g.add(w); }
  const pole = new THREE.Mesh(S.umbPole, S.steel); pole.position.set(0.55, 2.2, -0.25); g.add(pole);
  const can = new THREE.Mesh(S.canopy, S.mats[col % 6]); can.position.set(0.55, 3.15, -0.25); g.add(can);
  return g;
}
function parasol(col = 0) {
  const S = shared(), g = new THREE.Group();
  const pole = new THREE.Mesh(S.umbPole, S.white); pole.position.y = 1.1; g.add(pole);
  const can = new THREE.Mesh(S.canopy, S.mats[col % 6]); can.position.y = 2.3; can.scale.setScalar(1.1); g.add(can);
  return g;
}
function towel(col = 0) { const t = new THREE.Mesh(shared().towel, shared().mats[col % 6]); t.position.y = 0.04; return t; }

const hatCap = (a) => { a.hat = 'cap'; a.hatColor = pk([0xeeeeee, 0xe03030, 0x3a7ae0, 0x222226]); if (a.hairStyle === 'afro' || a.hairStyle === 'mohawk' || a.hairStyle === 'bun') a.hairStyle = 'short'; };
const beachwear = (a) => { a.shirtType = a.gender === 'f' ? 'tank' : (Math.random() < 0.5 ? 'tank' : 'tee'); a.shorts = true; a.skirt = undefined; if (Math.random() < 0.4) { a.shirt = pk([0x29b6c9, 0xf2994a, 0xe25a8a, 0x5ac86a, 0xf0d050]); } a.hat = Math.random() < 0.25 ? 'cap' : a.hat; if (a.hat === 'cap') { a.hatColor = pk([0xeeeeee, 0xf0d050, 0x29b6c9]); if (a.hairStyle === 'afro' || a.hairStyle === 'mohawk' || a.hairStyle === 'bun') a.hairStyle = 'short'; } };
const jogwear = (a) => { a.shirtType = 'tank'; a.shorts = true; a.skirt = undefined; a.shirt = pk([0xe8303a, 0x3a7ae0, 0x40c070, 0xf0f0f0, 0xffb020, 0xd96ab0]); a.shoes = 0xf0f0f0; a.hat = 'none'; a.build = 'slim'; if (a.hairStyle === 'cap') a.hairStyle = 'short'; };
const hoodDark = (a) => { a.shirtType = 'hoodie'; a.shirt = pk([0x1c1c22, 0x2a2a30, 0x3a1c1c]); a.pants = 0x1b1b1f; a.hat = 'beanie'; a.hatColor = 0x16161a; if (a.hairStyle === 'afro' || a.hairStyle === 'mohawk' || a.hairStyle === 'bun') a.hairStyle = 'short'; a.build = 'normal'; };
const clubwear = (a) => { if (a.gender === 'f') { a.shirtType = 'dress'; a.skirt = 'mini'; a.shirt = pk([0xd9306a, 0x7a3fc0, 0x222226, 0xe8303a, 0x40b8c8, 0xf0d050]); } else { a.shirtType = Math.random() < 0.5 ? 'jacket' : 'tee'; a.shirt = pk([0x222226, 0x7a3fc0, 0xeeeeee, 0x3a7ae0, 0xd9306a]); a.pants = pk([0x111114, 0x23262c, 0x2f4a7a]); a.shoes = pk([0xeeeeee, 0x111114]); } a.shorts = false; };

export const SCENES = {
  // ------------------------------------------------------------------------------------------ 1 benches
  bench: {
    weight: (c) => 1.1 * (1 - 0.75 * c.night) * zoneK(c, [ZONE.RES_LOW, ZONE.RES_MID, ZONE.COMMERCIAL, ZONE.DOWNTOWN, ZONE.BEACH, ZONE.PARK], 0.15) * (1 - c.rain),
    make(A, c) {
      const pr = A.pickProp('bench', 35, 125, q => A.hidden(q.x, q.z) && !A.sceneNear(q.x, q.z, 6)); if (!pr) return null;
      const S = A.newScene('bench', pr.x, pr.z);
      const n = Math.random() < 0.5 ? 2 : 1; const zone = G.map.zoneAt(pr.x, pr.z);
      const gy = pr.y ?? G.world.groundY(pr.x, pr.z);
      for (let i = 0; i < n; i++) S.jobs.push(() => {
        const l = loc(pr, n === 1 ? rrange(-0.25, 0.25) : (i ? 0.45 : -0.45), 0.04);
        const p = A.mkPed(S, { x: l.x, z: l.z, yaw: pr.yaw, look: zone === ZONE.BEACH ? 'tourist' : (Math.random() < 0.2 ? 'business' : 'civ') });
        p.life = { type: 'sit', frozen: true, x: l.x, z: l.z, y: gy + 0.05, yaw: pr.yaw, state: 'sit', t: rrange(50, 140), gesture: n === 2 };
        p.x = l.x; p.z = l.z; p.y = gy + 0.05; p.group.position.set(p.x, p.y, p.z);
        if (Math.random() < 0.25) p.phoneT = 40;
      });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 2 bus stops
  busstop: {
    weight: (c) => 1.3 * (1 - 0.6 * c.night) * zoneK(c, [ZONE.RES_LOW, ZONE.RES_MID, ZONE.COMMERCIAL, ZONE.DOWNTOWN, ZONE.BEACH], 0.1) * (c.hour > 6.5 && c.hour < 9.5 || c.hour > 16 && c.hour < 19 ? 1.6 : 1),
    make(A, c) {
      const pr = A.pickProp('busstop', 35, 135, q => A.hidden(q.x, q.z) && !A.sceneNear(q.x, q.z, 10)); if (!pr) return null;
      const S = A.newScene('busstop', pr.x, pr.z); S.meta.stop = pr;
      const n = 1 + ((Math.random() * 3) | 0); const gy = pr.y ?? G.world.groundY(pr.x, pr.z);
      const rush = c.hour > 6.5 && c.hour < 9.5 || c.hour > 16 && c.hour < 19;
      const look = c.zone === ZONE.DOWNTOWN || rush ? 'business' : 'civ';
      let seated = false;
      for (let i = 0; i < n; i++) S.jobs.push(() => {
        const sit = !seated && Math.random() < 0.5; seated = seated || sit;
        let l, yaw = pr.yaw;
        if (sit) l = loc(pr, rrange(-0.7, 0.7), -0.3); else l = loc(pr, rrange(-1.1, 1.1), rrange(0.7, 1.3));
        if (!sit) yaw = pr.yaw + rrange(-0.7, 0.7);
        const p = A.mkPed(S, { x: l.x, z: l.z, yaw, look: Math.random() < 0.6 ? look : 'civ' });
        p.busStop = pr;
        if (sit) { p.life = { type: 'sit', frozen: true, x: l.x, z: l.z, y: gy + 0.03, yaw: pr.yaw, state: 'sit', t: rrange(80, 200) }; p.x = l.x; p.z = l.z; p.y = gy + 0.03; }
        else p.life = { type: 'stand', state: Math.random() < 0.4 ? 'phone' : 'idle', yaw, t: rrange(70, 180) };
      });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 3 chatting pairs
  chat: {
    weight: (c) => 1.2 * zoneK(c, [ZONE.RES_LOW, ZONE.RES_MID, ZONE.COMMERCIAL, ZONE.DOWNTOWN, ZONE.BEACH, ZONE.PARK], 0.15) * (1 - 0.5 * c.night),
    make(A, c) {
      const sp = A.sideSpot(40, 120); if (!sp) return null;
      const S = A.newScene('chat', sp.x, sp.z);
      const ax = sp.x, az = sp.z, bx = sp.x + sp.tx * 1.25, bz = sp.z + sp.tz * 1.25;
      if (!A.spotOK(bx, bz, 0.6)) { A.endScene(S); return null; }
      const look = sp.zone === ZONE.DOWNTOWN && Math.random() < 0.6 ? 'business' : 'civ';
      let a = null;
      S.jobs.push(() => { a = A.mkPed(S, { x: ax, z: az, yaw: Math.atan2(bz - az, bx - ax) , look }); a.life = { type: 'stand', state: 'idle', t: rrange(30, 80), partner: null, face: { x: bx, z: bz } }; });
      S.jobs.push(() => {
        const b = A.mkPed(S, { x: bx, z: bz, yaw: Math.atan2(az - bz, ax - bx), look });
        const phone = Math.random() < 0.3;
        b.life = { type: 'stand', state: phone ? 'phone' : 'idle', t: rrange(30, 80), partner: phone ? null : a, face: { x: ax, z: az } };
        if (a && a.life && !phone) { a.life.partner = b; a.life.face = null; }
      });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 4 joggers
  jog: {
    weight: (c) => 1.0 * c.day * (1 - c.rain) * zoneK(c, [ZONE.BEACH, ZONE.PARK, ZONE.RES_LOW, ZONE.RES_MID, ZONE.RICH], 0.08) * (c.zone === ZONE.BEACH || c.zone === ZONE.PARK ? 1.8 : 1) * (hourK(c.hour, 5.5, 10) * 0.7 + hourK(c.hour, 16, 20) * 0.7 + 0.5),
    make(A, c) {
      const sp = A.sideSpot(35, 120); if (!sp) return null;
      const S = A.newScene('jog', sp.x, sp.z); const n = Math.random() < 0.3 ? 2 : 1;
      for (let i = 0; i < n; i++) S.jobs.push(() => {
        const x = sp.x + sp.tx * i * 1.4, z = sp.z + sp.tz * i * 1.4;
        const p = A.mkPed(S, { x, z, yaw: Math.atan2(sp.tx, sp.tz), mod: jogwear });
        p.life = { type: 'jog', t: rrange(45, 100), speed: rrange(2.8, 3.3) };
        p.path = { edge: sp.nr.edge, dir: Math.random() < 0.5 ? 1 : -1, s: sp.nr.s, side: sp.side };
      });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 5 beach: sunbathers under umbrellas
  sunbathe: {
    weight: (c) => 2.0 * c.day * (1 - c.rain * 0.9) * zoneK(c, [ZONE.BEACH], 0.12),
    make(A, c) {
      let pr = A.pickProp('umbrella_beach', 35, 135, q => A.hidden(q.x, q.z) && !A.sceneNear(q.x, q.z, 10));
      let own = false;
      if (!pr || Math.random() < 0.5) { const sp = A.sandSpot(40, 130, 2.5); if (sp) { pr = sp; own = true; } }
      if (!pr) return null;
      const S = A.newScene('sunbathe', pr.x, pr.z);
      if (own) S.jobs.push(() => { const u = parasol((Math.random() * 6) | 0); u.position.set(pr.x, G.world.groundY(pr.x, pr.z), pr.z); A.addObj(S, u); });
      const sd = A.seaDir(pr.x, pr.z); const yaw = Math.atan2(sd.x, sd.z);
      const n = 1 + ((Math.random() * 3) | 0); const ci = (Math.random() * 6) | 0;
      for (let i = 0; i < n; i++) S.jobs.push(() => {
        const off = (i - (n - 1) / 2) * 1.55, cs = Math.cos(yaw), sn = Math.sin(yaw);
        const x = pr.x + off * cs - sd.x * 0.3, z = pr.z - off * sn - sd.z * 0.3;
        const gy = G.world.groundY(x, z);
        const chair = deckChair(ci + i); chair.position.set(x, gy, z); chair.rotation.y = yaw; A.addObj(S, chair);
        const tw = towel(ci + i + 2); tw.position.set(x + sd.x * 1.6, gy + 0.03, z + sd.z * 1.6); tw.rotation.y = yaw; tw.scale.set(0.8, 1, 0.45); if (Math.random() < 0.5) A.addObj(S, tw);
        const p = A.mkPed(S, { x, z, yaw, look: 'tourist', mod: beachwear });
        p.life = { type: 'sit', frozen: true, x, z, y: gy + 0.0, yaw, state: 'sit', t: rrange(90, 240), gesture: n > 1 };
        p.x = x; p.z = z; p.y = gy;
      });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 5 beach: volleyball
  volley: {
    weight: (c) => 1.4 * c.day * (1 - c.rain) * zoneK(c, [ZONE.BEACH], 0.1),
    make(A, c) {
      const spot = A.sandSpot(40, 130, 4);
      if (!spot) return null;
      const S = A.newScene('volley', spot.x, spot.z); const yaw = Math.random() * TAU, cs = Math.cos(yaw), sn = Math.sin(yaw);
      const P = [[-1.3, -3.0], [1.0, 3.0], [-1.0, 3.0], [1.3, -3.0]];   // local court positions (net along local x at z=0)
      const W = (lx, lz) => ({ x: spot.x + lx * cs + lz * sn, z: spot.z - lx * sn + lz * cs });
      const gy = G.world.groundY(spot.x, spot.z); const Sh = shared();
      S.jobs.push(() => {
        const net = new THREE.Mesh(Sh.netG, Sh.net); net.position.set(spot.x, gy + 1.45, spot.z); net.rotation.y = yaw; A.addObj(S, net);
        for (const sx of [-2.6, 2.6]) { const pole = new THREE.Mesh(Sh.pole, Sh.white); const w = W(sx, 0); pole.position.set(w.x, gy + 1.15, w.z); A.addObj(S, pole); }
        const ball = new THREE.Mesh(Sh.ball, Sh.mats[0]); ball.position.set(spot.x, gy + 1.5, spot.z); A.addObj(S, ball); S.meta.ball = ball;
      });
      S.meta.players = [];
      for (let i = 0; i < 4; i++) S.jobs.push(() => {
        const w = W(P[i][0], P[i][1]);
        const p = A.mkPed(S, { x: w.x, z: w.z, yaw: Math.atan2(spot.x - w.x, spot.z - w.z), look: 'tourist', mod: beachwear });
        p.life = { type: 'stand', state: 'idle', face: { x: spot.x, z: spot.z }, t: rrange(120, 300) }; S.meta.players.push(p);
      });
      const V = { t: 0, i: 0 };
      S.tick = (dt) => {
        const pls = S.meta.players, ball = S.meta.ball; if (!ball || pls.length < 4) return;
        const pl0 = A.playerPos(); if (dist2(spot.x, spot.z, pl0.x, pl0.z) > 90 * 90) return;
        const a = pls[V.i % 4], b = pls[(V.i + 1) % 4];
        if (!a.life || !b.life || a.dead || b.dead) { ball.visible = false; return; }
        ball.visible = true; V.t += dt; const u = V.t / 1.5;
        if (u >= 1) { V.t = 0; V.i++; b.rig.playAction('throw'); return; }
        ball.position.set(a.x + (b.x - a.x) * u, gy + 1.15 + 2.6 * 4 * u * (1 - u) + 0.0, a.z + (b.z - a.z) * u);
      };
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 5 swimmers
  swim: {
    weight: (c) => 1.6 * c.day * (1 - c.rain) * zoneK(c, [ZONE.BEACH], 0.08) * (G.sky && G.sky.hour > 10 && G.sky.hour < 18 ? 1.3 : 0.7),
    make(A, c) {
      const m = G.map, pl = A.playerPos(); let spot = null;
      for (let k = 0; k < 40 && !spot; k++) {
        const a = Math.random() * TAU, r = rrange(45, 130), x = pl.x + Math.cos(a) * r, z = pl.z + Math.sin(a) * r;
        if (!m.inBounds(x, z, 40)) continue;
        const gy = G.world.groundY(x, z); if (gy > -1.1 || gy < -2.4) continue;
        let shore = false; for (let q = 0; q < 6; q++) { const aa = q * TAU / 6, sx = x + Math.cos(aa) * 14, sz = z + Math.sin(aa) * 14; if (G.world.groundY(sx, sz) > 0.3) { shore = true; break; } }
        if (!shore || !A.hidden(x, z) || A.sceneNear(x, z, 16)) continue;
        spot = { x, z };
      }
      if (!spot) return null;
      const S = A.newScene('swim', spot.x, spot.z); const n = 1 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) S.jobs.push(() => {
        const x = spot.x + rrange(-3, 3), z = spot.z + rrange(-3, 3);
        const p = A.mkPed(S, { x, z, yaw: Math.random() * TAU, look: 'tourist', mod: beachwear });
        p.life = { type: 'swim', cx: spot.x, cz: spot.z, r: 9, t: rrange(100, 240) };
      });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 1 street vendors (hot dog / grill stands)
  vendor: {
    weight: (c) => 1.0 * c.day * (1 - c.rain) * zoneK(c, [ZONE.BEACH, ZONE.PARK, ZONE.COMMERCIAL, ZONE.DOWNTOWN], 0.1),
    make(A, c) {
      const sp = A.sideSpot(40, 125); if (!sp) return null;
      const yaw = Math.atan2(-sp.nx, -sp.nz), pr = { x: sp.x, z: sp.z, yaw };   // cart front faces the road
      const vl = loc(pr, 0, -1.0), cl = loc(pr, 0, 0.3);
      if (!A.spotOK(vl.x, vl.z, 0.5) || !A.spotOK(cl.x, cl.z, 1.0)) return null;
      const S = A.newScene('vendor', sp.x, sp.z);
      S.jobs.push(() => { const cart = hotdogCart((Math.random() * 6) | 0); cart.position.set(cl.x, G.world.groundY(cl.x, cl.z), cl.z); cart.rotation.y = yaw; A.addObj(S, cart); });
      S.jobs.push(() => {
        const v = A.mkPed(S, { x: vl.x, z: vl.z, yaw, look: 'civ', mod: (a) => { hatCap(a); a.shirt = 0xf4f4f0; a.shirtType = 'tee'; } });
        v.life = { type: 'stand', state: 'idle', yaw, t: rrange(150, 300), gesture: true, say: ['Hot dogs!', 'Get your hot dogs!', 'Fresh and hot!'] };
      });
      const nc = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < nc; i++) S.jobs.push(() => {
        const a0 = loc(pr, rrange(-5, 5), rrange(6, 8)), a1 = loc(pr, (i - 0.5) * 1.0, 1.9 + i * 0.9);
        if (!A.spotOK(a0.x, a0.z, 0.5)) return;
        const p = A.mkPed(S, { x: a0.x, z: a0.z, yaw: Math.atan2(a1.x - a0.x, a1.z - a0.z), look: 'civ' });
        p.life = { type: 'goto', x: a1.x, z: a1.z, speed: 1.5, t: 14, next: { type: 'stand', state: 'idle', face: { x: cl.x, z: cl.z }, t: rrange(6, 12), next: null } };
      });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 1 tourists taking photos downtown
  tourists: {
    weight: (c) => 1.5 * c.day * (1 - c.rain * 0.8) * zoneK(c, [ZONE.DOWNTOWN, ZONE.COMMERCIAL, ZONE.BEACH], 0.04),
    make(A, c) {
      const pl = A.playerPos(); const near = G.world.placement.occ.queryRadius(pl.x, pl.z, 130, A._tq || (A._tq = []));
      let best = null, n = 0;
      for (const b of near) {
        if (b.reserved || b.h < 14 || !b.d) continue; const d2 = dist2(b.x, b.z, pl.x, pl.z); if (d2 < 40 * 40 || d2 > 130 * 130) continue;
        const f = A.doorOf(b, 7.0); if (!A.hidden(f.x, f.z) || A.sceneNear(f.x, f.z, 12)) continue;
        if (G.map.roadDistAt(f.x, f.z) < 1.0 || !A.spotOK(f.x, f.z, 1.0)) continue;
        n++; if (Math.random() * n < 1) best = { b, f };
      }
      if (!best) return null;
      const { b, f } = best; const S = A.newScene('tourists', f.x, f.z);
      const k = 2 + ((Math.random() * 2) | 0); const tx = Math.cos(b.yaw), tz = -Math.sin(b.yaw);
      for (let i = 0; i < k; i++) S.jobs.push(() => {
        const off = (i - (k - 1) / 2) * 1.5; const x = f.x + tx * off, z = f.z + tz * off;
        if (!A.spotOK(x, z, 0.5)) return;
        const yaw = b.yaw + Math.PI + rrange(-0.3, 0.3);
        const p = A.mkPed(S, { x, z, yaw, look: 'tourist' });
        const photographer = i % 2 === 0;
        p.life = { type: 'stand', state: 'idle', yaw, t: rrange(45, 120), photo: photographer, aimPitch: 0.65, say: photographer ? null : ['Amazing!', 'Look at that!', 'Take one of me!'], partner: null, cleanup: (q) => { q.rig.setWeapon(null); } };
        if (photographer) p.rig.setWeapon('camera');
      });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 1 dock / industrial workers
  workers: {
    weight: (c) => 2.2 * (c.hour > 6 && c.hour < 19 ? 1 : 0.25) * zoneK(c, [ZONE.INDUSTRIAL, ZONE.DOCKS, ZONE.AIRPORT], 0.04),
    make(A, c) {
      const kinds = ['crate', 'pallet', 'barrel', 'container', 'container', 'dumpster']; let pr = null;
      const WZ = [ZONE.INDUSTRIAL, ZONE.DOCKS, ZONE.AIRPORT];
      for (const k of kinds.sort(() => Math.random() - 0.5)) { pr = A.pickProp(k, 35, 130, q => WZ.includes(G.map.zoneAt(q.x, q.z)) && A.hidden(q.x, q.z) && !A.sceneNear(q.x, q.z, 10)); if (pr) break; }
      if (!pr) { const sp = A.sideSpot(40, 120); if (!sp || !WZ.includes(sp.zone)) return null; pr = { x: sp.x, z: sp.z, kind: 'spot' }; }
      const S = A.newScene('workers', pr.x, pr.z); const n = 2 + ((Math.random() * 2) | 0);
      const pts = [];
      for (let i = 0; i < 6; i++) { const a = Math.random() * TAU, r = rrange(pr.kind === 'container' ? 5 : 3.5, pr.kind === 'container' ? 9 : 6); const x = pr.x + Math.cos(a) * r, z = pr.z + Math.sin(a) * r; if (A.spotOK(x, z, 0.5) && G.map.roadDistAt(x, z) > 0.3) pts.push({ x, z }); }
      if (pts.length < 2) { A.endScene(S); return null; }
      for (let i = 0; i < n; i++) S.jobs.push(() => {
        const a = pts[i % pts.length], b = pts[(i + 1) % pts.length];
        const p = A.mkPed(S, { x: a.x, z: a.z, yaw: Math.random() * TAU, look: 'worker' });
        const route = [{ x: a.x, z: a.z, wait: rrange(5, 14), state: Math.random() < 0.25 ? 'phone' : Math.random() < 0.3 ? 'crouch' : 'idle', face: { x: pr.x, z: pr.z } }, { x: b.x, z: b.z, wait: rrange(4, 10), face: { x: pr.x, z: pr.z } }];
        p.life = { type: 'route', pts: route, i: 0, speed: 1.3, t: rrange(120, 300) };
      });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 1 cops with a coffee break near the burger joints
  cops: {
    weight: (c) => 1.0 * (c.stars === 0 ? 1 : 0) * zoneK(c, [ZONE.RES_LOW, ZONE.RES_MID, ZONE.COMMERCIAL, ZONE.DOWNTOWN, ZONE.BEACH], 0.3),
    make(A, c) {
      if (c.stars > 0) return null;
      const L = G.landmarks, pl = A.playerPos(); let best = null, n = 0;
      for (const id of ['burger_a', 'burger_b', 'pizza_a', 'pizza_b', 'chicken_a', 'chicken_b', 'chicken_c', 'gas_a', 'gas_b', 'gas_c', 'gas_d']) {
        const l = L[id]; if (!l) continue; const d2 = dist2(l.door.x, l.door.z, pl.x, pl.z); if (d2 < 40 * 40 || d2 > 150 * 150) continue;
        if (!A.hidden(l.door.x, l.door.z) || A.sceneNear(l.door.x, l.door.z, 15)) continue;
        n++; if (Math.random() * n < 1) best = l;
      }
      if (!best) return null;
      const l = best, S = A.newScene('cops', l.door.x, l.door.z);
      const fx = Math.sin(l.yaw), fz = Math.cos(l.yaw), rx = -fz, rz = fx;
      // parked patrol car on the kerb in front of the shop
      S.jobs.push(() => {
        const nr = G.map.nearestRoad(l.door.x, l.door.z, 40); if (!nr) return;
        const e = nr.edge; const side = ((l.door.x - nr.x) * nr.tz - (l.door.z - nr.z) * nr.tx) >= 0 ? 1 : -1;
        const cx = nr.x + nr.tz * side * (e.w / 2 - 1.0), cz = nr.z - nr.tx * side * (e.w / 2 - 1.0);
        for (const v of G.vehicles.list) if (dist2(v.x, v.z, cx, cz) < 36) return;
        const v = G.vehicles.spawn('police', cx, cz, Math.atan2(nr.tx, nr.tz) + (Math.random() < 0.5 ? 0 : Math.PI), { owner: 'parked', color: 0xeeeeee }); S.meta.car = v;
      });
      for (let i = 0; i < 2; i++) S.jobs.push(() => {
        const x = l.door.x + rx * (i ? 1.1 : -0.6) + fx * 0.5, z = l.door.z + rz * (i ? 1.1 : -0.6) + fz * 0.5;
        const p = A.mkPed(S, { x, z, yaw: i ? l.yaw + 2.2 : l.yaw - 2.2, role: 'cop', look: 'cop' });
        p.give('pistol', 60); p.equip('pistol');
        S.meta.cops = S.meta.cops || []; S.meta.cops.push(p);
        const restore = (q) => { q.rig.setWeapon(q.weaponId === 'fist' ? null : q.weaponId); };
        const a = S.meta.cops[0]; const tt = rrange(70, 150);
        if (i === 1 && a && a !== p && a.life) { a.life = { type: 'stand', state: 'idle', partner: p, t: tt, cleanup: restore }; p.life = { type: 'stand', state: 'idle', partner: a, t: tt, cleanup: restore }; }
        else p.life = { type: 'stand', state: 'phone', t: tt, cleanup: restore };
        p.rig.setWeapon(null);
      });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 5 hobos by dumpsters / burning barrels
  homeless: {
    weight: (c) => (0.35 + 1.4 * c.night) * zoneK(c, [ZONE.COMMERCIAL, ZONE.DOWNTOWN, ZONE.INDUSTRIAL, ZONE.RES_MID, ZONE.DOCKS, ZONE.BEACH], 0.12),
    make(A, c) {
      const pr = A.pickProp(Math.random() < 0.55 ? 'barrel' : 'dumpster', 35, 130, q => A.hidden(q.x, q.z) && !A.sceneNear(q.x, q.z, 10)) || A.pickProp('dumpster', 35, 130, q => A.hidden(q.x, q.z) && !A.sceneNear(q.x, q.z, 10));
      if (!pr) return null;
      const S = A.newScene('homeless', pr.x, pr.z); const barrel = pr.kind === 'barrel';
      const gy = pr.y ?? G.world.groundY(pr.x, pr.z);
      const n = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) S.jobs.push(() => {
        const a = Math.random() * TAU, r = rrange(1.3, 2.2); const x = pr.x + Math.cos(a) * r, z = pr.z + Math.sin(a) * r;
        if (!A.spotOK(x, z, 0.5)) return;
        const p = A.mkPed(S, { x, z, yaw: Math.atan2(pr.x - x, pr.z - z), look: 'homeless', cash: 0 });
        p.life = { type: 'stand', state: Math.random() < 0.3 ? 'phone' : 'idle', face: { x: pr.x, z: pr.z }, t: rrange(100, 260), say: ['Spare some change?', 'Got a dollar?', 'Bless you...', 'It\'s cold out here'] };
      });
      if (barrel && c.night > 0.3) {
        let t = 0; S.tick = (dt) => {
          t -= dt; if (t > 0) return; t = 0.16; const p = A.playerPos(); if (dist2(pr.x, pr.z, p.x, p.z) > 70 * 70) return;
          G.fx.fire(pr.x, gy + (pr.kind === 'barrel' ? 0.85 : 1.5), pr.z, 0.55);
        };
      }
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 5 couples taking a walk
  couple: {
    weight: (c) => 0.9 * (0.6 + c.night * 0.6) * zoneK(c, [ZONE.RES_LOW, ZONE.RES_MID, ZONE.COMMERCIAL, ZONE.DOWNTOWN, ZONE.BEACH, ZONE.PARK, ZONE.RICH], 0.1),
    make(A, c) {
      const sp = A.sideSpot(40, 120); if (!sp) return null;
      const S = A.newScene('couple', sp.x, sp.z); let lead = null;
      const yaw = Math.atan2(sp.tx, sp.tz);
      S.jobs.push(() => { lead = A.mkPed(S, { x: sp.x, z: sp.z, yaw, look: Math.random() < 0.4 ? 'tourist' : 'civ', app: G.models.peds.randomAppearance(Math.random, { role: 'civ' }) }); lead.walkSpeed = rrange(0.95, 1.2); lead.life = { type: 'jog', t: S.meta.t = rrange(80, 200), speed: rrange(0.95, 1.15) }; lead.path = { edge: sp.nr.edge, dir: Math.random() < 0.5 ? 1 : -1, s: sp.nr.s, side: sp.side }; });
      S.jobs.push(() => {
        const x = sp.x - sp.nz * 0.0 + sp.tx * 0.3 + sp.nx * 0.85, z = sp.z + sp.tz * 0.3 + sp.nz * 0.85;
        if (!A.spotOK(x, z, 0.5)) return;
        const p = A.mkPed(S, { x, z, yaw, look: 'civ' });
        p.life = { type: 'follow', leader: lead, t: S.meta.t, side: 0.85 };
      });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 1/5 bar fight
  fight: {
    weight: (c) => 0.22 * (0.7 + c.night * 0.9) * zoneK(c, [ZONE.RES_LOW, ZONE.RES_MID, ZONE.COMMERCIAL, ZONE.DOWNTOWN, ZONE.BEACH], 0.1),
    make(A, c) {
      const sp = A.sideSpot(40, 105); if (!sp) return null;
      const S = A.newScene('fight', sp.x, sp.z);
      const ax = sp.x, az = sp.z, bx = sp.x + sp.tx * 1.3, bz = sp.z + sp.tz * 1.3;
      if (!A.spotOK(bx, bz, 0.6)) { A.endScene(S); return null; }
      let a = null;
      const start = (p, q) => { if (!q || q.dead || p.dead) return; p.target = q; p.brave = true; p.duel = true; p.setMode('fight', 16); };
      S.jobs.push(() => { a = A.mkPed(S, { x: ax, z: az, yaw: Math.atan2(bz - az, bx - ax), look: 'civ' }); });
      S.jobs.push(() => {
        const b = A.mkPed(S, { x: bx, z: bz, yaw: Math.atan2(az - bz, ax - bx), look: 'civ' });
        const t = rrange(4, 7);
        a.life = { type: 'stand', state: 'idle', partner: b, t, onEnd: (p) => start(p, b), say: ['What did you say?!', 'Say that again!', 'You want some?!'] };
        b.life = { type: 'stand', state: 'idle', partner: a, t: t + 0.4, onEnd: (p) => start(p, a), say: ['Bring it!', 'Back off!', 'You owe me!'] };
        A.addPOI({ x: (ax + bx) / 2, z: (az + bz) / 2, r: 6.5, until: G.time + 40, kind: 'fight', max: 4, say: ['Fight!', 'Hit him!', 'Somebody stop them!'] });
      });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 1 street performer with an audience
  busker: {
    weight: (c) => 0.9 * c.day * (1 - c.rain) * zoneK(c, [ZONE.DOWNTOWN, ZONE.COMMERCIAL, ZONE.BEACH], 0.03),
    make(A, c) {
      const sp = A.sideSpot(40, 120); if (!sp) return null;
      const S = A.newScene('busker', sp.x, sp.z); const n = 2 + ((Math.random() * 3) | 0);
      S.jobs.push(() => {
        const p = A.mkPed(S, { x: sp.x, z: sp.z, yaw: Math.atan2(-sp.nx, -sp.nz), look: 'civ', mod: (a) => { a.shirtType = 'jacket'; a.shirt = pk([0xe0523a, 0x7a3fc0, 0x3a8ae0]); a.hat = 'beanie'; a.hatColor = pk([0xe8c030, 0xd9306a]); if (a.hairStyle === 'afro' || a.hairStyle === 'mohawk' || a.hairStyle === 'bun') a.hairStyle = 'short'; } });
        p.life = { type: 'stand', state: 'dance', t: rrange(120, 260), yaw: Math.atan2(-sp.nx, -sp.nz), say: ['Thank you!', 'This one\'s for you!', 'Tips are appreciated!'] };
      });
      for (let i = 0; i < n; i++) S.jobs.push(() => {
        const a = (i - (n - 1) / 2) * 0.75 + Math.atan2(-sp.nx, -sp.nz), r = rrange(2.6, 3.6); const x = sp.x + Math.sin(a) * r, z = sp.z + Math.cos(a) * r;
        if (!A.spotOK(x, z, 0.5)) return;
        const p = A.mkPed(S, { x, z, yaw: Math.atan2(sp.x - x, sp.z - z), look: 'civ' });
        p.life = { type: 'stand', state: Math.random() < 0.2 ? 'phone' : 'idle', face: { x: sp.x, z: sp.z }, t: rrange(25, 90), say: ['Bravo!', 'Nice!', 'Encore!', 'Great voice!'], gesture: Math.random() < 0.5 };
      });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 1 police arrest at the roadside
  arrest: {
    weight: (c) => 1.0 * (c.stars === 0 ? 1 : 0) * zoneK(c, [ZONE.RES_LOW, ZONE.RES_MID, ZONE.COMMERCIAL, ZONE.DOWNTOWN], 0.2) * (0.8 + c.night * 0.6),
    make(A, c) {
      if (c.stars > 0) return null;
      const sp = A.sideSpot(45, 125); if (!sp) return null;
      const e = sp.nr.edge; const cx = sp.nr.x + sp.nx * (e.w / 2 - 1.1), cz = sp.nr.z + sp.nz * (e.w / 2 - 1.1);
      for (const v of G.vehicles.list) if (dist2(v.x, v.z, cx, cz) < 36) return null;
      const S = A.newScene('arrest', sp.x, sp.z); const yawRoad = Math.atan2(sp.nr.tx, sp.nr.tz);
      S.jobs.push(() => { const v = G.vehicles.spawn('police', cx, cz, yawRoad, { owner: 'parked', color: 0xeeeeee }); v.model.setSiren && v.model.setSiren(true); S.meta.car = v; S.cleanup = () => { if (S.meta.car && G.vehicles.list.includes(S.meta.car) && !S.meta.car.driver) S.meta.car.model.setSiren && S.meta.car.model.setSiren(false); }; });
      const tx = sp.nr.tx, tz = sp.nr.tz;
      let suspect = null;
      S.jobs.push(() => { suspect = A.mkPed(S, { x: sp.x, z: sp.z, yaw: yawRoad, look: 'civ', mod: hoodDark }); suspect.life = { type: 'stand', state: 'cower', yaw: Math.atan2(-sp.nx, -sp.nz), t: rrange(60, 130), say: ['I didn\'t do anything!', 'This is harassment!', 'Come on, man...'] }; });
      for (let i = 0; i < 2; i++) S.jobs.push(() => {
        const x = sp.x + tx * (i ? 1.1 : -1.1) - sp.nx * 0.4, z = sp.z + tz * (i ? 1.1 : -1.1) - sp.nz * 0.4;
        const p = A.mkPed(S, { x, z, yaw: Math.atan2(sp.x - x, sp.z - z), role: 'cop', look: 'cop' });
        p.give('pistol', 40); p.rig.setWeapon(null);
        p.life = { type: 'stand', state: 'idle', face: { x: sp.x, z: sp.z }, t: rrange(60, 130), gesture: i === 0, cleanup: (q) => { q.rig.setWeapon(q.weaponId === 'fist' ? null : q.weaponId); } };
      });
      S.jobs.push(() => { A.addPOI({ x: sp.x, z: sp.z, r: 8, until: G.time + 60, kind: 'arrest', max: 4, say: ['What did he do?', 'Got him!', 'Serves him right.', 'Is that a real arrest?'] }); });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 1 wedding party outside the church
  wedding: {
    weight: (c, A) => { const l = G.landmarks && G.landmarks.church; if (!l || c.night > 0.3 || c.rain > 0.4 || A.scenes.some(s => s.kind === 'wedding')) return 0; const pl = A.playerPos(); return dist2(l.door.x, l.door.z, pl.x, pl.z) < 170 * 170 ? 3 : 0; },
    make(A, c) {
      const l = G.landmarks.church; const pl = A.playerPos(); if (!A._force && (dist2(l.door.x, l.door.z, pl.x, pl.z) < 35 * 35 || !A.hidden(l.door.x, l.door.z, 70))) return null;
      const fx = Math.sin(l.yaw), fz = Math.cos(l.yaw), rx = -fz, rz = fx; const D = (r, f) => ({ x: l.door.x + rx * r + fx * f, z: l.door.z + rz * r + fz * f });
      const S = A.newScene('wedding', l.door.x, l.door.z);
      const formal = (a) => { if (a.gender === 'f') { a.shirtType = 'dress'; a.skirt = 'knee'; a.shirt = pk([0xd9306a, 0x7a3fc0, 0x40b8c8, 0xe8c030, 0x3bb36b]); } else { a.shirtType = 'suit'; a.shirt = pk([0x2a2d36, 0x3a3f4c, 0x4a4036]); a.pants = a.shirt; a.shoes = 0x1c1c1e; } a.shorts = false; };
      const cb = D(0.5, 1.1), cg = D(-0.5, 1.1), mid = D(0, 1.1);
      S.jobs.push(() => { const p = A.mkPed(S, { x: cb.x, z: cb.z, yaw: l.yaw, look: 'civ', mod: (a) => { a.gender = 'f'; a.shirtType = 'dress'; a.skirt = 'knee'; a.shirt = 0xfafafa; a.hairStyle = 'bun'; a.hat = 'none'; a.shorts = false; } }); p.life = { type: 'stand', state: 'idle', yaw: l.yaw, t: rrange(150, 300), gesture: true, say: ['I do!', 'Best day ever!'] }; });
      S.jobs.push(() => { const p = A.mkPed(S, { x: cg.x, z: cg.z, yaw: l.yaw, look: 'civ', mod: (a) => { a.gender = 'm'; a.shirtType = 'suit'; a.shirt = 0x1e2026; a.pants = 0x1e2026; a.shoes = 0x111111; a.shorts = false; a.accent = 0xeeeeee; } }); p.life = { type: 'stand', state: 'idle', yaw: l.yaw, t: rrange(150, 300), gesture: true }; });
      const n = 4 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) S.jobs.push(() => {
        const side = i % 2 ? 1 : -1, k = (i >> 1); const w = D(side * (1.9 + k * 1.15), 1.0 + (k % 2) * 0.35);
        if (!A.spotOK(w.x, w.z, 0.45)) return;
        const p = A.mkPed(S, { x: w.x, z: w.z, yaw: Math.atan2(mid.x - w.x, mid.z - w.z), look: 'civ', mod: formal });
        p.life = { type: 'stand', state: Math.random() < 0.2 ? 'phone' : 'idle', face: { x: mid.x, z: mid.z }, t: rrange(120, 280), gesture: Math.random() < 0.4, say: ['Congratulations!', 'What a lovely couple!', 'Throw the rice!'] };
      });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 1 protest picket line outside city hall
  protest: {
    weight: (c, A) => { const l = G.landmarks && G.landmarks.city_hall; if (!l || c.night > 0.3 || c.rain > 0.4 || A.scenes.some(s => s.kind === 'protest')) return 0; const pl = A.playerPos(); return dist2(l.door.x, l.door.z, pl.x, pl.z) < 170 * 170 ? 2.5 : 0; },
    make(A, c) {
      const l = G.landmarks.city_hall; const pl = A.playerPos(); if (!A._force && (dist2(l.door.x, l.door.z, pl.x, pl.z) < 35 * 35 || !A.hidden(l.door.x, l.door.z, 70))) return null;
      const fx = Math.sin(l.yaw), fz = Math.cos(l.yaw), rx = -fz, rz = fx; const S = A.newScene('protest', l.door.x, l.door.z); const n = 5 + ((Math.random() * 3) | 0);
      const P = (r) => ({ x: l.door.x + rx * r + fx * 1.0, z: l.door.z + rz * r + fz * 1.0 });
      const a = P(-8), b = P(8);
      for (let i = 0; i < n; i++) S.jobs.push(() => {
        const s0 = P(-8 + i * 2.1); if (!A.spotOK(s0.x, s0.z, 0.45)) return;
        const p = A.mkPed(S, { x: s0.x, z: s0.z, yaw: l.yaw, look: 'civ' });
        const fwd = i % 2 ? [a, b] : [b, a];
        p.life = { type: 'route', pts: [{ x: fwd[0].x + (i % 3) * 0.4, z: fwd[0].z }, { x: fwd[1].x + (i % 3) * 0.4, z: fwd[1].z }], i: 0, speed: 1.05, t: rrange(150, 300), gesture: true, say: ['Hey hey, ho ho!', 'Justice now!', 'We want change!', 'Whose streets? Our streets!'] };
      });
      return S;
    }
  },

  // ------------------------------------------------------------------------------------------ 5 outside Club Zenith after dark
  club: {
    weight: (c, A) => {
      const club = G.landmarks && G.landmarks.club; if (!club) return 0;
      if (c.night < 0.55 && !(c.hour > 20 || c.hour < 4)) return 0;
      if (A.scenes.some(s => s.kind === 'club')) return 0;
      const pl = A.playerPos(); const d2 = dist2(club.door.x, club.door.z, pl.x, pl.z);
      return d2 < 170 * 170 ? 6 : 0;
    },
    make(A, c) {
      const club = G.landmarks.club; const pl = A.playerPos(); const d2 = dist2(club.door.x, club.door.z, pl.x, pl.z);
      if (d2 < 30 * 30 || !(A._force || A.hidden(club.door.x, club.door.z, 70))) return null;
      const S = A.newScene('club', club.door.x, club.door.z);
      const fx = Math.sin(club.yaw), fz = Math.cos(club.yaw), rx = -fz, rz = fx;
      const P = (r, f) => ({ x: club.door.x + rx * r + fx * f, z: club.door.z + rz * r + fz * f });
      const faceDoor = { x: club.door.x, z: club.door.z };
      // bouncer
      S.jobs.push(() => { const w = P(1.6, 0.6); const p = A.mkPed(S, { x: w.x, z: w.z, yaw: club.yaw, look: 'business', mod: (a) => { a.build = 'big'; a.gender = 'm'; a.glasses = true; a.hairStyle = 'bald'; } }); p.life = { type: 'stand', state: 'idle', yaw: club.yaw, t: 1e9 }; });
      // queue along the wall
      const qn = 3 + ((Math.random() * 3) | 0);
      for (let i = 0; i < qn; i++) S.jobs.push(() => {
        const w = P(3.3 + i * 1.25, 1.0); if (!A.spotOK(w.x, w.z, 0.5)) return;
        const p = A.mkPed(S, { x: w.x, z: w.z, yaw: Math.atan2(faceDoor.x - w.x, faceDoor.z - w.z), look: 'civ', mod: clubwear });
        p.life = { type: 'stand', state: Math.random() < 0.4 ? 'phone' : 'idle', face: i === 0 ? faceDoor : { x: w.x - rx * 2, z: w.z - rz * 2 }, t: rrange(90, 220), say: ['Come on, let us in!', 'This line is forever', 'Is Zenith any good?'] };
      });
      // dancers spilling onto the pavement
      for (let i = 0; i < 3; i++) S.jobs.push(() => {
        const w = P(-2.4 - i * 1.6, 1.2 + (i % 2) * 0.6); if (!A.spotOK(w.x, w.z, 0.5)) return;
        const p = A.mkPed(S, { x: w.x, z: w.z, yaw: Math.random() * TAU, look: 'civ', mod: clubwear });
        p.life = { type: 'stand', state: 'dance', t: rrange(90, 200), yaw: club.yaw + rrange(-1, 1) };
      });
      // a couple of drunks wobbling along the pavement
      for (let i = 0; i < 2; i++) S.jobs.push(() => {
        const w = P(-6 - i * 2, 2); if (!A.spotOK(w.x, w.z, 0.5)) return;
        const p = A.mkPed(S, { x: w.x, z: w.z, yaw: Math.random() * TAU, look: 'civ', mod: clubwear });
        p.life = { type: 'drunk', t: rrange(80, 160) };
      });
      return S;
    }
  }
};
