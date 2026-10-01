// Ambient pedestrian activities ("life"): a ped with p.life = {type,...} is driven from here instead of the normal civ/gang/cop brain.
// Activities: stand (idle|phone|dance|crouch, optional facing), sit (frozen on a bench / chair), goto (+ chained next), route (waypoints),
// follow (couples / groups), jog, drunk, swim, photo.  Any damage / fear / setMode() ends the activity (see Ped.setMode / Ped.damage).
import { G } from './state.js';
import { clamp, dist2, rrange, dampAngle, pick, TAU } from './util.js';
import { walkPath, trackStuck, avoidTraffic } from './peds.js';

export function endLife(p, toMode = 'walk') {
  const L = p.life; if (!L) return;
  p.life = null;
  if (L.cleanup) L.cleanup(p);
  p.crouch = false; p.aiming = false; p.faceOverride = null; p.phoneT = 0;
  if (p.mode === 'dance' || p.mode === 'cower') p.mode = 'walk';
  if (toMode) { p.setMode(toMode, 0); p.path = null; }
}

// frozen activities (sitting): the ped is placed by hand, no physics
export function lifeStatic(p, dt) {
  const L = p.life;
  p.vx = p.vz = 0; p.x = L.x; p.z = L.z; p.y = L.y; p.yaw = L.yaw;
  p.rig.setState(L.state || 'sit');
  p.rig.update(dt, { speed: 0 });
  p.group.position.set(p.x, p.y, p.z); p.group.rotation.y = p.yaw;
  if (L.gesture && (L.gT = (L.gT || rrange(3, 8)) - dt) <= 0) { L.gT = rrange(4, 10); p.rig.playAction('wave'); }
}

function chatter(p, L, dt) {
  if (L.gesture && (L.gT = (L.gT === undefined ? rrange(2, 5) : L.gT) - dt) <= 0) { L.gT = rrange(4, 9); p.rig.playAction('wave'); }
  if (L.say && (L.sT = (L.sT === undefined ? rrange(4, 14) : L.sT) - dt) <= 0) { L.sT = rrange(10, 25); G.ambient && G.ambient.say(p, pick(L.say), 2.4, true); }
}
function still(p) { p.move.x = p.move.z = 0; p.speedTarget = 0; }
function faceTo(p, tx, tz) { p.faceOverride = Math.atan2(tx - p.x, tz - p.z); }

function next(p, L) { if (L.onEnd) { L.onEnd(p); if (p.life !== L) return; } if (L.next) { p.life = L.next; p.life.t = p.life.t ?? 10; p.crouch = false; p.aiming = false; if (p.mode === 'dance') p.mode = 'walk'; if (L.cleanup) L.cleanup(p); } else endLife(p); }

