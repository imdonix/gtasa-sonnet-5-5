// Damage / burnt / heli sheet.  TYPES=sedan,suv,policeheli.  node tools/play.js tools/qa_vis_damage.js --w 800 --h 450
const { setup } = require('./qa_vis_lib');
module.exports = async (ctx) => {
  await setup(ctx, { empty: true });
  const types = (process.env.TYPES || 'sedan,sports,van,policeheli').split(',');
  await ctx.eval(() => { const h = VIS.district('ganton'); const r = VIS.road(h.x, h.z); window.__r = r; VIS.go(r.x, r.z, r.yaw); VIS.hour(14); });
  for (const t of types) {
    await ctx.eval((t) => { QA.clear(); const r = window.__r; const v = G.vehicles.spawn(t, r.x, r.z, 0, { owner: 'parked', color: 0x2060d0 }); window.__v = v; v.wake(); }, t);
    for (const [name, lvl] of [['d0', 0], ['d1', 0.45], ['d2', 0.8], ['burnt', -1]]) {
      await ctx.eval((lvl) => { const v = window.__v; if (lvl < 0) { v.model.setDamage(1); v.model.setBurnt(true); } else { v.model.setBurnt(false); v.model.setDamage(lvl); } const h = v.def.height; QA.orbit(v.x, v.y + h * 0.4, v.z, 30, 12, Math.max(6, v.def.length * 1.6), 42); QA.sim(0.3); }, lvl);
      await ctx.wait(300); await ctx.shot(`dmg_${t}_${name}`);
    }
  }
};
