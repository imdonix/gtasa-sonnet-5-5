// "Legit" story QA: plays missions with a simulated human (keys / mouse / camera only, no kills / teleports) and reports
// time, damage taken, deaths and retries per mission.
//   node tools/qa_legit.js --from m01 --to m14 [--only m05] [--tries 3] [--skill 1] [--cruise 30] [--armor 0] [--maxsec 420] [--seq 1]
// --seq 1 : carry weapons/money between missions (continuous campaign) instead of resetting loadout for each.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const OUT = '/tmp/claude-1001/-home-tamasmagyar-Work-testgame/2244238a-7010-4c23-9327-bbc7bc4690bf/scratchpad/';
(async () => {
  const browser = await puppeteer.launch({ protocolTimeout: 3600000, executablePath: '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(); await page.setViewport({ width: 960, height: 540 });
  page.on('console', m => { const t = m.type(), x = m.text(); if (t === 'error' || t === 'warning' || x.startsWith('[L]')) console.log('[' + t + ']', x.slice(0, 400)); });
  page.on('pageerror', e => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')));
  await page.goto('http://localhost:8080/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.game && window.game.running, { timeout: 180000 });
  await page.evaluate(fs.readFileSync(__dirname + '/human_sim.js', 'utf8'));
  await page.waitForFunction(() => window.HUM_READY, { timeout: 20000 });
  const P = { from: opt('from', 'm01'), to: opt('to', 'm14'), only: opt('only', null), tries: +opt('tries', 3), skill: +opt('skill', 1), cruise: +opt('cruise', 30), armor: +opt('armor', 0), maxsec: +opt('maxsec', 420), seq: +opt('seq', 1) };
  const result = await page.evaluate(async (P) => {
    const log = (...a) => console.log('[L]', ...a);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const H = window.HUM; H.skill = P.skill; H.cruise = P.cruise;
    game.startGame(false); await sleep(3600);
    const M = G.missions, pl = G.player; M.abortAll();
    let failReason = ''; const oF = G.hud.missionFailed.bind(G.hud); G.hud.missionFailed = (r) => { failReason = r; oF(r); };
    const ids = M.defs.filter(d => !d.side).map(d => d.id);
    const startIdx = ids.indexOf(P.only || P.from), endIdx = P.only ? startIdx : ids.indexOf(P.to);
    for (let i = 0; i < startIdx; i++) { M.done.add(ids[i]); const d = M.defs.find(x => x.id === ids[i]); if (d.afterDone) try { d.afterDone(M); } catch (e) { } }
    if (startIdx > 0) { pl.give('pistol', 120, false); pl.give('smg', 150, false); pl.give('bat', 0, false); }
    const report = []; const mk0 = G.markers.list.filter(m => !m.dead).length - M.startMarkers.size;
    for (let idx = startIdx; idx <= endIdx; idx++) {
      const def = M.defs.find(x => x.id === ids[idx]);
      const row = { id: def.id, title: def.title, attempts: [] }; let passed = false;
      for (let att = 1; att <= P.tries && !passed; att++) {
        failReason = ''; pl.health = 100; pl.armor = P.armor; pl.dead = false; G.police.clear(); game.timeScale = 1; game.state = 'play'; pl.controlEnabled = true;
        if (pl.vehicle) pl.exitVehicle(true);
        const pe0 = G.peds.list.length, ve0 = G.vehicles.list.length;
        H.reset(); H.resetAI();
        if (!def.autostart && def.where) { const w = def.where(); if (w) game.teleport(w.x + 3, w.z + 3, 0); }
        M.refreshStarts(); await sleep(30);
        const t0 = G.time; const pr = M.start(def); let ended = false; pr.then(() => ended = true);
        let n = 0, lastObj = '', lastObjT = G.time;
        while (!ended && G.time - t0 < P.maxsec) {
          for (let k = 0; k < 10; k++) game.sim(1 / 30);
          if (game.state === 'dead' || game.state === 'busted') { for (let k = 0; k < 10; k++) game.sim(1 / 30); }
          n++;
          const obj = (document.getElementById('objective') || {}).textContent || '';
          if (obj !== lastObj) { lastObj = obj; lastObjT = G.time; log(def.id, '[' + (G.time - t0).toFixed(0) + 's]', 'obj:', obj.slice(0, 80), '| goal', H.lastGoal, '| hp', Math.round(pl.health), Math.round(pl.armor)); }
          if (n % 4 === 0) await sleep(0);
          if (!M.active && !ended) { await sleep(5); if (!M.active) { for (let k = 0; k < 30; k++) game.sim(1 / 30); } }
        }
        await sleep(20);
        const st = H.stats; const dt = G.time - t0;
        passed = M.done.has(def.id);
        const a = { att, passed, t: +dt.toFixed(0), dmg: Math.round(st.dmg), minHp: Math.round(st.minHp), reason: passed ? '' : (failReason || (dt >= P.maxsec ? 'TIMEOUT @ ' + lastObj.slice(0, 60) + ' goal=' + H.lastGoal : '?')), idleMax: Math.round(st.idleMax || 0), by: st.by, noBlip: st.noBlip, fatal: st.fatal, raises: st.raises, ents: (() => { const gs = new Set([...M.startMarkers.values()].map(e => e.ped)); return [G.peds.list.filter(q => q.mission && !q.isPlayer && !q.removeMe && !gs.has(q)).length, G.vehicles.list.filter(q => q.mission && !q.removeMe).length, G.markers.list.filter(m => !m.dead).length - M.startMarkers.size - mk0]; })() };
        row.attempts.push(a); log('RESULT', def.id, JSON.stringify(a));
        if (M.active) M.abortAll();
        if (game.state === 'dead' || game.state === 'busted') game.respawn(game.state);
        H.resetAI(); H.release();
        await sleep(100);
        if (!passed && att >= P.tries) { M.done.add(def.id); const d = def; if (d.afterDone) try { d.afterDone(M); } catch (e) { } log('FORCED done', def.id); }
      }
      report.push(row);
    }
    return report;
  }, P);
  console.log('REPORT');
  for (const r of result) console.log(r.id, r.title, r.attempts.map(a => `${a.passed ? 'PASS' : 'FAIL'} t=${a.t}s dmg=${a.dmg} minHp=${a.minHp} idle=${a.idleMax}s leak(peds,veh,mk)=${a.ents}${a.reason ? ' [' + a.reason + ']' : ''} fatal=${a.fatal} raises=${JSON.stringify(a.raises || {})} by=${JSON.stringify(a.by)} noBlip=${JSON.stringify(a.noBlip || {})}`).join(' || '));
  await page.screenshot({ path: OUT + 'legit_end.png' });
  await browser.close();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
