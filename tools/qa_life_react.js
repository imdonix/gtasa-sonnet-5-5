// Pedestrian reactions: crossing signals, near misses / horns, crowd around a burning car, loose cash.
// node tools/play.js tools/qa_life_react.js
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  // ---- A: pedestrian signals
  const A = await ctx.eval(() => {
    G.worldEvents.timer = 1e9; G.ambient.forcedOnly = true; QA.clear(); G.population.carTarget = 0; G.population.gangTarget = 0; G.population.pedTarget = 70; G.population.density = 1;
    const c = G.world.placement.districtCentre('Pershing Square'); const node = G.map.nearestNode(c.x, c.z, 1e9, 4) ; const sig = G.nav.sigByNode.has(node.id);
    let best = null, bd = 1e9; for (const s of G.nav.signals) { const n = G.map.nodes[s.node]; const d = Math.hypot(n.x - c.x, n.z - c.z); if (d < bd && n.deg >= 4) { bd = d; best = n; } }
    QA.tp(best.x, best.z + 12, 0); G.world.update(0, best.x, best.z, 60); G.player.invincible = true; G.population.enabled = true;
    G.population.update(1);
    for (let i = 0; i < 160; i++) G.population.spawnCiv(best.x, best.z, G.player);
    let waiting = 0, samples = 0, maxW = 0, crossGreen = 0, crossN = 0; const tw = new Map();
    for (let i = 0; i < 30 * 90; i++) {
      game.sim(1 / 30); G.player.x = best.x; G.player.z = best.z + 12;
      if (i % 10 === 0) for (const p of G.peds.list) {
        if (p.isPlayer || p.dead) continue; const d = Math.hypot(p.x - best.x, p.z - best.z); if (d > best.maxW / 2 + 14) continue;
        samples++; if (p.sigWait) { waiting++; tw.set(p, (tw.get(p) || 0) + 1); maxW = Math.max(maxW, tw.get(p) / 3); } else tw.delete(p);
        if (G.map.roadDistAt(p.x, p.z) < -1.5 && d < best.maxW / 2 + 6) {
          // on the carriageway: axis of the road being crossed is perpendicular to the ped's motion
          const axis = Math.abs(p.vx) > Math.abs(p.vz) ? 1 : 0; if (Math.hypot(p.vx, p.vz) > 0.5) { crossN++; if (G.nav.lightState(best.id, axis) === 'green') crossGreen++; }
        }
      }
    }
    return { node: best.id, signalised: G.nav.sigByNode.has(best.id), samples, waitingPct: +(waiting / Math.max(1, samples) * 100).toFixed(1), maxWaitS: +maxW.toFixed(0), crossSamples: crossN, crossWhileCarsGreen: crossGreen };
  });
  console.log('A signals', JSON.stringify(A));
  await ctx.eval((n) => { const b = G.map.nodes[n]; QA.orbit(b.x, 1.5, b.z, 30, 22, 26, 55); }, A.node); await ctx.wait(700); await ctx.shot('life_react_signal'); await ctx.eval(() => QA.camEnd());
  // ---- B: near miss + horn + greet + armed fear
  const B = await ctx.eval(async () => {
    QA.clear(); G.population.pedTarget = 0; G.population.carTarget = 0; G.population.enabled = false;
    const nr = G.map.nearestRoad(G.player.x, G.player.z, 300); QA.tp(nr.x, nr.z, Math.atan2(nr.tx, nr.tz)); G.world.update(0, nr.x, nr.z, 60);
    const sx = nr.tz, sz = -nr.tx; // sidewalk normal
    const peds = []; for (let i = 0; i < 6; i++) { const p = await QA.ped({ x: nr.x + sx * (nr.edge.w / 2 + 0.9) + nr.tx * (i * 3 - 6) , z: nr.z + sz * (nr.edge.w / 2 + 0.9) + nr.tz * (i * 3 - 6), role: 'civ' }); peds.push(p); }
    const v = await QA.car('sports', nr.x - nr.tx * 60 + sx * (nr.edge.w / 2 - 1.6), nr.z - nr.tz * 60 + sz * (nr.edge.w / 2 - 1.6), Math.atan2(nr.tx, nr.tz));
    v.vx = nr.tx * 22; v.vz = nr.tz * 22; let said = 0, looks = 0, reacted = 0; const seen = new Set();
    for (let i = 0; i < 30 * 6; i++) { v.input.throttle = 0.4; v.vx = nr.tx * 22; v.vz = nr.tz * 22; game.sim(1 / 30); G.player.x = nr.x; G.player.z = nr.z; if (i % 6 === 0) { said = Math.max(said, G.ambient.bubbles.active.length); } }
    for (const p of peds) { if (p.reactT) reacted++; }
    // horn
    for (const p of peds) { p.lookT = 0; p.reactT = 0; }
    G.combat.noise(nr.x, nr.z, 30, null, 'horn'); game.sim(0.05); for (const p of peds) if (p.lookT > 0) looks++;
    return { reactedToNearMiss: reacted, maxBubbles: said, lookedAtHorn: looks, total: peds.length };
  });
  console.log('B reactions', JSON.stringify(B));
  // ---- C: crowd around a burning car
  const C = await ctx.eval(async () => {
    QA.clear(); G.population.pedTarget = 0; G.population.enabled = false; G.ambient.pois.length = 0;
    const nr = G.map.nearestRoad(G.player.x, G.player.z, 300); QA.tp(nr.x + 30, nr.z + 30, 0); G.world.update(0, nr.x, nr.z, 60);
    for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28, r = 12 + Math.random() * 18; const p = await QA.ped({ x: nr.x + Math.cos(a) * r, z: nr.z + Math.sin(a) * r, role: 'civ' }); }
    const v = G.vehicles.spawn('sedan', nr.x, nr.z, 0, { owner: 'traffic' }); v.health = 400; v.ignite(); v.fireT = 40;
    let maxG = 0; for (let i = 0; i < 30 * 25; i++) { game.sim(1 / 30); G.player.x = nr.x + 30; G.player.z = nr.z + 30; if (v.onFire) { v.fireT = Math.max(v.fireT, 30); v.health = Math.max(v.health, 200); } if (i % 30 === 0) maxG = Math.max(maxG, G.peds.list.filter(p => p.life && p.life.poi).length); }
    return { gawkers: maxG, pois: G.ambient.pois.map(p => p.kind), x: nr.x, z: nr.z };
  });
  console.log('C crowd', JSON.stringify(C));
  await ctx.eval((C) => { QA.orbit(C.x, 1.5, C.z, 40, 20, 20, 55); }, C); await ctx.wait(700); await ctx.shot('life_react_crowd'); await ctx.eval(() => QA.camEnd());
  // ---- D: loose cash
  const D = await ctx.eval(async () => {
    QA.clear(); const nr = G.map.nearestRoad(G.player.x, G.player.z, 300); QA.tp(nr.x + 40, nr.z + 40, 0);
    const p = await QA.ped({ x: nr.x + 6, z: nr.z, role: 'civ' }); G.pickups.spawn('cash', nr.x, nr.z + 4, { amount: 150, life: 60 });
    const c0 = p.cash; for (let i = 0; i < 30 * 15; i++) { game.sim(1 / 30); G.player.x = nr.x + 40; G.player.z = nr.z + 40; }
    return { pickedUp: p.cash > c0, pickupsLeft: G.pickups.list.filter(q => q.kind === 'cash' && !q.dead).length };
  });
  console.log('D cash', JSON.stringify(D));
};
