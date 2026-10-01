// Driving metrics for every vehicle type.  node tools/play.js tools/qa_game_drive.js
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const res = await ctx.eval(async () => {
    G.police.noWanted = true;
    const { PHYS } = await import('/src/vehicles.js');
    const st = QA.findStraight(220, null, 0.01); if (!st) return { error: 'no straight' };
    const out = { _road: { x: Math.round(st.x), z: Math.round(st.z), len: Math.round(st.len), cls: st.edge.cls } };
    const only = window.__only;
    for (const type of Object.keys(PHYS)) {
      if (type === 'policeheli') continue;
      QA.clear();
      const dt = 1 / 30; const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw);
      const lane = 2.4; const ox = st.x - fz * lane * -1, oz = st.z + fx * lane * -1;
      const v = await QA.car(type, st.x + fz * -lane, st.z - fx * -lane, st.yaw);
      G.player.x = v.x; G.player.z = v.z;
      const r = { surf: G.world.surfaceAt(v.x, v.z), crashes: [] };
      const oc = v.crash.bind(v); v.crash = (sp, w, nx, nz, o) => { if (r.crashes.length < 3) r.crashes.push([+sp.toFixed(1), w, Math.round(along()), Math.round(G.time)]); oc(sp, w, nx, nz, o); };
      const x0 = v.x, z0 = v.z; const along = () => (v.x - x0) * fx + (v.z - z0) * fz;
      const wrap = () => { if (along() > st.len - 40) { const back = st.len - 100; v.x -= fx * back; v.z -= fz * back; v.y = G.world.groundY(v.x, v.z) + v.def.wheelRadius; v.groundY = v.y; v._lastVy = 0; v.vy = 0; } };
      const S = (secs) => { for (let i = 0; i < secs * 30; i++) { game.sim(dt); wrap(); } };
      v.input.throttle = 1;
      let time = 0, t60 = null, t100 = null, vmax = 0;
      let travelled = 0; for (let i = 0; i < 30 * 45; i++) {
        game.sim(dt); time += dt; const s = v.speed * 3.6; vmax = Math.max(vmax, s);
        if (t60 === null && s >= 60) t60 = time; if (t100 === null && s >= 100) t100 = time;
        wrap();
      }
      r.t60 = t60 && +t60.toFixed(2); r.t100 = t100 && +t100.toFixed(2); r.vmaxKmh = Math.round(vmax); 
      v.input.throttle = -1; let bt = 0, bdist = 0; const s0 = v.speed;
      for (let i = 0; i < 30 * 15 && v.speed > 0.5; i++) { game.sim(dt); wrap(); bt += dt; bdist += v.speed * dt; }
      r.brakeFromKmh = Math.round(s0 * 3.6); r.brakeDist = Math.round(bdist); r.brakeT = +bt.toFixed(2);
      v.input.throttle = 0; v.input.handbrake = true; S(2); v.input.handbrake = false;
      // reverse test
      v.input.throttle = -1; S(4); r.revKmh = Math.round(v.speed * 3.6); v.input.throttle = 0; v.input.handbrake = true; S(2); v.input.handbrake = false;
      // turning at cruise
      v.vx = 0; v.vz = 0; v.input.throttle = 0.6; S(6); r.cruiseKmh = Math.round(v.speed * 3.6);
      v.input.steer = 1; const y0 = v.yaw; let tt = 0, maxLat = 0, maxRoll = 0;
      for (let i = 0; i < 30 * 2; i++) { game.sim(dt); tt += dt; maxLat = Math.max(maxLat, Math.abs(v.latSpeed)); maxRoll = Math.max(maxRoll, Math.abs(v.roll)); }
      r.yawRateDeg = +(((v.yaw - y0) / tt) * 57.3).toFixed(0); r.maxLat = +maxLat.toFixed(1); r.maxRoll = +maxRoll.toFixed(2);
      r.hp = Math.round(v.health);
      out[type] = r;
    }
    return out;
  });
  console.log(JSON.stringify(res).replace(/\},/g, '},\n'));
};
