// Ambient city life: scene spawner (people on benches, at bus stops, chatting, jogging, sunbathing, tourists, club queue ...),
// pedestrian reactions (near misses, horns, armed player, crowds around crashes / bodies, loose cash), speech bubbles,
// bus-stop transit, roaming emergency/patrol vehicles and traffic-jam honking.  Scene builders live in ambient_scenes.js,
// random world events (accidents, muggings, chases ...) in events_world.js.
import * as THREE from 'three';
import { G } from './state.js';
import { Ped } from './peds.js';
import { DriverAI } from './driverai.js';
import { endLife } from './lifebrain.js';
import { clamp, dist2, rrange, pick, pickWeighted, TAU } from './util.js';
import { ZONE, CLS } from './mapdata.js';
import { SCENES } from './ambient_scenes.js';

// ------------------------------------------------------------------------------------------------ speech bubbles
class Bubbles {
  constructor() { this.cache = new Map(); this.active = []; this.pool = []; }
  tex(text) {
    let e = this.cache.get(text); if (e) return e;
    const c = document.createElement('canvas'); c.width = 384; c.height = 64; const x = c.getContext('2d');
    x.font = 'bold 38px Arial, Helvetica, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const w = Math.min(372, x.measureText(text).width + 8);
    x.lineJoin = 'round'; x.lineWidth = 9; x.strokeStyle = 'rgba(0,0,0,0.85)'; x.strokeText(text, 192, 34, 372);
    x.fillStyle = '#fff6d8'; x.fillText(text, 192, 34, 372);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    e = { tex: t, w }; if (this.cache.size > 60) { const k = this.cache.keys().next().value; this.cache.get(k).tex.dispose(); this.cache.delete(k); }
    this.cache.set(text, e); return e;
  }
  say(p, text, dur = 2.2, force = false) {
    const cam = G.cam; if (!cam || !G.scene) return;
    if (this.active.length >= 4) return;
    const dx = p.x - cam.position.x, dz = p.z - cam.position.z; if (dx * dx + dz * dz > (force ? 38 : 30) ** 2) return;
    for (const b of this.active) if (b.p === p) return;
    const e = this.tex(text);
    let s = this.pool.pop();
    if (!s) { s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false })); s.renderOrder = 20; s.center.set(0.5, 0); }
    s.material.map = e.tex; s.material.opacity = 0; s.material.needsUpdate = true;
    const h = 0.32; s.scale.set(h * 6 * (e.w / 384) + 0.25, h, 1);
    s.position.set(p.x, p.y + 2.05, p.z); s.visible = true; G.scene.add(s);
    this.active.push({ p, s, t: 0, dur });
  }
  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i]; b.t += dt; const p = b.p;
      const gone = p.dead || p.removeMe || !G.peds.list.includes(p);
      if (gone || b.t > b.dur) { G.scene.remove(b.s); this.pool.push(b.s); this.active.splice(i, 1); continue; }
      const k = Math.min(1, b.t / 0.15, (b.dur - b.t) / 0.4);
      b.s.material.opacity = clamp(k, 0, 1);
      b.s.position.set(p.x, p.y + (p.crouch ? 1.35 : p.life && p.life.type === 'sit' ? 1.7 : 2.0) + b.t * 0.06, p.z);
    }
  }
  clear() { for (const b of this.active) { G.scene.remove(b.s); this.pool.push(b.s); } this.active.length = 0; }
}

class Scene {
  constructor(kind, x, z) { this.kind = kind; this.x = x; this.z = z; this.peds = []; this.objs = []; this.jobs = []; this.t = 0; this.tick = null; this.dead = false; this.meta = {}; }
}

const GREET = ['Hey!', 'Hi there', 'Yo', 'Nice day, huh?', 'What\'s up?', 'Hello'];
const GAWK = ['Oh my god!', 'Is he okay?', 'Somebody call an ambulance!', 'Did you see that?', 'Wow...', 'Call the police!'];
const ENTERABLE = new Set(['shop_strip', 'liquor_store', 'fast_food', 'apartment_low', 'apartment_mid', 'office_low', 'office_mid', 'skyscraper', 'house_small', 'house_ranch', 'house_two_story', 'duplex', 'motel', 'gym', 'bank', 'church', 'school', 'hospital', 'gas_station', 'nightclub', 'garage_shop']);
const _vq = [];

export class Ambient {
  constructor() {
    this.enabled = true; this.scenes = []; this.pois = []; this.exits = []; this.bubbles = new Bubbles(); this.transit = new Transit(this);
    this.time = 0; this.tA = 0; this.tB = 0; this.tC = 0; this.tD = 0; this.tS = 3;
    this.cost = { sum: 0, n: 0, max: 0, avg: 0 }; this.made = {}; this._idx = null; this.maxScenes = 7; this.maxScenePeds = 26;
    this.forcedOnly = false; this.stats = {};
    G.events.on('wantedChanged', (n, old) => { if (n > 0 && old === 0) this.onWanted(); });
  }

  stat(k) { this.stats[k] = (this.stats[k] || 0) + 1; }
  say(p, text, dur = 2.2, force = false) { if (this.enabled) { this.stat('say'); this.bubbles.say(p, text, dur, force); } }
  playerPos() { const pl = G.player; const v = pl.vehicle; return v ? v : pl; }
  get sceneCount() { return this._sc || 0; }

