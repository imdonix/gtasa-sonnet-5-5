// Story robustness scenarios (headless). node tools/play.js tools/qa_story_edge.js
// Prints PASS/FAIL lines for: abort/fail mid-mission (no hang, no leaks), quit to title mid-mission + new game (markers, HUD),
// save/load around missions (start markers + territories), replay, idle objective hint, side quests listed in stats/replay.
module.exports = async (c) => {
  const T = (...a) => c.log(...a);
  const ok = (name, cond, extra = '') => T((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
  const boot = async () => { await c.eval(() => { game.startGame(false); }); await c.wait(3800); await c.eval(() => { G.missions.abortAll(); G.player.invincible = true; G.police.clear(); }); };
  const counts = () => c.eval(() => {
    const M = G.missions; const gs = new Set([...M.startMarkers.values()].map(e => e.ped));
    return { peds: G.peds.list.filter(p => p.mission && !p.isPlayer && !p.removeMe && !gs.has(p)).length, veh: G.vehicles.list.filter(v => v.mission && !v.removeMe).length, markers: G.markers.list.filter(m => !m.dead).length - M.startMarkers.size, blips: G.blips.list.length - M.startMarkers.size, active: !!M.active, obj: document.getElementById('objective').textContent, timer: getComputedStyle(document.getElementById('timer')).display, counter: getComputedStyle(document.getElementById('counter')).display, pickups: G.pickups.list.filter(p => !p.dead && p.life > 1e8 && !p.persistent).length };
  });
  const prep = (id) => c.eval((id) => {
    const M = G.missions; M.abortAll(); const ids = M.defs.filter(d => !d.side).map(d => d.id); const k = ids.indexOf(id);
    for (let i = 0; i < k; i++) { M.done.add(ids[i]); const d = M.defs.find(x => x.id === ids[i]); if (d.afterDone) try { d.afterDone(M); } catch (e) { } }
    M.refreshStarts(); const def = M.defs.find(d => d.id === id); const w = def.where && def.where(); if (w) game.teleport(w.x + 3, w.z + 3, 0);
  }, id);
  const stepMission = (sec) => c.eval(async (sec) => { const sleep = ms => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < sec * 3; i++) { for (let k = 0; k < 10; k++) game.sim(1 / 30); if (i % 6 === 0) await sleep(0); } }, sec);

  await boot();
  const base = await counts(); T('baseline', JSON.stringify(base));

  // ---- 1. fail in the middle of the m02 pickup wait must end the mission (raw-promise wait)
  for (const id of ['m02', 'm05', 'm08', 'm12']) {
    await prep(id);
    await c.eval((id) => { G.missions.start(G.missions.defs.find(d => d.id === id)); }, id);
    await stepMission(25);
    const mid = await counts();
    await c.eval(() => { const r = G.missions.active; if (r) r.abortAll(Object.assign(new Error('x'), { isFail: true, reason: 'QA forced fail' })); });
    await stepMission(3);
    const after = await counts();
    ok(id + ' forced fail: mission ended', !after.active, JSON.stringify(after));
    ok(id + ' forced fail: no leaked mission entities / markers', after.peds === 0 && after.veh === 0 && after.markers === base.markers, JSON.stringify({ mid, after, base }));
    ok(id + ' forced fail: HUD clean', after.obj === '' && after.timer === 'none' && after.counter === 'none');
    await c.eval(() => { const pl = G.player; pl.dead = false; pl.health = pl.maxHealth; game.state = 'play'; G.police.clear(); });
  }

  // ---- 2. m02: die while waiting for the cash pickup (raw promise) -> mission must fail, not hang
  await prep('m02');
  await c.eval(async () => { const M = G.missions; M.start(M.defs.find(d => d.id === 'm02')); const sleep = ms => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 40; i++) { for (let k = 0; k < 10; k++) game.sim(1 / 30); await sleep(0); } const r = M.active; if (r) { for (const p of G.peds.list) if (p.mission && (p.hostile || p.role === 'enemy') && !p.dead) p.damage(1e5, { source: G.player }); } });
  await stepMission(6);
  const pk = await c.eval(() => { const r = G.missions.active; return r ? r.pickups.filter(k => !k.dead && k.kind === 'cash').length : -1; });
  ok('m02 reached cash-pickup wait', pk === 1, 'pickups=' + pk);
  await c.eval(() => { G.player.invincible = false; G.player.damage(1e4, { source: null }); });
  await stepMission(2);
  await c.eval(() => { const pl = G.player; game.respawn(game.state); game.state = 'play'; pl.invincible = true; });
  await stepMission(4);
  ok('m02 death during cash wait: mission ended (no soft-lock)', !(await counts()).active);

  // ---- 3. quit to title mid-mission, start a new game: clean state, shop markers back
  await prep('m05');
  await c.eval(() => { G.missions.start(G.missions.defs.find(d => d.id === 'm05')); });
  await stepMission(20);
  await c.eval(() => { game.quitToTitle(); });
  await c.wait(400);
  const q = await c.eval(() => ({ active: !!G.missions.active, state: game.state, obj: document.getElementById('objective').textContent, peds: G.peds.list.length, cine: game.inCutscene }));
  ok('quitToTitle mid-mission: no active mission, title state', !q.active && q.state === 'title' && !q.cine, JSON.stringify(q));
  await c.eval(() => { game.startGame(false); });
  await c.wait(3800);
  const nm = await c.eval(() => { const M = G.missions; return { active: M.active && M.active.def.id, shops: G.places.shops.filter(s => s.marker && !s.marker.dead).length, total: G.places.shops.length }; });
  ok('new game after quit: m01 auto-starts', nm.active === 'm01', JSON.stringify(nm));
  ok('new game after quit: shop markers restored', nm.shops >= 10 && nm.shops <= nm.total, JSON.stringify(nm));

  // ---- 4. save / load around missions
  await c.eval(() => { G.missions.abortAll(); G.player.invincible = true; });
  await prep('m06');   // m01..m05 done (m05 afterDone paints territory)
  const before = await c.eval(() => { G.game.save(); return { terr: [...game.territories], done: [...G.missions.done] }; });
  await c.eval(() => { game.quitToTitle(); });
  await c.wait(300);
  await c.eval(() => { game.startGame(true); });
  await c.wait(2500);
  const aft = await c.eval(() => { const M = G.missions; const gang = G.map.gangAt(G.landmarks.vk_base.door.x, G.landmarks.vk_base.door.z); return { terr: [...game.territories], done: [...M.done], starts: [...M.startMarkers.keys()], gang, active: !!M.active }; });
  ok('load: done set restored', aft.done.length === before.done.length, JSON.stringify(aft.done));
  ok('load: territory restored (idlewood is Emerald turf)', aft.terr.includes('idlewood') && aft.gang === 1, JSON.stringify({ terr: aft.terr, gang: aft.gang }));
  ok('load: next mission start markers present', aft.starts.includes('m06') && aft.starts.includes('m07') === false && !aft.active, JSON.stringify(aft.starts));

  // ---- 5. replay from the pause menu path
  await c.eval(() => { G.player.invincible = true; });
  await c.eval(() => { const M = G.missions; const def = M.defs.find(d => d.id === 'm02'); M.replay(def); });
  await stepMission(6);
  const rp = await c.eval(() => ({ active: G.missions.active && G.missions.active.def.id, doneHas: G.missions.done.has('m02') }));
  ok('replay m02 starts', rp.active === 'm02', JSON.stringify(rp));
  await c.eval(() => { G.missions.abortAll(); });

  // ---- 6. objective reminder after 60 s idle
  await c.eval(() => { const pl = G.player; pl.controlEnabled = true; });
  await prep('m02');
  await c.eval(() => { G.missions.start(G.missions.defs.find(d => d.id === 'm02')); });
  await stepMission(30);
  await c.eval(() => { G.hud.clearSubs(); });
  await stepMission(75);
  const sub = await c.eval(() => document.getElementById('subs') ? document.getElementById('subs').textContent : '(no #subs)');
  ok('idle objective reminder appears', /Objective:/i.test(sub), sub.slice(0, 120));
  await c.eval(() => { G.missions.abortAll(); });

  // ---- 7. side quests registered
  const sd = await c.eval(() => { const M = G.missions; return { side: M.defs.filter(d => d.side).map(d => d.id), total: M.storyTotal(), sideTotal: M.sideTotal() }; });
  ok('side quests registered', sd.side.length >= 3 && sd.total === 24, JSON.stringify(sd));
  T('DONE');
};
