// Camera continuity across enter / exit / aim / death: max per-frame camera movement (m) and look-direction change (deg).
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const res = await ctx.eval(async () => {
    const pl = G.player; const cx = 420, cz = 740; QA.tp(cx, cz, Math.PI / 2); for (let i = 0; i < 30; i++) G.world.update(0.05, cx, cz, 30); G.police.noWanted = true;
    const out = {}; let lp = G.camera.pos.clone(), lf = G.camera.fwd.clone();
    const track = (name, secs, pre) => { let mp = 0, ma = 0; const n = Math.round(secs * 30); for (let i = 0; i < n; i++) { if (pre) pre(i); game.sim(1 / 30); G.input.pressed.clear(); G.camera.update(1 / 30, 1 / 30, pl, G.input); const d = G.camera.pos.distanceTo(lp); const a = Math.acos(Math.max(-1, Math.min(1, G.camera.fwd.dot(lf)))) * 57.3; if (i > 0) { mp = Math.max(mp, d); ma = Math.max(ma, a); } lp.copy(G.camera.pos); lf.copy(G.camera.fwd); } out[name] = { maxMove: +mp.toFixed(2), maxTurnDeg: +ma.toFixed(1), inVeh: !!pl.vehicle, spd: pl.vehicle ? Math.round(pl.vehicle.speed) : 0, cine: !!G.camera.cine, mode: game.state }; };
    QA.clear(); const v = G.vehicles.spawn('sedan', cx + 2.5, cz + 1, 1.2, { owner: 'player' }); G.camera.snapTo(pl); G.camera.yaw = 0;
    track('walk', 1);
    const press = (k) => { G.input.pressed.add(k); };
    track('enter', 2.5, (i) => { if (i === 2) press('KeyF'); });
    G.input.down.add('KeyW'); track('accel', 4); G.input.down.add('KeyA'); track('steerLeft', 2); G.input.down.delete('KeyA'); G.input.down.add('KeyS'); G.input.down.delete('KeyW'); track('brake', 3); G.input.down.clear();
    track('exit', 2, (i) => { if (i === 2) pl.exitVehicle(false); });
    pl.give('ak47', 300, true); G.input.buttons.add(2); track('aimOn', 1.5); G.input.buttons.clear(); track('aimOff', 1.5);
    pl.give('sniper', 50, true); pl.equip('sniper'); G.input.buttons.add(2); track('scopeOn', 1.5); G.input.buttons.clear(); track('scopeOff', 1.5);
    pl.invincible = false; pl.damage(1e4, {}); track('death', 3);
    return out;
  });
  for (const k in res) console.log(k.padEnd(10), JSON.stringify(res[k]));
};