  // ------------------------------------------------------------------------------------ helpers for scene builders
  index() {
    if (this._idx) return this._idx;
    const want = new Set(['bench', 'busstop', 'dumpster', 'grill', 'barrel', 'crate', 'pallet', 'container', 'vending', 'phonebooth', 'umbrella_beach', 'lifeguard_tower', 'trashcan', 'cone']);
    const idx = {}; for (const pr of G.world.placement.props) if (want.has(pr.kind)) (idx[pr.kind] || (idx[pr.kind] = [])).push(pr);
    return (this._idx = idx);
  }
  pickProp(kind, rmin, rmax, filter = null, near = null) {
    const arr = this.index()[kind]; if (!arr || !arr.length) return null;
    const c = near || this.playerPos(); let n = 0, chosen = null;
    const r2a = rmin * rmin, r2b = rmax * rmax;
    for (let i = 0; i < arr.length; i++) {
      const pr = arr[i]; if (pr.removed) continue;
      if (G.world.groundY(pr.x, pr.z) < 0.4) continue;
      const d2 = dist2(pr.x, pr.z, c.x, c.z); if (d2 < r2a || d2 > r2b) continue;
      if (filter && !filter(pr)) continue;
      n++; if (Math.random() * n < 1) chosen = pr;   // reservoir sampling
    }
    return chosen;
  }
  hidden(x, z, hideR = 95) { if (this._force) return true; const pl = this.playerPos(); const d2 = dist2(x, z, pl.x, pl.z); return d2 > hideR * hideR || !G.population.visible(x, 0, z, hideR); }
  spotOK(x, z, r = 0.6) {
    if (!G.map.inBounds(x, z, 25)) return false;
    if (G.world.groundY(x, z) < 0.45) return false;
    const q = { x, z }; return !G.world.pushCircle(q, r);
  }
  sceneNear(x, z, r) { for (const s of this.scenes) if (dist2(s.x, s.z, x, z) < r * r) return true; return false; }
  newScene(kind, x, z) { const S = new Scene(kind, x, z); this.scenes.push(S); this.made[kind] = (this.made[kind] || 0) + 1; return S; }
  mkPed(S, o) {
    const P = G.models.peds;
    const app = o.app || P.randomAppearance(Math.random, { role: o.look || 'civ', gang: o.gang || 0 });
    if (o.mod) o.mod(app);
    const p = new Ped({ x: o.x, z: o.z, role: o.role || 'civ', gang: o.gang || 0, appearance: app, yaw: o.yaw || 0 });
    if (o.weapon) p.give(o.weapon, o.ammo ?? 60);
    p.scene = S; if (S) S.peds.push(p); G.peds.add(p);
    if (o.cash !== undefined) p.cash = o.cash;
    return p;
  }
  addObj(S, o) { G.scene.add(o); S.objs.push(o); return o; }
  // a spot on the pavement next to a road, out of the player's sight. returns {x,z,tx,tz,nr,zone}
  sideSpot(rmin = 40, rmax = 125, hideR = 95) {
    const pl = this.playerPos();
    for (let k = 0; k < 6; k++) {
      const nr = G.population.pickRoadSpot(pl.x, pl.z, rmin, rmax, 8, this._force ? 0 : hideR); if (!nr) return null;
      const e = nr.edge; const side = Math.random() < 0.5 ? 1 : -1; const nx = nr.tz * side, nz = -nr.tx * side;
      const off = e.w / 2 + 1.9 + Math.random() * 0.8; const x = nr.x + nx * off, z = nr.z + nz * off;
      if (!this.spotOK(x, z, 1.2) || G.map.roadDistAt(x, z) < 0.8) continue;
      if (this.sceneNear(x, z, 12)) continue;
      return { x, z, tx: nr.tx, tz: nr.tz, nx, nz, nr, zone: G.map.zoneAt(x, z), side };
    }
    return null;
  }
  doorOf(b, extra = 1.0) { return { x: b.x + Math.sin(b.yaw) * (b.d / 2 + extra), z: b.z + Math.cos(b.yaw) * (b.d / 2 + extra) }; }
  // a clear sand spot on the beach (for volleyball courts, parasols)
  sandSpot(rmin = 40, rmax = 130, clear = 4, tries = 30) {
    const m = G.map, pl = this.playerPos();
    for (let k = 0; k < tries; k++) {
      const a = Math.random() * TAU, r = rrange(rmin, rmax), x = pl.x + Math.cos(a) * r, z = pl.z + Math.sin(a) * r;
      if (!m.inBounds(x, z, 40) || m.classAt(x, z) !== CLS.SAND || m.roadDistAt(x, z) < 8) continue;
      const wd = m.waterDist[m._idx(x, z)] * 2; if (wd < 12 || wd > 70) continue;
      if (!this.hidden(x, z) || this.sceneNear(x, z, 14)) continue;
      let ok = true; for (const [dx, dz] of [[0, 0], [clear, clear], [-clear, clear], [clear, -clear], [-clear, -clear]]) if (!this.spotOK(x + dx, z + dz, 1.0)) { ok = false; break; }
      if (ok) return { x, z };
    }
    return null;
  }
  // direction (unit vector) pointing towards the sea from a sand point
  seaDir(x, z) {
    const m = G.map; let best = 1e9, bx = 0, bz = -1;
    for (let k = 0; k < 8; k++) { const a = k * TAU / 8, dx = Math.cos(a), dz = Math.sin(a); const w = m.waterDist[m._idx(x + dx * 40, z + dz * 40)]; if (w < best) { best = w; bx = dx; bz = dz; } }
    return { x: bx, z: bz };
  }

