// Soak: tour of locations (day + night), frequent world events; reports entity counts, leaks, NaN, exceptions and per-step cost.
// node tools/play.js tools/qa_life_soak.js   (env SECS=120 per stop, PLACES=a,b  ONLYNIGHT=1  STARS=0)
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, {});
  const SECS = +(process.env.SECS || 120);
  const places = (process.env.PLACES || 'Ganton,Pershing Square,Santa Maria Beach,Ocean Docks,Vinewood,Little Mexico').split(',');
  const times = process.env.ONLYNIGHT ? [23] : process.env.ONLYDAY ? [12] : [12, 23];
  await ctx.eval(() => { window.__errs = []; window.addEventListener('error', e => window.__errs.push(e.message)); const oe = console.error; console.error = (...a) => { window.__errs.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 200)); oe(...a); }; G.player.noDespawn = true; G.player.invincible = true; });
  if (process.env.NOLIFE) await ctx.eval(() => { G.ambient.enabled = false; G.worldEvents.enabled = false; });
  for (const hour of times) for (const place of places) {
    const r = await ctx.eval(async (place, hour, SECS) => {
      G.sky.hour = hour; G.sky.lockWeather = true; G.sky.setWeather('clear'); G.sky.timeScale = 0;
      const c = G.world.placement.districtCentre(place); const q = G.map.nearestRoad(c.x, c.z, 300);
      QA.tp(q.x, q.z, 0); G.world.update(0, q.x, q.z, 200);
      const base = { children: G.scene.children.length, peds: G.peds.list.length, vehs: G.vehicles.list.length };
      let totMs = 0, maxMs = 0, n = 0; const maxPeds = [0, 0]; let evs = 0, nan = 0; const sceneKinds = {}; let gawk = 0, sitting = 0, sigw = 0; let evSince = 0;
      const t0w = performance.now();
      for (let i = 0; i < SECS * 30; i++) {
        const t0 = performance.now(); game.sim(1 / 30); G.camera.update(1 / 30, 1 / 30, G.player, G.input); const ms = performance.now() - t0; totMs += ms; maxMs = Math.max(maxMs, ms); n++;
        if (i % 30 === 0) G.world.update(0.03, G.player.x, G.player.z, 8);
        G.player.health = G.player.maxHealth; G.player.dead = false;
        if (i % 30 === 0) {
          maxPeds[0] = Math.max(maxPeds[0], G.peds.list.length); maxPeds[1] = Math.max(maxPeds[1], G.vehicles.list.length);
          for (const S of G.ambient.scenes) sceneKinds[S.kind] = (sceneKinds[S.kind] || 0) + 1;
          for (const p of G.peds.list) { if (!isFinite(p.x + p.y + p.z)) nan++; if (p.life && p.life.poi) gawk++; if (p.life && p.life.type === 'sit') sitting++; if (p.sigWait) sigw++; }
          for (const v of G.vehicles.list) if (!isFinite(v.x + v.y + v.z + v.yaw)) nan++;
          evSince += 1; if (G.worldEvents.enabled && !G.worldEvents.active && evSince > 25 && G.police.stars === 0) { evSince = 0; if (G.worldEvents.startRandom()) evs++; }
        }
        // the player wanders a little so the population streams
        if (i % 600 === 599) { const a = Math.random() * 6.28; const q2 = G.map.nearestRoad(G.player.x + Math.cos(a) * 140, G.player.z + Math.sin(a) * 140, 200); if (q2) { QA.tp(q2.x, q2.z, 0); G.world.update(0, q2.x, q2.z, 100); } }
      }
      const cs = G.ambient.cost, ws = G.worldEvents.cost;
      return { place, hour, simMsAvg: +(totMs / n).toFixed(2), simMsMax: +maxMs.toFixed(1), ambAvg: +(cs.sum / Math.max(1, cs.n)).toFixed(3), ambMax: +cs.max.toFixed(1), evAvg: +(ws.sum / Math.max(1, ws.n)).toFixed(3), evMax: +ws.max.toFixed(1), events: evs, hist: G.worldEvents.history.slice(-6), peds: G.peds.list.length, vehs: G.vehicles.list.length, maxPeds, children: G.scene.children.length, dChildren: G.scene.children.length - base.children, scenes: Object.keys(sceneKinds).join(','), nScenes: G.ambient.scenes.length, nan, gawkSamples: gawk, sitSamples: sitting, sigSamples: sigw, stars: G.police.stars, stats: JSON.stringify(G.ambient.stats), errs: window.__errs.slice(-3), wall: Math.round((performance.now() - t0w) / 1000) };
    }, place, hour, SECS);
    console.log(JSON.stringify(r));
  }
  const fin = await ctx.eval(() => { G.ambient.cost.max = 0; return { ...QA.counts(), poi: G.ambient.pois.length, scenes: G.ambient.scenes.length, bubbles: G.ambient.bubbles.active.length, blips: G.blips.list.length, markers: G.markers.list.length, pickups: G.pickups.list.length, errs: window.__errs.length }; });
  console.log('final', JSON.stringify(fin));
};
