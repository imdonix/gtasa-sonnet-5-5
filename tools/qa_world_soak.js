// Soak test: hop around the whole map, cycle time of day + weather, run simulated seconds; console errors are printed by play.js.
// node tools/play.js tools/qa_world_soak.js
const Q = require('./qa_world_lib.js');
module.exports = async (ctx) => {
  await Q.init(ctx, { pop: true });
  await ctx.eval(() => { window.__fc = null; G.sky.timeScale = 1; G.sky.dayLengthSec = 240; G.sky.lockWeather = false; G.sky.nextWeatherIn = 5; G.player.group.visible = true; G.hud.root.style.display = ''; });
  const pts = [[0, -60], [560, 206], [-440, 250], [268, -760], [404, 700], [860, 800], [-560, -700], [730, -380], [-100, -440], [900, 140], [0, 0], [-550, 380], [130, -960], [990, 990], [-990, -990], [990, -990], [-990, 990]];
  for (let k = 0; k < pts.length; k++) {
    const [x, z] = pts[k];
    await ctx.eval((x, z, k) => { game.teleport(Math.max(-1000, Math.min(1000, x)), Math.max(-1000, Math.min(1000, z)), k); G.sky.hour = (k * 3.7) % 24; G.sky.setWeather(['clear', 'rain', 'smog', 'cloudy'][k % 4]); }, x, z, k);
    await ctx.step(4);
    await ctx.wait(700);
    const s = await ctx.eval(() => ({ fps: Math.round(game.fpsAvg), chunks: G.world.chunks.size, jobs: G.world.pendingJobs(), errs: game.errCount || 0, veh: G.vehicles.list.length, tris: G.renderer.info.render.triangles }));
    ctx.log(k, JSON.stringify(s));
  }
  await ctx.step(60);
  ctx.log('done');
};
