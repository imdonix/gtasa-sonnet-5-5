// Long-run soak: an AI-driven car roams the city carrying the (invisible) player; reports leaks, stuck cars, NaN, sim cost.
// node tools/play.js tools/qa_game_soak.js   (env: MIN=10 minutes, NIGHT=1, STARS=n)
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  const MIN = +(process.env.MIN || 10);
  await boot(ctx, {});
  await ctx.eval((c) => { window.__cruise = c; }, +(process.env.CRUISE || 22));
  await ctx.eval(async () => {
    const { DriverAI } = await import('/src/driverai.js');
    window.__errs = []; window.addEventListener('error', e => window.__errs.push(e.message));
    const pl = G.player; pl.noDespawn = true;
    const home = G.landmarks.home; const x = home.door.x + 6, z = home.door.z + 6;
    const nr = G.map.nearestRoad(x, z, 80);
    window.__v = await QA.car('sports', nr.x, nr.z, Math.atan2(nr.tx, nr.tz), {});
    pl.enterVehicle(window.__v, 1, true); window.__ai = new DriverAI(window.__v, 'goto', { cruise: window.__cruise || 22, stopDist: 15 }); window.__dmg = []; const _od = window.__v.damage.bind(window.__v); window.__v.damage = (a, i) => { window.__dmg.push([Math.round(G.time), Math.round(a), Math.round(window.__v.speed), window.__v.airborne ? 'air' : '', Math.round(window.__v.x), Math.round(window.__v.z)]); _od(a, i); }; let _wasAir = false; window.__air = 0; const _tr = () => { if (window.__v.airborne && !_wasAir) window.__air++; _wasAir = window.__v.airborne; }; window.__trAir = _tr;
    window.__dests = 0; window.__pickDest = () => { window.__dests++; const n = G.map.nodes.filter(n => n.deg >= 3); const d = n[(Math.random() * n.length) | 0]; window.__ai.setMode('goto', { dest: { x: d.x, z: d.z } }); };
    window.__pickDest();
    window.__stuck = new Map(); window.__maxMs = 0; window.__totMs = 0; window.__n = 0; window.__sinceDest = 0;
    if (window.__night) G.sky.hour = 23;
    const THREE = await import('three'); const fr = new THREE.Frustum(), pm = new THREE.Matrix4(); const seenV = new Map(), seenP = new Map(); window.__pop = { vIn: 0, vInVis: 0, vOut: 0, vOutVis: 0, pIn: 0, pInVis: 0, pOut: 0, pOutVis: 0, samples: [] };
    const inView = (x, y, z, r = 2) => { const sp = new THREE.Sphere(new THREE.Vector3(x, y, z), r); return fr.intersectsSphere(sp); };
    window.__track = () => {
      G.cam.updateMatrixWorld(); pm.multiplyMatrices(G.cam.projectionMatrix, G.cam.matrixWorldInverse); fr.setFromProjectionMatrix(pm);
      const nowV = new Map(); for (const q of G.vehicles.list) { nowV.set(q.id, q); if (!seenV.has(q.id)) { seenV.set(q.id, q); if (q.owner === 'traffic' || q.owner === 'police') { window.__pop.vIn++; const vis = inView(q.x, q.y, q.z, 3) && Math.hypot(q.x - G.cam.position.x, q.z - G.cam.position.z) < 250; if (vis) { window.__pop.vInVis++; if (window.__pop.samples.length < 10) window.__pop.samples.push(['vIn', q.type, q.owner, Math.round(Math.hypot(q.x - G.cam.position.x, q.z - G.cam.position.z))]); } } } }
      for (const [id, q] of seenV) if (!nowV.has(id)) { seenV.delete(id); if ((q.owner === 'traffic' || q.owner === 'police') && !q.wrecked) { window.__pop.vOut++; const vis = inView(q.x, q.y, q.z, 3); if (vis) { window.__pop.vOutVis++; if (window.__pop.samples.length < 10) window.__pop.samples.push(['vOut', q.type, Math.round(Math.hypot(q.x - G.cam.position.x, q.z - G.cam.position.z))]); } } }
      const nowP = new Map(); for (const q of G.peds.list) { if (q.vehicle) continue; nowP.set(q.id, q); if (!seenP.has(q.id)) { seenP.set(q.id, q); if (!q.mission && !q.isPlayer) { window.__pop.pIn++; if (inView(q.x, q.y + 1, q.z, 1)) { window.__pop.pInVis++; if (window.__pop.samples.length < 10) window.__pop.samples.push(['pIn', q.role, Math.round(Math.hypot(q.x - G.cam.position.x, q.z - G.cam.position.z))]); } } } }
      for (const [id, q] of seenP) if (!nowP.has(id)) { seenP.delete(id); if (!q.vehicle && !q.dead && !q.mission) { window.__pop.pOut++; if (inView(q.x, q.y + 1, q.z, 1)) window.__pop.pOutVis++; } }
    };
    window.__step = (secs, dt = 1 / 30) => {
      const n = Math.round(secs / dt);
      for (let i = 0; i < n; i++) {
        const v = window.__v;
        
        const t0 = performance.now(); game.sim(dt); G.camera.update(dt, dt, pl, G.input); window.__track(); window.__trAir(); const ms = performance.now() - t0; window.__maxMs = Math.max(window.__maxMs, ms); window.__totMs += ms; window.__n++;
        window.__sinceDest += dt;
        if (window.__ai.arrived || window.__sinceDest > 90) { window.__pickDest(); window.__sinceDest = 0; }
        if (v.wrecked) { v.repair(); v.health = v.maxHealth; }
        if (i % 30 === 0) G.world.update(0.03, v.x, v.z, 6);
        if (i % 15 === 0) {
          for (const q of G.vehicles.list) {
            const s = window.__stuck.get(q.id) || { t: 0, x: q.x, z: q.z };
            if (Math.hypot(q.x - s.x, q.z - s.z) > 1.5) { s.t = 0; s.x = q.x; s.z = q.z; } else s.t += 0.5;
            window.__stuck.set(q.id, s);
          }
        }
      }
    };
  });
  for (let m = 0; m < MIN; m++) {
    const r = await ctx.eval(() => {
      window.__step(60);
      const stuck = []; for (const q of G.vehicles.list) { const s = window.__stuck.get(q.id); if (s && s.t > 30 && q.owner !== 'parked' && (q.driver || q.ai) && q !== window.__v) stuck.push([q.type, q.owner, Math.round(q.x), Math.round(q.z), Math.round(s.t), q.ai ? (q.ai.blockedBy || '') + '|' + (q.ai.lightStop ? 'light' : '') + '|sc' + (q.ai.stuckCount || 0) : '']); }
      const v = window.__v;
      return { t: Math.round(G.time), ...QA.counts(), nan: QA.nan(), avgMs: +(window.__totMs / window.__n).toFixed(2), maxMs: +window.__maxMs.toFixed(1), errs: window.__errs.slice(-3), stuck: stuck.slice(0, 6), nStuck: stuck.length, me: [Math.round(v.x), Math.round(v.z), Math.round(v.speed), v.ai && v.ai.mode, Math.round(v.health), v.ai && v.ai.blockedBy, v.ai && v.ai.lightStop, v.ai && v.ai.stuckCount, window.__ai.dest && Math.round(Math.hypot(window.__ai.dest.x - v.x, window.__ai.dest.z - v.z)), window.__dests], fx: G.scene.children.length, pop: window.__pop, air: window.__air, dmg: window.__dmg.slice(-6) };
    });
    console.log(JSON.stringify(r));
    await ctx.eval(() => { window.__maxMs = 0; });
  }
};
