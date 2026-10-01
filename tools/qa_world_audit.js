// Automated placement audit: props inside roads / buildings, buildings on roads, slope stats.  node tools/play.js tools/qa_world_audit.js
const Q = require('./qa_world_lib.js');
module.exports = async (ctx) => {
  await Q.init(ctx, { pop: false });
  const r = await ctx.eval(() => {
    const W = G.world, P = W.placement, m = G.map, T = W.terrain;
    const out = { props: P.props.length, buildings: P.buildings.length, propInRoad: {}, propInBuilding: {}, propUnderwater: {}, bldOnRoad: [], bldOverlap: 0, slopeBig: 0, floatBig: [] };
    const obbContains = (o, x, z, mg) => { const dx = x - o.x, dz = z - o.z, s = Math.sin(o.yaw), c = Math.cos(o.yaw); const lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx) <= o.hw + mg && Math.abs(lz) <= o.hd + mg; };
    for (const p of P.props) {
      if (p.kind === 'wire' || p.roof) continue;
      const rd = m.roadDistAt(p.x, p.z);
      if (rd < -0.3 && p.kind !== 'trafficlight') out.propInRoad[p.kind] = (out.propInRoad[p.kind] || 0) + 1;
      const y = T.groundY(p.x, p.z);
      if (y < 0.0 && p.kind !== 'container') out.propUnderwater[p.kind] = (out.propUnderwater[p.kind] || 0) + 1;
      for (const b of P.occ.queryRadius(p.x, p.z, 30)) if (b.obb && obbContains(b.obb, p.x, p.z, 0.2)) { out.propInBuilding[p.kind] = (out.propInBuilding[p.kind] || 0) + 1; break; }
    }
    for (const b of P.buildings) {
      const cs = Math.cos(b.yaw), sn = Math.sin(b.yaw); let minRd = 1e9, hmin = 1e9, hmax = -1e9;
      for (const [lx, lz] of [[0, 0], [-b.hw, -b.hd], [b.hw, -b.hd], [-b.hw, b.hd], [b.hw, b.hd], [0, -b.hd], [0, b.hd], [-b.hw, 0], [b.hw, 0]]) { const x = b.x + lx * cs + lz * sn, z = b.z - lx * sn + lz * cs; minRd = Math.min(minRd, m.roadDistAt(x, z)); const h = T.groundY(x, z); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); }
      if (minRd < 1.0) out.bldOnRoad.push([b.type, Math.round(b.x), Math.round(b.z), +minRd.toFixed(1)]);
      if (hmax - hmin > 3.2) out.slopeBig++;
      if (b.y - hmin > 2.0) out.floatBig.push([b.type, Math.round(b.x), Math.round(b.z), +(b.y - hmin).toFixed(1)]);
    }
    out.bldOnRoad = out.bldOnRoad.slice(0, 12); out.floatBig = out.floatBig.slice(0, 12);
    return out;
  });
  console.log(JSON.stringify(r));
};
