// Visual-QA helpers (in-page, on top of qa_game_lib).  const {setup}=require('./qa_vis_lib'); await setup(ctx, {empty:true, at:'ganton'})
const { install, boot } = require('./qa_game_lib');
function inpage() {
  const V = window.VIS = {};
  V.spots = {};
  // a flat, road-free-ish spot near a district label/world coordinate: returns {x,z,yaw} on the nearest road centreline
  V.road = (x, z) => { const nr = G.map.nearestRoad(x, z, 200) || G.map.nearestRoad(x, z, 600); if (!nr) return null; return { x: nr.x, z: nr.z, yaw: Math.atan2(nr.tx, nr.tz) }; };
  V.district = (name) => { const d = G.map.districts.find(d => d.name.toLowerCase().includes(name.toLowerCase())); if (!d) return null; return { x: (d.cx - 512) * 2, z: (d.cy - 512) * 2, d }; };
  V.go = (x, z, yaw = 0) => { QA.tp(x, z, yaw); for (let i = 0; i < 25; i++) G.world.update(0.05, x, z, 30); };
  V.hour = (h) => { G.sky.hour = h; G.sky.dayLengthSec = 1e9; G.sky.lockWeather = true; G.sky.setWeather && G.sky.setWeather('clear'); };
  // free a camera: look from (dist, yaw deg around target, pitch deg) at target
  V.look = (x, y, z, yawDeg, pitchDeg, dist, fov = 40) => QA.orbit(x, y, z, yawDeg, pitchDeg, dist, fov);
  // standalone rig placed in the real scene (lit like the game). returns rig; call rig.update manually.
  V.rig = async (x, y, z, app, opts = {}) => {
    const M = await import('/src/models_peds.js'); const rig = new M.PedRig(app || M.randomAppearance(Math.random, {}));
    rig.group.position.set(x, y, z); rig.group.rotation.y = opts.yaw || 0; G.scene.add(rig.group); (V.rigs = V.rigs || []).push(rig); return rig;
  };
  V.clearRigs = () => { for (const r of V.rigs || []) r.dispose(); V.rigs = []; };
  V.settle = (s = 0.4) => { QA.sim(s); };
}
async function setup(ctx, opts = {}) {
  await install(ctx); await ctx.page.evaluate(inpage);
  await boot(ctx, { empty: opts.empty !== false });
  await ctx.eval(async () => { const st = document.createElement('style'); st.textContent = 'body > *:not(canvas){display:none !important}'; document.head.appendChild(st); G.player.group.visible = false; window.__Ped = (await import('/src/peds.js')).Ped; });
}
module.exports = { setup };
