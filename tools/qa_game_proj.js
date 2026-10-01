// Projectiles & melee: grenade landing accuracy, molotov, RPG, melee hit rate.
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const res = await ctx.eval(async () => {
    const pl = G.player; const out = { grenade: {}, melee: {} }; const cx = 420, cz = 740;
    QA.tp(cx, cz, Math.PI / 2); for (let i = 0; i < 30; i++) G.world.update(0.05, cx, cz, 30); G.population.pedTarget = 0; G.police.noWanted = true;
    const aimAt = (tx, ty, tz) => { for (let k = 0; k < 40; k++) { const c = G.camera; const dx = tx - c.pos.x, dy = ty - c.pos.y, dz = tz - c.pos.z; const l = Math.hypot(dx, dy, dz); c.yaw = Math.atan2(dx, dz); c.pitch = -Math.asin(dy / l); c.update(1 / 30, 1 / 30, pl, { consumeMouse: () => [0, 0], gpAx: null }); } };
    pl.give('grenade', 50, true); pl.give('molotov', 50, true);
    for (const wid of ['grenade', 'molotov']) for (const D of [8, 15, 25, 35]) {
      pl.equip(wid); pl.x = cx; pl.z = cz; pl.y = G.world.groundY(cx, cz); G.combat.projectiles.length = 0; pl.cool = 0; pl.wslot.clip = 1;
      const tx = cx + D, tz = cz; const ty = G.world.groundY(tx, tz);
      pl.yaw = Math.PI / 2; G.camera.yaw = Math.PI / 2; G.input.buttons.add(2); game.sim(1 / 30); aimAt(tx, ty, tz); G.input.btnPressed.add(0); game.sim(1 / 30); G.input.btnPressed.clear(); G.input.buttons.clear();
      const p = G.combat.projectiles[0]; if (!p) { out.grenade[wid + D] = 'no projectile'; continue; }
      let t = 0, landed = null; for (let i = 0; i < 30 * 6 && !landed; i++) { const y0 = p.y; game.sim(1 / 30); t += 1 / 30; if (p.dead || G.combat.projectiles.indexOf(p) < 0) landed = [p.x, p.z]; else if (i > 3 && p.y <= G.world.groundY(p.x, p.z) + 0.11) { landed = [p.x, p.z]; break; } }
      out.grenade[wid + '@' + D] = landed ? { landedX: +(landed[0] - cx).toFixed(1), z: +(landed[1] - cz).toFixed(1), t: +t.toFixed(2) } : 'still flying';
      for (let i = 0; i < 30 * 5; i++) game.sim(1 / 30); G.combat.fires.length = 0;
    }
    // melee
    for (const wid of ['fist', 'bat']) {
      pl.give('bat', 0, false); pl.equip(wid); QA.clear(); pl.x = cx; pl.z = cz; pl.yaw = Math.PI / 2; pl.faceOverride = null;
      const t = await QA.ped({ x: cx + 1.3, z: cz, role: 'civ' }); t.brave = false; t.health = 1e9; let hits = 0, kd = 0; const od = t.damage.bind(t); t.damage = (a, i) => { hits++; od(a, i); };
      t.setMode('idle', 1e9);
      const t0 = G.time; G.input.buttons.add(0);
      for (let i = 0; i < 30 * 4; i++) { t.x = Math.max(t.x, cx + 1.3); game.sim(1 / 30); if (t.downT > 0) kd++; t.mode = 'idle'; t.modeT = 1e9; G.input.btnPressed.add(0); }
      G.input.buttons.clear(); G.input.btnPressed.clear();
      out.melee[wid] = { hits4s: hits, knockedFrames: kd, hp: Math.round(1e9 - t.health) };
    }
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
};
