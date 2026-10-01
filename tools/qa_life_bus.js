// Bus stop transit: waiting passengers, a bus that stops, doors, boarding.  node tools/play.js tools/qa_life_bus.js
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx); await boot(ctx, { empty: true });
  const r = await ctx.eval(() => {
    QA.clear(); G.ambient.forcedOnly = true; G.worldEvents.timer = 1e9; G.population.pedTarget = 0; G.population.carTarget = 0; G.population.gangTarget = 0; G.sky.hour = 12; G.sky.timeScale = 0;
    const c = G.world.placement.districtCentre('Market'); let S = null;
    for (let i = 0; i < 40 && !S; i++) { const q = G.map.nearestRoad(c.x + (Math.random() - 0.5) * 500, c.z + (Math.random() - 0.5) * 500, 200); QA.tp(q.x, q.z, 0); G.world.update(0, q.x, q.z, 60); S = G.ambient.forceScene('busstop'); if (S && S.jobs.length === 0) { } }
    let n = 0; while (S.jobs.length && n++ < 100) QA.sim(0.05);
    G.ambient._force = true; const pl = G.player; G.ambient.transit.spawnT = 0; G.ambient.transit.slow({ x: S.x + 60, z: S.z, }); G.ambient._force = false;
    const bus = G.vehicles.list.find(v => v.type === 'bus'); if (!bus) return { err: 'no bus', stop: [S.x, S.z] };
    return { stop: [Math.round(S.x), Math.round(S.z)], peds: S.peds.length, bus: [Math.round(bus.x), Math.round(bus.z)], S: [S.x, S.z] };
  });
  console.log(JSON.stringify(r)); if (r.err) return;
  const seq = [];
  for (let k = 0; k < 40; k++) {
    const o = await ctx.eval((S) => { QA.sim(1); const bus = G.vehicles.list.find(v => v.type === 'bus'); G.world.update(0, S[0], S[1], 200); if (!bus) return null; return { t: G.time | 0, st: bus.transit && bus.transit.state, sp: +bus.speed.toFixed(1), d: Math.round(Math.hypot(bus.x - S[0], bus.z - S[1])), pedsLife: G.peds.list.filter(p => p.life && p.life.vanish).length, n: G.peds.list.length, stops: G.ambient.stats.busStop || 0 }; }, r.S);
    seq.push(o); if (o && o.st === 'dwell') { await ctx.eval((S) => { QA.tp(S[0] + 25, S[1] + 25, 0); const gy = G.world.groundY(S[0], S[1]); QA.orbit(S[0], gy + 1.5, S[1], 60, 18, 12, 55); }, r.S); await ctx.wait(400); await ctx.shot('life_bus_dwell'); await ctx.eval(() => QA.camEnd()); }
  }
  console.log(seq.filter(Boolean).map(o => `${o.t}:${o.st || '-'}:${o.sp}:${o.d}:${o.pedsLife}:${o.n}:${o.stops}`).join(' '));
};
