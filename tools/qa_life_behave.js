// Behaviour checks for the scripted world events and scenes (rewards, hostility, shooting, cleanup).
// node tools/play.js tools/qa_life_behave.js
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const setup = () => ctx.eval(() => { window.__errs = []; const oe = console.error; console.error = (...a) => { window.__errs.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 200)); oe(...a); };
    G.worldEvents.timer = 1e9; G.ambient.forcedOnly = true; G.population.pedTarget = 4; G.population.carTarget = 4; G.population.gangTarget = 0; G.player.invincible = true; G.police.clear(); G.sky.hour = 12; G.sky.timeScale = 0; });
  await setup();
  const go = (kind, sec = 0.05) => ctx.eval((kind) => {
    QA.clear(); if (G.worldEvents.active) G.worldEvents.abort(); G.police.clear(); G.player.money = 500;
    const c = G.world.placement.districtCentre('Jefferson'); let E = null;
    for (let i = 0; i < 25 && !E; i++) { const q = G.map.nearestRoad(c.x + (Math.random() - 0.5) * 400, c.z + (Math.random() - 0.5) * 400, 200); QA.tp(q.x, q.z, 0); G.world.update(0, q.x, q.z, 60); E = G.worldEvents.start(kind, true); }
    if (!E) return null; let n = 0; while (E.jobs.length && n++ < 300) QA.sim(0.05); return { x: E.x, z: E.z }; }, kind);
  // 1 mugging: kill the thug => reward
  let r = await go('mugging'); let res = await ctx.eval(() => { QA.sim(3); const E = G.worldEvents.active; const th = E.peds.find(p => p.name === 'Mugger'); const pl = G.player; QA.tp(th.x + 3, th.z + 3, 0); QA.sim(1); th.damage(1e4, { source: pl }); QA.sim(1.2); return { money: pl.money, stars: G.police.stars, phase: E.kind, errs: window.__errs }; });
  console.log('mugging', JSON.stringify(res));
  // 2 chase: player stops the thief
  r = await go('chase'); res = await ctx.eval(() => { QA.sim(6); const E = G.worldEvents.active; const th = E.vehs[0]; const pl = G.player; th.lastHitBy = pl; th.health = 120; th.input.handbrake = true; if (th.ai) th.ai.setMode('idle'); th.vx = th.vz = 0; QA.sim(8); return { money: pl.money, errs: window.__errs, alive: !!G.worldEvents.active }; });
  console.log('chase', JSON.stringify(res));
  // 3 drive-by: do the gunmen shoot at the victims?
  r = await go('driveby'); res = await ctx.eval(() => { const E = G.worldEvents.active; let shots = 0, hits = 0; const of = G.combat.fire.bind(G.combat); G.combat.fire = (sh, ...a) => { if (sh && sh.name === 'Shooter') shots++; return of(sh, ...a); };
    for (let i = 0; i < 30 * 40; i++) { game.sim(1 / 30); G.player.x = E.x + 70; G.player.z = E.z + 70; } G.combat.fire = of;
    const victims = E.peds.filter(p => p.role === 'civ'); return { shots, victimsAlive: victims.filter(p => !p.dead).length, victims: victims.length, errs: window.__errs, stars: G.police.stars }; });
  console.log('driveby', JSON.stringify(res));
  // 4 armoured truck: burst => cash => star when collected
  r = await go('armoured'); res = await ctx.eval(() => { QA.sim(2); const E = G.worldEvents.active; const tr = E.vehs[0]; const pl = G.player; tr.damage(400, { source: pl }); QA.sim(1); const cash = G.pickups.list.filter(p => p.kind === 'cash' && !p.dead && p.onCollect); const n = cash.length; let got = 0;
    if (n) { QA.tp(cash[0].x, cash[0].z, 0); QA.sim(1); } return { cashPickups: n, money: pl.money, stars: G.police.stars, guards: E.peds.filter(p => p.name === 'Guard').map(p => p.mode), errs: window.__errs }; });
  console.log('armoured', JSON.stringify(res));
  // 5 fight scene
  res = await ctx.eval(() => { QA.clear(); if (G.worldEvents.active) G.worldEvents.abort(); G.police.clear(); const c = G.world.placement.districtCentre('Jefferson'); let S = null; for (let i = 0; i < 25 && !S; i++) { const q = G.map.nearestRoad(c.x + (Math.random() - 0.5) * 400, c.z + (Math.random() - 0.5) * 400, 200); QA.tp(q.x, q.z, 0); G.world.update(0, q.x, q.z, 60); S = G.ambient.forceScene('fight'); }
    let n = 0; while (S.jobs.length && n++ < 100) QA.sim(0.05); const pe = S.peds.slice(); let fought = 0, minH = 100; for (let i = 0; i < 30 * 40; i++) { game.sim(1 / 30); G.player.x += 0; if (pe.some(p => p.mode === 'fight')) fought++; for (const p of pe) minH = Math.min(minH, p.health); }
    return { fightFrames: fought, minHealth: Math.round(minH), modes: pe.map(p => p.mode), dead: pe.filter(p => p.dead).length, stars: G.police.stars, errs: window.__errs }; });
  console.log('fight', JSON.stringify(res));
  // 6 gang members with activities still turn on an armed player in their turf
  res = await ctx.eval(async () => { QA.clear(); const gh = G.world.placement.districtCentre('Idlewood'); const q = G.map.nearestRoad(gh.x, gh.z, 200); QA.tp(q.x, q.z, 0); G.world.update(0, q.x, q.z, 60); G.population.gangTarget = 6; G.population.enabled = true;
    for (let i = 0; i < 6; i++) G.population.spawnGang(q.x, q.z, G.player); const gangs = G.peds.list.filter(p => p.role === 'gang'); const withLife = gangs.filter(p => p.life).length;
    G.player.give('pistol', 100); G.player.equip('pistol'); QA.sim(0.1); for (const g of gangs) { g.x = q.x + 6 + Math.random(); g.z = q.z + 3; } QA.sim(3);
    return { gangs: gangs.length, withLife, attacking: gangs.filter(p => p.mode === 'attack').length, errs: window.__errs }; });
  console.log('gang', JSON.stringify(res));
};
