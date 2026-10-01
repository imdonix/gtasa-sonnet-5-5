// World perf audit: node tools/play.js tools/qa_world_perf.js   -> visible triangles per category + draw calls at several spots.
const Q = require('./qa_world_lib.js');
module.exports = async (ctx) => {
  await Q.init(ctx, { pop: false });
  const spots = [['downtown', 0, -60, 1.2], ['ganton', 560, 206, 0.3], ['vhills', 268, -760, 3.14], ['airport', 400, 700, 0], ['docks', 860, 800, 3.14], ['beach', -440, 250, 1.5], ['industrial', 150, 500, 0.5], ['rich', -560, -700, 0.5]];
  for (const [n, x, z, yaw] of spots) {
    await Q.street(ctx, x, z, yaw, { h: 2, hour: 12 });
    const r = await ctx.eval(async () => {
      const THREE = await import('three');
      const R = G.renderer; R.info.autoReset = false; R.info.reset(); game.renderFrame(0.016); const i = R.info;
      const fr = new THREE.Frustum(), m = new THREE.Matrix4(); G.cam.updateMatrixWorld(); m.multiplyMatrices(G.cam.projectionMatrix, G.cam.matrixWorldInverse); fr.setFromProjectionMatrix(m);
      const cat = { terrain: 0, buildings: 0, props: 0, propsFar: 0 };
      for (const ch of G.world.chunks.values()) for (const k of Object.keys(cat)) { const arr = [].concat(ch[k] || [], k === 'buildings' ? (ch.extra || []) : []); for (const mesh of arr) { if (!mesh.visible || !fr.intersectsObject(mesh)) continue; cat[k] += (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3; } }
      for (const k in cat) cat[k] = Math.round(cat[k] / 1000) + 'k';
      return { tris: Math.round(i.render.triangles / 1000) + 'k', calls: i.render.calls, geos: i.memory.geometries, tex: i.memory.textures, chunks: G.world.chunks.size, cat };
    });
    console.log(n, JSON.stringify(r));
  }
};
