// Drive the steepest road edges at speed: airborne launches, landing damage, wheel contact.
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const res = await ctx.eval(async () => {
    const W = G.world; const out = [];
    const es = G.map.edges.filter(e => e.len > 60).map(e => { const a = e.pts[0], b = e.pts.at(-1); let mx = 0, mn = 1e9, mxv = -1e9; for (let s = 0; s <= e.len; s += 5) { const p = {}; const { edgePointAt } = { edgePointAt: null }; } return e; });
    const slope = (e) => { let worst = 0; for (let i = 0; i < e.pts.length - 1; i++) { const a = e.pts[i], b = e.pts[i + 1]; const d = Math.hypot(b.x - a.x, b.z - a.z) || 1; worst = Math.max(worst, Math.abs(W.groundY(b.x, b.z) - W.groundY(a.x, a.z)) / d); } return worst; };
    const ranked = es.map(e => ({ e, s: slope(e) })).sort((a, b) => b.s - a.s).slice(0, 4);
    for (const { e, s } of ranked) {
      for (const dir of [1, -1]) for (const type of ['sedan', 'sports']) {
        QA.clear(); const pts = dir > 0 ? e.pts : e.pts.slice().reverse(); const a = pts[0], b = pts[1]; const yaw = Math.atan2(b.x - a.x, b.z - a.z);
        QA.tp(a.x, a.z, yaw); for (let i = 0; i < 10; i++) W.update(0.05, a.x, a.z, 30);
        const v = await QA.car(type, a.x, a.z, yaw); G.player.x = a.x; G.player.z = a.z;
        const { DriverAI } = await import('/src/driverai.js'); const ai = new DriverAI(v, 'goto', { cruise: 40, stopDist: 5 }); ai.ignoreVehiclesT = 1e9; v.ghost = 1e9; const end = pts.at(-1); ai.dest = { x: end.x, z: end.z };
        v.vx = Math.sin(yaw) * 20; v.vz = Math.cos(yaw) * 20;
        let air = 0, wasAir = false, dmg = 0, maxSp = 0, maxPitch = 0, maxAirT = 0, airT = 0, minClear = 9; const od = v.damage.bind(v); v.damage = (am, i) => { dmg += am; od(am, i); };
        for (let i = 0; i < 30 * 25; i++) { game.sim(1 / 30); if (v.airborne && !wasAir) air++; wasAir = v.airborne; if (v.airborne) { airT += 1 / 30; maxAirT = Math.max(maxAirT, airT); } else airT = 0; maxSp = Math.max(maxSp, v.speed); maxPitch = Math.max(maxPitch, Math.abs(v.pitch)); minClear = Math.min(minClear, v.y - v.def.wheelRadius - W.groundY(v.x, v.z)); if (ai.arrived || Math.hypot(v.x - end.x, v.z - end.z) < 8) break; }
        out.push({ edge: e.id, slope: +s.toFixed(3), dir, type, air, maxAirT: +maxAirT.toFixed(2), dmg: Math.round(dmg), maxSpKmh: Math.round(maxSp * 3.6), maxPitchDeg: Math.round(maxPitch * 57.3), minClear: +minClear.toFixed(2) });
      }
    }
    return out;
  });
  for (const r of res) console.log(JSON.stringify(r));
};
