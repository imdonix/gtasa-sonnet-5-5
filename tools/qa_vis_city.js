// Street-level district shots.  DISTRICTS="Ganton,Idlewood,..." HOUR=14|23 VIEWS=3.  node tools/play.js tools/qa_vis_city.js --w 960 --h 540
const { setup } = require('./qa_vis_lib');
module.exports = async (ctx) => {
  await setup(ctx, { empty: true });
  const ds = (process.env.DISTRICTS || 'Ganton,Idlewood,Pershing Square,Vinewood Hills,Santa Maria Beach,Commerce,Ocean Docks,Los Santos Airport').split(',');
  const hour = +(process.env.HOUR || 14), tag = process.env.TAG || 'city', nv = +(process.env.VIEWS || 3);
  await ctx.eval((h) => { VIS.hour(h); }, hour);
  for (const d of ds) {
    const ok = await ctx.eval((d, nv) => {
      const c = VIS.district(d); if (!c) return false;
      // try a few spots around; choose the one with most buildings nearby
      let best = null;
      for (let i = 0; i < 12; i++) {
        const a = i * 0.9, rr = 10 + i * 18; const p = VIS.road(c.x + Math.cos(a) * rr, c.z + Math.sin(a) * rr); if (!p) continue;
        const near = G.placement && G.placement.buildings ? G.placement.buildings.filter(b => Math.hypot(b.x - p.x, b.z - p.z) < 60).length : 0;
        if (!best || near > best.near) best = { p, near };
      }
      window.__spot = best.p; VIS.go(best.p.x, best.p.z, best.p.yaw); QA.sim(0.5); return true;
    }, d, nv);
    if (!ok) { console.log('no district', d); continue; }
    for (let v = 0; v < nv; v++) {
      await ctx.eval((v) => {
        const p = window.__spot, y = G.world.groundY(p.x, p.z) + 1.7;
        const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), sx = fz, sz = -fx;     // forward, right-ish
        const ang = [0, Math.PI / 2, -Math.PI / 2][v];
        const dx = fx * Math.cos(ang) + sx * Math.sin(ang), dz = fz * Math.cos(ang) + sz * Math.sin(ang);
        QA.cam({ x: p.x, y, z: p.z }, { x: p.x + dx * 30, y: y + 2 + (v ? 3 : 0), z: p.z + dz * 30 }, 62);
      }, v);
      await ctx.wait(500); await ctx.shot(`${tag}_${d.replace(/ /g, '')}_${v}`);
    }
  }
};