  // ------------------------------------------------------------------------------------ points of interest (crowds)
  addPOI(o) { const p = { x: 0, z: 0, r: 7, until: G.time + 30, kind: 'crash', max: 6, list: [], key: null, say: GAWK, ...o }; this.pois.push(p); return p; }

  // ------------------------------------------------------------------------------------ update
  update(dt) {
    const t0 = performance.now();
    this.bubbles.update(dt);
    const g = G.game;
    if (!this.enabled || !g || g.state === 'title' || !G.player) return;
    this.time += dt;
    // one queued ped per step (building a rig is a few ms)
    if (this.scenes.length) this.runJobs();
    for (const S of this.scenes) if (S.tick) S.tick(dt, this);
    if ((this.tA -= dt) <= 0) { this.tA = 0.2; this.reactTick(); }
    if ((this.tB -= dt) <= 0) { this.tB = 1.0; this.slowTick(); }
    this.transit.update(dt);
    if ((this.tS -= dt) <= 0) { this.tS = 2.2; this.spawnScene(); }
    const ms = performance.now() - t0; const c = this.cost; c.sum += ms; c.n++; if (ms > c.max) c.max = ms;
  }

  runJobs() {
    for (const S of this.scenes) {
      if (!S.jobs.length) continue;
      const job = S.jobs.shift();
      try { job(S); } catch (e) { console.error('ambient job', S.kind, e); S.jobs.length = 0; S.dead = true; }
      return;
    }
  }

  budget() {
    let n = 0; for (const S of this.scenes) for (const p of S.peds) if (p.scene === S && G.peds.list.includes(p)) n++;
    this._sc = n; return n;
  }

  spawnScene() {
    const g = G.game; if (g.state !== 'play' || G.paused || g.inCutscene) return;
    if (this.forcedOnly) return;
    const pop = G.population; if (!pop.enabled) return;
    const md = G.missionDensity ?? 1; if (md < 0.3) return;
    if (this.scenes.length >= this.maxScenes) return;
    if (this.scenes.some(S => S.jobs.length)) return;
    const dens = (pop.density || 1) * md;
    if (this.budget() >= this.maxScenePeds * dens) return;
    const pl = this.playerPos();
    const hour = G.sky ? G.sky.hour : 12, night = G.sky ? G.sky.night : 0;
    const ctx = { hour, night, day: 1 - night, zone: G.map.zoneAt(pl.x, pl.z), stars: G.police ? G.police.stars : 0, rain: G.sky ? G.sky.rain : 0, px: pl.x, pz: pl.z, dens, inCar: !!G.player.vehicle, gang: G.map.gangAt(pl.x, pl.z) };
    for (let tries = 0; tries < 3; tries++) {
      const names = Object.keys(SCENES); const ws = names.map(n => Math.max(0, SCENES[n].weight(ctx, this)));
      let tot = 0; for (const w of ws) tot += w; if (tot <= 0) return;
      let r = Math.random() * tot, k = 0; for (; k < ws.length - 1; k++) { r -= ws[k]; if (r <= 0) break; }
      const kind = names[k];
      const S = this.makeScene(kind, ctx); if (S) return;
    }
  }
  makeScene(kind, ctx = null) {
    if (!ctx) { const pl = this.playerPos(); ctx = { hour: G.sky.hour, night: G.sky.night, day: 1 - G.sky.night, zone: G.map.zoneAt(pl.x, pl.z), stars: G.police.stars, rain: G.sky.rain, px: pl.x, pz: pl.z, dens: 1, inCar: !!G.player.vehicle, gang: G.map.gangAt(pl.x, pl.z) }; }
    let S = null;
    try { S = SCENES[kind].make(this, ctx); } catch (e) { console.error('ambient scene', kind, e); }
    return S;
  }
  // test hook: force a scene near the player (or at x,z), skipping the hidden/visibility rules
  forceScene(kind) { this._force = true; let S = null; try { S = this.makeScene(kind); } finally { this._force = false; } return S; }

  endScene(S, removeMembers) {
    S.dead = true;
    for (const p of S.peds) { if (p.scene !== S) continue; p.scene = null; if (removeMembers && G.peds.list.includes(p) && !p.mission) { if (p.life) G.peds.remove(p); else if (!p.vehicle) G.peds.remove(p); } }
    for (const o of S.objs) { G.scene.remove(o); }
    if (S.cleanup) S.cleanup();
    const i = this.scenes.indexOf(S); if (i >= 0) this.scenes.splice(i, 1);
  }

