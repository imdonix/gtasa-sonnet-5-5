// Sim cost breakdown with and without the city-life systems.  node tools/play.js tools/qa_life_prof.js   (env PLACE, SECS)
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx); await boot(ctx, {});
  for (const life of [false, true, false, true]) {
    const r = await ctx.eval((life, place, SECS) => {
      G.player.invincible = true; G.ambient.enabled = life; G.worldEvents.enabled = life; G.sky.hour = 12; G.sky.timeScale = 0;
      QA.clear(); for (const S of G.ambient.scenes.slice()) G.ambient.endScene(S, true);
      const c = G.world.placement.districtCentre(place); const q = G.map.nearestRoad(c.x, c.z, 300); QA.tp(q.x, q.z, 0); G.world.update(0, q.x, q.z, 200);
      const T = {}; const wrap = (obj, name, label) => { const o = obj[name].bind(obj); obj[name] = (...a) => { const t = performance.now(); const r = o(...a); T[label] = (T[label] || 0) + performance.now() - t; return r; }; return () => { obj[name] = o; }; };
      const undo = [wrap(G.peds, 'update', 'peds'), wrap(G.vehicles, 'update', 'vehicles'), wrap(G.population, 'update', 'population'), wrap(G.ambient, 'update', 'ambient'), wrap(G.worldEvents, 'update', 'events'), wrap(G.combat, 'update', 'combat'), wrap(G.police, 'update', 'police')];
      for (let i = 0; i < 30 * 40; i++) { game.sim(1 / 30); G.player.x = q.x; G.player.z = q.z; }   // warm up (population fills)
      for (const k in T) T[k] = 0;
      const n = SECS * 30; let peds = 0, vehs = 0, ev = 0; const t0 = performance.now();
      for (let i = 0; i < n; i++) { game.sim(1 / 30); G.player.x = q.x; G.player.z = q.z; if (i % 30 === 0) { peds += G.peds.list.length; vehs += G.vehicles.list.length; if (life && !G.worldEvents.active && i % 900 === 0 && G.worldEvents.startRandom()) ev++; } }
      const tot = performance.now() - t0; undo.forEach(u => u());
      const o = { life, total: +(tot / n).toFixed(2), avgPeds: Math.round(peds / (n / 30)), avgVehs: Math.round(vehs / (n / 30)), ev }; for (const k in T) o[k] = +(T[k] / n).toFixed(2); return o;
    }, life, process.env.PLACE || 'Pershing Square', +(process.env.SECS || 60));
    console.log(JSON.stringify(r));
  }
};
