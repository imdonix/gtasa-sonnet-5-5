// In-game vehicle sheet: TYPES=all or list, VIEWS="yaw:pitch:dist,...", HOUR=14|23.   node tools/play.js tools/qa_vis_cars.js --w 800 --h 450
const { setup } = require('./qa_vis_lib');
module.exports = async (ctx) => {
  await setup(ctx, { empty: true });
  const ALL = 'sedan,coupe,muscle,lowrider,sports,hatch,suv,pickup,van,taxi,police,swatvan,ambulance,bus,truck,limo,motorbike,bicycle,policeheli'.split(',');
  const types = !process.env.TYPES || process.env.TYPES === 'all' ? ALL : process.env.TYPES.split(',');
  const views = (process.env.VIEWS || '35:10:0,140:8:0,250:25:0').split(',').map(s => s.split(':').map(Number));
  const tag = process.env.TAG || 'car', hour = +(process.env.HOUR || 14), seats = process.env.SEATS !== '0';
  await ctx.eval((hour) => { const h = VIS.district('ganton') || { x: 0, z: 0 }; const r = VIS.road(h.x, h.z); window.__r = r; VIS.go(r.x, r.z, r.yaw); VIS.hour(hour); }, hour);
  for (const t of types) {
    await ctx.eval(async (t, seats, extra) => {
      QA.clear(); const r = window.__r; const y = G.world.groundY(r.x, r.z);
      const v = G.vehicles.spawn(t, r.x, r.z, 0, { owner: 'player', color: [0xd01c1c, 0x1c5cd0, 0xe0c020, 0x20a060][(t.length) % 4] });
      window.__v = v; v.wake();
      if (seats) for (let s = 0; s < Math.min(v.model.seats.length, t === 'bus' ? 3 : 4); s++) { const p = new (window.__Ped)({ x: r.x, z: r.z, role: 'civ' }); G.peds.add(p); p.noDespawn = true; p.enterVehicle(v, s, true); p.invincible = true; }
      v.input.handbrake = true; QA.sim(0.6);
      for (const k of (extra.hide || [])) if (v.model.meshes[k]) v.model.meshes[k].visible = false;
      if (extra.hl) { v.model.setHeadlights(true); v.model.setBrake(true); }
      if (extra.siren && v.model.setSiren) v.model.setSiren(true);
    }, t, seats, { hl: hour > 18 || hour < 6, siren: process.env.SIREN === '1', hide: (process.env.HIDE || '').split(',').filter(Boolean) });
    for (const [ya, pi, dd] of views) {
      await ctx.eval((ya, pi, dd) => { const v = window.__v; const h = v.def.height; QA.orbit(v.x, v.y + h * 0.45, v.z, ya, pi, dd || Math.max(6, v.def.length * 1.5), 42); }, ya, pi, dd);
      await ctx.wait(300); await ctx.shot(`${tag}_${t}_${ya}`);
    }
  }
};
