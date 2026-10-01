// Numeric seated-ped fit for every vehicle type and seat: head clearance under the roof and sole height above the floor pan (model space).
// node tools/play.js tools/qa_vis_seatfit.js      (negative head = poking through the roof, negative foot = below the floor pan)
const { setup } = require('./qa_vis_lib');
module.exports = async (ctx) => {
  await setup(ctx, { empty: true });
  const res = await ctx.eval(async () => {
    const THREE = await import('three'); const out = [];
    const h = VIS.district('ganton'); const r = VIS.road(h.x, h.z); VIS.go(r.x, r.z, r.yaw);
    const types = (window.__types || 'sedan,coupe,muscle,lowrider,sports,hatch,suv,pickup,van,taxi,police,swatvan,ambulance,bus,truck,limo,motorbike,bicycle').split(',');
    for (const t of types) {
      QA.clear(); const v = G.vehicles.spawn(t, r.x, r.z, 0, { owner: 'player' }); v.wake();
      const peds = [];
      for (let s = 0; s < v.model.seats.length; s++) { const p = new window.__Ped({ x: r.x, z: r.z, role: 'civ', appearance: { scale: 1.0, hairStyle: 'short', gender: 'm' } }); G.peds.add(p); p.noDespawn = true; p.enterVehicle(v, s, true); peds.push(p); }
      v.input.handbrake = true; QA.sim(1.0);
      v.model.group.updateMatrixWorld(true); const g = v.model.group; const si = g.userData.seatInfo;
      const row = [];
      for (let s = 0; s < peds.length; s++) {
        const rig = peds[s].rig; const hb = new THREE.Box3().setFromObject(rig.p.neck); const c = hb.getCenter(new THREE.Vector3()); g.worldToLocal(c);
        const base = v.y - v.def.wheelRadius; // model origin height
        const top = hb.max.y - base;
        const roof = si ? si.roofAt(c.z) : NaN;
        let foot = 1e9; for (const kn of [rig.p.lKnee, rig.p.rKnee]) for (const lz of [-0.07, 0.17]) { const w = kn.localToWorld(new THREE.Vector3(0, -0.47, lz)); foot = Math.min(foot, w.y - base); }
        const fl = si ? si.seats[s].floor : NaN;
        let hd = '';
        if (s === 0 && si && si.seats[0].wheel) { const W = si.seats[0].wheel; const hw = rig.getHandWorldPos(); g.worldToLocal(hw); const cc = new THREE.Vector3(W.x, W.y, W.z); hd = ` hand-wheel ${hw.distanceTo(cc).toFixed(2)}`; }
        row.push(`s${s}: head ${(roof - top).toFixed(2)} foot ${(foot - fl).toFixed(2)}${hd} rec ${rig._fit ? rig._fit.rec.toFixed(2) : '-'}`);
      }
      out.push(`${t.padEnd(10)} ${row.join(' | ')}`);
    }
    return out;
  });
  console.log(res.join('\n'));
};
