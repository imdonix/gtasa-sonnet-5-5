// Helpers for world QA. usage in steps.js:  const Q = require('./qa_world_lib.js'); await Q.init(ctx); await Q.fly(ctx, {x,y,z}, {x,y,z}, {name, hour, weather});
module.exports = {
  async init(ctx, opts = {}) {
    await ctx.eval(() => { game.startGame(false); });
    await ctx.wait(3500);   // tutorial mission m01 auto-starts ~1s after startGame; abort only after it began
    await ctx.eval((o) => {
      if (G.missions) G.missions.abortAll(); G.camera.endCine(); G.hud.setCinematic(false); G.hud.fade(0, 1); game.inCutscene = false; G.player.controlEnabled = false;
      G.player.invincible = true; G.police.noWanted = true;
      G.sky.lockWeather = true; G.population.enabled = o.pop !== false;
      if (o.noHud !== false) { G.hud.root.style.display = 'none'; }
      window.__fc = null;
      const orig = game.renderFrame.bind(game);
      game.renderFrame = function (dt) {
        const f = window.__fc;
        if (f) { G.cam.position.set(f.x, f.y, f.z); G.cam.lookAt(f.tx, f.ty, f.tz); G.cam.fov = f.fov || 65; G.cam.updateProjectionMatrix(); G.cam.updateMatrixWorld(); if (f.fogFar) { G.scene.fog.far = f.fogFar; G.scene.fog.near = f.fogNear ?? G.scene.fog.near; } }
        this.renderer.render(G.scene, G.cam);
      };
    }, opts);
  },
  // place camera at p looking at t; focus streaming at focus (default camera xz)
  async fly(ctx, p, t, o = {}) {
    await ctx.eval((p, t, o) => {
      const fx = o.focus ? o.focus.x : p.x, fz = o.focus ? o.focus.z : p.z;
      game.teleport(fx, fz, 0); G.player.group.visible = false;
      if (o.hour !== undefined) G.sky.hour = o.hour;
      if (o.weather) { G.sky.setWeather(o.weather); G.sky.cover = G.sky.coverTarget; G.sky.rain = G.sky.rainTarget; G.sky.grey = G.sky.greyTarget; G.sky.hazeCur = G.sky.haze; if (G.world.wetU) G.world.wetU.value = G.sky.rain; }
      G.sky.timeScale = 0; G.sky.dayLengthSec = 1e9;
      const R = G.world.loadRadius; if (o.radius) G.world.loadRadius = o.radius;
      for (let i = 0; i < 600 && (i < 2 || G.world.pendingJobs() || [...G.world.chunks.values()].some(c => c.repaint)); i++) G.world.update(0, fx, fz, 50);
      window.__fc = { x: p.x, y: p.y, z: p.z, tx: t.x, ty: t.y, tz: t.z, fov: o.fov, fogFar: o.fogFar, fogNear: o.fogNear };
      G.sky.update(0.01, G.cam, { x: fx, y: 0, z: fz }); G.world.setNight(G.sky.dark);
      if (G.lights) { G.cam.position.set(p.x, p.y, p.z); G.lights.lampTimer = 0; G.lights.timer = 0; G.lights.update(0.5); }
    }, p, t, o);
    await ctx.wait(o.wait || 700);
    if (o.name) await ctx.shot(o.name);
  },
  // look at x,z from given height & distance & bearing (deg, 0 = camera south of target looking north)
  async look(ctx, x, z, o = {}) {
    const d = o.dist ?? 60, h = o.h ?? 40, b = (o.bearing ?? 0) * Math.PI / 180;
    const gy = await ctx.eval((x, z) => G.world.groundY(x, z), x, z);
    const ty = gy + (o.ty ?? 2);
    return this.fly(ctx, { x: x + Math.sin(b) * d, y: gy + h, z: z + Math.cos(b) * d }, { x, y: ty, z }, o);
  },
  // street-level: stand at x,z facing yaw
  async street(ctx, x, z, yaw, o = {}) {
    const gy = await ctx.eval((x, z) => G.world.groundY(x, z), x, z);
    const h = o.h ?? 1.8; const fx = Math.sin(yaw), fz = Math.cos(yaw);
    return this.fly(ctx, { x, y: gy + h, z }, { x: x + fx * 30, y: gy + h - (o.pitch ?? 0.5), z: z + fz * 30 }, o);
  }
};
