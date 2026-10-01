// In-game ped pose sheet: every state/action of a few rigs at 3 m, real lighting.   node tools/play.js tools/qa_vis_peds_states.js --w 640 --h 480
const { setup } = require('./qa_vis_lib');
module.exports = async (ctx) => {
  await setup(ctx, { empty: true });
  const states = (process.env.STATES || 'idle,walk,run,sprint,crouch,jump,fall,swim,cower,phone,dance,aim').split(',');
  await ctx.eval(() => { const h = VIS.district('ganton') || { x: 0, z: 0 }; const r = VIS.road(h.x, h.z); window.__r = r; VIS.go(r.x, r.z, r.yaw); VIS.hour(14); });
  for (const st of states) {
    await ctx.eval(async (st) => {
      VIS.clearRigs(); const r = window.__r; const y = G.world.groundY(r.x, r.z);
      const rig = await VIS.rig(r.x, y, r.z, null, { yaw: 0.6 }); rig.setState(st); if (st === 'aim') rig.setWeapon('ak47');
      const sp = { walk: 1.3, run: 4.1, sprint: 6.6, crouch: 1.9, swim: 2.4 }[st] || 0;
      for (let i = 0; i < 40; i++) rig.update(1 / 30, { speed: sp, aiming: st === 'aim' });
      VIS.look(r.x, y + 0.9, r.z, 35, 8, 3.2, 40);
    }, st);
    await ctx.wait(350); await ctx.shot('ps_' + st);
  }
};
