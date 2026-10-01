// Shared in-page helpers for gameplay QA scripts.  usage: const {install}=require('./qa_game_lib'); await install(ctx);
// then in ctx.eval(()=>{ QA.start(); ...})
function inpage() {
  const QA = window.QA = {};
  QA.start = () => { game.startGame(false); };   // then ctx.wait(3500) and QA.after()
  QA.after = (opts = {}) => { G.missions.abortAll(); G.police.clear(); G.player.controlEnabled = true; game.state = 'play'; G.input.down.clear(); G.player.invincible = opts.invincible ?? true; game.inCutscene = false; G.camera.endCine && G.camera.endCine(); G.hud.hideBig && G.hud.hideBig(); if (opts.empty) { G.population.carTarget = 0; G.population.pedTarget = 0; G.population.gangTarget = 0; QA.clear(); } };
  QA.clear = () => { for (const p of G.peds.list.slice()) if (p !== G.player) G.peds.remove(p); for (const v of G.vehicles.list.slice()) G.vehicles.remove(v); };
  QA.sim = (s, dt = 1 / 30) => { const n = Math.round(s / dt); for (let i = 0; i < n; i++) game.sim(dt); };
  // find a long straight flat road stretch. returns {x,z,yaw,len}
  QA.findStraight = (minLen = 220, cls = null, maxSlope = 0.02) => {
    const map = G.map, W = G.world; let best = null;
    for (const e of map.edges) {
      if (cls !== null && e.cls !== cls) continue;
      if (e.len < minLen) continue;
      // walk in chunks
      let runStart = 0;
      for (let i = 0; i < e.pts.length - 1; i++) {
        // run of pts with nearly constant heading
      }
      const a = e.pts[0], b = e.pts[e.pts.length - 1]; const chord = Math.hypot(b.x - a.x, b.z - a.z);
      if (chord < e.len * 0.985) continue;
      const ha = W.groundY(a.x, a.z), hb = W.groundY(b.x, b.z); if (Math.abs(ha - hb) / e.len > maxSlope) continue;
      if (!best || e.len * (1 + e.cls * 0.1) > best.len * (1 + best.edge.cls * 0.1)) best = { x: a.x, z: a.z, yaw: Math.atan2(b.x - a.x, b.z - a.z), len: e.len, edge: e };
    }
    return best;
  };
  // vehicle with a dummy driver and no AI (inputs set directly). returns vehicle
  QA.car = async (type, x, z, yaw, opts = {}) => {
    const { Ped } = await import('/src/peds.js');
    const v = G.vehicles.spawn(type, x, z, yaw, { owner: 'player', ...opts });
    const d = new Ped({ x, z, role: 'civ' }); G.peds.add(d); d.noDespawn = true; d.enterVehicle(v, 0, true); d.invincible = true;
    v.wake(); return v;
  };
  QA.key = (...k) => { G.input.down.clear(); for (const c of k) G.input.down.add(c); };
  QA.ped = async (o) => { const { Ped } = await import('/src/peds.js'); const p = new Ped(o); G.peds.add(p); return p; };
  QA.tp = (x, z, yaw = 0) => game.teleport(x, z, yaw);
  QA.nan = () => { const bad = []; for (const p of G.peds.list) if (!isFinite(p.x + p.y + p.z)) bad.push('ped:' + p.role); for (const v of G.vehicles.list) if (!isFinite(v.x + v.y + v.z + v.yaw)) bad.push('veh:' + v.type); return bad; };
  QA.cam = (from, look, fov = 45) => { G.camera.startCine({ total: 1e9, t: 0, shots: [{ from, look, dur: 1e9, fov, ease: false }] }); };
  QA.camEnd = () => G.camera.endCine();
  // camera orbiting a point: yawDeg (0 = from +Z looking -Z), pitchDeg, dist
  QA.orbit = (x, y, z, yawDeg, pitchDeg, dist, fov = 40) => { const a = yawDeg * Math.PI / 180, p = pitchDeg * Math.PI / 180; QA.cam({ x: x + Math.sin(a) * Math.cos(p) * dist, y: y + Math.sin(p) * dist, z: z + Math.cos(a) * Math.cos(p) * dist }, { x, y, z }, fov); };
  QA.counts = () => { const r = { peds: G.peds.list.length, vehs: G.vehicles.list.length }; const byRole = {}; for (const p of G.peds.list) byRole[p.role] = (byRole[p.role] || 0) + 1; r.byRole = byRole; const byOwner = {}; for (const v of G.vehicles.list) byOwner[v.owner] = (byOwner[v.owner] || 0) + 1; r.byOwner = byOwner; return r; };
}
async function install(ctx) { await ctx.page.evaluate(inpage); }
// start a free-roam game and wait until the tutorial mission has auto-started (it does so asynchronously), then abort it
async function boot(ctx, opts = {}) {
  await ctx.eval(() => QA.start());
  for (let i = 0; i < 40; i++) { await ctx.wait(400); if (await ctx.eval(() => !!(G.missions && G.missions.active))) break; }
  await ctx.wait(600);
  await ctx.eval((o) => QA.after(o), opts);
}
module.exports = { install, inpage, boot };