  // ------------------------------------------------------------------------------------ 1 Hz housekeeping
  slowTick() {
    const pl = this.playerPos();
    const g = G.game;
    // scenes: release members that turned into ordinary pedestrians, drop scenes that are gone / far away
    for (let i = this.scenes.length - 1; i >= 0; i--) {
      const S = this.scenes[i]; S.t += 1;
      let alive = 0;
      for (const p of S.peds) { if (p.scene !== S) continue; if (p.removeMe || !G.peds.list.includes(p)) { p.scene = null; continue; } if (!p.life && !p.dead) { p.scene = null; continue; } alive++; }
      const far = dist2(S.x, S.z, pl.x, pl.z) > 155 * 155;
      if ((alive === 0 && !S.jobs.length) || far || g.state === 'title') this.endScene(S, far || g.state === 'title');
    }
    if (g.state !== 'play') return;
    this.budget();
    if (G.time > (this._audT || 0)) { this._audT = G.time + rrange(50, 120) * (1 - 0.4 * (G.sky ? G.sky.night : 0)); if (G.audio && G.audio.ready && !(G.missions && G.missions.active) && !this.forcedOnly) { const a = Math.random() * TAU; G.audio.play('siren_short', { pos: { x: pl.x + Math.cos(a) * 170, y: 2, z: pl.z + Math.sin(a) * 170 }, volume: 0.28, pitch: rrange(0.9, 1.1) }); } }
    this.poiTick(pl); this.cashTick(); this.doorTick(pl); this.honkTick(pl); this.carTick(pl);
    this.transit.slow(pl);
    this.patrolTick(pl);
  }

