// Shops and services: Ammu-Nation (weapon dealers), food joints, drive-in Pay 'n' Spray garages,
// safehouse save icon, hospitals/police blips, map pickups.
import * as THREE from 'three';
import { G } from './state.js';
import { clamp, pick } from './util.js';
import { CLS } from './mapdata.js';
import { Ped } from './peds.js';

const FOOD = {
  burger: { name: 'Burger Bonanza', item: 'Bonanza Burger', cost: 10, heal: 45, color: '#ff9a2a' },
  pizza: { name: 'Pizza Stack', item: 'Stack Slice', cost: 12, heal: 50, color: '#ff6a3a' },
  chicken: { name: "Clucky's", item: 'Clucky Bucket', cost: 10, heal: 45, color: '#ffc83a' }
};
const PAINT = [0xc0c0c8, 0x1d1d22, 0xf2f2f2, 0x9a1c1c, 0x1c3a8a, 0x2a6a3a, 0xb58a1a, 0x5a5a66, 0x7a3a9a, 0xd06a1c, 0x3a7a9a, 0xe8d8b0, 0xff4fa0, 0x39c4a8];

// ---------------------------------------------------------------- small generated textures
let _signTex = null, _doorTex = null, _glowTex = null, _saveTex = null;
function saveTexture() {
  if (_saveTex) return _saveTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#f4f2ea'; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = '#cfcabb'; x.lineWidth = 4; x.strokeRect(6, 6, 116, 116);
  x.fillStyle = '#2b6cb0'; x.fillRect(0, 0, 128, 26);
  x.fillStyle = '#e8e6dd'; x.fillRect(38, 40, 52, 26);
  x.fillStyle = '#2e9e4a'; x.font = 'bold 34px Arial'; x.textAlign = 'center'; x.fillText('SAVE', 64, 104);
  _saveTex = new THREE.CanvasTexture(c); return _saveTex;
}
function signTexture() {
  if (_signTex) return _signTex;
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#123a63'); g.addColorStop(1, '#0a2340'); x.fillStyle = g; x.fillRect(0, 0, 512, 128);
  x.strokeStyle = '#5fd8e0'; x.lineWidth = 6; x.strokeRect(6, 6, 500, 116);
  x.fillStyle = '#f2f7ff'; x.font = 'bold 58px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText("PAY 'N' SPRAY", 256, 66);
  _signTex = new THREE.CanvasTexture(c); _signTex.anisotropy = 4; return _signTex;
}
function doorTexture() {
  if (_doorTex) return _doorTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#c9d2d8'; x.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 16) { x.fillStyle = (y / 16) % 2 ? '#b3bcc4' : '#dde5ea'; x.fillRect(0, y, 128, 14); x.fillStyle = '#8f989f'; x.fillRect(0, y + 14, 128, 2); }
  _doorTex = new THREE.CanvasTexture(c); return _doorTex;
}
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c); return _glowTex;
}

