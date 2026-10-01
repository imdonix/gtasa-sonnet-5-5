// Third-person game camera (on foot, aiming, vehicle chase, scope, cutscenes).
import * as THREE from 'three';
import { G } from './state.js';
import { clamp, lerp, damp, dampAngle, wrapAngle, smoothstep } from './util.js';

export class GameCamera {
  constructor(cam) {
    this.cam = cam;
    this.pos = new THREE.Vector3(0, 10, 0);
    this.yaw = 0; this.pitch = 0.25;          // yaw: heading the camera looks toward; pitch>0 looks down
    this.mode = 'foot';
    this.dist = 4.6; this.fov = 70; this.targetFov = 70;
    this.shakeAmt = 0; this.shakeT = 0; this.shakeDur = 1;
    this.lookOffYaw = 0; this.idleT = 0;
    this.cine = null;
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.pivot = new THREE.Vector3();
    this.lookBack = false;
    this.scopeZoom = 0; this.scoped = false;
    this.vehYaw = 0; this.vehDist = 7;
    this.up = new THREE.Vector3(0, 1, 0);
    this.tmp = new THREE.Vector3();
    this.lookAtPt = new THREE.Vector3();
    this.bob = 0;
  }
  shake(amt, dur = 0.4) { if (amt > this.shakeAmt * (this.shakeT / this.shakeDur)) { this.shakeAmt = amt; this.shakeT = this.shakeDur = dur; } }

