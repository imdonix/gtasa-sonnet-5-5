// Monkey test: random inputs (move, sprint, jump, fire, aim, weapons, enter/exit cars, handbrake...) for MIN sim-minutes; counts exceptions.
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  const MIN = +(process.env.MIN || 5);
  await boot(ctx, { invincible: process.env.INV === '1' });
  await ctx.eval(() => {
    G.police.noWanted = false; const pl = G.player; pl.give('weaponset'.length ? 'pistol' : 'pistol', 400, false);
    for (const w of ['bat', 'pistol', 'deagle', 'shotgun', 'smg', 'ak47', 'sniper', 'rpg', 'grenade', 'molotov']) pl.give(w, 300, false);
    window.__errs = []; window.__ex = 0; const oe = console.error; console.error = (...a) => { window.__errs.push(a.map(String).join(' ').slice(0, 160)); };
    const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'KeyC'];
    window.__monkey = (secs) => {
      const dt = 1 / 30; const n = Math.round(secs / dt); let acts = 0;
      for (let i = 0; i < n; i++) {
        if (i % 12 === 0) { // new action burst every 0.4 s
          G.input.down.clear(); G.input.buttons.clear();
          for (const k of keys) if (Math.random() < (k === 'KeyW' ? 0.6 : 0.25)) G.input.down.add(k);
          if (Math.random() < 0.3) G.input.buttons.add(0); if (Math.random() < 0.25) G.input.buttons.add(2);
          if (Math.random() < 0.15) G.input.pressed.add('KeyF'); if (Math.random() < 0.15) G.input.pressed.add('KeyR');
          if (Math.random() < 0.2) G.input.pressed.add('Digit' + (1 + ((Math.random() * 9) | 0)));
          if (Math.random() < 0.1) G.input.pressed.add(['KeyE', 'KeyQ'][(Math.random() * 2) | 0]);
          if (Math.random() < 0.2) G.input.mouseDX += (Math.random() - 0.5) * 400; if (Math.random() < 0.1) G.input.mouseDY += (Math.random() - 0.5) * 200;
          if (Math.random() < 0.1) G.input.wheel = Math.random() < 0.5 ? 1 : -1;
          acts++;
        }
        if (G.input.btnPressed.size === 0 && G.input.buttons.has(0)) G.input.btnPressed.add(0);
        try { game.sim(dt); G.camera.update(dt, dt, G.player, G.input); } catch (e) { window.__ex++; if (window.__errs.length < 30) window.__errs.push('EXC ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join('|')); }
        G.input.pressed.clear(); G.input.btnPressed.clear(); G.input.wheel = 0;
        const pl = G.player;
        if (game.state === 'dead' || game.state === 'busted') { game.deadT = 99; try { game.respawn(game.state); } catch (e) { window.__ex++; window.__errs.push('EXC respawn ' + e.message); } }
        if (pl.dead && game.state === 'play') { pl.dead = false; pl.health = pl.maxHealth; }
        if (i % 600 === 0 && !pl.vehicle && Math.random() < 0.5) { const c = G.vehicles.list.find(v => !v.exploded && Math.hypot(v.x - pl.x, v.z - pl.z) < 60); if (c) { const dw = c.doorWorldPos(0); game.teleport(dw.x, dw.z, 0); } }
        if (i % 900 === 0) { const nr = G.map.nearestRoad((Math.random() - 0.5) * 1800, (Math.random() - 0.5) * 1800, 300); if (nr && !pl.vehicle) game.teleport(nr.x + 4, nr.z, Math.random() * 6.28); }
        if (i % 30 === 0) G.world.update(0.03, pl.x, pl.z, 6);
      }
      return acts;
    };
  });
  for (let m = 0; m < MIN; m++) {
    const r = await ctx.eval(() => { window.__monkey(60); const pl = G.player; return { t: Math.round(G.time), ...QA.counts(), nan: QA.nan(), ex: window.__ex, errs: window.__errs.slice(-4), stars: G.police.stars, pos: [Math.round(pl.x), Math.round(pl.z)], veh: pl.vehicle && pl.vehicle.type, deaths: pl.stats.deaths, hp: Math.round(pl.health) }; });
    console.log(JSON.stringify(r));
  }
};
