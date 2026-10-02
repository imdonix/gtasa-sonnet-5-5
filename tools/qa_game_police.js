// Police escalation: player driving a car (AI-less), cops chasing. STARS=1..6  SECS=90  MODE=drive|still|foot
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { invincible: false });
  const stars = (process.env.STARS || '1,2,3,4,5,6').split(',').map(Number); const SECS = +(process.env.SECS || 90); const MODE = process.env.MODE || 'drive';
  for (const st of stars) {
    const r = await ctx.eval(async (st, SECS, MODE, SPD) => {
      const pl = G.player; QA.clear(); G.population.carTarget = 12; G.population.pedTarget = 20; G.population.gangTarget = 0; G.police.clear(); pl.health = pl.maxHealth; pl.dead = false; game.state = 'play'; pl.invincible = false;
      const home = G.landmarks.home; const nr = G.map.nearestRoad(home.door.x + 10, home.door.z + 10, 100);
      QA.tp(nr.x, nr.z, Math.atan2(nr.tx, nr.tz)); for (let i = 0; i < 20; i++) G.world.update(0.05, nr.x, nr.z, 30);
      const v = G.vehicles.spawn('sedan', nr.x, nr.z, Math.atan2(nr.tx, nr.tz), { owner: 'player' }); pl.enterVehicle(v, 0, true);
      const { DriverAI } = await import('/src/driverai.js');
      // "player" is driven by a script: steer along roads toward random nodes, using DriverAI logic on the vehicle while the player sits inside
      const ai = new DriverAI(v, 'goto', { cruise: 26, stopDist: 15 }); ai.ignoreLights = true; if (MODE === 'ghost') { ai.ignoreVehiclesT = 1e9; v.ghost = 1e9; ai.cruise = SPD; }
      const origUpdate = ai.update.bind(ai); // DriverAI.update returns early for the player: temporarily flip isPlayer during update
      v.hpLock = MODE === 'ghost'; ai.update = (dt) => { if (MODE === 'still') { v.input.throttle = 0; v.input.handbrake = true; return; } const f = pl.isPlayer; pl.isPlayer = false; origUpdate(dt); pl.isPlayer = f; };
      const pick = () => { const n = G.map.nodes.filter(n => n.deg >= 3); const d = n[(Math.random() * n.length) | 0]; ai.setMode('goto', { dest: { x: d.x, z: d.z } }); };
      pick();
      // make the Player.updateDriving not overwrite inputs
      pl.controlEnabled = false;
      G.police.raise(st, 'test', st);
      const prof = {}; for (const [k, o] of [['peds', G.peds], ['veh', G.vehicles], ['combat', G.combat], ['police', G.police], ['pop', G.population], ['pick', G.pickups], ['miss', G.missions]]) { const f = o.update.bind(o); prof[k] = { sum: 0, max: 0, n: 0 }; o.update = (dt) => { const a = performance.now(); f(dt); const d = performance.now() - a; const P = prof[k]; P.sum += d; P.n++; if (d > P.max) P.max = d; }; }
      const log = []; let busted = false, dead = false; let maxCars = 0, since = 0, stuckCops = 0; const t0 = performance.now(); let maxMs = 0;
      G.events.on && G.events.on('playerBusted', () => busted = true);
      for (let i = 0; i < 30 * SECS; i++) {
        const a = performance.now(); game.sim(1 / 30); maxMs = Math.max(maxMs, performance.now() - a);
        since += 1 / 30; if (ai.arrived || since > 30) { pick(); since = 0; }
        if (pl.dead) { dead = true; break; }
        if (game.state === 'busted') { busted = true; break; }
        if (i % 300 === 0) { const cops = G.vehicles.list.filter(q => q.owner === 'police' && !q.wrecked); const foot = G.peds.list.filter(p => (p.role === 'cop' || p.role === 'swat') && !p.vehicle && !p.dead);
          log.push({ t: Math.round(i / 30), stars: G.police.stars, cars: cops.length, footCops: foot.length, nearest: cops.length ? Math.round(Math.min(...cops.map(c => Math.hypot(c.x - v.x, c.z - v.z)))) : null, heli: !!G.police.heli, hp: Math.round(pl.health), vhp: Math.round(v.health), spd: Math.round(v.speed), seen: G.police.seenNow, hide: Math.round(G.police.hideT), rb: G.police.roadblocks.length }); }
        if (v.hpLock) { v.health = v.maxHealth; pl.health = pl.maxHealth; } if (v.wrecked) break;
      }
      const cops = G.vehicles.list.filter(q => q.owner === 'police' && !q.wrecked);
      const stuck = cops.filter(c => c.ai && (c.ai.stuckCount || 0) > 2).length;
      const pr = {}; for (const k in prof) pr[k] = +(prof[k].sum / prof[k].n).toFixed(2) + '/' + prof[k].max.toFixed(0); return { prof: pr, st, busted, dead, vWrecked: v.wrecked, maxMs: +maxMs.toFixed(0), copCars: cops.length, stuckCops: stuck, stars: G.police.stars, log };
    }, st, SECS, MODE, +(process.env.SPEED || 26));
    console.log('STARS', st, JSON.stringify({ ...r, log: undefined }));
    for (const l of r.log) console.log('   ', JSON.stringify(l));
  }
};
