// Night / weather shots: node tools/play.js tools/qa_world_night.js
const Q = require('./qa_world_lib.js');
module.exports = async (ctx) => {
  await Q.init(ctx);
  await Q.street(ctx, 0, -10, 0.8, { h: 2, hour: 22, name: 'n_downtown' });
  await Q.street(ctx, 556, 210, 0.3, { h: 2.5, hour: 22, name: 'n_ganton' });
  await Q.look(ctx, 0, -60, { dist: 200, h: 120, bearing: 30, hour: 22, fogFar: 2500, name: 'n_aerial_downtown' });
  await Q.street(ctx, 556, 210, 0.3, { h: 2.5, hour: 17.7, name: 'n_dusk' });
  await Q.street(ctx, 556, 210, 0.3, { h: 2.5, hour: 6.0, name: 'n_dawn' });
  await Q.street(ctx, 0, -10, 0.8, { h: 2, hour: 14, weather: 'rain', name: 'w_rain' });
  await Q.street(ctx, 0, -10, 0.8, { h: 2, hour: 14, weather: 'smog', name: 'w_smog' });
};