  // ------------------------------------------------------------------------------------ pedestrian reactions (5 Hz)
  reactTick() {
    const g = G.game; if (g.state !== 'play') return;
    const pl = G.player; const px = pl.vehicle ? pl.vehicle.x : pl.x, pz = pl.vehicle ? pl.vehicle.z : pl.z;
    const armed = !pl.vehicle && pl.hasGunDrawn && pl.hasGunDrawn();
    const now = G.time; const V = G.vehicles;
    for (const p of G.peds.list) {
      if (p.isPlayer || p.dead || p.vehicle || p.mission || p.removeMe) continue;
      const dx = p.x - px, dz = p.z - pz, d2 = dx * dx + dz * dz; if (d2 > 48 * 48) continue;
      if (p.role !== 'civ' && p.role !== 'worker') continue;
      if (p.mode === 'flee' || p.mode === 'fight') continue;
      // vehicle near miss
      if (now - (p.reactT || -9) > 3.5 && p.downT <= 0) {
        const vs = V.hash.queryRadius(p.x, p.z, 4, _vq);
        for (const v of vs) {
          const sp = v.totalSpeed; if (sp < 10 || v.isHeli || v.wrecked) continue;
          const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = p.x - v.x, rz = p.z - v.z;
          const lon = rx * fx + rz * fz, lat = rx * fz - rz * fx, al = Math.abs(lat);
          if (Math.abs(lon) > v.def.length / 2 + 1.5 || al < v.def.width / 2 + 0.45 || al > v.def.width / 2 + 2.2) continue;
          p.reactT = now; this.stat('nearMiss'); if (p.life) endLife(p);
          p.lookT = 1.5; p.lookAt = v; const s = al > 0 ? (lat > 0 ? 1 : -1) : 1;
          p.vx += fz * s * 3.0; p.vz += -fx * s * 3.0;
          if (Math.random() < 0.65) this.say(p, pick(['Watch it!', 'Hey, slow down!', 'Jerk!', 'Are you crazy?!', 'Whoa!']), 1.8);
          if (Math.random() < 0.2 && G.audio) G.audio.play(p.appearance.gender === 'f' ? 'scream_female' : 'scream_male', { pos: p, volume: 0.5, pitch: rrange(0.95, 1.15) });
          break;
        }
        if (p.reactT === now) continue;
      }
      // fear of an armed player
      if (armed && d2 < 11 * 11 && now - (p.scareT || -99) > 14 && Math.random() < 0.5) {
        const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw); const d = Math.sqrt(d2) || 1;
        if (-(dx * fx + dz * fz) / d > 0.3) {   // in front of the gun
          p.scareT = now;
          if (p.brave && Math.random() < 0.6) { this.say(p, pick(['Put that away!', 'You don\'t scare me!']), 2); p.lookT = 1.5; p.lookAt = pl; }
          else { this.say(p, pick(['Don\'t shoot!', 'Please, no!', 'Take it easy!']), 2); if (p.life) endLife(p); if (Math.random() < 0.5) p.setMode('cower', rrange(3, 6)); else p.flee(pl.x, pl.z, 6); }
          continue;
        }
      }
      // glance / greet when the player walks past
      if (d2 < 3.8 * 3.8 && p.mode === 'walk' && !p.life && !(p.lookT > 0) && now - (p.greetT || -99) > 25 && Math.random() < 0.25) {
        p.greetT = now; p.lookT = 1.3; p.lookAt = pl;
        if (!pl.vehicle && Math.random() < 0.35) this.say(p, pick(GREET), 1.8);
      }
    }
  }

  // ------------------------------------------------------------------------------------ crowds, cash, doors, honks
  poiTick(pl) {
    const now = G.time;
    // discover crashes / fires / bodies
    if (this.pois.length < 6) {
      for (const v of G.vehicles.list) {
        if (!(v.wrecked || v.onFire || (v.health < v.maxHealth * 0.35 && v.totalSpeed < 1.5 && v.owner !== 'parked' && !v.evt)) || v.mission) continue;
        if (dist2(v.x, v.z, pl.x, pl.z) > 85 * 85) continue;
        if (this.pois.some(q => q.key === v)) continue;
        this.addPOI({ x: v.x, z: v.z, r: v.onFire && !v.wrecked ? 13 : 9, until: now + 40, kind: v.onFire ? 'fire' : 'crash', key: v, max: 7 });
        break;
      }
      let bodies = 0; for (const q of this.pois) if (q.kind === 'body') bodies++;
      if (bodies < 2) for (const p of G.peds.list) {
        if (!p.dead || p.deadT > 5 || p.isPlayer || p.role === 'gang' || p.role === 'cop' || p.role === 'swat' || p.scene && false) continue;
        if (dist2(p.x, p.z, pl.x, pl.z) > 60 * 60 || this.pois.some(q => q.key === p)) continue;
        this.addPOI({ x: p.x, z: p.z, r: 4.5, until: now + 28, kind: 'body', key: p, max: 5, say: ['Oh my god, he\'s dead!', 'Somebody call the cops!', 'Is he breathing?', 'Did you see who did this?'] }); break;
      }
    }
    for (let i = this.pois.length - 1; i >= 0; i--) {
      const q = this.pois[i];
      if (now > q.until || (q.key && q.key.removeMe) || dist2(q.x, q.z, pl.x, pl.z) > 140 * 140) { this.pois.splice(i, 1); continue; }
      if (q.key && q.key.x !== undefined && q.kind !== 'body') { q.x = q.key.x; q.z = q.key.z; }
      q.list = q.list.filter(p => G.peds.list.includes(p) && p.life && p.life.poi === q);
      // burning car: bystanders back off
      if (q.kind === 'fire' && q.key && q.key.onFire && !q.key.wrecked) {
        for (const p of G.peds.list) { if (p.dead || p.vehicle || p.isPlayer || p.mission || p.mode === 'flee' || (p.role !== 'civ' && p.role !== 'worker')) continue; if (dist2(p.x, p.z, q.x, q.z) < 8 * 8 && p.life?.poi !== q) p.flee(q.x, q.z, 5); }
      }
      if (q.list.length >= q.max) continue;
      // recruit onlookers
      let tries = 0;
      for (const p of G.peds.list) {
        if (p.dead || p.vehicle || p.isPlayer || p.mission || p.life || p.mode !== 'walk' || (p.role !== 'civ' && p.role !== 'worker')) continue;
        const d2 = dist2(p.x, p.z, q.x, q.z); if (d2 > 38 * 38 || d2 < 4) continue;
        if (Math.random() > 0.3) continue;
        const a = Math.random() * TAU, r = q.r * rrange(0.85, 1.25); const tx = q.x + Math.cos(a) * r, tz = q.z + Math.sin(a) * r;
        if (!this.spotOK(tx, tz, 0.4)) continue;
        const face = { x: q.x, z: q.z };
        const L = { type: 'goto', x: tx, z: tz, speed: 2.1, radius: 1.0, t: 25, poi: q, next: { type: 'stand', state: Math.random() < 0.3 ? 'phone' : 'idle', face, t: rrange(10, 26), poi: q, say: q.say } };
        p.life = L; p.path = null; q.list.push(p); this.stat('gawk');
        if (Math.random() < 0.5) this.say(p, pick(q.say), 2.4);
        if (++tries >= 2 || q.list.length >= q.max) break;
      }
    }
  }
  cashTick() {
    const list = G.pickups.list; if (!list.length) return;
    for (const pk of list) {
      if (pk.kind !== 'cash' || pk.dead || pk.mission || pk.life < 8) continue;   // never grab a quest pickup
      if (pk.grabbed) { const g = pk.grabber; if (!g || g.dead || g.removeMe || !g.life || g.life.type !== 'goto') pk.grabbed = false; else continue; }
      let best = null, bd = 12 * 12;
      for (const p of G.peds.list) { if (p.dead || p.vehicle || p.isPlayer || p.mission || p.life || p.mode !== 'walk' || p.role !== 'civ') continue; const d2 = dist2(p.x, p.z, pk.x, pk.z); if (d2 < bd) { bd = d2; best = p; } }
      if (!best || Math.random() > 0.4) continue;
      pk.grabbed = true; pk.grabber = best;
      best.life = { type: 'goto', x: pk.x, z: pk.z, speed: 2.8, radius: 0.9, t: 10, onArrive: (p) => { if (!pk.dead) { G.pickups.remove(pk); this.stat('cashGrab'); p.cash += pk.amount; G.audio && G.audio.play('cash', { pos: p, volume: 0.4, pitch: 1.3 }); this.say(p, pick(['Score!', 'Finders keepers!', 'Nice!']), 2); } } };
      best.path = null;
    }
  }
  doorTick(pl) {
    const now = G.time;
    // people coming back out of buildings
    for (let i = this.exits.length - 1; i >= 0; i--) {
      const e = this.exits[i]; if (now < e.t) continue; this.exits.splice(i, 1);
      if (dist2(e.x, e.z, pl.x, pl.z) > 100 * 100 || G.peds.list.length > 130) continue;
      const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw); let x = 0, z = 0, ok = false;
      for (const k of [0.5, 1.2, 2.0, 3.0]) { x = e.x + fx * k; z = e.z + fz * k; if (this.spotOK(x, z, 0.35)) { ok = true; break; } }
      if (!ok) continue;
      const p = new Ped({ x, z, role: 'civ', appearance: e.app, yaw: e.yaw }); p.walkSpeed = 1.2 + Math.random() * 0.4; G.peds.add(p);
      G.audio && G.audio.play('door_open', { pos: { x: e.x, y: 1, z: e.z }, volume: 0.35 }); this.stat('doorExit');
      break;
    }
    if (this.exits.length > 10) this.exits.length = 10;
    // someone walks into a shop / home
    if (G.peds.list.length < 4) return;
    for (let n = 0; n < 4; n++) {
      const p = G.peds.list[(Math.random() * G.peds.list.length) | 0];
      if (!p || p.isPlayer || p.dead || p.vehicle || p.mission || p.life || p.mode !== 'walk' || p.role !== 'civ' || p.removeMe) continue;
      if (dist2(p.x, p.z, pl.x, pl.z) > 70 * 70 || Math.random() > 0.05) continue;
      const near = G.world.placement.occ.queryRadius(p.x, p.z, 14, this._bq || (this._bq = []));
      let best = null, bd = 10 * 10;
      for (const b of near) { if (!ENTERABLE.has(b.type) || b.reserved) continue; const d = this.doorOf(b, 1.1); const d2 = dist2(d.x, d.z, p.x, p.z); if (d2 < bd) { bd = d2; best = b; } }
      if (!best) continue;
      const door = this.doorOf(best, 0.9);
      p.life = { type: 'goto', x: door.x, z: door.z, speed: 1.5, radius: 0.8, t: 14, vanish: true, onArrive: (q) => { this.stat('doorEnter'); G.audio && G.audio.play('door_close', { pos: { x: door.x, y: 1, z: door.z }, volume: 0.3 }); if (this.exits.length < 10) this.exits.push({ t: G.time + rrange(10, 28), x: door.x, z: door.z, yaw: best.yaw, app: q.appearance }); } };
      p.path = null; break;
    }
  }
  // somebody walks up to a parked car, gets in and drives off
  carTick(pl) {
    if (G.time < (this._carT || 0) || G.police.stars > 0) return; this._carT = G.time + rrange(7, 16);
    if (G.vehicles.list.length > 75) return;
    let car = null, n = 0;
    for (const v of G.vehicles.list) {
      if (v.owner !== 'parked' || v.driver || v.wrecked || v.mission || v.locked || v.isBike || v.type === 'police' || v.type === 'ambulance' || v.evt) continue;
      const d2 = dist2(v.x, v.z, pl.x, pl.z); if (d2 < 22 * 22 || d2 > 75 * 75) continue;
      n++; if (Math.random() * n < 1) car = v;
    }
    if (!car) return;
    let who = null, bd = 14 * 14;
    for (const p of G.peds.list) { if (p.isPlayer || p.dead || p.vehicle || p.mission || p.life || p.mode !== 'walk' || p.role !== 'civ') continue; const d2 = dist2(p.x, p.z, car.x, car.z); if (d2 < bd) { bd = d2; who = p; } }
    if (!who) return;
    const dw = car.doorWorldPos(0);
    who.path = null;
    who.life = { type: 'goto', x: dw.x, z: dw.z, speed: 1.9, radius: 1.3, t: 14, onArrive: (p) => {
      if (car.driver || car.wrecked || !G.vehicles.list.includes(car) || car.mission) return;
      p.life = null; p.setMode('walk');
      car.owner = 'traffic'; if (!car.ai) { const ai = new DriverAI(car, 'traffic', {}); ai.speedFactor = rrange(0.85, 1.05); }
      p.enterVehicle(car, 0, false); this.stat('carGetIn');
    } };
  }
  honkTick(pl) {
    let n = 0;
    for (const v of G.vehicles.list) {
      if (n >= 2) break;
      if (v.owner !== 'traffic' || !v.ai || !v.driver || v.driver.isPlayer || v.ai.lightStop) continue;
      if (!v.ai.blocked || Math.abs(v.speed) > 0.4 || (v.ai.blockedStopT || 0) < 2.5) continue;
      if (dist2(v.x, v.z, pl.x, pl.z) > 70 * 70 || Math.random() > 0.3) continue;
      v.honk(); n++;
    }
  }

  // ------------------------------------------------------------------------------------ roaming emergency / patrol vehicles
  patrolTick(pl) {
    const g = G.game; if (g.state !== 'play' || (G.missionDensity ?? 1) < 0.5) return;
    if ((this.tC -= 1) > 0) return; this.tC = rrange(8, 16);
    let amb = 0; for (const v of G.vehicles.list) if (v.amb && !v.wrecked) amb++;
    const stars = G.police.stars; if (stars > 0 || amb >= 3 || G.vehicles.list.length > 70) return;
    const night = G.sky.night, zone = G.map.zoneAt(pl.x, pl.z);
    const downtown = zone === ZONE.DOWNTOWN || zone === ZONE.COMMERCIAL;
    const table = [['police', 2.2 + (downtown ? 1.6 : 0) + night * 1.2], ['ambulance', 0.8], ['firetruck', 0.35], ['taxi', 0]];
    const kind = pickWeighted(table, e => e[1])[0];
    this.spawnAmbientVehicle(kind);
  }
  spawnAmbientVehicle(kind) {
    const pl = this.playerPos();
    const nr = G.population.pickRoadSpot(pl.x, pl.z, 110, 210, 12, 150); if (!nr) return null;
    const v = spawnDriven(nr, kind === 'firetruck' ? 'truck' : kind, { owner: 'traffic', color: kind === 'firetruck' ? 0xc41e1e : kind === 'police' ? 0xeeeeee : undefined, role: kind === 'police' ? 'cop' : kind === 'ambulance' ? 'medic' : kind === 'firetruck' ? 'fireman' : 'civ', speedFactor: kind === 'police' ? 1.05 : 1.45 });
    if (!v) return null;
    v.amb = true;
    if (kind === 'ambulance' || kind === 'firetruck') { v.setSiren(true); }
    else if (kind === 'police' && Math.random() < 0.3) v.setSiren(true);
    if (v.driver && kind === 'police') v.driver.give('pistol', 100);
    return v;
  }
  // a wanted level appeared: nearby patrol cars join in
  onWanted() {
    for (const v of G.vehicles.list) if (v.amb && v.type === 'police' && v.driver && !v.wrecked && dist2(v.x, v.z, G.player.x, G.player.z) < 260 * 260) { v.owner = 'police'; v.amb = false; v.setSiren(true); v.driver.noDespawn = true; }
    for (const S of this.scenes) for (const p of S.peds) if (p.life && (p.role === 'cop')) endLife(p);
  }
}

