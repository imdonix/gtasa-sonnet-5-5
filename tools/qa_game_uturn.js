// Dead-end U-turn behaviour for traffic cars.
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const res = await ctx.eval(async () => {
    const { DriverAI } = await import('/src/driverai.js'); const out = [];
    const dead = G.map.nodes.filter(n => n.deg === 1); out.push({ deadEnds: dead.length, nodes: G.map.nodes.length });
    let k = 0;
    for (const n of dead) {
      if (k++ >= 6) break;
      const e = G.map.edges[n.edges[0]]; const dir = e.b === n.id ? 1 : -1; // travel direction towards the dead end
      const s0 = Math.max(2, e.len - 45); const agent = { edge: e, dir, s: dir > 0 ? s0 : e.len - s0, lane: 0, route: null };
      const p = {}; G.nav.lanePoint(agent, agent.s, p);
      QA.clear(); QA.tp(p.x + 20, p.z + 20, 0); for (let i = 0; i < 20; i++) G.world.update(0.05, p.x, p.z, 30);
      G.population.carTarget = 0; G.population.pedTarget = 0; G.population.gangTarget = 0;
      const v = await QA.car('sedan', p.x, p.z, Math.atan2(p.tx, p.tz), { owner: 'traffic' }); const ai = new DriverAI(v, 'traffic', {}); ai.agent = agent; v.vx = p.tx * 8; v.vz = p.tz * 8;
      let done = false, t = 0, crashes = 0, kturn = false, maxAng = 0; const oc = v.crash.bind(v); v.crash = (...a) => { crashes++; oc(...a); };
      const y0 = v.yaw; let flips = 0;
      for (let i = 0; i < 30 * 40; i++) { game.sim(1 / 30); G.player.x = p.x + 20; G.player.z = p.z + 20; G.camera.yaw = Math.atan2(-20, -20); G.camera.update(1 / 30, 1 / 30, G.player, G.input); t += 1 / 30; if (ai.ut) kturn = true; if (kturn && !ai.ut && agent.dir === -dir && Math.hypot(v.x - p.x, v.z - p.z) < 500) { const back = Math.abs(((v.yaw - y0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI); if (back < 0.8 && t > 6) { done = true; break; } } }
      out.push({ node: n.id, kturn, done, t: +t.toFixed(1), crashes, hp: Math.round(v.health), speed: Math.round(v.speed), dist: Math.round(Math.hypot(v.x - p.x, v.z - p.z)) });
    }
    return out;
  });
  for (const r of res) console.log(JSON.stringify(r));
};
