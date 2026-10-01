// Pedestrian walking QA: surfaces walked on, stuck detection, jitter, in-building checks.
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const spots = (process.env.SPOTS || 'home,downtown,beach').split(',');
  for (const spot of spots) {
    const r = await ctx.eval(async (spot) => {
      let c;
      if (spot === 'home') { const h = G.landmarks.home; c = { x: h.door.x, z: h.door.z }; }
      else if (spot === 'downtown') { const l = G.landmarks.city_hall || G.landmarks.bank || Object.values(G.landmarks).find(l => l && l.door); c = { x: l.door.x, z: l.door.z }; }
      else { c = { x: -700, z: 300 }; let best = 1e9; for (const l of Object.values(G.landmarks)) if (l && l.door && l.door.x < -600) { c = { x: l.door.x, z: l.door.z }; break; } }
      QA.clear(); G.population.carTarget = 0; G.population.gangTarget = 0; G.population.pedTarget = 40; G.population.density = 1;
      G.police.noWanted = true;
      QA.tp(c.x, c.z, 0); G.world.update(0, c.x, c.z, 30);
      QA.sim(1);
      // spawn 40 peds
      for (let i = 0; i < 60; i++) G.population.spawnCiv(c.x, c.z, G.player);
      const peds = G.peds.list.filter(p => p.role === 'civ' && !p.isPlayer);
      const st = new Map(); for (const p of peds) st.set(p, { surf: {}, stuck: 0, lx: p.x, lz: p.z, lt: 0, turns: 0, lyaw: p.yaw, inb: 0, n: 0, dist: 0, jitter: 0, lastMove: 0 });
      const dt = 1 / 30; let flee = 0;
      for (let i = 0; i < 30 * 120; i++) {
        game.sim(dt);
        G.player.x = c.x; G.player.z = c.z;
        if (i % 6 === 0) for (const [p, s] of st) {
          if (p.dead || p.removeMe || !G.peds.list.includes(p)) continue;
          const sf = G.world.surfaceAt(p.x, p.z); s.surf[sf] = (s.surf[sf] || 0) + 1; s.n++;
          const pos = { x: p.x, z: p.z }; // inside collider?
          const moved = Math.hypot(p.x - s.lx, p.z - s.lz); s.dist += moved; s.lx = p.x; s.lz = p.z;
          if (p.mode === 'walk' && moved < 0.02 && p.speedTarget > 0.5) s.stuck++;
          if (p.y < -0.3 && !p.swimming) s.inb++;
        }
      }
      const tot = { road: 0, sidewalk: 0, grass: 0, sand: 0, concrete: 0, water: 0, n: 0 }; let stuckPeds = 0, avgDist = 0, alive = 0, stuckFrames = 0;
      for (const [p, s] of st) { if (!s.n) continue; alive++; for (const k in s.surf) tot[k] = (tot[k] || 0) + s.surf[k]; tot.n += s.n; if (s.stuck > s.n * 0.15) stuckPeds++; stuckFrames += s.stuck; avgDist += s.dist; }
      for (const k in tot) if (k !== 'n') tot[k] = +(tot[k] / tot.n * 100).toFixed(1);
      return { spot, alive, surfPct: tot, stuckPeds, stuckPct: +(stuckFrames / tot.n * 100).toFixed(1), avgDistPerPed: Math.round(avgDist / alive), modes: G.peds.list.reduce((a, p) => { a[p.mode] = (a[p.mode] || 0) + 1; return a; }, {}) };
    }, spot);
    console.log(JSON.stringify(r));
  }
};