  // screen-centre aim ray
  aimDir(out = new THREE.Vector3()) { out.set(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)); return out; }

  // find the world point under the crosshair
  aimPoint(shooter, out = new THREE.Vector3(), maxR = 160) {
    const d = this.aimDir(this.tmp);
    const hit = G.combat.trace(this.pos.x, this.pos.y, this.pos.z, d.x, d.y, d.z, maxR, shooter, { hitOwnVehicle: false });
    out.set(hit.x, hit.y, hit.z); out.hit = hit;
    return out;
  }

  startCine(c) { this.cine = c; c.t = 0; }
  endCine() { this.cine = null; }

  update(dt, rawDt, player, input) {
    const cam = this.cam;
    const veh = player && player.vehicle;
    // ---- mouse look
    let [mdx, mdy] = input ? input.consumeMouse() : [0, 0];
    if (this.cine) { this.updateCine(dt); return; }
    const aiming = player && player.aimMode && !veh;
    const scoped = aiming && player.weapon && player.weapon.scope;
    this.scoped = !!scoped;
    const sens = scoped ? 0.35 : aiming ? 0.75 : 1;
    const inv = G.settings.invertY ? -1 : 1;
    if (!(player && player.dead)) {
      if (veh) {
        if (Math.abs(mdx) + Math.abs(mdy) > 0.0005) { this.idleT = 0; this.lookOffYaw = clamp(this.lookOffYaw - mdx * 1.0, -2.6, 2.6); this.pitch = clamp(this.pitch + mdy * inv * 0.7, -0.2, 1.1); }
        else this.idleT += dt;
      } else { this.yaw -= mdx * sens; this.pitch = clamp(this.pitch + mdy * inv * sens, -1.2, 1.35); }
    }
    if (input && input.gpAx && veh) { /* stick handled via mouse path already */ }
    // ---- target pivot & desired placement
    let targetFov = G.settings.fov || 70;
    const p = this.pivot;
    if (!player) return;
    if (player.dead) {
      // death cam: slowly rise and orbit
      this.yaw += dt * 0.15; this.pitch = lerp(this.pitch, 0.7, dt * 0.6); this.dist = lerp(this.dist, 7, dt * 0.5);
      p.set(player.x, player.y + 0.6, player.z);
      this.place(p, this.dist, 0, dt, 12);
    } else if (veh) {
      const v = veh;
      const spd = v.totalSpeed;
      const fwdSpeed = v.speed;
      const velYaw = spd > 4 && fwdSpeed > 1 ? Math.atan2(v.vx, v.vz) : v.yaw;
      let baseYaw = fwdSpeed < -2 ? v.yaw + Math.PI * 0.0 : dampYawBlend(v.yaw, velYaw, 0.35);
      if (this.lookBack) baseYaw += Math.PI;
      if (this.idleT > 1.6) this.lookOffYaw = damp(this.lookOffYaw, 0, 2.2, dt);
      const targetYaw = baseYaw + this.lookOffYaw;
      this.yaw = dampAngle(this.yaw, targetYaw, this.lookOffYaw === 0 || this.idleT > 0.2 ? 4.2 : 12, dt);
      const wantPitch = 0.2 + (v.isBike ? 0.05 : 0) - clamp(v.speedKmh / 500, 0, 0.1) ;
      if (this.idleT > 1.6) this.pitch = damp(this.pitch, wantPitch, 2.5, dt);
      const len = v.def.length;
      const baseDist = len * 0.55 + 3.6 + (v.def.height > 2 ? 1.5 : 0);
      this.dist = damp(this.dist, baseDist + clamp(spd * 0.06, 0, 3.2), 2.5, dt);
      p.set(v.x, v.y - v.def.wheelRadius + v.def.height * 0.75 + 0.35, v.z);
      targetFov = (G.settings.fov || 70) + clamp(spd * 0.35, 0, 16);
      this.place(p, this.dist, 0, dt, 14);
    } else if (aiming) {
      const right = 0.9; const d = scoped ? 0.0 : 2.7;
      p.set(player.x, player.y + 1.52 * player.scale, player.z);
      if (scoped) { targetFov = 14 - this.scopeZoom * 6; this.pos.set(player.x, player.y + 1.6 * player.scale, player.z); this.updateCamObj(dt); return; }
      targetFov = 56;
      this.place(p, d, right, dt, 22);
      this.dist = d;
    } else {
      const sprint = player.speedTarget > 5 && player.grounded;
      const d = 4.1 + (sprint ? 0.5 : 0);
      this.dist = damp(this.dist, d, 4, dt);
      p.set(player.x, player.y + 1.45 * player.scale + (player.crouch ? -0.4 : 0), player.z);
      this.place(p, this.dist, 0.3, dt, 12);
      targetFov = (G.settings.fov || 70) + (sprint ? 4 : 0);
    }
    this.targetFov = targetFov;
    this.updateCamObj(rawDt);
  }

  // place camera orbiting pivot at distance dist with lateral shoulder offset; collision-safe
  place(p, dist, shoulder, dt, lambda) {
    const f = this.aimDir(this.tmp);
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw); // right vector
    const px = p.x + rx * shoulder, pz = p.z + rz * shoulder;
    let dx = px - f.x * dist, dy = p.y - f.y * dist, dz = pz - f.z * dist;
    // collision: three rays (centre + lateral +-0.28 m, a cheap "fat ray") from the pivot to the desired position
    let tmin = 2;
    for (const o of [0, 0.17, -0.17]) {
      const ox = rx * o, oz = rz * o;
      const hit = G.world.raycast(p.x + ox, p.z + oz, dx + ox, dz + oz, p.y, dy);
      if (hit && hit.t < tmin) tmin = hit.t;
    }
    const hitAny = tmin < 2;
    if (hitAny) {
      const tt = Math.max(0.1, tmin - 0.07);
      dx = p.x + (dx - p.x) * tt; dy = p.y + (dy - p.y) * tt; dz = p.z + (dz - p.z) * tt;
    }
    const gy = Math.max(G.world.groundY(dx, dz), 0.05) + 0.45; if (dy < gy) dy = gy;   // never below the sea surface either
    // smooth (snap quickly while something is in the way so the view never sweeps through a wall)
    const k = 1 - Math.exp(-(hitAny ? Math.max(lambda, 34) : lambda) * dt);
    this.pos.x += (dx - this.pos.x) * k; this.pos.y += (dy - this.pos.y) * k; this.pos.z += (dz - this.pos.z) * k;
    // never inside the pivot if it snapped: hard clamp if distance exploded
    const dd = Math.hypot(this.pos.x - p.x, this.pos.z - p.z);
    if (dd > dist + 6) { this.pos.set(dx, dy, dz); }
    // final safety: push the camera out of any collider it still overlaps (tall enough to matter)
    const cp = this._cp || (this._cp = { x: 0, z: 0 }), co = this._co || (this._co = {});
    cp.x = this.pos.x; cp.z = this.pos.z;
    if (G.world.pushCircle(cp, 0.3, co) && co.c) {
      const top = G.world.groundY(co.c.x, co.c.z) + (co.c.h ?? 3);
      if (this.pos.y < top + 0.05) { this.pos.x = cp.x; this.pos.z = cp.z; }
    }
    this.lookAtPt.set(p.x + rx * shoulder, p.y, p.z + rz * shoulder);
  }

  updateCamObj(dt) {
    const cam = this.cam;
    this.fov = damp(this.fov, this.targetFov, 6, dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    let sx = 0, sy = 0, sz = 0;
    if (this.shakeT > 0) { this.shakeT -= dt; const a = this.shakeAmt * clamp(this.shakeT / this.shakeDur, 0, 1); sx = (Math.random() - 0.5) * a * 0.6; sy = (Math.random() - 0.5) * a * 0.6; sz = (Math.random() - 0.5) * a * 0.6; }
    cam.position.set(this.pos.x + sx, this.pos.y + sy, this.pos.z + sz);
    const f = this.aimDir(this.tmp);
    // look direction is yaw/pitch (keeps crosshair consistent)
    cam.up.set(0, 1, 0);
    cam.lookAt(cam.position.x + f.x, cam.position.y + f.y, cam.position.z + f.z);
    this.fwd.copy(f);
    cam.updateMatrixWorld();
  }

  // advances cutscene time with the simulation (independent of render rate)
  cineTick(dt) {
    const c = this.cine; if (!c) return; c.t += dt;
    if (c.t >= c.total) { c.t = c.total; if (!c.ended) { c.ended = true; if (c.onEnd) c.onEnd(); } }   // holds the last shot until the mission ends the cutscene
  }
  updateCine(dt) {
    const c = this.cine;
    const shots = c.shots; let acc = 0, shot = shots[shots.length - 1], lt = 1;
    for (const s of shots) { if (c.t < acc + s.dur) { shot = s; lt = (c.t - acc) / s.dur; break; } acc += s.dur; }
    const e = lt * lt * (3 - 2 * lt);
    const from = shot.from, to = shot.to || shot.from;
    const a = shot.ease === false ? lt : e;
    this.pos.set(lerp(from.x, to.x, a), lerp(from.y, to.y, a), lerp(from.z, to.z, a));
    const lf = shot.look, lt2 = shot.lookTo || shot.look;
    let lx = lerp(lf.x, lt2.x, a), ly = lerp(lf.y, lt2.y, a), lz = lerp(lf.z, lt2.z, a);
    if (shot.follow) { lx = shot.follow.x; ly = shot.follow.y + 1.4; lz = shot.follow.z; }
    const cam = this.cam; cam.position.copy(this.pos); cam.lookAt(lx, ly, lz);
    const fov = shot.fov || 55; if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); this.fov = fov; this.targetFov = fov; }
    // keep yaw/pitch consistent for when control returns
    const dx = lx - this.pos.x, dy = ly - this.pos.y, dz = lz - this.pos.z; this.yaw = Math.atan2(dx, dz); this.pitch = -Math.atan2(dy, Math.hypot(dx, dz));
    cam.updateMatrixWorld();
  }
  snapTo(player) { // place camera behind player immediately
    if (!player) return; this.yaw = player.yaw; this.pitch = 0.25;
    const f = this.aimDir(this.tmp); this.pos.set(player.x - f.x * 4, player.y + 1.45 + 1.0, player.z - f.z * 4); this.dist = 4.1; this.cine = null;
  }
}
function dampYawBlend(a, b, t) { return a + wrapAngle(b - a) * t; }
