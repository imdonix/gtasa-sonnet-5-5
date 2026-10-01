// Cornering / handbrake drift metrics in the flat airport arena.  TYPES=sedan,sports
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const types = (process.env.TYPES || 'sedan,coupe,muscle,sports,suv,van,bus,truck,limo,motorbike,bicycle').split(',');
  const res = await ctx.eval(async (types) => {
    const out = {}; const cx = 420, cz = 740; QA.tp(cx, cz, 0); for (let i = 0; i < 30; i++) G.world.update(0.05, cx, cz, 30); G.population.pedTarget = 0;
    for (const t of types) {
      QA.clear(); G.player.x = cx; G.player.z = cz;
      const v = await QA.car(t, cx - 150, cz, Math.PI / 2); // heading +x
      const r = {}; const dt = 1 / 30;
      const hold = (kmh, secs = 8) => { const tgt = kmh / 3.6; for (let i = 0; i < secs * 30; i++) { v.input.throttle = v.speed < tgt ? 1 : 0.1; v.input.steer = 0; game.sim(dt); } };
      for (const kmh of [50, 90]) {
        v.x = cx - 150; v.z = cz; v.yaw = Math.PI / 2; v.vx = v.vz = 0; v.yawRate = 0; v.input.handbrake = false;
        if (kmh / 3.6 > v.phys.vmax * 0.9) continue;
        hold(kmh, 12); const s0 = v.speed; const yaw0 = v.yaw;
        let maxSlip = 0, maxRoll = 0; let tt = 0; const x0 = v.x, z0 = v.z;
        v.input.steer = 1; v.input.throttle = 0.3;
        for (let i = 0; i < 60; i++) { game.sim(dt); tt += dt; const slip = Math.abs(Math.atan2(v.latSpeed, Math.max(0.1, Math.abs(v.speed)))); maxSlip = Math.max(maxSlip, slip); maxRoll = Math.max(maxRoll, Math.abs(v.roll)); }
        r['turn' + kmh] = { s0: Math.round(s0 * 3.6), yawDegPerS: Math.round((v.yaw - yaw0) * 57.3 / tt), slipDeg: Math.round(maxSlip * 57.3), speedLossKmh: Math.round((s0 - v.speed) * 3.6), roll: +maxRoll.toFixed(2), lean: +(v.lean || 0).toFixed(2) };
      }
      // handbrake turn from 70 km/h
      if (70 / 3.6 < v.phys.vmax * 0.95) {
        v.x = cx - 150; v.z = cz; v.yaw = Math.PI / 2; v.vx = v.vz = 0; v.input.handbrake = false; hold(70, 10);
        const yaw0 = v.yaw; v.input.steer = 1; v.input.handbrake = true; v.input.throttle = 0; let maxSlip = 0;
        for (let i = 0; i < 45; i++) { game.sim(dt); maxSlip = Math.max(maxSlip, Math.abs(Math.atan2(v.latSpeed, Math.max(0.1, Math.abs(v.speed))))); }
        r.hbTurn = { yawDeg: Math.round((v.yaw - yaw0) * 57.3), slipDeg: Math.round(maxSlip * 57.3), totalKmh: Math.round(v.totalSpeed * 3.6) };
        v.input.handbrake = false; v.input.steer = 0; for (let i = 0; i < 60; i++) game.sim(dt); r.hbTurn.after1s = Math.round(v.totalSpeed * 3.6); r.hbTurn.yaw1s = Math.round((v.yaw - yaw0) * 57.3);
      }
      r.hp = Math.round(v.health);
      out[t] = r;
    }
    return out;
  }, types);
  for (const k in res) console.log(k, JSON.stringify(res[k]));
};
