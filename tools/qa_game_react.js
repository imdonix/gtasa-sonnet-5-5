// Civilian / gang / traffic reactions to gunfire, explosions, hits.
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const res = await ctx.eval(async () => {
    const pl = G.player; const out = {}; const home = G.landmarks.home; const nr = G.map.nearestRoad(home.door.x + 30, home.door.z + 10, 100);
    G.police.noWanted = true; G.population.carTarget = 0; G.population.pedTarget = 0; G.population.gangTarget = 0;
    QA.tp(nr.x + 8, nr.z + 8, 0); for (let i = 0; i < 20; i++) G.world.update(0.05, nr.x, nr.z, 30);
    const setup = async () => { QA.clear(); const civs = []; for (let i = 0; i < 10; i++) { const p = await QA.ped({ x: nr.x + 8 + (i - 5) * 2, z: nr.z + 14 + (i % 3) * 3, role: 'civ' }); p.mode = 'idle'; p.modeT = 1e9; civs.push(p); } return civs; };
    let civs = await setup(); pl.give('pistol', 100, true); G.combat.fire(pl, 'pistol', pl.x, pl.y + 1.4, pl.z, 0, 0, 1, {}); QA.sim(1.0);
    out.shot = { fleeing: civs.filter(p => p.mode === 'flee' || p.mode === 'cower').length, of: civs.length };
    QA.sim(10); out.shotAfter10s = civs.map(p => p.mode).reduce((a, m) => (a[m] = (a[m] || 0) + 1, a), {});
    civs = await setup(); G.combat.explode(nr.x + 8, 1, nr.z + 25, 5, 200, { source: pl }); QA.sim(0.6);
    out.explosion = { fleeing: civs.filter(p => p.mode === 'flee').length, knocked: civs.filter(p => p.downT > 0 || p.dead).length, dead: civs.filter(p => p.dead).length, stars: G.police.stars };
    // traffic reacts to being shot
    QA.clear(); const c = await QA.car('sedan', nr.x, nr.z + 20, 0, { owner: 'traffic' }); const { DriverAI } = await import('/src/driverai.js'); const ai = new DriverAI(c, 'traffic', {}); c.driver.role = 'civ';
    QA.sim(1); G.combat.fire(pl, 'pistol', pl.x, pl.y + 1.4, pl.z, 0, 0, 1, {}); c.onHit(24, { source: pl, bullet: true }); QA.sim(0.5);
    out.carShot = { mode: ai.mode };
    // gang hostility: armed player in rival territory
    QA.clear(); G.police.noWanted = true;
    let gpos = null; for (let x = -900; x < 900 && !gpos; x += 25) for (let z = -900; z < 900; z += 25) { if (G.map.gangAt(x, z) === 2 && G.world.groundY(x, z) > 1 && G.map.roadDistAt(x, z) > 4) { gpos = [x, z]; break; } }
    out.gangSpot = gpos;
    if (gpos) { QA.tp(gpos[0], gpos[1], 0); for (let i = 0; i < 20; i++) G.world.update(0.05, gpos[0], gpos[1], 30);
      const gs = []; for (let i = 0; i < 3; i++) { const p = await QA.ped({ x: gpos[0] + 20 + i * 2, z: gpos[1], role: 'gang', gang: 2 }); p.give('pistol', 200, true); p.mode = 'loiter'; p.modeT = 50; gs.push(p); }
      pl.give('pistol', 100, true); pl.equip('pistol'); QA.sim(3); out.gangs = gs.map(p => p.mode); }
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
};