export class Places {
  constructor() {
    this.shops = []; this.cool = 0; this.pns = []; this.homePanel = null;
    this.iconT = 0;
    const L = G.landmarks;
    const add = (id, opts) => { const l = L[id]; if (l) this.shops.push({ id, l, ...opts }); };
    for (const id of ['ammu_a', 'ammu_b', 'ammu_c']) add(id, { kind: 'ammu', blip: { color: '#d84a3a', text: 'A', icon: 'text', label: 'Ammu-Nation' } });
    for (const id of ['burger_a', 'burger_b']) add(id, { kind: 'food', food: FOOD.burger, blip: { color: FOOD.burger.color, text: 'B', icon: 'text', label: 'Burger Bonanza' } });
    for (const id of ['pizza_a', 'pizza_b']) add(id, { kind: 'food', food: FOOD.pizza, blip: { color: FOOD.pizza.color, text: 'P', icon: 'text', label: 'Pizza Stack' } });
    for (const id of ['chicken_a', 'chicken_b', 'chicken_c']) add(id, { kind: 'food', food: FOOD.chicken, blip: { color: FOOD.chicken.color, text: 'C', icon: 'text', label: "Clucky's" } });
    for (const id of ['pns_a', 'pns_b', 'pns_c']) add(id, { kind: 'pns', blip: { color: '#39c4d8', text: 'S', icon: 'text', label: "Pay 'n' Spray" } });
    add('home', { kind: 'home', blip: { color: '#4fd36b', text: 'H', icon: 'text', label: 'Safehouse' } });
    for (const id of ['hospital_a', 'hospital_b']) add(id, { kind: 'hospital', blip: { color: '#ffffff', text: '+', icon: 'text', label: 'Hospital' } });
    for (const id of ['police_hq', 'police_b', 'police_c']) add(id, { kind: 'police', blip: { color: '#4a7be0', text: '★', icon: 'text', label: 'Police station' } });
    add('gym', { kind: 'gym', blip: { color: '#ff7a9a', text: 'G', icon: 'text', label: 'Gym' } });
    for (const s of this.shops) { this.makeBlip(s); this.makeMarker(s); }
    // build the drive-in garages, the weapon-dealer NPCs and the safehouse save icon
    for (const s of this.shops) if (s.kind === 'pns') this.buildGarage(s);
    for (const s of this.shops) if (s.kind === 'ammu') this.buildDealer(s);
    for (const s of this.shops) if (s.kind === 'home') this.buildSaveIcon(s);
    this.seedPickups();
  }

  makeBlip(s) { s.blipObj = G.blips.add({ x: s.l.door.x, z: s.l.door.z, ...s.blip, priority: 0 }); }
  makeMarker(s) {
    if (s.kind === 'food' || s.kind === 'gym') {
      s.marker = G.markers.add({ x: s.l.door.x, z: s.l.door.z, radius: 1.5, color: 0xffb030, footOnly: true, once: false, arrow: true, onEnter: () => this.enter(s) });
    } else if (s.kind === 'pns') {
      // locator only: the garage door opens by proximity, the player drives in and out themselves
      const drop = s.l.door; s.marker = G.markers.add({ x: drop.x, z: drop.z, radius: 3.4, color: 0x39c4d8, vehicleOnly: true, once: false, arrow: true });
    }
    // weapon dealers and the safehouse use the icon + interact prompt instead of a glow marker
  }
  // quitToTitle() removes peds / mission markers: put shops & NPCs back whenever they are missing
  heal() {
    for (const s of this.shops) {
      if (s.marker && s.marker.dead) this.makeMarker(s);
      if (s.blipObj && !G.blips.list.includes(s.blipObj)) this.makeBlip(s);
      if (s.kind === 'ammu' && (!s.dealer || s.dealer.dead || s.dealer.removeMe)) s.dealer = this.spawnDealer(s);
      else if (s.kind === 'ammu' && s.dealer && G.player) s.dealer.script = { type: 'stand', look: G.player };
    }
  }

  seedPickups() {
    const L = G.landmarks;
    const near = (id, dx, dz, kind, o = {}) => { const l = L[id]; if (!l) return; const x = l.door.x + dx, z = l.door.z + dz; return G.pickups.spawn(kind, x, z, { persistent: true, life: 1e9, respawn: 120, ...o }); };
    near('home', 3, 2, 'armor'); near('home', -2, 3, 'health');
    near('hospital_a', 4, 2, 'health'); near('hospital_b', 4, 2, 'health'); near('police_hq', 5, 2, 'armor');
    near('ammu_a', 3, 0, 'armor');
    // bribe stars
    for (const id of ['bank', 'label', 'dealer', 'pier_shop']) near(id, 6, 4, 'star', { respawn: 300 });
  }

