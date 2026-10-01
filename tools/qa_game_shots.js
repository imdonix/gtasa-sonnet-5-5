// Vehicle + seated driver screenshots.  node tools/play.js tools/qa_game_shots.js --w 800 --h 450 [types via env TYPES=sedan,bus]
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const types = (process.env.TYPES || 'sedan,sports,suv,van,bus,motorbike,bicycle,police').split(',');
  const views = (process.env.VIEWS || '0:25,90:10,200:40').split(',').map(s => s.split(':').map(Number));
  for (const t of types) {
    await ctx.eval(async (t) => {
      QA.clear(); const st = QA.findStraight(220, null, 0.01);
      const x = st.x, z = st.z - 0; const v = await QA.car(t, x, z, 0); window.__v = v; G.player.x = x + 30; G.player.z = z + 30;
      const p2 = await QA.ped({ x, z, role: 'civ' }); p2.enterVehicle(v, 1, true);
      const p3 = await QA.ped({ x, z, role: 'civ' }); if (v.model.seats.length > 2) p3.enterVehicle(v, 2, true);
      window.__pl = G.player; G.player.noDespawn = true; v.input.handbrake = true; QA.sim(0.5);
    }, t);
    for (const [ya, pi] of views) {
      await ctx.eval((ya, pi) => { const v = window.__v; const h = v.def.height; QA.orbit(v.x, v.y - v.def.wheelRadius + h * 0.6, v.z, ya, pi, Math.max(5.5, v.def.length * 1.4), 45); }, ya, pi);
      await ctx.wait(450);
      await ctx.shot(`veh_${t}_${ya}`);
    }
  }
};
