// Muzzle flash / barrel alignment: a ped fires each gun, close-up side and 3/4 shots.  node tools/play.js tools/qa_vis_muzzle.js --w 640 --h 400
const { setup } = require('./qa_vis_lib');
module.exports = async (ctx) => {
  await setup(ctx, { empty: true });
  const ws = (process.env.WEAPONS || 'pistol,deagle,smg,shotgun,ak47,sniper,rpg').split(',');
  await ctx.eval(() => { const h = VIS.district('ganton'); const r = VIS.road(h.x, h.z); window.__r = r; VIS.go(r.x, r.z, r.yaw); VIS.hour(14); G.police.noWanted = true; });
  for (const w of ws) for (const [vn, ya] of [['side', 90], ['q', 50]]) {
    await ctx.eval(async (w, ya) => {
      QA.clear(); const r = window.__r; const p = await QA.ped({ x: r.x + 3, z: r.z, role: 'gang', gang: 2 }); p.invincible = true; p.noDespawn = true;
      p.give(w, 999, true); p.equip(w); p.yaw = 0; p.faceOverride = 0; p.brain = () => {}; p.aiming = true;
      QA.sim(0.6); window.__p = p;
      p.shootAt(p.x, p.y + 1.35, p.z + 30, {});
      game.sim(1 / 60); game.sim(1 / 60);
      const m = p.rig.getMuzzleWorldPos();
      QA.orbit(p.x + 0.0, p.y + 1.3, p.z + 0.35, ya, 6, 1.9, 45);
    }, w, ya);
    await ctx.wait(120); await ctx.shot(`mz_${w}_${vn}`);
  }
};
