// Real player on foot with the real third-person camera: MODES=walk,run,sprint,crouch,aim  WEAPON=ak47.  node tools/play.js tools/qa_vis_player.js --w 800 --h 450
const { setup } = require('./qa_vis_lib');
module.exports = async (ctx) => {
  await setup(ctx, { empty: true });
  await ctx.eval(() => { G.player.group.visible = true; const st = [...document.querySelectorAll('style')].pop(); st.textContent = 'body > *:not(canvas):not(#hud){display:none !important}'; });
  const modes = (process.env.MODES || 'walk,run,sprint,crouch,aim').split(','), wp = process.env.WEAPON || null;
  await ctx.eval(() => { const h = VIS.district('ganton'); const r = VIS.road(h.x, h.z); window.__r = r; VIS.go(r.x + 4, r.z, r.yaw); VIS.hour(14); G.player.noWanted = true; });
  for (const m of modes) {
    await ctx.eval((m, wp) => {
      const r = window.__r; const pl = G.player; QA.tp(r.x + 4, r.z, r.yaw); pl.yaw = r.yaw; G.camera.snapTo && G.camera.snapTo(pl);
      if (wp) { pl.give(wp, 500, true); pl.equip(wp); } else pl.equip('fist');
      pl.crouch = false;
      const keys = { walk: ['KeyW'], run: ['KeyW'], sprint: ['KeyW', 'ShiftLeft'], crouch: ['KeyW'], aim: ['KeyW'] }[m];
      G.input.down.clear(); for (const k of keys) G.input.down.add(k);
      if (m === 'crouch') pl.crouch = true; if (m === 'aim') G.input.buttons.add(2);
      window.__walkSlow = m === 'walk';
    }, m, wp);
    for (let i = 0; i < 4; i++) {
      await ctx.eval((m) => { for (let k = 0; k < 14; k++) { game.sim(1 / 30); G.camera.update(1 / 30, 1 / 30, G.player, G.input); } const p = G.player; window.__sp = Math.hypot(p.vx, p.vz); }, m);
      await ctx.wait(250); await ctx.shot(`pl_${m}_${i}`);
    }
    console.log(m, 'speed', await ctx.eval(() => window.__sp));
  }
};
