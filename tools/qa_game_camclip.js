// Randomised camera-clipping check (on foot / aiming / in vehicle).  Reports % of samples where the camera ends up inside a collider.
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, { empty: true });
  const N = +(process.env.N || 120);
  const res = await ctx.eval(async (N) => {
    const pl = G.player, W = G.world; const out = { foot: { n: 0, inside: 0, close: 0, underground: 0 }, aim: { n: 0, inside: 0, close: 0, underground: 0 }, car: { n: 0, inside: 0, close: 0, underground: 0 } }; const bad = [];
    const hb = { consumeMouse: () => [0, 0], gpAx: null };
    const check = (k, label) => {
      const c = G.camera.pos; const pos = { x: c.x, z: c.z }; const o = {}; const r = out[k]; r.n++;
      if (W.pushCircle(pos, 0.12, o)) { const col = o.c; const top = W.groundY(col.x, col.z) + (col.h ?? 3); if (c.y < top) { r.inside++; if (bad.length < 8) bad.push([k, Math.round(c.x), Math.round(c.z), label]); } }
      const gy = W.groundY(c.x, c.z); if (c.y < gy + 0.1) r.underground++;
      const piv = G.camera.pivot; if (Math.hypot(c.x - piv.x, c.z - piv.z, c.y - piv.y) < 0.8) r.close++;
    };
    const h = G.landmarks.home; const spots = [];
    for (let i = 0; i < N; i++) { const a = Math.random() * 6.28, r = 20 + Math.random() * 500; const x = h.door.x + Math.cos(a) * r, z = h.door.z + Math.sin(a) * r; if (Math.abs(x) > 950 || Math.abs(z) > 950) continue; if (W.groundY(x, z) < 1) continue; spots.push([x, z]); }
    let i = 0;
    for (const [x, z] of spots) {
      if (i++ % 10 === 0) { QA.tp(x, z, 0); for (let k = 0; k < 6; k++) W.update(0.05, x, z, 20); }
      // place near an actual building corner: walk to nearest collider edge
      const pos = { x, z }; let tries = 0; const ps = { x: x, z: z };
      { const q = { x, z }; if (W.pushCircle(q, 0.6, {})) continue; }
      let px = x, pz = z; { const q = { x, z }, oo = {}; if (W.pushCircle(q, 7, oo) && oo.nx !== undefined) { px = q.x - oo.nx * 6.45; pz = q.z - oo.nz * 6.45; const q2 = { x: px, z: pz }; if (W.pushCircle(q2, 0.4, {})) { px = x; pz = z; } } }
      QA.tp(px, pz, Math.random() * 6.28); pl.x = px; pl.z = pz; pl.y = W.groundY(px, pz); G.camera.yaw = Math.random() * 6.28; G.camera.pitch = 0.1 + Math.random() * 0.4; G.camera.snapTo(pl); G.camera.yaw = Math.random() * 6.28;
      for (let k = 0; k < 40; k++) G.camera.update(1 / 30, 1 / 30, pl, hb);
      check('foot', 'f');
      pl.aimMode = true; for (let k = 0; k < 30; k++) G.camera.update(1 / 30, 1 / 30, pl, hb); check('aim', 'a'); pl.aimMode = false;
    }
    return { out, bad };
  }, N);
  console.log(JSON.stringify(res));
};
