// Shops and services: Ammu-Nation, food joints, Pay 'n' Spray, safehouse, hospitals/police blips, map pickups.
import { G } from './state.js';
import { clamp, dist2, rrange, pick, fmtMoney } from './util.js';
import { CLS } from './mapdata.js';

const FOOD = {
  burger: { name: 'Burger Bonanza', item: 'Bonanza Burger', cost: 10, heal: 30, color: '#ff9a2a' },
  pizza: { name: 'Pizza Stack', item: 'Stack Slice', cost: 12, heal: 35, color: '#ff6a3a' },
  chicken: { name: "Clucky's", item: 'Clucky Bucket', cost: 10, heal: 30, color: '#ffc83a' }
};
const PAINT = [0xc0c0c8, 0x1d1d22, 0xf2f2f2, 0x9a1c1c, 0x1c3a8a, 0x2a6a3a, 0xb58a1a, 0x5a5a66, 0x7a3a9a, 0xd06a1c, 0x3a7a9a, 0xe8d8b0, 0xff4fa0, 0x39c4a8];

export class Places {
  constructor() {
    this.shops = []; this.cool = 0; this.pns = []; this.homePanel = null;
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
    this.seedPickups();
  }

  makeBlip(s) { s.blipObj = G.blips.add({ x: s.l.door.x, z: s.l.door.z, ...s.blip, priority: 0 }); }
  makeMarker(s) {
    if (s.kind === 'ammu' || s.kind === 'food' || s.kind === 'home' || s.kind === 'gym') {
      s.marker = G.markers.add({ x: s.l.door.x, z: s.l.door.z, radius: 1.5, color: s.kind === 'home' ? 0x40ff80 : s.kind === 'ammu' ? 0xff4040 : 0xffb030, footOnly: true, once: false, arrow: true, onEnter: () => this.enter(s) });
    } else if (s.kind === 'pns') {
      const drop = s.l.door; s.marker = G.markers.add({ x: drop.x, z: drop.z, radius: 4.6, color: 0x39c4d8, vehicleOnly: true, once: false, arrow: true, onEnter: () => this.enter(s) });
    }
  }
  // quitToTitle() wipes every marker in the world: put the shop markers / blips back whenever they are missing
  heal() { for (const s of this.shops) { if (s.marker && s.marker.dead) this.makeMarker(s); if (s.blipObj && !G.blips.list.includes(s.blipObj)) this.makeBlip(s); } }

  seedPickups() {
    const L = G.landmarks;
    const near = (id, dx, dz, kind, o = {}) => { const l = L[id]; if (!l) return; const x = l.door.x + dx, z = l.door.z + dz; return G.pickups.spawn(kind, x, z, { persistent: true, life: 1e9, respawn: 120, ...o }); };
    near('home', 3, 2, 'armor'); near('home', -2, 3, 'health');
    near('hospital_a', 4, 2, 'health'); near('hospital_b', 4, 2, 'health'); near('police_hq', 5, 2, 'armor');
    near('ammu_a', 3, 0, 'armor');
    // bribe stars
    for (const id of ['bank', 'label', 'dealer', 'pier_shop']) near(id, 6, 4, 'star', { respawn: 300 });
  }

  enter(s) {
    if (this.cool > 0) return; const pl = G.player;
    if (G.missions && G.missions.blocksShops) return;
    switch (s.kind) {
      case 'ammu': this.cool = 1.5; G.game.pause(true, true); G.menus.show('shop'); break;
      case 'food': {
        this.cool = 2; const f = s.food;
        if (pl.health >= pl.maxHealth) { G.hud.notify('You are not hungry'); return; }
        if (pl.money < f.cost) { G.hud.notify('Not enough cash for ' + f.item); return; }
        pl.money -= f.cost; pl.health = Math.min(pl.maxHealth, pl.health + f.heal); G.audio.play('cash'); G.audio.play('pickup');
        G.hud.notify(`${f.item}: -$${f.cost}, +${f.heal} health`);
        break;
      }
      case 'home': this.cool = 1.5; this.openHome(); break;
      case 'gym': this.cool = 2; G.hud.notify(G.missions && G.missions.isDone('m04') ? 'Sal runs a fight club here. Look for the cyan G marker outside.' : "Sal's Gym is closed for now. Come back later."); break;
      case 'pns': this.paySpray(s); break;
    }
  }

  openHome() {
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

  async paySpray(s) {
    const pl = G.player; const v = pl.vehicle; if (!v || this.busy) return;
    if (v.isBike && false) return;
    const cost = 100;
    if (G.police.stars >= 5 && false) return;
    if (pl.money < cost) { G.hud.notify("Pay 'n' Spray: not enough cash ($100)"); this.cool = 3; return; }
    this.busy = true; this.cool = 6;
    pl.money -= cost; pl.controlEnabled = false; v.input.throttle = 0; v.input.brake = 1; v.input.handbrake = true;
    G.hud.fade(1, 500); await new Promise(r => setTimeout(r, 650));
    v.repair(); const col = pick(PAINT); v.model.setBodyColor && v.model.setBodyColor(col); v.colors.body = col;
    G.police.clear(); for (const c of G.vehicles.list.slice()) if (c.owner === 'police' && !c.mission && c !== v) G.vehicles.remove(c);
    G.audio.play('spray'); G.audio.play('cash');
    await new Promise(r => setTimeout(r, 650));
    G.hud.fade(0, 700); pl.controlEnabled = true; v.input.handbrake = false; v.input.brake = 0;
    G.hud.notify("Pay 'n' Spray: -$100, vehicle resprayed, heat gone");
    this.busy = false;
  }

  update(dt) { if (this.cool > 0) this.cool -= dt; this.healT = (this.healT || 0) - dt; if (this.healT <= 0) { this.healT = 1.5; this.heal(); } }
}
