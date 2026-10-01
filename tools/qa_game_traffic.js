// Traffic deadlock hunt: player stands still in a dense area, sim for MIN minutes, report cars stuck > 25 s.
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  const MIN = +(process.env.MIN || 6); const DENS = +(process.env.DENS || 2); const SPOT = process.env.SPOT || 'downtown';
  await boot(ctx, {});
  await ctx.eval(async (DENS, SPOT) => {
    const pl = G.player; QA.clear(); G.population.density = DENS; G.population.carTarget = 40; G.population.pedTarget = 30; G.population.gangTarget = 0; G.police.noWanted = true;
    let best = null, bd = 1e9; const tgt = SPOT === 'downtown' ? { x: 0, z: -80 } : SPOT === 'home' ? { x: G.landmarks.home.door.x, z: G.landmarks.home.door.z } : { x: +SPOT.split(',')[0], z: +SPOT.split(',')[1] };
    for (const n of G.map.nodes) if (n.deg >= 3) { const d = Math.hypot(n.x - tgt.x, n.z - tgt.z); if (d < bd) { bd = d; best = n; } }
    window.__c = best; QA.tp(best.x + 12, best.z + 12, 0); for (let i = 0; i < 30; i++) G.world.update(0.05, best.x, best.z, 40);
    window.__stuck = new Map(); window.__seen = new Set(); window.__hits = { ai: 0, killed: 0 }; G.events.on && G.events.on('pedKilled', (p, info) => { if (info && info.vehicle) window.__hits.killed++; });
    const { Ped } = await import('/src/peds.js'); const od = Ped.prototype.damage; Ped.prototype.damage = function (a, i) { if (i && i.vehicleCrash && !this.isPlayer) window.__hits.ai++; if (i && i.vehicleCrash && !this.isPlayer) { const v = i.vehicle; const n = G.map.nearestNode(this.x, this.z, 80, 3); const nd = n ? Math.hypot(n.x - this.x, n.z - this.z) : 99; const rel = n ? nd / (n.maxW / 2) : 99; const k = (rel < 1 ? 'inJunction' : rel < 1.8 ? 'nearJunction' : 'midBlock'); (window.__hits.where = window.__hits.where || {})[k] = ((window.__hits.where || {})[k] || 0) + 1; if ((window.__hits.samples = window.__hits.samples || []).length < 14 && !this.dead) window.__hits.samples.push([k, this.mode, +G.map.roadDistAt(this.x, this.z).toFixed(1), Math.round(v.totalSpeed), v.ai ? v.ai.mode : '-', v.ai && v.ai.lightStop ? 'L' : '', v.ai && v.ai.blockedBy || '', Math.round(Math.hypot(v.x - this.x, v.z - this.z) * 10) / 10]); } return od.call(this, a, i); };
    window.__step = (secs, dt = 1 / 20) => { const n = Math.round(secs / dt); for (let i = 0; i < n; i++) { game.sim(dt); pl.x = best.x + 12; pl.z = best.z + 12; G.camera.update(dt, dt, pl, G.input);
      if (i % 10 === 0) for (const q of G.vehicles.list) { const s = window.__stuck.get(q.id) || { t: 0, x: q.x, z: q.z }; if (Math.hypot(q.x - s.x, q.z - s.z) > 1.2) { s.t = 0; s.x = q.x; s.z = q.z; } else s.t += 0.5; window.__stuck.set(q.id, s); } } };
  }, DENS, SPOT);
  for (let m = 0; m < MIN * 2; m++) {
    const r = await ctx.eval(() => {
      window.__step(30);
      const stuck = []; for (const q of G.vehicles.list) { const s = window.__stuck.get(q.id); if (s && s.t > 25 && (q.driver || q.ai) && q.owner === 'traffic') { const a = q.ai; stuck.push([q.id, q.type, Math.round(q.x), Math.round(q.z), Math.round(s.t), a ? [a.blockedBy || '', a.lightStop ? 'light' : '', 'sc' + (a.stuckCount || 0), a.agent && 'e' + a.agent.edge.id, 'thr' + (+q.input.throttle).toFixed(1), q.ghost > 0 ? 'ghost' : ''].join('|') : '']); } }
      const c = QA.counts(); return { t: Math.round(G.time), veh: c.vehs, traffic: c.byOwner.traffic, peds: c.peds, nStuck: stuck.length, stuck: stuck.slice(0, 5), errs: 0, pedHitByCars: window.__hits };
    });
    console.log(JSON.stringify(r));
  }
};
