// District tour: aerial 3/4 shots of every district into contact sheets.  node tools/play.js tools/qa_world_tour.js [then python3 tools/qa_world_sheet.py sheet_tour1.png tour_]
const Q = require('./qa_world_lib.js');
module.exports = async (ctx) => {
  await Q.init(ctx, { pop: true });
  const hour = +(process.env.HOUR || 12), tag = process.env.TAG || 'tour';
  const names = ['Ganton', 'Idlewood', 'Jefferson', 'Glen Park', 'Little Mexico', 'Conference Center', 'Market', 'Rodeo', 'Temple', 'Vinewood', 'Forest Lawn Cemetery', 'Richman Golf Club', 'Del Perro', 'Las Colinas', 'East Los Santos', 'Los Flores', 'Willowfield', 'El Corona', 'Playa del Seville', 'Ocean Flats', 'Las Brisas', 'Verdant Bluffs', 'Verona Beach', 'East Hills'];
  for (const n of names) {
    const c = await ctx.eval((n) => { const c = G.world.placement.districtCentre(n); return c ? { x: c.x, z: c.z } : null; }, n);
    if (!c) { ctx.log('no district', n); continue; }
    await Q.look(ctx, c.x, c.z, { dist: 150, h: 95, bearing: 25, hour, fogFar: 2500, name: tag + '_' + n.replace(/ /g, '_'), wait: 400 });
  }
};
