// Enter / exit vehicle flows for every type: glitch detection (teleports), placement, carjack, moving/burning vehicles.
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const res = await ctx.eval(async () => {
    const { PHYS } = await import('/src/vehicles.js'); const out = {}; const pl = G.player;
    const cx = 420, cz = 740; QA.tp(cx, cz, 0); for (let i = 0; i < 30; i++) G.world.update(0.05, cx, cz, 30); G.population.pedTarget = 0;
    const press = (k) => { G.input.pressed.add(k); game.sim(1 / 30); G.input.pressed.clear(); };
    for (const t of Object.keys(PHYS)) {
      if (t === 'policeheli') continue;
      QA.clear(); QA.tp(cx, cz, 0); pl.vx = pl.vz = 0;
      const v = G.vehicles.spawn(t, cx + 4, cz, 0.3, { owner: 'traffic' });
      const r = { };
      const dw = v.doorWorldPos(0); const off = +(window.__off ?? 3); pl.x = dw.x + Math.cos(v.yaw) * off; pl.z = dw.z - Math.sin(v.yaw) * off; pl.y = G.world.groundY(pl.x, pl.z);
      QA.sim(0.2);
      const pos = () => { const w = pl.group.getWorldPosition(new (pl.group.position.constructor)()); return [w.x, w.y, w.z]; };
      let last = pos(), maxJump = 0; const track = (secs) => { for (let i = 0; i < secs * 30; i++) { game.sim(1 / 30); const p = pos(); maxJump = Math.max(maxJump, Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2])); last = p; } };
      press('KeyF'); track(2.2);
      r.entered = !!pl.vehicle && pl.vehicle === v && pl.seat === 0; r.enterJump = +maxJump.toFixed(2);
      const w = pos(); r.seatErr = +Math.hypot(w[0] - v.seatWorldPos(0).x, w[2] - v.seatWorldPos(0).z).toFixed(2);
      maxJump = 0; last = pos();
      press('KeyF'); track(1.0);
      r.exited = !pl.vehicle; const p = pos();
      // not inside own obb
      const dx = p[0] - v.x, dz = p[2] - v.z, c = Math.cos(v.yaw), s = Math.sin(v.yaw); const lx = dx * c - dz * s, lz = dx * s + dz * c;
      r.outsideObb = Math.abs(lx) > v.def.width / 2 - 0.05 || Math.abs(lz) > v.def.length / 2 + 0.05; r.exitJump = +maxJump.toFixed(2);
      r.exitY = +(p[1] - G.world.groundY(p[0], p[2])).toFixed(2);
      out[t] = r;
    }
    // NPC far away enters a car on its own (walks/runs to the door first)
    QA.clear(); const vv = G.vehicles.spawn('sedan', cx, cz, 0, { owner: 'traffic' }); const np = await QA.ped({ x: cx + 25, z: cz + 10, role: 'civ' }); np.invincible = true; np.brain = (p, dt) => { p.move.x = p.move.z = 0; p.speedTarget = 0; };
    np.enterVehicle(vv, 1, false); let maxStep = 0, lx = np.x, lz = np.z; const t0 = G.time; let tIn = null;
    for (let i = 0; i < 30 * 12; i++) { game.sim(1 / 30); maxStep = Math.max(maxStep, Math.hypot(np.x - lx, np.z - lz)); lx = np.x; lz = np.z; if (np.vehicle && tIn === null) tIn = G.time - t0; }
    out.npcEnterFar = { inCar: !!np.vehicle, seat: np.seat, tIn: tIn && +tIn.toFixed(1), maxStepPerFrame: +maxStep.toFixed(2) };
    // exit at speed
    QA.clear(); QA.tp(cx, cz, 0);
    const v = G.vehicles.spawn('sedan', cx - 100, cz, Math.PI / 2, { owner: 'player' }); pl.enterVehicle(v, 0, true);
    v.vx = 25; v.vz = 0; QA.sim(0.1); const h0 = pl.health; pl.invincible = false;
    press('KeyF'); QA.sim(3); out.exitAt90kmh = { health: Math.round(pl.health), dead: pl.dead, onGround: pl.grounded, downT: +pl.downT.toFixed(1) };
    pl.health = 100; pl.dead = false;
    // carjack a civilian-driven car
    QA.clear(); const v2 = await QA.car('sedan', cx + 20, cz, 0, { owner: 'traffic' }); const d = v2.driver; d.invincible = false;
    const dw = v2.doorWorldPos(0); pl.x = dw.x; pl.z = dw.z; QA.sim(0.1); press('KeyF'); QA.sim(1.5);
    out.carjack = { inCar: pl.vehicle === v2, oldDriverOut: !d.vehicle, oldMode: d.mode, stars: G.police.stars };
    // burning
    pl.exitVehicle(true); QA.sim(0.2); const v3 = G.vehicles.spawn('sedan', cx + 40, cz, 0, { owner: 'traffic' }); v3.ignite(); const dw3 = v3.doorWorldPos(0); pl.x = dw3.x; pl.z = dw3.z; QA.sim(0.1); press('KeyF'); QA.sim(1);
    out.burning = { entered: pl.vehicle === v3 };
    return out;
  });
  for (const k in res) console.log(k, JSON.stringify(res[k]));
};
