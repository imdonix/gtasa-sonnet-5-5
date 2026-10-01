// Vehicle driver AI: lane following traffic, chase, flee, follow, goto.
import { G } from './state.js';
import { clamp, lerp, wrapAngle, dist2, rrange, TAU } from './util.js';
import { ROAD_SPEED, CLS, edgePointAt } from './mapdata.js';

const _p = {}, _q = {};

export class DriverAI {
  constructor(v, mode = 'traffic', opts = {}) {
    this.v = v; this.mode = mode; v.ai = this;
    this.speedFactor = opts.speedFactor ?? rrange(0.8, 1.1);
    this.agent = null; this.next = null;
    this.target = opts.target || null;          // entity with x,z (and vx,vz)
    this.dest = opts.dest || null;              // {x,z}
    this.aggressive = !!opts.aggressive;
    this.ignoreLights = !!opts.ignoreLights;
    this.timer = 0; this.stuckT = 0; this.reverseT = 0; this.revSteer = 1; this.panicT = 0;
    this.routeT = 0; this.route = null;
    this.arrived = false; this.cruise = opts.cruise ?? null; this.stopDist = opts.stopDist ?? 6;
    this.patience = 0; this.waitT = 0; this.lastSpeedOk = 0;
    this.honkT = rrange(0, 4); this.fleeFrom = null; this.leader = opts.leader || null; this.gap = opts.gap || 12;
    this.lightStop = false;
    this.parkWhenDone = opts.park ?? false;
  }
  setMode(m, o = {}) { this.ut = null; this.mode = m; Object.assign(this, o); this.arrived = false; this.route = null; this.routeT = 0; this.stuckT = 0; if (m === 'traffic') { this.agent = null; } }

  update(dt) {
    const v = this.v;
    if (!v.driver || v.wrecked) { v.input.throttle = 0; v.input.steer = 0; v.input.handbrake = true; return; }
    if (v.driver.isPlayer) return;
    if (this.panicT > 0) { this.panicT -= dt; }
    switch (this.mode) {
      case 'traffic': this.traffic(dt); break;
      case 'flee': this.flee(dt); break;
      case 'chase': this.chase(dt); break;
      case 'follow': this.follow(dt); break;
      case 'goto': this.goto(dt); break;
      case 'idle': v.input.throttle = 0; v.input.steer = 0; v.input.handbrake = true; break;
    }
    this.unstick(dt);
  }

  onHit(attacker, speed) {
    const v = this.v, d = v.driver; if (!d || d.isPlayer) return;
    if (this.mode === 'traffic' && (d.role === 'civ')) {
      if (attacker && attacker.isPlayer) {
        if (speed > 4 && Math.random() < 0.22 && !v.mission) { // road rage
          const tgt = attacker; v.input.throttle = 0; v.input.handbrake = true; d.exitVehicle(false, false); d.target = tgt; d.role = 'civ'; d.brave = true; d.give(Math.random() < 0.5 ? 'pistol' : 'bat', 30); d.setMode('fight', 25); if (d.hasGun()) { d.role = 'gang'; d.gang = 0; d.aggroT = 30; d.target = tgt; d.setMode('attack', 30); } return;
        }
        this.fleeFrom = { x: attacker.x, z: attacker.z }; this.setMode('flee'); this.panicT = rrange(9, 16);
      }
    }
  }
  onRanOver(ped) { if (this.mode === 'traffic' && Math.random() < 0.5) { this.setMode('flee'); this.fleeFrom = { x: ped.x, z: ped.z }; this.panicT = 10; } }

