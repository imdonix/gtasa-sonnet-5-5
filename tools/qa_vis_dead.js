// Dead bodies on flat ground and on a slope, several causes.   node tools/play.js tools/qa_vis_dead.js --w 800 --h 450
const { setup } = require('./qa_vis_lib');
module.exports = async (ctx) => {
  await setup(ctx, { empty: true });
  const info = await ctx.eval(() => {
    // find steepest nearby-ish slope (>=12%) on the hills
    let best = null; const W = G.world;
    for (let x = -300; x < 300; x += 6) for (let z = -900; z < -300; z += 6) { const h = W.groundY(x, z), hx = W.groundY(x + 2, z), hz = W.groundY(x, z + 2); const s = Math.hypot(hx - h, hz - h) / 2; if (s > 0.25 && s < 0.6 && (!best || s > best.s)) best = { x, z, s }; }
    window.__slope = best; const h = VIS.district('ganton'); const r = VIS.road(h.x, h.z); window.__flat = r; VIS.hour(14); return best;
  });
  console.log('slope', JSON.stringify(info));
  for (const [nm, key] of [['flat', '__flat'], ['slope', '__slope']]) {
    await ctx.eval(async (key) => {
      QA.clear(); const c = window[key]; if (!c) return; VIS.go(c.x, c.z, 0);
      const y = G.world.groundY(c.x, c.z);
      window.__dead = [];
      for (let i = 0; i < 3; i++) { const p = await QA.ped({ x: c.x + i * 1.6 - 1.6, z: c.z, role: 'civ' }); p.invincible = false; p.noDespawn = true; p.brain = () => {}; p.yaw = i * 1.2; window.__dead.push(p); }
      QA.sim(0.3); for (const p of window.__dead) p.damage(999, { source: G.player }); QA.sim(1.5);
      QA.orbit(c.x, y + 0.4, c.z, 50, 22, 4.2, 45);
    }, key);
    await ctx.wait(300); await ctx.shot('dead_' + nm);
    await ctx.eval((key) => { const c = window[key]; const y = G.world.groundY(c.x, c.z); QA.orbit(c.x, y + 0.3, c.z, 120, 4, 3.6, 45); }, key);
    await ctx.wait(300); await ctx.shot('dead_' + nm + '2');
  }
};
