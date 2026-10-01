// Chunk streaming hitch test: node tools/play.js tools/qa_world_stream.js
const Q = require('./qa_world_lib.js');
module.exports = async (ctx) => {
  await Q.init(ctx, { pop: false });
  const r = await ctx.eval(() => {
    const W = G.world; const out = {};
    const run = (fx, fz, budget) => {
      game.teleport(fx, fz, 0);
      const times = []; let n = 0; const t00 = performance.now();
      while ((W.pendingJobs() || n < 3) && n < 3000) { const t0 = performance.now(); W.update(0.016, fx, fz, budget); times.push(performance.now() - t0); n++; }
      times.sort((a, b) => a - b);
      return { frames: n, total: Math.round(performance.now() - t00), max: +times[times.length - 1].toFixed(1), p95: +times[Math.floor(times.length * 0.95)].toFixed(1), med: +times[Math.floor(times.length / 2)].toFixed(1) };
    };
    out.downtown = run(0, -60, 3.5);
    out.walk = []; for (let i = 1; i <= 6; i++) out.walk.push(run(0 + i * 40, -60, 3.5));
    out.vhills = run(268, -760, 3.5);
    out.docks = run(860, 800, 3.5);
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
};
