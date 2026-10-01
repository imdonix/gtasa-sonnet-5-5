// Combat QA: (1) player crosshair accuracy, (2) enemy DPS against a standing player, (3) weapon sanity.
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const res = await ctx.eval(async () => {
    const out = { acc: {}, dps: {} }; const pl = G.player; const cx = 420, cz = 740;
    const { WEAPONS } = await import('/src/weapons.js'); const THREE = await import('three');
    QA.tp(cx, cz, 0); for (let i = 0; i < 30; i++) G.world.update(0.05, cx, cz, 30); G.population.pedTarget = 0; G.police.noWanted = true;
    // ---------------- 1. accuracy: free aim, crosshair on the target torso
    const aimAt = (tx, ty, tz) => {
      for (let k = 0; k < 40; k++) {
        const c = G.camera; const dx = tx - c.pos.x, dy = ty - c.pos.y, dz = tz - c.pos.z; const l = Math.hypot(dx, dy, dz);
        c.yaw = Math.atan2(dx, dz); c.pitch = -Math.asin(dy / l); c.update(1 / 30, 1 / 30, pl, { consumeMouse: () => [0, 0], gpAx: null });
      }
    };
    for (const wid of ['pistol', 'smg', 'ak47', 'shotgun', 'deagle', 'sniper']) {
      pl.give(wid, 9999, true); pl.invincible = true; out.acc[wid] = {};
      for (const dist of [8, 25, 50]) {
        let hits = 0, heads = 0, shots = 0; const W = WEAPONS[wid];
        for (let trial = 0; trial < (W.auto ? 3 : 2); trial++) {
          QA.clear(); pl.x = cx; pl.z = cz; pl.vx = pl.vz = 0; pl.y = G.world.groundY(cx, cz); pl.weapons[wid].clip = W.clip; pl.reloadT = 0;
          const t = await QA.ped({ x: cx + dist, z: cz, role: 'civ' }); t.invincible = true; t.health = 1e9; t.mode = 'idle'; t.modeT = 1e9; t.speedTarget = 0; let dmg0 = 0;
          let hitCount = 0; const od = t.damage.bind(t); t.damage = (a, i) => { hitCount++; if (i && i.headshot) heads++; };
          pl.faceOverride = Math.PI / 2; pl.yaw = Math.PI / 2; G.camera.yaw = Math.PI / 2;
          const n = W.auto ? 30 : 8;
          for (let s = 0; s < n; s++) {
            G.input.buttons.add(2); G.input.buttons.add(0); G.input.btnPressed.add(0);
            t.x = cx + dist; t.z = cz; t.y = G.world.groundY(t.x, t.z); t.vx = t.vz = 0;
            game.sim(1 / 30); aimAt(t.x, t.y + 1.25, t.z);
            G.input.btnPressed.clear(); if (!W.auto) { G.input.buttons.delete(0); game.sim(1 / 30); } pl.cool = Math.max(0, pl.cool - 0.0);
            if (pl.wslot.clip <= 0) pl.wslot.clip = W.clip; pl.cool = 0; shots++;
          }
          hits += hitCount; G.input.buttons.clear();
        }
        out.acc[wid][dist] = `${hits}/${shots * (WEAPONS[wid].pellets || 1)} hit, ${heads} head`;
      }
    }
    return out;
  });
  console.log(JSON.stringify(res.acc, null, 1));
};
