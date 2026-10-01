// Automated story playthrough bot: drives the mission scripts with cheats (teleports, kills) to find script errors.
// node tools/bot.js [--from m01] [--to m14] [--only m05]
const puppeteer = require('puppeteer-core');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const OUT = '/tmp/claude-1001/-home-tamasmagyar-Work-testgame/2244238a-7010-4c23-9327-bbc7bc4690bf/scratchpad/';
(async () => {
  const browser = await puppeteer.launch({ protocolTimeout: 1800000, executablePath: '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(); await page.setViewport({ width: 960, height: 540 });
  page.on('console', m => { const t = m.type(), x = m.text(); if (t === 'error' || t === 'warning' || x.startsWith('[B]')) console.log('[' + t + ']', x.slice(0, 500)); });
  page.on('pageerror', e => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')));
  await page.goto('http://localhost:8080/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.game && window.game.running, { timeout: 180000 });
  const MAXL_ARG = +opt('maxloops', 4000); const from = opt('from', 'm01'), to = opt('to', 'm14'), only = opt('only', null);
  await page.evaluate(() => { window.__start = performance.now(); });
  const result = await page.evaluate(async (from, to, only, MAXL, NOLIFE) => {
    const log = (...a) => console.log('[B]', ...a);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    game.startGame(false);
    if (NOLIFE) { G.ambient.enabled = false; G.worldEvents.enabled = false; log('life systems disabled'); }
    await sleep(800);
    G.player.invincible = true;
    const M = G.missions; const pl = G.player;
    // prepare: mark prerequisites as done
    const ids = M.defs.map(d => d.id);
    const startIdx = ids.indexOf(only || from);
    for (let i = 0; i < startIdx; i++) { M.done.add(ids[i]); const d = M.defs[i]; if (d.afterDone) try { d.afterDone(M); } catch (e) { } }
    M.abortAll();
    const passed = []; const failed = [];
    let lastId = null;
    const endIdx = only ? startIdx : ids.indexOf(to);
    const t0 = performance.now();
    for (let idx = startIdx; idx <= endIdx; idx++) {
      const def = M.defs[idx]; if (!def) break;
      log('--- starting', def.id, def.title);
      G.police.clear(); pl.health = 100; pl.dead = false; game.state = 'play'; game.timeScale = 1; pl.controlEnabled = true;
      if (!def.autostart && def.where) { const w = def.where(); if (w) { game.teleport(w.x + 4, w.z + 4, 0); } }
      // start
      M.refreshStarts(); await sleep(50);
      const p = M.start(def);
      let n = 0, lastObj = '', stuck = 0, ended = false;
      p.then(() => { ended = true; });
      const tm = performance.now();
      while (!ended && performance.now() - tm < 240000) {
        for (let k = 0; k < 12; k++) game.sim(1 / 20);
        n++; if (!pl.dead) pl.health = Math.max(pl.health, 30);
        const r = M.active; if (!r) { await sleep(10); continue; }
        if (n % 4 === 0) {
          const obj = document.getElementById('objective').textContent; if (obj !== lastObj) { lastObj = obj; log(def.id, 'obj:', obj.slice(0, 90)); }
          if (!game.inCutscene) {
            // kill enemies
            for (const q of G.peds.list) if (!q.dead && !q.isPlayer && q.mission && (q.hostile || q.role === 'enemy' || q.name === 'Courier' || q.name === 'Duke Price') && q.role !== 'ally') { q.damage(1e5, { source: pl }); }
            for (const v of G.vehicles.list) if (v.name === 'Armored truck' && !v.wrecked && v.health > v.maxHealth * 0.4) v.health = v.maxHealth * 0.3;
            // destroy hostile vehicles
            for (const v of G.vehicles.list) if (v.mission && !v.wrecked && v !== pl.vehicle && v.blipObj && v.blipObj.color === '#ff3030') v.blowUp(pl);
            if (/^Get out|^Leave/i.test(r.objText) && pl.vehicle) pl.exitVehicle(false);
            if (/^Chase/i.test(r.objText)) { const lm = G.vehicles.list.find(v => v.ai && /limo/i.test(v.name)); if (lm && pl.vehicle && Math.hypot(pl.vehicle.x - lm.x, pl.vehicle.z - lm.z) < 30) { const hh = G.landmarks.home.door; pl.vehicle.x = hh.x; pl.vehicle.z = hh.z; pl.vehicle.vx = pl.vehicle.vz = 0; } }
            if (G.police.stars > 0 && !(r.def.id === 'm04' && G.police.stars === 2 && false)) G.police.clear();
            // tail bot
            const cel = document.getElementById('counter'); const ctr = cel.style.display === 'none' ? '' : cel.textContent;
            if (ctr.startsWith('Distance')) { const mc = G.vehicles.list.find(v => v.name === "Marcus's coupe"); if (mc && pl.vehicle) { const v = pl.vehicle; const back = 34; v.x = mc.x - Math.sin(mc.yaw) * back; v.z = mc.z - Math.cos(mc.yaw) * back; v.yaw = mc.yaw; v.vx = mc.vx; v.vz = mc.vz; } else if (mc && !pl.vehicle) { const v = G.vehicles.list.find(q => q.mission && q !== mc && !q.wrecked); if (v) pl.enterVehicle(v, 0, true); } }
            else {
              let targeted = false;
              // pickups
              for (const pk of r.pickups) { if (!pk.dead) { if (pl.vehicle) pl.exitVehicle(true); if (pk.kind === 'health') pl.health = Math.min(pl.health, 40); if (pk.kind === 'armor') pl.armor = 0; game.teleport(pk.x, pk.z, pl.yaw); targeted = true; break; } }
              if (!targeted) {
                const mk = r.markers.find(m => !m.dead);
                if (mk) {
                  if (mk.vehicleOnly || (mk.mode === 'vehicle')) {
                    if (!pl.vehicle) { const v = G.vehicles.list.find(q => (q.mission || q.owner === 'player') && !q.wrecked && !q.driver && q.type !== 'policeheli') || null; if (v) pl.enterVehicle(v, 0, true); else { const nv = G.vehicles.spawn('sedan', mk.x, mk.z, 0, { owner: 'player' }); pl.enterVehicle(nv, 0, true); } }
                    const v = pl.vehicle; if (v) { v.x = mk.x; v.z = mk.z; v.vx = v.vz = 0; v.vy = 0; v.airborne = false; v.y = G.world.groundY(v.x, v.z) + v.def.wheelRadius; v.groundY = v.y; }
                    if (mk.needVehicle && pl.vehicle !== mk.needVehicle && !mk.needVehicle.wrecked) { pl.exitVehicle(true); pl.enterVehicle(mk.needVehicle, 0, true); mk.needVehicle.x = mk.x; mk.needVehicle.z = mk.z; }
                  } else { if (pl.vehicle && mk.footOnly) pl.exitVehicle(true); if (pl.vehicle) { const vv = pl.vehicle; vv.x = mk.x; vv.z = mk.z; vv.vx = vv.vz = 0; vv.vy = 0; vv.airborne = false; vv.y = G.world.groundY(vv.x, vv.z) + vv.def.wheelRadius; vv.groundY = vv.y; } else game.teleport(mk.x, mk.z, pl.yaw); }
                  targeted = true;
                }
              }
              if (!targeted) {
                // enter-vehicle waiters
                const bv = r.blips.find(b => b.entity && b.entity.def && !b.entity.wrecked && b.color !== '#ff3030');
                if (bv && pl.vehicle !== bv.entity && !bv.entity.driver) { if (pl.vehicle) pl.exitVehicle(true); pl.enterVehicle(bv.entity, 0, true); }
                else if (!pl.vehicle) { const v = G.vehicles.list.find(q => q.mission && !q.wrecked && !q.driver && !q.ai); if (v && r.objText && /car|van|bike|limo|truck|wheel|vehicle|Get in|Take/i.test(r.objText)) pl.enterVehicle(v, 0, true); }
              }
            }
          }
        }
        if (n % 200 === 0 && r) log(def.id, 'dbg: waiters', r.waiters.length, 'markers', r.markers.length, 'pickups', r.pickups.length, 'peds', r.peds.filter(p=>!p.dead).length, 'player', Math.round(pl.x), Math.round(pl.z), pl.vehicle ? pl.vehicle.name : 'foot', 'obj', lastObj.slice(0,40), (() => { const m = G.vehicles.list.find(v => v.name === "Marcus's coupe" || v.name === "Calloway's limo"); if (!m) return ''; const a = m.ai; return JSON.stringify({ mp: [Math.round(m.x), Math.round(m.z)], spd: +m.speed.toFixed(1), hp: Math.round(m.health), blk: a && a.blocked, ls: a && a.lightStop, rv: a && a.reverseT, sc: a && a.stuckCount, mode: a && a.mode, thr: m.input.throttle, hb: m.input.handbrake, e: a && a.agent && a.agent.edge.id, s: a && a.agent && Math.round(a.agent.s) }); })());
        if (n > MAXL) { log('TIMEOUT loops in', def.id); break; }
        await sleep(1);
      }
      if (M.done.has(def.id)) { passed.push(def.id); log('PASSED', def.id, 'in', Math.round(performance.now() - tm) + 'ms'); }
      else { failed.push(def.id); log('NOT PASSED', def.id, 'obj:', lastObj, '| mp:', document.getElementById('mp').textContent); try { M.abortAll(); } catch (e) { } }
      await sleep(200);
      if (M.active) { M.abortAll(); }
      // clear leftover entities
      for (const q of G.peds.list.slice()) if (!q.isPlayer && q.mission) { q.mission = false; }
    }
    return { passed, failed };
  }, from, to, only, MAXL_ARG, !!process.env.NOLIFE);
  console.log('RESULT', JSON.stringify(result));
  await page.screenshot({ path: OUT + 'bot_end.png' });
  await browser.close();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
