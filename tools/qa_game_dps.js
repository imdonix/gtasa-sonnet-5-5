// Enemy firepower vs a standing (and a strafing) player.  node tools/play.js tools/qa_game_dps.js
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const res = await ctx.eval(async () => {
    const pl = G.player; const cx = 420, cz = 740; const out = {};
    QA.tp(cx, cz, 0); for (let i = 0; i < 30; i++) G.world.update(0.05, cx, cz, 30); G.population.pedTarget = 0; G.police.noWanted = true; G.population.gangTarget = 0;
    pl.invincible = false; pl.health = 1e9; pl.maxHealth = 1e9;
    const cases = [['gang', 'pistol', 10], ['gang', 'pistol', 20], ['gang', 'pistol', 35], ['gang', 'smg', 15], ['gang', 'shotgun', 10], ['gang', 'ak47', 25], ['cop', 'pistol', 15], ['swat', 'ak47', 20], ['cop', 'smg', 15]];
    for (const [role, wid, dist] of cases) {
      QA.clear(); pl.x = cx; pl.z = cz; pl.y = G.world.groundY(cx, cz); pl.health = 1e9; pl.armor = 0; let taken = 0; const h0 = 1e9;
      const e = await QA.ped({ x: cx + dist, z: cz, role, gang: role === 'gang' ? 2 : 0 }); e.give(wid, 9999, true); e.invincible = true;
      if (role === 'gang') { e.hostile = true; e.aggroT = 1e9; e.setMode('attack', 1e9); e.target = pl; } else { G.police.stars = 3; G.police.armedT = 99; }
      pl.health = h0; let shots = 0; const sh = e.shootAt.bind(e); e.shootAt = (...a) => { const r = sh(...a); if (r) shots++; return r; };
      const T = 12;
      for (let i = 0; i < 30 * T; i++) { pl.x = cx; pl.z = cz; game.sim(1 / 30); if (G.police.stars) G.police.stars = 3; }
      taken = h0 - pl.health; G.police.stars = 0;
      out[`${role}:${wid}@${dist}`] = { dps: +(taken / T).toFixed(1), shots: +(shots / T).toFixed(1) + '/s', dist: Math.round(Math.hypot(e.x - pl.x, e.z - pl.z)), mode: e.mode };
    }
    return out;
  });
  for (const k in res) console.log(k, JSON.stringify(res[k]));
};