export function lifeBrain(p, dt) {
  const L = p.life; if (!L) return false;
  const cop = p.role === 'cop' || p.role === 'swat';
  if (p.mission || p.role === 'script' || p.role === 'ally' || p.role === 'enemy' || (cop && G.police && G.police.stars > 0) || (p.role === 'gang' && p.aggroT > 0)) { endLife(p); return false; }
  if (p.role === 'gang' && G.player && !G.player.dead && p.isHostileTo(G.player) && dist2(p.x, p.z, G.player.x, G.player.z) < 40 * 40) { endLife(p); return false; }
  if (p.role === 'gang' && p.gang === 1 && (L.ally = (L.ally === undefined ? rrange(0, 0.5) : L.ally) - dt) <= 0) {   // Emerald Row homies drop everything when a fight starts near them
    L.ally = 0.5;
    for (const q of G.peds.list) { if (q.dead || q === p || q.isPlayer) continue; if (!(q.hostile || q.role === 'enemy' || (q.role === 'gang' && q.gang !== p.gang && q.aggroT > 0))) continue; if (dist2(q.x, q.z, p.x, p.z) < 38 * 38) { endLife(p); return false; } }
  }
  if (L.t !== undefined) { L.t -= dt; }
  switch (L.type) {
    case 'sit': {
      if (L.t <= 0) { L.frozen = false; p.y = L.y; endLife(p); return false; }
      still(p); return true;
    }
    case 'stand': {
      still(p);
      if (L.face) faceTo(p, L.face.x, L.face.z); else if (L.yaw !== undefined) p.faceOverride = L.yaw;
      if (L.state === 'phone') { p.phoneT = 1; if (!L.rung) { L.rung = 1; if (Math.random() < 0.15 && G.audio) G.audio.play('phone_ring', { pos: p, volume: 0.22, pitch: 1.0 + Math.random() * 0.3 }); } }
      else if (L.state === 'dance') { p.mode = 'dance'; if (!L.danced) { L.danced = true; p.rig.setDanceMove && p.rig.setDanceMove((p.id % 5)); } }
      else if (L.state === 'crouch') p.crouch = true;
      else if (L.state === 'cower') p.mode = 'cower';
      if (L.partner) {   // chatting: a gesture now and then, stop if the partner is gone
        const q = L.partner; if (q.dead || !q.life || q.life.partner !== p) { endLife(p); return false; }
        faceTo(p, q.x, q.z);
        if ((L.gT = (L.gT === undefined ? rrange(2, 6) : L.gT) - dt) <= 0) { L.gT = rrange(3, 8); p.rig.playAction(Math.random() < 0.7 ? 'wave' : 'hit'); }
      }
      if (L.photo) {
        p.aiming = true; p.aimPitch = L.aimPitch || 0.2;
        if ((L.fT = (L.fT === undefined ? rrange(2, 5) : L.fT) - dt) <= 0) { L.fT = rrange(3, 7); G.fx && G.fx.flash(p.x + Math.sin(p.yaw) * 0.6, p.y + 1.5, p.z + Math.cos(p.yaw) * 0.6, 2.5, 0.08, 0xffffff, 8); G.audio && G.audio.play('ding', { pos: p, volume: 0.15, pitch: 2.2 }); }
      }
      chatter(p, L, dt);
      if (L.t <= 0) next(p, L);
      return true;
    }
    case 'goto': {
      const dx = L.x - p.x, dz = L.z - p.z, d = Math.hypot(dx, dz);
      if (d < (L.radius || 1.1) || L.t <= 0 && !L.vanish) {
        if (L.onArrive && d < 3) L.onArrive(p, L);
        if (L.vanish && d < 3) { p.removeMe = true; p.group.visible = false; return true; }
        if (p.life === L) { still(p); next(p, L); }
        return true;
      }
      if (L.t <= -20) { p.removeMe = !!L.vanish; if (L.vanish) p.group.visible = false; else endLife(p); return true; }
      let mx = dx / d, mz = dz / d;
      if (p.unstuckT > 0) { const a = Math.atan2(mx, mz) + p.unstuckDir; mx = Math.sin(a); mz = Math.cos(a); p.unstuckT -= dt; }
      if (avoidTraffic(p)) { still(p); return true; }
      p.move.x = mx; p.move.z = mz; p.speedTarget = L.speed || 1.4; trackStuck(p, dt);
      return true;
    }
    case 'route': {   // loop through waypoints [{x,z,wait,state,face}]
      chatter(p, L, dt);
      const w = L.pts[L.i % L.pts.length];
      const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
      if (d < 1.0) {
        L.wt = (L.wt === undefined ? (w.wait ?? 5) * rrange(0.6, 1.4) : L.wt) - dt;
        still(p); if (w.face) faceTo(p, w.face.x, w.face.z);
        if (w.state === 'phone') p.phoneT = 1; else if (w.state === 'crouch') p.crouch = true; else p.crouch = false;
        if (L.wt <= 0) { L.wt = undefined; L.i++; p.crouch = false; }
        return true;
      }
      let mx = dx / d, mz = dz / d;
      if (p.unstuckT > 0) { const a = Math.atan2(mx, mz) + p.unstuckDir; mx = Math.sin(a); mz = Math.cos(a); p.unstuckT -= dt; }
      if (avoidTraffic(p)) { still(p); return true; }
      p.move.x = mx; p.move.z = mz; p.speedTarget = L.speed || 1.3; trackStuck(p, dt);
      if (L.t !== undefined && L.t <= 0) endLife(p);
      return true;
    }
    case 'follow': {
      const q = L.leader; if (!q || q.dead || q.removeMe) { endLife(p); return false; }
      if (L.t <= 0) { endLife(p); return false; }
      // target: beside the leader (leader's right-hand side), slightly behind
      const fx = Math.sin(q.yaw), fz = Math.cos(q.yaw);
      const tx = q.x - fz * (L.side ?? 0.85) - fx * 0.2, tz = q.z + fx * (L.side ?? 0.85) - fz * 0.2;
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz) || 1;
      const qs = Math.hypot(q.vx, q.vz);
      if (d < 0.35 && qs < 0.3) { still(p); faceTo(p, q.x + fx, q.z + fz); return true; }
      p.move.x = dx / d; p.move.z = dz / d; p.speedTarget = clamp(qs + d * 1.4, 0, 5.2); trackStuck(p, dt);
      if (d > 40) { p.x = tx; p.z = tz; }
      return true;
    }
    case 'jog': {
      if (L.t <= 0) { endLife(p); return false; }
      p.aiming = false;
      if (avoidTraffic(p)) { still(p); return true; }
      walkPath(p, dt, L.speed || 2.95); trackStuck(p, dt, true);
      return true;
    }
    case 'drunk': {
      if (L.t <= 0) { endLife(p); return false; }
      L.ph = (L.ph || Math.random() * 6) + dt;
      if (L.pause > 0) { L.pause -= dt; still(p); if (L.pause <= 0 && Math.random() < 0.4) L.pause = 0; return true; }
      if (avoidTraffic(p)) { still(p); return true; }
      walkPath(p, dt, 0.95); trackStuck(p, dt, true);
      const a = Math.sin(L.ph * 1.7) * 0.9 + Math.sin(L.ph * 0.6) * 0.5, c = Math.cos(a), s = Math.sin(a);
      const mx = p.move.x * c + p.move.z * s, mz = -p.move.x * s + p.move.z * c; p.move.x = mx; p.move.z = mz;
      p.speedTarget *= 0.55 + 0.45 * Math.abs(Math.sin(L.ph * 0.9));
      if (Math.random() < dt * 0.05) { L.pause = rrange(1.5, 4); G.ambient && G.ambient.say(p, pick(['Woooo!', '*hic*', 'Another round!', 'I love you guys...']), 2.4, true); }
      return true;
    }
    case 'swim': {
      if (!L.tx || L.wT <= 0 || Math.hypot(L.tx - p.x, L.tz - p.z) < 1) {
        L.wT = rrange(4, 9);
        for (let k = 0; k < 6; k++) {
          const a = Math.random() * TAU, r = Math.random() * L.r, x = L.cx + Math.cos(a) * r, z = L.cz + Math.sin(a) * r;
          const gy = G.world.groundY(x, z); if (gy < -0.9 && gy > -3.2) { L.tx = x; L.tz = z; break; }
        }
        if (!L.tx) { L.tx = L.cx; L.tz = L.cz; }
      }
      L.wT -= dt;
      const dx = L.tx - p.x, dz = L.tz - p.z, d = Math.hypot(dx, dz) || 1;
      p.move.x = dx / d; p.move.z = dz / d; p.speedTarget = 1.25;
      if (L.t !== undefined && L.t <= 0) endLife(p);
      return true;
    }
    default: endLife(p); return false;
  }
}
