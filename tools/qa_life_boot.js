// quick smoke: boot, free roam, sim 30 s
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, {});
  const r = await ctx.eval(() => { window.__errs = []; window.addEventListener('error', e => window.__errs.push(e.message)); QA.sim(30); return { ...QA.counts(), errs: window.__errs, scenes: G.ambient.scenes.map(s => s.kind), cost: G.ambient.cost }; });
  console.log(JSON.stringify(r));
};