  // ------------------------------------------------------------------ traffic (lane following)
  ensureAgent() {
    const v = this.v, nav = G.nav;
    if (this.agent) return true;
    this.agent = nav.agentAt(v.x, v.z, v.yaw, 70);
    if (!this.agent) return false;
    this.agent.s = this.projectS(this.agent, v.x, v.z, 0);
    this.next = null;
    return true;
  }
  // travel-s (in direction of travel) of position on edge
  projectS(agent, x, z, hint) {
    const e = agent.edge; let best = 1e18, bs = 0;
    for (let i = 0; i < e.pts.length - 1; i++) {
      const a = e.pts[i], b = e.pts[i + 1]; const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1); const px = a.x + dx * t, pz = a.z + dz * t; const d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (d2 < best) { best = d2; bs = e.cum[i] + t * Math.sqrt(l2); }
    }
    return agent.dir > 0 ? bs : e.len - bs;
  }

  laneTarget(look, out) {
    const a = this.agent, nav = G.nav, e = a.edge;
    let s = a.s + look;
    if (s <= e.len) { nav.lanePoint(a, s, out); return out; }
    if (!this.next) this.next = nav.chooseNext(a);
    const n = this.next; const na = { edge: n.edge, dir: n.dir, lane: Math.min(a.lane, nav.laneCount(n.edge) - 1) };
    nav.lanePoint(na, Math.min(s - e.len, n.edge.len), out); return out;
  }

  // speed limit from road curvature ahead (uses lane points along current + next edge)
  curveLimit(desired) {
    const pts = this._cp || (this._cp = [{}, {}, {}, {}, {}]);
    const ds = [5, 13, 21, 29, 37];
    for (let i = 0; i < ds.length; i++) this.laneTarget(ds[i], pts[i]);
    let worst = 0; let prev = Math.atan2(pts[0].x - this.v.x, pts[0].z - this.v.z);
    for (let i = 1; i < pts.length; i++) {
      const h = Math.atan2(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      const dh = Math.abs(wrapAngle(h - prev)); if (dh > worst) worst = dh; prev = h;
    }
    const k = worst / 8;
    if (k < 0.004) return desired;
    const alat = this.aggressive ? 6.5 : 4.6;
    return Math.min(desired, Math.max(4.5, Math.sqrt(alat / k)));
  }

  // Dead end: cars in view make a proper K-turn (forward / reverse with opposite lock); unseen cars just flip round.
  beginUturn(a) {
    const v = this.v;
    const vis = G.population && G.population.visible(v.x, v.y, v.z, 120);
    if (!vis) { this.finishUturn(a, true); return false; }
    this.ut = { t: 0, phase: 0, pt: 0, target: wrapAngle(v.yaw + Math.PI), a };
    return true;
  }
  finishUturn(a, instant) {
    const v = this.v; a = a || (this.ut && this.ut.a) || this.agent;
    if (instant) { v.yaw += Math.PI; v.vx = v.vz = 0; }
    a.dir = -a.dir; a.s = instant ? 0.5 : this.projectS(a, v.x, v.z, 0); this.next = null; this.ut = null; v.input.throttle = 0; v.input.steer = 0;
  }
  runUturn(dt) {
    const v = this.v, u = this.ut; u.t += dt; u.pt += dt;
    const err = wrapAngle(u.target - v.yaw);
    if (Math.abs(err) < 0.4) { this.finishUturn(u.a, false); return; }
    if (u.t > 9) { this.finishUturn(u.a, true); return; }
    const s = err > 0 ? 1 : -1; v.input.handbrake = false; v.input.brake = 0;
    if (u.phase === 0) { v.input.throttle = 0.55; v.input.steer = s; if (Math.abs(err) < 1.0 || (u.pt > 1.0 && v.speed < 0.4) || u.pt > 2.4) { u.phase = 1; u.pt = 0; } }
    else { v.input.throttle = -0.6; v.input.steer = -s; if (Math.abs(err) < 1.0 || (u.pt > 0.8 && v.speed > -0.4) || u.pt > 2.2) { u.phase = 0; u.pt = 0; } }
  }

  traffic(dt) {
    const v = this.v, nav = G.nav;
    if (this.ut) { this.runUturn(dt); return; }
    if (!this.ensureAgent()) { v.input.throttle = 0; v.input.handbrake = true; return; }
    const a = this.agent, e = a.edge;
    a.s = Math.max(a.s, this.projectS(a, v.x, v.z, a.s) );
    const spd = v.speed;
    if (!this.next && a.s > e.len - 34) { this.next = nav.chooseNext(a, Math.random); }
    if (a.s >= e.len - 3.5 && this.next) {
      const n = this.next; const nodeU = n.uturn;
      if (nodeU) { // dead end: turn around when nearly stopped
        if (Math.abs(spd) < 3) { if (!this.beginUturn(a)) return; return; }
      } else { a.edge = n.edge; a.dir = n.dir; a.lane = Math.min(a.lane, nav.laneCount(n.edge) - 1); a.s = 0.5 + 0; this.next = null; a.s = this.projectS(a, v.x, v.z, 0); }
    }
    const look = clamp(6 + Math.abs(spd) * 0.55, 7, 26);
    this.laneTarget(look, _p);
    let desired = ROAD_SPEED[a.edge.cls] * this.speedFactor * (this.cruise ? this.cruise / 13 : 1);
    if (this.aggressive) desired *= 1.35;
    desired = this.curveLimit(desired);
    // slow for upcoming turn
    if (this.next && a.s > e.len - 24) { const ang = this.turnAngle(a, this.next); desired = Math.min(desired, lerp(desired, 6.5, clamp(Math.abs(ang) / 1.2, 0, 1))); }
    // dead end ahead: come to (almost) a stop at the end of the road so the U-turn can start
    if (this.next && this.next.uturn) desired = Math.min(desired, 2.2 + Math.sqrt(2 * 4 * Math.max(0, e.len - 5 - a.s)));
    // signals
    desired = this.applySignal(desired, a, e);
    this.drive(_p.x, _p.z, desired, dt);
  }
  turnAngle(a, n) {
    const e = a.edge; const p0 = a.dir > 0 ? e.pts[e.pts.length - 2] : e.pts[1], p1 = a.dir > 0 ? e.pts[e.pts.length - 1] : e.pts[0];
    const ne = n.edge; const q0 = n.dir > 0 ? ne.pts[0] : ne.pts[ne.pts.length - 1], q1 = n.dir > 0 ? ne.pts[1] : ne.pts[ne.pts.length - 2];
    return wrapAngle(Math.atan2(q1.x - q0.x, q1.z - q0.z) - Math.atan2(p1.x - p0.x, p1.z - p0.z));
  }
  applySignal(desired, a, e) {
    const nav = G.nav; if (this.ignoreLights) return desired;
    const nodeId = a.dir > 0 ? e.b : e.a; const node = G.map.nodes[nodeId];
    const remain = e.len - a.s;
    if (remain > 45 || node.deg < 3) { this.lightStop = false; return desired; }
    const sig = nav.sigByNode.get(nodeId);
    const stopAt = node.maxW / 2 + 5.0;
    const distToStop = remain - stopAt;
    if (sig) {
      const t = e.pts; const tx = a.dir > 0 ? (t[t.length - 1].x - t[t.length - 2].x) : (t[0].x - t[1].x), tz = a.dir > 0 ? (t[t.length - 1].z - t[t.length - 2].z) : (t[0].z - t[1].z);
      const axis = Math.abs(tx) > Math.abs(tz) ? 0 : 1;
      const st = nav.lightState(nodeId, axis);
      const spd = Math.max(0, this.v.speed);
      const brakeDist = spd * spd / (2 * 6.5);
      if (st === 'red' || (st === 'yellow' && distToStop > brakeDist * 0.9)) {
        if (distToStop > -1.5) { this.lightStop = true; return Math.min(desired, Math.sqrt(2 * 5 * Math.max(0, distToStop - 0.5)) + 0.0); }
      }
      this.lightStop = false;
    } else {
      // unsignalised junction: yield to vehicles already inside the junction
      this.lightStop = false;
      if (remain < 14) {
        const near = G.vehicles.hash.queryRadius(node.x, node.z, node.maxW / 2 + 2, this._qq || (this._qq = []));
        for (const o of near) { if (o === this.v || o.totalSpeed < 0.5 && false) continue; if (o === this.v) continue; if (dist2(o.x, o.z, node.x, node.z) < (node.maxW / 2 + 2) ** 2 && (o.ai && o.ai.agent && o.ai.agent.edge !== e) && this.waitT < 4) { this.waitT += 0.016; return Math.min(desired, Math.sqrt(2 * 5 * Math.max(0, distToStop)) ); } }
        if (remain < 6) this.waitT = 0;
      }
    }
    return desired;
  }

  // ------------------------------------------------------------------ primitive: drive toward point at desired speed
  drive(tx, tz, desired, dt, opts = {}) {
    const v = this.v;
    const spd = v.speed;
    const dx = tx - v.x, dz = tz - v.z;
    const angle = wrapAngle(Math.atan2(dx, dz) - v.yaw);
    desired = this.limitBySurroundings(desired, dt, opts);
    let steer = clamp(angle * (1.6 / (1 + Math.abs(spd) * 0.03)), -1, 1);
    // reversing out of stuck
    if (this.reverseT > 0) { this.reverseT -= dt; v.input.throttle = -0.8; v.input.steer = this.revSteer; v.input.handbrake = false; return; }
    // slow down when heavily misaligned
    desired = Math.min(desired, lerp(desired, 4.5, clamp((Math.abs(angle) - 0.5) / 1.2, 0, 1)));
    if (spd < desired - 0.4) { v.input.throttle = clamp((desired - spd) * 0.5, 0.2, 1); v.input.brake = 0; }
    else if (spd > desired + 1.0) { v.input.throttle = spd > 1 ? -clamp((spd - desired) * 0.25, 0.1, 1) : 0; }
    else v.input.throttle = 0.12 * (desired > 1 ? 1 : 0);
    if (desired < 0.3 && Math.abs(spd) < 1.0) { v.input.throttle = 0; v.input.handbrake = true; } else v.input.handbrake = false;
    v.input.steer = steer;
  }

  limitBySurroundings(desired, dt, opts) {
    const v = this.v; const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    const spd = Math.max(0, v.speed); const look = 6 + spd * 1.3;
    let limited = desired; let blocked = false;
    // vehicles
    const list = (this.ignoreVehiclesT > 0) ? [] : G.vehicles.hash.queryRadius(v.x + fx * look * 0.5, v.z + fz * look * 0.5, look * 0.7 + 4, this._q1 || (this._q1 = []));
    for (const o of list) {
      if (o === v || o.wrecked && false) continue;
      if (opts.ignore && o === opts.ignore) continue;
      const dx = o.x - v.x, dz = o.z - v.z; const lz = dx * fx + dz * fz; if (lz < 0 || lz > look + o.def.length) continue;
      const lx = dx * fz - dz * fx; let lim = (v.def.width + o.def.width) / 2 + (this.aggressive ? 0.2 : 0.7);
      if (!o.driver && !o.ai && !o.isPlayerDriven) lim = Math.min(lim, 1.3);   // parked cars only block when (almost) directly ahead
      if (Math.abs(lx) > lim) continue;
      const gap = lz - (v.def.length + o.def.length) / 2;
      const ofs = o.speed > 0 ? o.speed : 0;
      const d = Math.min(limited, Math.max(0, ofs + (gap - (this.aggressive ? 1.5 : 4.5)) * 0.9));
      if (d < limited) { limited = d; blocked = true; this.blockedBy = 'veh:' + o.type + ':' + (o.driver ? 'drv' : 'empty'); if (o.isPlayerDriven || o.driver && o.driver.isPlayer) this.blockedByPlayer = (this.blockedByPlayer || 0) + dt; }
    }
    // pedestrians
    if (!this.aggressive || true) {
      for (const p of G.peds.list) {
        if (p.dead || p.vehicle) continue;
        const dx = p.x - v.x, dz = p.z - v.z; if (dx * dx + dz * dz > (look + 4) ** 2) continue;
        const lz = dx * fx + dz * fz; if (lz < 0 || lz > look) continue;
        const lx = dx * fz - dz * fx; if (Math.abs(lx) > v.def.width / 2 + 1.4) continue;
        const d = Math.sqrt(2 * 7 * Math.max(0, lz - (v.def.length / 2 + 2.3)));   // stop a couple of metres short of the bumper, not of the car centre
        if (d < limited) { limited = d; blocked = true; this.blockedBy = 'ped:' + p.role + ':' + p.name; this.honk(dt, true); }
      }
    }
    // walls for non-lane driving
    if (opts.feelers) {
      const W = G.world; const L = 5 + spd * 0.7;
      const hit = (ang) => { const c = Math.cos(ang), s = Math.sin(ang); const dx = fx * c + fz * s, dz = -fx * s + fz * c; return W.raycast(v.x, v.z, v.x + dx * L, v.z + dz * L, v.y, v.y); };
      const f = hit(0);
      if (f) { limited = Math.min(limited, Math.max(3, f.t * L * 1.2)); const l = hit(0.6), r = hit(-0.6); this.steerBias = (l ? 0 : 1) - (r ? 0 : 1); if (l && r) this.steerBias = 0; } else this.steerBias = 0;
    }
    this.blocked = blocked;
    if (blocked && limited < 0.5) { this.honkT -= dt; if (this.honkT <= 0 && (this.blockedByPlayer || 0) > 2.5) { v.honk(); this.honkT = rrange(2, 4); } } else if (!blocked) this.blockedByPlayer = 0;
    return limited;
  }
  honk(dt, ped) { this.honkT -= dt; if (this.honkT <= 0) { this.v.honk(); this.honkT = rrange(1.5, 3.5); } }

  unstick(dt) {
    const v = this.v;
    if (this.ignoreVehiclesT > 0) { this.ignoreVehiclesT -= dt; }
    if (this.blocked && Math.abs(v.speed) < 0.4 && !v.driver?.isPlayer) { this.blockedStopT = (this.blockedStopT || 0) + dt; if (this.blockedStopT > 9) { this.blockedStopT = 0; this.ignoreVehiclesT = 6; v.ghost = 6; this.stuckCount = (this.stuckCount || 0) + 1; } } else this.blockedStopT = Math.max(0, (this.blockedStopT || 0) - dt);
    if (this.reverseT > 0) return;
    const wantMove = v.input.throttle > 0.15 && !v.input.handbrake;
    if (wantMove && Math.abs(v.speed) < 0.5 && !this.blocked && !this.lightStop) { this.stuckT += dt; if (this.stuckT > 2.2) { this.stuckT = 0; this.reverseT = rrange(0.9, 1.6); this.revSteer = Math.random() < 0.5 ? 1 : -1; this.stuckCount = (this.stuckCount || 0) + 1; } }
    else this.stuckT = Math.max(0, this.stuckT - dt);
  }

  // ------------------------------------------------------------------ flee (panic)
  flee(dt) {
    const v = this.v; const f = this.fleeFrom || (G.player ? { x: G.player.x, z: G.player.z } : { x: v.x - 10, z: v.z - 10 });
    let dx = v.x - f.x, dz = v.z - f.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    // prefer roads: aim for a point ahead along away-vector but snap to nearest road lane point
    const tx = v.x + dx * 40, tz = v.z + dz * 40;
    const nr = G.map.nearestRoad(tx, tz, 50);
    let gx = tx, gz = tz; if (nr) { gx = nr.x; gz = nr.z; }
    this.drive(gx, gz, 24, dt, { feelers: true });
    v.input.steer = clamp(v.input.steer + (this.steerBias || 0) * 0.7, -1, 1);
    if (this.panicT <= 0) { this.setMode('traffic'); this.agent = null; }
  }

  // ------------------------------------------------------------------ route following toward a point (A* over the road graph)
  routeStep(dt, destX, destZ, speedLimit, stopAtEnd) {
    const v = this.v, nav = G.nav;
    if (this.ut) { this.runUturn(dt); return; }
    this.routeT -= dt;
    if (!this.agent) { if (!this.ensureAgent()) { this.drive(destX, destZ, speedLimit * 0.5, dt, { feelers: true }); return; } }
    if (this.routeT <= 0 || !this.route) {
      this.routeT = 2.5;
      const a = this.agent, e = a.edge; const endNode = a.dir > 0 ? e.b : e.a;
      const dn = nav.nearestNodeTo(destX, destZ, 2);
      const r = nav.route(endNode, dn.id);
      this.route = r || []; a.route = r ? r.slice() : null; this.next = null; this.destNode = dn;
    }
    const a = this.agent, e = a.edge;
    a.s = Math.max(a.s, this.projectS(a, v.x, v.z, a.s));
    if (!this.next && a.s > e.len - 34) this.next = this.chooseRouteNext(a);
    if (a.s >= e.len - 3.5 && this.next) {
      const n = this.next; if (n.uturn) { if (Math.abs(v.speed) < 3) { this.beginUturn(a); return; } }
      else { a.edge = n.edge; a.dir = n.dir; a.lane = Math.min(a.lane, nav.laneCount(n.edge) - 1); this.next = null; a.s = this.projectS(a, v.x, v.z, 0); }
    }
    const look = clamp(7 + Math.abs(v.speed) * 0.6, 8, 30);
    this.laneTarget(look, _p);
    let desired = Math.min(speedLimit, ROAD_SPEED[a.edge.cls] * 1.6);
    desired = this.curveLimit(desired);
    if (this.next && a.s > e.len - 26) { const ang = this.turnAngle(a, this.next); desired = Math.min(desired, lerp(desired, 7, clamp(Math.abs(ang) / 1.1, 0, 1))); }
    if (this.next && this.next.uturn) desired = Math.min(desired, 2.2 + Math.sqrt(2 * 4 * Math.max(0, e.len - 5 - a.s)));
    desired = this.applySignal(desired, a, e);
    this.drive(_p.x, _p.z, desired, dt, { feelers: false });
  }
  chooseRouteNext(a) {
    const nav = G.nav; const e = a.edge;
    return nav.chooseNext(a);
  }

  // ------------------------------------------------------------------ chase
  chase(dt) {
    const v = this.v, t = this.target; if (!t) return this.traffic(dt);
    const tx = t.x, tz = t.z; const d = Math.hypot(tx - v.x, tz - v.z);
    const tvx = t.vx || 0, tvz = t.vz || 0;
    const los = d < 70 && !G.world.raycast(v.x, v.z, tx, tz, v.y + 0.8, (t.y || 0) + 0.8);
    const tSpeed = Math.hypot(tvx, tvz);
    this.ignoreLights = true;
    const pursuit = this.pursuitSpeed || 38;
    if (los && d < 60) {
      // direct pursuit with lead
      const lead = clamp(d / 30, 0, 1.2);
      const px = tx + tvx * lead * 0.6, pz = tz + tvz * lead * 0.6;
      let desired = d < this.stopDist && tSpeed < 3 ? 0 : clamp(Math.max(tSpeed * 1.1 + d * 0.5, 9), 0, pursuit);
      if (d < 12 && tSpeed > 5) desired = tSpeed + 6;
      this.drive(px, pz, desired, dt, { feelers: true, ignore: this.ramTarget ? (t.vehicle || t) : null });
      this.v.input.steer = clamp(this.v.input.steer + (this.steerBias || 0) * 0.5, -1, 1);
      this.agent = null; this.ut = null;
      this.arrivedNear = d < this.stopDist + 2 && tSpeed < 4;
    } else {
      this.routeStep(dt, tx, tz, pursuit, false);
      this.arrivedNear = false;
    }
  }

  follow(dt) {
    const v = this.v, l = this.leader; if (!l) return;
    const d = Math.hypot(l.x - v.x, l.z - v.z);
    const lspd = l.totalSpeed || 0;
    const los = d < 50 && !G.world.raycast(v.x, v.z, l.x, l.z, v.y + 0.8, l.y + 0.8);
    const desired = clamp(lspd + (d - this.gap) * 0.7, 0, 34);
    if (los) { this.drive(l.x - Math.sin(l.yaw) * 2, l.z - Math.cos(l.yaw) * 2, desired, dt, { feelers: true, ignore: l }); this.agent = null; this.ut = null; }
    else this.routeStep(dt, l.x, l.z, Math.max(desired, 14), false);
  }

  goto(dt) {
    const v = this.v, d = this.dest; if (!d) return;
    const dist = Math.hypot(d.x - v.x, d.z - v.z);
    if (dist < this.stopDist) { this.arrived = true; v.input.throttle = 0; v.input.brake = 1; v.input.handbrake = true; v.input.steer = 0; return; }
    this.arrived = false;
    const cruise = this.cruise || 18;
    if (dist < 35) { this.drive(d.x, d.z, clamp(dist * 0.5, 4, cruise), dt, { feelers: true }); v.input.steer = clamp(v.input.steer + (this.steerBias || 0) * 0.6, -1, 1); this.agent = null; this.ut = null; }
    else this.routeStep(dt, d.x, d.z, cruise, true);
  }
}
