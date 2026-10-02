// Edge cases: water (swim / sinking car), falling damage, map bounds, stuck-in-geometry.
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true, invincible: false });
  const res = await ctx.eval(async () => {
    const pl = G.player, W = G.world; const out = {};
    // find water near the map edge: scan for deep water
    let wx = null; for (let x = -1000; x < 1000 && !wx; x += 20) for (let z = 900; z < 1000; z += 20) if (W.groundY(x, z) < -3) { wx = [x, z]; break; }
    if (!wx) for (let x = -1000; x < 1000 && !wx; x += 20) for (let z = -1000; z < -900; z += 20) if (W.groundY(x, z) < -3) { wx = [x, z]; break; }
    out.water = wx;
    if (wx) {
      // swimming
      QA.tp(wx[0], wx[1], 0); for (let i = 0; i < 10; i++) W.update(0.05, wx[0], wx[1], 20); pl.y = 3; pl.health = pl.maxHealth;
      QA.sim(2); out.swim = { swimming: pl.swimming, y: +pl.y.toFixed(2), health: Math.round(pl.health), dead: pl.dead };
      G.input.down.add('KeyW'); QA.sim(3); G.input.down.clear(); out.swimMoved = { speed: +Math.hypot(pl.vx, pl.vz).toFixed(2) };
      // long swim: drowning? (SA drowns after a while) 
      QA.sim(60); out.swim60s = { health: Math.round(pl.health), dead: pl.dead, stamina: Math.round(pl.stamina) };
      pl.health = pl.maxHealth; pl.dead = false;
      // vehicle in water
      QA.tp(wx[0], wx[1] - 30, 0); const v = G.vehicles.spawn('sedan', wx[0], wx[1], 0, { owner: 'player' }); pl.enterVehicle(v, 0, true);
      QA.sim(2); const y2 = v.y; QA.sim(4); out.carWater = { y2: +y2.toFixed(2), y6: +v.y.toFixed(2), hp: Math.round(v.health), exploded: v.exploded, playerVeh: !!pl.vehicle, plDead: pl.dead };
      QA.sim(6); out.carWater12 = { exploded: v.exploded, hp: Math.round(v.health), plDead: pl.dead, inVeh: !!pl.vehicle };
      pl.dead = false; pl.health = pl.maxHealth;
    }
    // falling damage: drop from height
    const h = G.landmarks.home; QA.tp(h.door.x, h.door.z, 0); pl.health = pl.maxHealth; pl.dead = false;
    for (const H of [4, 8, 14, 25]) { pl.health = pl.maxHealth; pl.dead = false; pl.y = W.groundY(pl.x, pl.z) + H; pl.vy = 0; pl.grounded = false; QA.sim(3); out['fall' + H] = Math.round(pl.health); }
    // vehicle map bounds
    QA.clear(); pl.health = pl.maxHealth; pl.dead = false; QA.tp(-900, 0, 0);
    const v2 = G.vehicles.spawn('sports', -1000, 0, -Math.PI / 2, { owner: 'player' }); pl.enterVehicle(v2, 0, true); v2.vx = -40; v2.airborne = false; QA.sim(3);
    out.bounds = { x: Math.round(v2.x), vx: +v2.vx.toFixed(1), hp: Math.round(v2.health) };
    pl.exitVehicle(true); pl.health = pl.maxHealth; pl.dead = false;
    // on foot leaving bounds
    QA.tp(1000, 0, Math.PI / 2); G.input.down.add('KeyW'); G.camera.yaw = Math.PI / 2; QA.sim(4); G.input.down.clear(); out.footBounds = { x: Math.round(pl.x) };
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
};