  // ================================================================== weapon dealers
  // a clear spot just beside a door, off the roadway, for an NPC or icon
  doorSideSpot(s, side, fwd) {
    const d = s.l.door, yaw = s.l.yaw, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const offs = [[side, fwd], [side, fwd - 0.8], [side * 1.6, fwd], [side, fwd + 0.8], [-side, fwd]];
    for (const o of offs) {
      const x = d.x + rx * o[0] + fx * o[1], z = d.z + rz * o[0] + fz * o[1];
      if (G.map.roadDistAt(x, z) > 1.0 && G.world.groundY(x, z) > 0.6 && G.world.placement.propClear(x, z, 0.8)) return { x, z };
    }
    return { x: d.x + rx * side + fx * fwd, z: d.z + rz * side + fz * fwd };
  }
  dealerSpot(s) { return this.doorSideSpot(s, 1.9, 0.6); }
  spawnDealer(s) {
    const p = this.dealerSpot(s);
    const app = G.models.peds.randomAppearance(Math.random, { role: 'worker' });
    app.hat = 'cap'; app.hatColor = 0x8a2020; app.shirt = 0x6a2a2a; app.shirtType = 'vest'; app.bandana = null;
    const ped = new Ped({ x: p.x, z: p.z, role: 'script', appearance: app, name: 'Ammu-Nation clerk' });
    ped.mission = false; ped.noDespawn = true; ped.invincible = true; ped.canDrop = false; ped.brave = true;
    ped.script = { type: 'stand', look: G.player };
    G.peds.add(ped);
    return ped;
  }
  buildDealer(s) {
    if (G.interactions) {
      s.dealerSpot = this.dealerSpot(s);
      s.dealerInteract = G.interactions.add({ x: s.dealerSpot.x, z: s.dealerSpot.z, radius: 3.0, footOnly: true, label: 'Buy weapons', onInteract: () => this.openAmmu(s) });
    }
  }
  openAmmu(s) {
    if (this.cool > 0) return;
    if (G.missions && G.missions.blocksShops) { G.hud.notify('Not now — finish what you are doing'); return; }
    this.cool = 1.5; G.game.pause(true, true); G.menus.show('shop');
  }

