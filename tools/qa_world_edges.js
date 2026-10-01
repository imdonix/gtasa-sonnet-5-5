// Map-edge audit: street-level shots at the world border looking outwards.  node tools/play.js tools/qa_world_edges.js
const Q = require('./qa_world_lib.js');
module.exports = async (ctx) => {
  await Q.init(ctx, { pop: false });
  const E = [['e', 1000, 0, Math.PI / 2], ['n', 0, -1000, Math.PI], ['s', 0, 1000, 0], ['w', -1000, 0, -Math.PI / 2], ['se', 990, 990, 0.8], ['nw', -990, -990, 3.9], ['ne', 990, -990, 2.4], ['sw', -990, 990, -0.8], ['e2', 1000, 500, Math.PI / 2], ['w2', -1000, -500, -Math.PI / 2], ['n2', -500, -1000, Math.PI], ['s2', -500, 1000, 0]];
  for (const [n, x, z, yaw] of E) await Q.street(ctx, x, z, yaw, { h: 3, hour: 12, pitch: 0.3, name: 'edge_' + n });
};