// ---------------------------------------------------------------------------------------------- shared vehicle spawner
const _lp = {};
// spawn a car on a road edge (nr = nearestRoad result) heading along its direction of travel, with a driver and traffic AI
export function spawnDriven(nr, type, o = {}) {
  const e = nr.edge, nav = G.nav;
  const na = G.map.nodes[e.a], nb = G.map.nodes[e.b]; if (na.deg < 2 && nb.deg < 2) return null;
  const dir = o.dir ?? (Math.random() < 0.5 ? 1 : -1); const lane = o.lane ?? Math.floor(Math.random() * nav.laneCount(e));
  const agent = { edge: e, dir, s: o.s !== undefined ? o.s : (dir > 0 ? nr.s : e.len - nr.s), lane, route: null };
  agent.s = clamp(agent.s, 1, e.len - 1);
  nav.lanePoint(agent, agent.s, _lp);
  for (const v of G.vehicles.list) if (dist2(v.x, v.z, _lp.x, _lp.z) < (o.spacing ?? 11) ** 2) return null;
  const yaw = Math.atan2(_lp.tx, _lp.tz);
  const v = G.vehicles.spawn(type, _lp.x, _lp.z, yaw, { owner: o.owner || 'traffic', color: o.color });
  v.y = G.world.groundY(v.x, v.z) + v.def.wheelRadius; v.applyTransform();
  const role = o.role || 'civ';
  const app = o.app || G.models.peds.randomAppearance(Math.random, { role: role === 'civ' ? (type === 'bus' ? 'worker' : 'civ') : role === 'gang' ? 'gangster' : role, gang: o.gang || 0 });
  const d = new Ped({ x: v.x, z: v.z, role, gang: o.gang || 0, appearance: app }); G.peds.add(d);
  d.enterVehicle(v, 0, true); d.cash = Math.floor(rrange(20, 150));
  if (o.noDespawn) d.noDespawn = true;
  if (o.mode && o.mode !== 'traffic') { const ai = new DriverAI(v, o.mode, o.ai || {}); if (o.speedFactor) ai.speedFactor = o.speedFactor; ai.agent = agent; }
  else { const ai = new DriverAI(v, 'traffic', {}); ai.agent = agent; if (o.speedFactor) ai.speedFactor = o.speedFactor; if (o.cruise) ai.cruise = o.cruise; }
  v.speed = 0; const sp = Math.min(e.cls === CLS.FREEWAY ? 20 : 12, o.speed ?? 12); v.vx = _lp.tx * sp; v.vz = _lp.tz * sp;
  return v;
}

