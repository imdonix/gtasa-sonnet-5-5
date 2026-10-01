// Force each random world event, fast-forward it and take screenshots at checkpoints.
// node tools/play.js tools/qa_life_events.js   (env KINDS=accident,mugging  WHERE=Jefferson  SHOTS=6,30,55  HOUR=12)
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const kinds = (process.env.KINDS || 'accident,pullover,mugging,driveby,chase,armoured,race,carfire').split(',');
  const shots = (process.env.SHOTS || '6,30,55').split(',').map(Number);
  for (const kind of kinds) {
    const ok = await ctx.eval(async (kind, where, hour) => {
      window.__errs = []; window.addEventListener('error', e => window.__errs.push(e.message));
      QA.clear(); G.worldEvents.timer = 1e9; G.ambient.forcedOnly = true; G.worldEvents.enabled = true; G.population.pedTarget = 6; G.population.carTarget = 5; G.population.gangTarget = 0;
      G.sky.hour = hour; G.sky.lockWeather = true; G.sky.setWeather('clear');
      for (const S of G.ambient.scenes.slice()) G.ambient.endScene(S, true);
      let E = null;
      for (let tries = 0; tries < 12 && !E; tries++) {
        const c = G.world.placement.districtCentre(where); const q = G.map.nearestRoad(c.x + (Math.random() - 0.5) * 300, c.z + (Math.random() - 0.5) * 300, 200);
        QA.tp(q.x, q.z, 0); G.world.update(0, q.x, q.z, 60); G.population.enabled = false;
        E = G.worldEvents.start(kind, true);
      }
      if (!E) return { kind, err: 'no event' };
      let n = 0; while (E.jobs.length && n++ < 300) QA.sim(0.05);
      return { kind, x: Math.round(E.x), z: Math.round(E.z), peds: E.peds.length, vehs: E.vehs.length };
    }, kind, process.env.WHERE || 'Jefferson', +(process.env.HOUR || 12));
    console.log(JSON.stringify(ok));
    if (ok.err) continue;
    let last = 0;
    for (const t of shots) {
      const r = await ctx.eval((dt) => { const E = G.worldEvents.active; QA.sim(dt); const E2 = G.worldEvents.active; if (!E2) return { ended: true, errs: window.__errs }; G.world.update(0, E2.x, E2.z, 300); QA.tp(E2.x + 35, E2.z + 35, 0); const gy = G.world.groundY(E2.x, E2.z); QA.orbit(E2.x, gy + 1.3, E2.z, 20 + E2.t * 3, 16, 13, 55);
        return { t: +E2.t.toFixed(1), peds: E2.peds.filter(p => G.peds.list.includes(p)).length, dead: E2.peds.filter(p => p.dead).length, vehs: E2.vehs.filter(v => G.vehicles.list.includes(v)).length, phase: E2.phase, dd: E2.dd, amb: E2.amb && E2.amb.state, pol: E2.pol && E2.pol.state, fd: E2.fd && E2.fd.state, errs: window.__errs.slice(-2) }; }, t - last);
      last = t; console.log(kind, JSON.stringify(r));
      if (r.ended) break;
      await ctx.wait(500); await ctx.shot('life_ev_' + kind + '_' + t); await ctx.eval(() => QA.camEnd());
    }
    const fin = await ctx.eval(() => { QA.sim(90); QA.camEnd(); return { active: !!G.worldEvents.active, ...QA.counts(), sc: G.scene.children.length, errs: window.__errs.slice(-2), hist: G.worldEvents.history }; });
    console.log(kind, 'after', JSON.stringify(fin));
  }
};
