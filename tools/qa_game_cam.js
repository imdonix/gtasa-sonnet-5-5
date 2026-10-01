// Camera screenshots in varied situations.  node tools/play.js tools/qa_game_cam.js --w 800 --h 450
const { install, boot } = require('./qa_game_lib');
module.exports = async (ctx) => {
  await install(ctx);
  await boot(ctx, {});
  await ctx.eval(() => { QA.simCam = (s, dt = 1 / 30) => { const n = Math.round(s / dt); for (let i = 0; i < n; i++) { game.sim(dt); G.camera.update(dt, dt, G.player, G.input); } }; });
  const only = (process.env.ONLY || 'fwd,bus,rev,bike,wall,alley').split(',');
  const drive = async (type, thr, secs, steer = 0, name) => {
    await ctx.eval(async (type, thr, secs, steer) => {
      QA.clear(); G.population.carTarget = 0; G.population.pedTarget = 0; G.population.gangTarget = 0;
      const st = QA.findStraight(220, null, 0.01); const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw);
      QA.tp(st.x, st.z, st.yaw); for (let i = 0; i < 10; i++) G.world.update(0.05, st.x, st.z, 30);
      const v = G.vehicles.spawn(type, st.x + fz * -2.4, st.z - fx * -2.4, st.yaw, { owner: 'player' }); G.player.enterVehicle(v, 0, true);
      G.camera.snapTo(G.player); G.camera.yaw = st.yaw;
      if (thr > 0) G.input.down.add('KeyW'); else if (thr < 0) G.input.down.add('KeyS');
      if (steer > 0) G.input.down.add('KeyA'); if (steer < 0) G.input.down.add('KeyD');
      QA.simCam(secs);
    }, type, thr, secs, steer);
    await ctx.wait(400); await ctx.shot(name);
    await ctx.eval(() => G.input.down.clear());
  };
  if (only.includes('fwd')) await drive('sedan', 1, 4, 0, 'cam_sedan_fast');
  if (only.includes('bus')) await drive('bus', 1, 6, 0, 'cam_bus');
  if (only.includes('rev')) await drive('sedan', -1, 0.1, 0, 'cam_rev0'), await drive('sedan', -1, 4, 0, 'cam_rev');
  if (only.includes('bike')) await drive('motorbike', 1, 3, 1, 'cam_bike_turn');
  if (only.includes('wall')) {
    // on foot, back against a building wall
    await ctx.eval(() => {
      const h = G.landmarks.home; QA.clear(); QA.tp(h.door.x, h.door.z, h.yaw + Math.PI); for (let i = 0; i < 10; i++) G.world.update(0.05, h.door.x, h.door.z, 30);
      // face away from the building: player yaw = house yaw (door faces +yaw dir), stand at the door
      G.player.x = h.door.x - Math.sin(h.yaw) * 0.6; G.player.z = h.door.z - Math.cos(h.yaw) * 0.6; G.player.yaw = h.yaw; G.camera.yaw = h.yaw; G.camera.snapTo(G.player); QA.simCam(1.5);
    });
    await ctx.wait(400); await ctx.shot('cam_wall');
  }
};
