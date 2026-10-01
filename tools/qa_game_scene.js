// Staged scene screenshots: SCENE=fight|chase|cops  (run: SCENE=fight node tools/play.js tools/qa_game_scene.js --w 960 --h 540)
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, {});
  const scene = process.env.SCENE || 'fight';
  await ctx.eval(() => { QA.simCam = (s, dt = 1 / 30) => { const n = Math.round(s / dt); for (let i = 0; i < n; i++) { game.sim(dt); G.camera.update(dt, dt, G.player, G.input); } }; });
  if (scene === 'fight') {
    await ctx.eval(async () => {
      const pl = G.player; QA.clear(); G.population.carTarget = 0; G.population.pedTarget = 0; G.population.gangTarget = 0; G.police.noWanted = true;
      const cx = 420, cz = 740; QA.tp(cx, cz, Math.PI / 2); for (let i = 0; i < 30; i++) G.world.update(0.05, cx, cz, 30);
      pl.give('smg', 500, true); pl.invincible = true;
      for (let i = 0; i < 4; i++) { const e = await QA.ped({ x: cx + 14 + i * 2, z: cz + (i - 1.5) * 3, role: 'gang', gang: 2 }); e.give(['pistol', 'smg', 'shotgun', 'ak47'][i], 999, true); e.hostile = true; e.aggroT = 1e9; e.setMode('attack', 1e9); e.target = pl; }
      G.input.buttons.add(2); QA.simCam(2.5);
      const t = G.peds.list.find(p => p.role === 'gang'); G.input.buttons.add(0);
      for (let k = 0; k < 12; k++) { G.input.btnPressed.add(0); QA.simCam(0.12); }
    });
    await ctx.shot('scene_fight');
  }
  if (scene === 'boom') {
    await ctx.eval(async () => {
      const pl = G.player; QA.clear(); G.population.carTarget = 0; G.population.pedTarget = 0; G.population.gangTarget = 0; G.police.noWanted = true;
      const cx = 420, cz = 740; QA.tp(cx, cz, Math.PI / 2); for (let i = 0; i < 30; i++) G.world.update(0.05, cx, cz, 30);
      const vs = []; for (let i = 0; i < 4; i++) vs.push(G.vehicles.spawn(['sedan', 'van', 'sports', 'suv'][i], cx + 14 + i * 5.5, cz + 2, 0.2, { owner: 'parked' }));
      for (let i = 0; i < 3; i++) { const p = await QA.ped({ x: cx + 18 + i * 3, z: cz - 6, role: 'civ' }); }
      window.__vs = vs; pl.give('rpg', 10, true); pl.equip('rpg'); pl.invincible = true;
      pl.yaw = Math.PI / 2; G.camera.yaw = Math.PI / 2; G.camera.snapTo(pl); G.camera.yaw = Math.PI / 2; QA.simCam(1.5);
      G.combat.explode(vs[0].x, vs[0].y, vs[0].z, 6, 300, { source: pl }); vs[0].blowUp(pl); QA.simCam(0.9);
    });
    await ctx.shot('scene_boom');
    const r = await ctx.eval(() => { const out = window.__vs.map(v => [v.type, Math.round(v.health), v.exploded, v.onFire]); QA.simCam(6); return [out, window.__vs.map(v => [v.type, Math.round(v.health), v.exploded])]; });
    console.log(JSON.stringify(r));
  }
  if (scene === 'chase') {
    await ctx.eval(async () => {
      const pl = G.player; QA.clear(); G.population.carTarget = 10; G.population.pedTarget = 10;
      const home = G.landmarks.home; const nr = G.map.nearestRoad(home.door.x + 10, home.door.z + 10, 100);
      QA.tp(nr.x, nr.z, Math.atan2(nr.tx, nr.tz)); for (let i = 0; i < 20; i++) G.world.update(0.05, nr.x, nr.z, 30);
      const v = G.vehicles.spawn('muscle', nr.x, nr.z, Math.atan2(nr.tx, nr.tz), { owner: 'player' }); pl.enterVehicle(v, 0, true); pl.invincible = true;
      G.police.raise(4, 'test', 4); G.input.down.add('KeyW'); QA.simCam(25);
    });
    await ctx.shot('scene_chase');
  }
};