  // ================================================================== safehouse save icon
  buildSaveIcon(s) {
    const spot = this.doorSideSpot(s, 2.4, 1.2);
    const x = spot.x, z = spot.z;
    const gY = G.world.groundY(x, z);
    const baseY = gY + 1.5;
    const group = new THREE.Group();
    // little pedestal
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.62, 0.5, 10), new THREE.MeshLambertMaterial({ color: 0x2a2d33 }));
    ped.position.y = -1.25; group.add(ped);
    // floppy disk with a "SAVE" label on both faces
    const disc = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.25, 0.14), new THREE.MeshLambertMaterial({ color: 0x2b6cb0 }));
    disc.add(body);
    for (const z of [0.075, -0.075]) {
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.02, 1.02), new THREE.MeshBasicMaterial({ map: saveTexture() }));
      label.position.z = z; if (z < 0) label.rotation.y = Math.PI; disc.add(label);
    }
    const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.02), new THREE.MeshLambertMaterial({ color: 0xc8ced6 }));
    shutter.position.set(0, 0.44, 0.082); disc.add(shutter);
    group.add(disc);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x40ff80, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(3.2, 3.2, 1); group.add(glow);
    group.position.set(x, baseY, z);
    G.scene.add(group);
    s.icon = disc; s.iconGroup = group; s.iconBaseY = baseY;
    if (G.interactions) s.saveInteract = G.interactions.add({ x, z, radius: 2.8, footOnly: true, label: 'Save game', onInteract: () => this.openHome() });
  }

  // ================================================================== drive-in Pay 'n' Spray
  buildGarage(s) {
    const l = s.l; if (!l || !l.building) return;
    const yaw = l.yaw, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const lp = (lx, lz) => ({ x: l.x + lx * cs + lz * sn, z: l.z - lx * sn + lz * cs });
    const hw = l.w / 2, hd = l.d / 2;
    const zWall = -l.d / 2 + 0.4 + Math.min(l.d - 6.5, 11);   // visible front wall of the shop
    const bayHw = 3.0, zFront = hd + 0.2, zd = zFront - zWall, zc = (zWall + zFront) / 2;
    const c = lp(0, zc), ground = G.world.groundY(c.x, c.z);
    const group = new THREE.Group(); G.scene.add(group);
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x4a5058 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x2b2f35 });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0x8a9099 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x13161b });
    const padMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x39e0e8 });
    const put = (mesh, lx, lz, y) => { const p = lp(lx, lz); mesh.position.set(p.x, ground + y, p.z); mesh.rotation.y = yaw; group.add(mesh); return mesh; };
    // side walls, roof, header and a dark shop interior at the back of the bay
    for (const sgn of [-1, 1]) put(new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.6, zd + 0.2), wallMat), sgn * (bayHw + 0.15), zc, 1.8);
    put(new THREE.Mesh(new THREE.BoxGeometry(bayHw * 2 + 0.9, 0.3, zd + 0.7), roofMat), 0, zc, 3.66);
    put(new THREE.Mesh(new THREE.BoxGeometry(bayHw * 2 + 0.9, 0.72, 0.34), trimMat), 0, zFront, 3.34);
    put(new THREE.Mesh(new THREE.BoxGeometry(bayHw * 2 + 0.3, 3.5, 0.2), darkMat), 0, zWall - 0.12, 1.75);
    put(new THREE.Mesh(new THREE.BoxGeometry(bayHw * 2 + 0.5, 0.08, zd + 0.4), padMat), 0, zc, 0.05);
    for (const sgn of [-1, 1]) put(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, zd * 0.86), glowMat), sgn * (bayHw - 0.05), zc, 0.55);
    // illuminated sign above the door
    put(new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), new THREE.MeshBasicMaterial({ map: signTexture() })), 0, zFront + 0.2, 4.08);
    // the animated roller door
    const doorH = 3.1;
    const door = new THREE.Mesh(new THREE.BoxGeometry(bayHw * 2 - 0.5, doorH, 0.16), new THREE.MeshLambertMaterial({ map: doorTexture() }));
    const dp = lp(0, zFront); door.position.set(dp.x, ground + doorH / 2, dp.z); door.rotation.y = yaw; group.add(door);
    s.garage = {
      group, door, doorH, ground, yaw, cx: l.x, cz: l.z, hw, hd, bayHw, zWall, zFront,
      bay: lp(0, zWall + zd * 0.56), entry: lp(0, zFront + 2.6), exit: lp(0, zFront + 7.2),
      doorOpen: 0, target: 0, sprayT: 0, done: false, warned: false,
      // a collider across the doorway that only exists while the shutter is shut, so the car can't
      // drive out through a closed door (the player keeps full control the whole time)
      doorColl: { x: dp.x, z: dp.z, hw: bayHw - 0.3, hd: 0.16, yaw, h: doorH, kind: 'garage_door' }, doorCollOn: false
    };
    this.carveGarage(s, { hw, hd, zWall, zFront, bayHw, lp });
  }
  // replace the solid shop collider with a footprint that leaves the bay corridor open
  carveGarage(s, g) {
    const W = G.world, bld = s.l.building, obb = bld && bld.obb; if (!W || !obb) return;
    W.removeCollider(obb); const i = W.placement.colliders.indexOf(obb); if (i >= 0) W.placement.colliders.splice(i, 1);
    // stop the generic roof-footprint collider from re-adding a solid box over the carved bay.
    // b.obb stays as the reserved footprint so placement queries (propClear / walkSpot) still see the lot.
    bld._solidDone = true;
    const mk = (cx, cz, hx, hz) => { const p = g.lp(cx, cz); return { x: p.x, z: p.z, hw: hx, hd: hz, yaw: s.l.yaw, h: obb.h, kind: 'garage' }; };
    const { hw, hd, zWall, zFront, bayHw } = g;
    const pieces = [
      mk(0, (-hd + zWall) / 2, hw, (zWall + hd) / 2),                              // solid building behind the bay
      mk((hw + bayHw) / 2, (zWall + zFront) / 2, (hw - bayHw) / 2, (zFront - zWall) / 2),   // right of the bay
      mk(-(hw + bayHw) / 2, (zWall + zFront) / 2, (hw - bayHw) / 2, (zFront - zWall) / 2)   // left of the bay
    ];
    for (const c of pieces) { W.placement.colliders.push(c); W._indexCollider(c); }
  }
  doorStep(g, target, dt) {
    if (g.doorOpen === target) return;
    const spd = 1 / 0.7, dir = Math.sign(target - g.doorOpen);
    g.doorOpen = clamp(g.doorOpen + dir * spd * dt, 0, 1);
    if ((target === 0 && g.doorOpen < 0.003) || (target === 1 && g.doorOpen > 0.997)) g.doorOpen = target;
    // roll the shutter up into the header: shrink from the bottom up, top edge fixed
    const h = g.doorH * (1 - g.doorOpen);
    g.door.visible = g.doorOpen < 0.985;
    g.door.scale.y = Math.max(0.03, 1 - g.doorOpen);
    g.door.position.y = g.ground + g.doorH * g.doorOpen + h / 2;
  }
  // world -> garage local coords (building centre + yaw); local +z points at the street
  localOf(g, x, z) { const dx = x - g.cx, dz = z - g.cz, cs = Math.cos(g.yaw), sn = Math.sin(g.yaw); return { lx: dx * cs - dz * sn, lz: dx * sn + dz * cs }; }
  setDoorCollider(g, on) {
    if (on === g.doorCollOn) return; const W = G.world; if (!W || !g.doorColl) return;
    if (on) { W.placement.colliders.push(g.doorColl); W._indexCollider(g.doorColl); }
    else { W.removeCollider(g.doorColl); const i = W.placement.colliders.indexOf(g.doorColl); if (i >= 0) W.placement.colliders.splice(i, 1); }
    g.doorCollOn = on;
  }
  respray(v, pl) {
    if (pl.money < 100) return false;
    pl.money -= 100;
    v.repair(); const col = pick(PAINT); v.model.setBodyColor && v.model.setBodyColor(col); v.colors.body = col;
    G.police.clear(); for (const c of G.vehicles.list.slice()) if (c.owner === 'police' && !c.mission && c !== v) G.vehicles.remove(c);
    if (G.audio) { G.audio.play('spray', { pos: v }); G.audio.play('cash'); }
    G.hud.notify("Pay 'n' Spray: -$100, vehicle resprayed, heat gone");
    return true;
  }
  // Fully player-driven: the door opens as you approach, shuts while you are parked inside
  // (the respray happens), then opens again so you drive out yourself. Control is never taken away.
  updateGarage(g, dt) {
    const pl = G.player, v = pl.vehicle;
    if (g.sprayT > 0) {
      g.sprayT -= dt;
      if (g.sprayT <= 0) { g.done = true; g.target = 1; if (G.audio) G.audio.play('door_open', { pos: g.bay }); }
    } else if (!v || v.exploded) {
      g.target = 0; if (!v) { g.done = false; g.warned = false; }
    } else {
      const l = this.localOf(g, v.x, v.z);
      const near = l.lz > g.zWall - 2 && l.lz < g.zFront + 15 && Math.abs(l.lx) < g.bayHw + 3;
      const inside = Math.abs(l.lx) < g.bayHw - 0.15 && l.lz > g.zWall + 0.4 && l.lz < g.zFront - 0.4;
      if (inside && !g.done) {
        if (g.doorOpen > 0.9) {
          const blocked = G.missions && G.missions.blocksShops;
          if (pl.money >= 100 && !blocked) g.target = 0;            // shut the door and spray
          else { if (!g.warned && !blocked) { G.hud.notify("Pay 'n' Spray: not enough cash ($100)"); g.warned = true; } g.target = 1; g.done = true; }
        }
      } else if (inside && g.done) g.target = 1;                     // done: open and let them out
      else if (near && !g.done) g.target = 1;                        // approaching: open
      else if (!near) { g.done = false; g.warned = false; g.target = 0; }
    }
    this.doorStep(g, g.target, dt);
    // the doorway only blocks while the shutter is essentially shut
    this.setDoorCollider(g, g.doorOpen < 0.12);
    // if the door finished shutting with the car inside, run the respray and hold it shut briefly
    if (g.sprayT <= 0 && g.doorOpen <= 0.02 && g.target === 0 && v && !v.exploded && !g.done) {
      const l = this.localOf(g, v.x, v.z);
      if (Math.abs(l.lx) < g.bayHw && l.lz > g.zWall + 0.2 && l.lz < g.zFront) {
        if (this.respray(v, pl)) g.sprayT = 1.4;
        else { g.done = true; g.target = 1; }
      }
    }
  }

  // ================================================================== services
  enter(s) {
    if (this.cool > 0) return; const pl = G.player;
    if (G.missions && G.missions.blocksShops) return;
    switch (s.kind) {
      case 'ammu': this.openAmmu(s); break;
      case 'food': {
        this.cool = 2; const f = s.food;
        if (pl.health >= pl.maxHealth) { G.hud.notify('You are not hungry'); return; }
        if (pl.money < f.cost) { G.hud.notify('Not enough cash for ' + f.item); return; }
        pl.money -= f.cost; pl.health = Math.min(pl.maxHealth, pl.health + f.heal); G.audio.play('cash'); G.audio.play('pickup');
        G.hud.notify(`${f.item}: -$${f.cost}, +${f.heal} health`);
        break;
      }
      case 'home': this.openHome(); break;
      case 'gym': this.cool = 2; G.hud.notify(G.missions && G.missions.isDone('m04') ? 'Sal runs a fight club here. Look for the cyan G marker outside.' : "Sal's Gym is closed for now. Come back later."); break;
      case 'pns': break;   // handled by the proximity door in updateGarage()
    }
  }

  openHome() {
    if (this.cool > 0) return;
    const pl = G.player; G.game.pause(true, true);
    const can = G.game.canSave();
    let p = document.getElementById('homePanel'); if (!p) { p = document.createElement('div'); p.id = 'homePanel'; document.body.appendChild(p); }
    p.className = 'panel show';
    p.innerHTML = `<div class="box" style="text-align:center"><h1 style="font-size:40px">SAFEHOUSE</h1><div class="menu"><div class="btn ${can ? '' : 'dis'}" id="hSave">Save Game</div><div class="btn" id="hRest">Rest until morning</div><div class="btn" id="hLeave">Leave</div></div>${can ? '' : '<div style="margin-top:10px;color:#f88">Finish your current business before saving.</div>'}</div>`;
    const close = () => { p.className = 'panel'; G.game.pause(false); };
    p.querySelector('#hSave').onclick = () => { G.game.save(); G.hud.toast('Game saved'); close(); };
    p.querySelector('#hRest').onclick = () => { G.sky.hour = 7.5; pl.health = pl.maxHealth; G.hud.notify('You slept. Health restored.'); close(); };
    p.querySelector('#hLeave').onclick = close;
    G.input.unlock();
  }

  update(dt) {
    if (this.cool > 0) this.cool -= dt;
    this.healT = (this.healT || 0) - dt; if (this.healT <= 0) { this.healT = 1.5; this.heal(); }
    for (const s of this.shops) if (s.garage) this.updateGarage(s.garage, dt);
    // save icons bob and spin
    this.iconT += dt;
    for (const s of this.shops) if (s.icon) { s.icon.rotation.y += dt * 1.3; s.iconGroup.position.y = s.iconBaseY + Math.sin(this.iconT * 2.1) * 0.12; }
  }
}
