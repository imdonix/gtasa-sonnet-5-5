// Force every ambient scene kind in a fitting district and take a screenshot of each.
// node tools/play.js tools/qa_life_scenes.js   (env KINDS=bench,chat  HOUR=12  ORBIT=yaw,pitch,dist)
const { install, boot } = require('./qa_game_lib');
const PLACE = { bench: 'Pershing Square', busstop: 'Market', chat: 'Jefferson', jog: 'Santa Maria Beach', sunbathe: 'Santa Maria Beach', volley: 'Santa Maria Beach', swim: 'Santa Maria Beach', vendor: 'Santa Maria Beach', tourists: 'Pershing Square', workers: 'Ocean Docks', cops: 'Idlewood', homeless: 'Ocean Docks', couple: 'Vinewood', fight: 'Jefferson', club: 'Vinewood', busker: 'Pershing Square', arrest: 'Jefferson', wedding: 'East Los Santos', protest: 'Commerce' };
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const kinds = (process.env.KINDS || Object.keys(PLACE).join(',')).split(',');
  for (const kind of kinds) {
    const night = kind === 'club' || kind === 'homeless';
    const r = await ctx.eval(async (kind, place, night, hour) => {
      QA.clear(); G.ambient.forcedOnly = true; G.population.pedTarget = 0; G.population.carTarget = 0; G.population.gangTarget = 0;
      G.sky.hour = night ? 23 : hour; G.sky.lockWeather = true; G.sky.setWeather('clear');
      const c = G.world.placement.districtCentre(place); if (!c) return { kind, err: 'no district' };
      // a spot on a road near the district centre
      const nr = G.map.nearestRoad(c.x, c.z, 400);
      QA.tp(nr.x, nr.z, 0); G.world.update(0, nr.x, nr.z, 40);
      for (const S of G.ambient.scenes.slice()) G.ambient.endScene(S, true);
      let S = null, tries = 0;
      for (; tries < 25 && !S; tries++) { const q = G.map.nearestRoad(c.x + (Math.random() - 0.5) * 500, c.z + (Math.random() - 0.5) * 500, 200); if (q) { QA.tp(q.x, q.z, 0); G.world.update(0, q.x, q.z, 30); } S = G.ambient.forceScene(kind); }
      if (!S) return { kind, err: 'not created', tries };
      QA.tp(S.x + 20, S.z + 20, 0); G.world.update(0, S.x, S.z, 400);
      let n = 0; while (S.jobs.length && n++ < 200) QA.sim(0.05);
      QA.sim(3);
      return { kind, tries, x: S.x, z: S.z, peds: S.peds.length, alive: S.peds.filter(p => p.life).length, objs: S.objs.length };
    }, kind, PLACE[kind] || 'Jefferson', night, +(process.env.HOUR || 12));
    console.log(JSON.stringify(r));
    if (r.err) continue;
    const [yaw, pitch, dist] = (process.env.ORBIT || '30,12,9').split(',').map(Number);
    await ctx.eval((r, yaw, pitch, dist) => { const gy = G.world.groundY(r.x, r.z); QA.orbit(r.x, gy + 1.1, r.z, yaw, pitch, dist, 50); }, r, yaw, pitch, dist);
    await ctx.wait(700);
    await ctx.shot('life_scene_' + kind);
    await ctx.eval(() => QA.camEnd());
  }
};