// ---------------------------------------------------------------------------------------------- buses that stop at bus stops
class Transit {
  constructor(A) { this.A = A; this.t = 0; this.spawnT = 6; }
  update(dt) {
    this.t -= dt; if (this.t > 0) return; this.t = 0.2;
    for (const v of G.vehicles.list) {
      const T = v.transit; if (!T) continue;
      if (v.removeMe || !v.ai || v.ai.mode !== 'traffic' || !v.driver || v.wrecked) { if (v.ai && T.sf) v.ai.speedFactor = T.sf; v.transit = null; continue; }
      T.t += 0.2;
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = T.stop.x - v.x, rz = T.stop.z - v.z;
      const ahead = rx * fx + rz * fz;
      if (T.state === 'approach') {
        if (T.t > 40 || ahead < -8) { v.ai.speedFactor = T.sf; v.transit = null; v.lastStop = T.stop; continue; }
        const k = clamp((ahead - 3.5) / 22, 0, 1);
        v.ai.speedFactor = T.sf * Math.max(k, ahead > 3.5 ? 0.14 : 0);
        if (ahead < 3.6 || (v.speed < 0.4 && ahead < 12)) { T.state = 'dwell'; T.t = 0; v.ai.speedFactor = 0; this.openDoors(v, T); }
      } else if (T.state === 'dwell') {
        v.ai.speedFactor = 0;
        if (T.t > 7.5) { v.ai.speedFactor = T.sf; v.lastStop = T.stop; v.transit = null; }
      }
    }
  }
  doorPos(v) { const c = Math.cos(v.yaw), s = Math.sin(v.yaw); const lx = -(v.def.width / 2 + 0.8), lz = v.def.length * 0.3; return { x: v.x + lx * c + lz * s, z: v.z - lx * s + lz * c }; }
  openDoors(v, T) {
    const A = this.A; const door = this.doorPos(v); A.stat('busStop');
    G.audio && G.audio.play('door_open', { pos: { x: door.x, y: 1, z: door.z }, volume: 0.35 });
    // waiting passengers climb aboard
    let n = 0;
    for (const p of G.peds.list) {
      if (p.busStop !== T.stop || p.dead || !p.life || p.mode === 'flee') continue;
      const dx = p.x - v.x, dz = p.z - v.z; if (dx * dx + dz * dz > 25 * 25) continue;
      if (p.life.type === 'sit') p.life.frozen = false;
      p.life = { type: 'goto', x: door.x, z: door.z, speed: 1.9, radius: 0.9, t: 9, vanish: true, onArrive: () => { } }; p.busStop = null; n++;
    }
    // somebody gets off
    const off = Math.random() < 0.7 ? 1 + ((Math.random() * 2) | 0) : 0;
    for (let i = 0; i < off && G.peds.list.length < 140; i++) {
      const x = door.x + (Math.random() - 0.5) * 0.8, z = door.z + (Math.random() - 0.5) * 0.8;
      if (!A.spotOK(x, z, 0.4)) continue;
      const p = new Ped({ x, z, role: 'civ', yaw: v.yaw - Math.PI / 2 }); p.walkSpeed = 1.2 + Math.random() * 0.4; G.peds.add(p);
    }
  }
  slow(pl) {
    // a bus reaching a stop: only near the player
    for (const v of G.vehicles.list) {
      if (v.type !== 'bus' || v.transit || v.mission || !v.ai || v.ai.mode !== 'traffic' || !v.driver || v.wrecked || v.speed < 2) continue;
      if (dist2(v.x, v.z, pl.x, pl.z) > 160 * 160) continue;
      const arr = this.A.index().busstop; if (!arr) continue;
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      for (const s of arr) {
        if (s.removed || s === v.lastStop) continue;
        const rx = s.x - v.x, rz = s.z - v.z; if (rx * rx + rz * rz > 60 * 60) continue;
        const ahead = rx * fx + rz * fz, side = rx * -fz + rz * fx;   // side > 0: stop is on the bus's right
        if (ahead < 6 || ahead > 50 || side < 2 || side > 11) continue;
        v.transit = { stop: s, state: 'approach', t: 0, sf: v.ai.speedFactor || 1 }; break;
      }
    }
    // keep a bus around when there are people waiting
    if ((this.spawnT -= 1) > 0) return; this.spawnT = rrange(10, 20);
    if (G.police.stars > 0 || (G.missionDensity ?? 1) < 0.5) return;
    let buses = 0; for (const v of G.vehicles.list) if (v.type === 'bus' && !v.wrecked && dist2(v.x, v.z, pl.x, pl.z) < 260 * 260) buses++;
    if (buses >= 2) return;
    const S = this.A.scenes.find(q => q.kind === 'busstop' && q.peds.length && dist2(q.x, q.z, pl.x, pl.z) > 50 && dist2(q.x, q.z, pl.x, pl.z) < 130 * 130);
    if (!S) return;
    const stop = S.meta.stop; if (!stop) return;
    const nr = G.map.nearestRoad(stop.x, stop.z, 20); if (!nr) return;
    const e = nr.edge; const nx = -Math.sin(stop.yaw), nz = -Math.cos(stop.yaw);   // from stop towards the road
    // travel direction that puts the stop on the right-hand side
    const rightOf = (dir) => { const tx = nr.tx * dir, tz = nr.tz * dir; const side = (stop.x - nr.x) * -tz + (stop.z - nr.z) * tx; return side; };
    const dir = rightOf(1) > 0 ? 1 : -1;
    const s0 = dir > 0 ? nr.s : e.len - nr.s;
    const back = Math.min(s0 - 2, 75); const sStart = s0 - Math.max(back, 0);
    const pos = { x: nr.x - nr.tx * dir * Math.max(back, 0), z: nr.z - nr.tz * dir * Math.max(back, 0) };
    if (!A_hidden(this.A, pos.x, pos.z)) return;
    const v = spawnDriven(nr, 'bus', { dir, s: sStart, lane: 0, speed: 9 });
    if (v) { v.amb = true; }
  }
}
function A_hidden(A, x, z) { return A.hidden(x, z, 60); }
