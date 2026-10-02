// Wasted / busted / respawn flows in real time (uses the real frame loop).
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { invincible: false });
  const snap = () => ctx.eval(() => { const p = G.player; return { state: game.state, dead: p.dead, hp: Math.round(p.health), veh: !!p.vehicle, stars: G.police.stars, pos: [Math.round(p.x), Math.round(p.z)], ctrl: p.controlEnabled, ts: game.timeScale, money: p.money, w: p.weaponId, group: p.group.visible, rot: [+p.group.rotation.x.toFixed(2), +p.group.rotation.z.toFixed(2)], cam: [Math.round(G.camera.pos.x), Math.round(G.camera.pos.y)] }; });
  // 1. wasted on foot
  await ctx.eval(() => { QA.tp(G.landmarks.home.door.x, G.landmarks.home.door.z, 0); G.player.give('pistol', 100, true); G.player.damage(1000, { source: null }); });
  ctx.log('dead', JSON.stringify(await snap())); await ctx.wait(1500); await ctx.shot('flow_wasted'); await ctx.wait(6500);
  ctx.log('after wasted', JSON.stringify(await snap())); await ctx.shot('flow_respawn');
  // 2. wasted in car via explosion
  await ctx.eval(async () => { const p = G.player; const v = G.vehicles.spawn('sedan', p.x + 4, p.z, 0, { owner: 'player' }); p.enterVehicle(v, 0, true); v.blowUp(null); });
  await ctx.wait(1200); ctx.log('car blast', JSON.stringify(await snap())); await ctx.wait(7000); ctx.log('after', JSON.stringify(await snap()));
  // 3. busted: 2 stars, stationary
  await ctx.eval(() => { const p = G.player; p.health = p.maxHealth; p.dead = false; G.police.raise(2, 'test', 2); G.police.armedT = 0; const n = G.map.nearestRoad(p.x, p.z, 80); QA.tp(n.x + 4, n.z, 0); for (let i = 0; i < 20; i++) G.world.update(0.05, n.x, n.z, 30); });
  let st = null; for (let i = 0; i < 40; i++) { await ctx.wait(1000); st = await snap(); if (st.state !== 'play') break; }
  ctx.log('busted?', JSON.stringify(st)); await ctx.wait(1500); await ctx.shot('flow_busted'); await ctx.wait(6000); ctx.log('after busted', JSON.stringify(await snap()));
  await ctx.eval(() => ({ peds: G.peds.list.length, cops: G.peds.list.filter(p => p.role === 'cop').length })).then(r => ctx.log(JSON.stringify(r)));
};
