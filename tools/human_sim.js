// Human simulator injected into the game page by tools/qa_legit.js.  No cheats: it only presses keys / mouse buttons,
// turns the camera, and lets a DriverAI "shadow" produce steering for the player's own vehicle (translated to gamepad axes).
// window.HUM.brain(dt) is called before every game.sim() step.
(async () => {
  const { DriverAI } = await import('/src/driverai.js');
  const { WEAPONS, WEAPON_ORDER } = await import('/src/weapons.js');
  const H = window.HUM = { on: true, fast: true, stats: {}, notes: [], skill: 1, cruise: 30 };
  const I = G.input; I.pollGamepad = () => { };
  const NOIN = { consumeMouse: () => [0, 0] };
  const d2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;
  const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  let ai = null, aiVeh = null;
  let stuckT = 0, lastX = 0, lastZ = 0, unstickT = 0, unstickDir = 1, strafeT = 0, strafeDir = 1, clickT = 0, fKey = 0, seenT = 0, idleT = 0;
  const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space', 'KeyC'];
  function release() { for (const k of KEYS) I.down.delete(k); I.buttons.delete(0); I.buttons.delete(2); I.gpAx = null; }
  H.release = release;
  H.resetAI = () => { if (ai && aiVeh && aiVeh.ai === ai) aiVeh.ai = null; ai = null; aiVeh = null; };

  const pl = () => G.player;
  const isEnemy = p => !p.dead && !p.isPlayer && (p.hostile || p.role === 'enemy') && p.role !== 'ally' && !p.removeMe;
  function hasLOS(a, b) { return !G.world.raycast(a.x, a.z, b.x, b.z, (a.y || 0) + 1.4, (b.y || 0) + 1.2); }

  function bestWeapon(dist) {
    const p = pl(); const have = id => p.weapons[id] && (WEAPONS[id].melee || p.totalAmmo(id) > 0);
    const pref = dist > 70 ? ['sniper', 'ak47', 'smg', 'pistol'] : dist > 25 ? ['ak47', 'smg', 'pistol', 'shotgun', 'deagle'] : ['ak47', 'shotgun', 'smg', 'deagle', 'pistol'];
    if (p.vehicle) { for (const id of ['smg', 'pistol', 'deagle']) if (have(id)) return id; return null; }
    for (const id of pref) if (have(id)) return id;
    if (have('bat')) return 'bat';
    return 'fist';
  }

  // ------------------------------------------------------------------ driving (shadow AI -> gamepad axes)
  function driveTo(v, x, z, o = {}) {
    const p = pl();
    if (!ai || aiVeh !== v || ai.mode !== 'goto') { H.resetAI(); ai = new DriverAI(v, 'goto', { dest: { x, z }, cruise: o.cruise ?? H.cruise, aggressive: false, ignoreLights: o.ignoreLights ?? true, stopDist: o.stopDist ?? 3 }); aiVeh = v; }
    ai.dest = { x, z }; ai.cruise = o.cruise ?? H.cruise; ai.stopDist = o.stopDist ?? 3;
    const d = v.driver; if (d !== p) return false;
    p.isPlayer = false; try { ai.update(1 / 30); } finally { p.isPlayer = true; }
    const t = v.input.throttle, brake = v.input.brake || 0;
    I.gpAx = { lx: -v.input.steer, ly: 0, rx: 0, ry: 0, lt: t < 0 ? -t : (brake > 0.5 && t <= 0 ? 1 : 0), rt: t > 0 ? t : 0 };
    if (v.input.handbrake) I.down.add('Space'); else I.down.delete('Space');
    return ai.arrived;
  }

  // ------------------------------------------------------------------ on foot
  let steerMemT = 0, steerMem = 0;
  function clearRay(p, yaw, len) { const ex = p.x + Math.sin(yaw) * len, ez = p.z + Math.cos(yaw) * len; return !G.world.raycast(p.x, p.z, ex, ez, p.y + 0.6, p.y + 0.6) && !G.world.raycast(p.x, p.z, ex, ez, p.y + 1.2, p.y + 1.2); }
  // look-ahead steering: best free direction toward the goal (a human walks around walls)
  function steerYaw(p, gx, gz) {
    const want = Math.atan2(gx - p.x, gz - p.z); const dist = Math.hypot(gx - p.x, gz - p.z);
    const len = Math.min(7, Math.max(2.5, dist));
    if (clearRay(p, want, len)) { if (steerMemT <= 0) return want; }
    steerMemT -= 1 / 30;
    const offs = [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.9, -1.9, 2.5, -2.5];
    if (steerMemT > 0) { const y = want + steerMem; if (clearRay(p, y, 4)) return y; }
    const order = steerMem > 0 ? offs.slice().sort((a, b) => (Math.sign(b) === Math.sign(steerMem) ? 1 : 0) - (Math.sign(a) === Math.sign(steerMem) ? 1 : 0) || Math.abs(a) - Math.abs(b)) : offs;
    for (const o of order) if (clearRay(p, want + o, 5)) { steerMem = o; steerMemT = 1.2; return want + o; }
    steerMemT = 0.5; return want + 2.8;
  }
  function walkTo(x, z, o = {}) {
    const p = pl(); const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    let yaw = steerYaw(p, x, z);
    if (unstickT > 0) { yaw += unstickDir * 1.3; unstickT -= 1 / 30; }
    G.camera.yaw = yaw; G.camera.pitch = 0.25;
    I.down.add('KeyW'); I.down.delete('KeyS'); I.down.delete('KeyA'); I.down.delete('KeyD');
    if (d > 12 && !o.noSprint) I.down.add('ShiftLeft'); else I.down.delete('ShiftLeft');
    stuckT += 1 / 30; if (stuckT > 1.2) { const mv = Math.hypot(p.x - lastX, p.z - lastZ); if (mv < 1.0) { unstickT = 0.9; unstickDir = Math.random() < 0.5 ? 1 : -1; } lastX = p.x; lastZ = p.z; stuckT = 0; }
    return d;
  }

  // ------------------------------------------------------------------ combat
  function aimAt(t, extra = {}) {
    const p = pl(); const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz) || 1;
    const yaw = Math.atan2(dx, dz); G.camera.yaw = yaw;
    // camera sits ~3 m behind + 1.5 m above; crosshair must pass through the target chest
    const cy = p.y + 1.7, ty = (t.y || 0) + 1.35; const cd = d + 3;
    G.camera.pitch = -Math.atan2(ty - cy, cd);
    return d;
  }
  function shoot(semi) {
    const p = pl(); I.buttons.add(2); I.buttons.add(0);
    if (semi) { clickT -= 1 / 30; if (clickT <= 0) { I.btnPressed.add(0); clickT = 0.18 + Math.random() * 0.12; } }
  }
  function fightOnFoot(p, tgt, enemies) {
    const dx = tgt.x - p.x, dz = tgt.z - p.z; const d = aimAt(tgt);
    const los = hasLOS(p, tgt);
    const wid = bestWeapon(d); if (wid && p.weaponId !== wid) { p.equip(wid); G.hud.weaponChanged(); }
    const W = p.weapon;
    strafeT -= 1 / 30; if (strafeT <= 0) { strafeT = 0.8 + Math.random() * 1.6; strafeDir = Math.random() < 0.5 ? 1 : -1; }
    const pref = W.melee ? 1.2 : W.id === 'sniper' ? 70 : W.kind === 'long' ? 20 : 13;
    I.down.delete('KeyW'); I.down.delete('KeyS'); I.down.delete('KeyA'); I.down.delete('KeyD'); I.down.delete('ShiftLeft');
    if (W.melee) {
      G.camera.yaw = Math.atan2(dx, dz); I.down.add('KeyW'); if (d > 10) I.down.add('ShiftLeft');
      if (d < 2.4) { I.buttons.add(0); clickT -= 1 / 30; if (clickT <= 0) { I.btnPressed.add(0); clickT = 0.3; } }
      return;
    }
    if (!los || d > (W.id === 'sniper' ? 118 : Math.min(pref + 5, 22))) { I.down.add('KeyW'); if (d > pref + 25 && !los) I.down.add('ShiftLeft'); G.camera.yaw = steerYaw(p, tgt.x, tgt.z) + (unstickT > 0 ? unstickDir * 1.2 : 0); I.buttons.delete(2); if (los) { G.camera.yaw = Math.atan2(dx, dz); } }
    else if (d < pref * 0.5) I.down.add('KeyS');
    else I.down.add(strafeDir > 0 ? 'KeyD' : 'KeyA');
    const maxR = W.id === 'sniper' ? 110 : W.kind === 'long' ? 42 : 30; if (los && d < maxR) { seenT += 1 / 30; if (seenT > 0.4 / H.skill) shoot(!W.auto); else { I.buttons.add(2); } } else { seenT = 0; if (d < maxR + 10) I.buttons.add(2); }
    if (p.wslot.clip <= 0 && p.wslot.ammo > 0 && p.reloadT <= 0) I.pressed.add('KeyR');
    stuckCheck(p);
  }
  function stuckCheck(p) { stuckT += 1 / 30; if (stuckT > 1.5) { const mv = Math.hypot(p.x - lastX, p.z - lastZ); if (mv < 0.8 && (I.down.has('KeyW'))) { unstickT = 0.8; unstickDir = Math.random() < 0.5 ? 1 : -1; } lastX = p.x; lastZ = p.z; stuckT = 0; } }

  function nearestEnemy(p, maxD) {
    let best = null, bd = maxD * maxD, bl = null, bld = maxD * maxD;
    for (const q of G.peds.list) { if (!isEnemy(q)) continue; const dd = d2(q.x, q.z, p.x, p.z); if (dd < bd) { bd = dd; best = q; } }
    return best;
  }

  // ------------------------------------------------------------------ goal finding
  function enterableVeh(v) { return v && !v.wrecked && !v.exploded && !v.locked && v.type !== 'police' && v.type !== 'swatvan' && v.type !== 'ambulance' && v.type !== 'bus' && v.type !== 'policeheli' && !v.isHeli; }
  function goalFor(r) {
    const p = pl();
    // pickups first
    for (const k of r.pickups) if (!k.dead && (k.kind === 'cash' || k.kind === 'tag')) return { kind: 'pickup', x: k.x, z: k.z, foot: true };
    // supplies: a sensible player grabs health / armor when hurt and nobody is shooting
    if (!nearestEnemy(p, 45)) for (const k of r.pickups) { if (k.dead) continue; const need = (k.kind === 'health' && p.health < 70) || (k.kind === 'armor' && p.armor < 40) || (k.kind === 'weapon' && p.totalAmmo() < 40); if (need && d2(k.x, k.z, p.x, p.z) < 70 * 70 && !p.vehicle) return { kind: 'pickup', x: k.x, z: k.z, foot: true }; }
    const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z;
    let best = null, bd = 1e18;
    for (const m of r.markers) { if (m.dead) continue; const dd = d2(px, pz, m.x, m.z); if (dd < bd) { bd = dd; best = m; } }
    if (best) return { kind: 'marker', m: best, x: best.x, z: best.z, foot: !!best.footOnly, veh: !!best.vehicleOnly, need: best.needVehicle || null };
    // loose pickups nearby (dropped weapons, cash, health): a real player grabs them
    if (!p.vehicle && !nearestEnemy(p, 30)) { let bp = null, bd = 28 * 28; for (const k of G.pickups.list) { if (k.dead) continue; const want = k.kind === 'cash' || (k.kind === 'weapon' && p.totalAmmo() < 60) || (k.kind === 'health' && p.health < 60) || (k.kind === 'armor' && p.armor < 30); if (!want) continue; const dd = d2(k.x, k.z, p.x, p.z); if (dd < bd) { bd = dd; bp = k; } } if (bp) return { kind: 'pickup', x: bp.x, z: bp.z, foot: true }; }
    // enter-vehicle style blips
    const bl = r.blips.find(b => b.entity && b.entity.def && enterableVeh(b.entity) && !b.entity.driver && !b.entity.ai && b.color !== '#ff3030' && p.vehicle !== b.entity);
    if (bl) return { kind: 'enter', v: bl.entity, x: bl.entity.x, z: bl.entity.z };
    // chase / tail something
    const ch = r.blips.find(b => b.entity && b.label && /Courier|Duke|Calloway|Harlan|Armored|Marcus/i.test(b.label));
    if (ch) { const e = ch.entity; return { kind: 'chase', e, x: e.x, z: e.z }; }
    const pb = r.blips.find(b => !b.entity && b.x !== undefined && /Spray|Objective|Store|Fight|Docks|Hospital|Pier/i.test(b.label || ''));
    if (pb) return { kind: 'marker', m: { x: pb.x, z: pb.z, radius: 6 }, x: pb.x, z: pb.z, foot: false, veh: false, need: null };
    return null;
  }

  H.lastGoal = null;
  H.brain = function (dt) {
    const p = pl(); if (!H.on || !p) return;
    const M = G.missions; const r = M && M.active;
    if (!r || r.ended || G.game.inCutscene || !p.controlEnabled || p.dead || G.game.state !== 'play') { release(); H.resetAI(); return; }
    const inVeh = !!p.vehicle; const v = p.vehicle;
    if (inVeh && p.weaponId !== 'smg' && p.weapons.smg && p.totalAmmo('smg') > 0) { p.equip('smg'); G.hud.weaponChanged(); } else if (inVeh && (!p.hasGun() || p.totalAmmo() <= 0)) { const w = bestWeapon(0); if (w && w !== 'fist' && !WEAPONS[w].melee) { p.equip(w); G.hud.weaponChanged(); } }
    // keep the camera rig + camera position fresh (fast-sim does not run the frame loop)
    const lookMode = (p.vehicle ? 'veh' : 'foot');
    // ---------- objective text helpers
    const obj = r.objText || '';
    // get out when asked
    if (/^(Get out|Leave)/i.test(obj) && inVeh) { I.pressed.add('KeyF'); release(); return; }
    // ---------- combat
    const maxSee = p.weaponId === 'sniper' ? 135 : 55;
    const en = nearestEnemy(p, maxSee);
    const wantsFight = en && (!r.markers.length || d2(en.x, en.z, p.x, p.z) < 38 * 38 || (p.weaponId === 'sniper' && hasLOS(p, en)));
    if (en && !inVeh && (wantsFight || G.police.stars < 0)) {
      H.resetAI(); I.gpAx = null; fightOnFoot(p, en); H.lastGoal = 'fight'; G.camera.update(dt, dt, p, NOIN); return;
    }
    if (en && inVeh && p.hasGun() && p.weapon.kind === 'pistol') {
      // drive-by: keep driving but shoot any hostile in range
    }
    if (en && inVeh && !/Drive by|Chase|Stop|Tail|tail|Escape|escape|Lose|cops|Deliver|Bring|Return|truck|Take the|Duke|limo/i.test(obj) && d2(en.x, en.z, v.x, v.z) < 50 * 50) {
      // a real player stops and gets out before walking into a firefight
      I.gpAx = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 1, rt: 0 }; if (v.totalSpeed < 5) { I.pressed.add('KeyF'); I.gpAx = null; } H.lastGoal = 'dismount'; return;
    }
    const goal = goalFor(r);
    H.lastGoal = goal ? goal.kind : 'none';
    if (!goal) {
      // nothing to do: if enemies exist far away walk to them (killAll after goto) else idle
      const far = nearestEnemy(p, 400);
      if (far && /Eliminate|Take|Clear|Snipe|Kill|Wave|Fight|Hold|End|Put|Finish|Stop|Clear/i.test(obj) && !inVeh) { I.down.add('KeyW'); const dd = walkTo(far.x, far.z); return; }
      if (far && inVeh && /Wave|Eliminate|Clear|Drive by/i.test(obj)) { driveTo(v, far.x, far.z, { stopDist: 25, cruise: 18 }); driveBy(p, en); return; }
      release(); idleT += dt; return;
    }
    idleT = 0;
    if (goal.kind === 'enter') {
      if (inVeh) { I.pressed.add('KeyF'); release(); return; }
      const dw = goal.v.doorWorldPos(0); const dd = walkTo(dw.x, dw.z, { noSprint: false });
      if (dd < 2.6) { if (fKey <= 0) { I.pressed.add('KeyF'); fKey = 0.5; } } if (fKey > 0) fKey -= dt;
      return;
    }
    if (goal.kind === 'pickup') { if (inVeh) { I.pressed.add('KeyF'); release(); return; } walkTo(goal.x, goal.z); return; }
    if (goal.kind === 'chase') {
      const e = goal.e;
      if (!inVeh) {
        // need a vehicle: nearest enterable mission/player vehicle within 60 m
        let bv = null, bd = 60 * 60; for (const q of G.vehicles.list) { if (!enterableVeh(q) || q.driver || q.isBike && false) continue; if (q.owner !== 'player' && !q.mission) continue; const dd = d2(q.x, q.z, p.x, p.z); if (dd < bd) { bd = dd; bv = q; } }
        if (bv) { const dw = bv.doorWorldPos(0); const dd = walkTo(dw.x, dw.z); if (dd < 2.6 && fKey <= 0) { I.pressed.add('KeyF'); fKey = 0.5; } if (fKey > 0) fKey -= dt; return; }
        walkTo(e.x, e.z); return;
      }
      const dist = Math.hypot(e.x - v.x, e.z - v.z);
      // tail mission (keep 25..70 m): match speed
      const tail = /Tail|tail/.test(obj);
      const cruise = tail ? (dist < 28 ? Math.max(3, e.totalSpeed * 0.7) : dist > 60 ? Math.min(e.totalSpeed * 1.4 + 4, 28) : e.totalSpeed * 1.05) : Math.min(44, Math.max(14, e.totalSpeed + 14));
      driveTo(v, e.x, e.z, { stopDist: tail ? 1 : 7, cruise });
      if (!tail) driveBy(p, e);
      return;
    }
    // marker
    const m = goal.m; const need = goal.need;
    if (need && p.vehicle !== need) {
      if (inVeh) { I.pressed.add('KeyF'); release(); return; }
      if (enterableVeh(need)) { const dw = need.doorWorldPos(0); const dd = walkTo(dw.x, dw.z); if (dd < 2.6 && fKey <= 0) { I.pressed.add('KeyF'); fKey = 0.5; } if (fKey > 0) fKey -= dt; return; }
    }
    const far = Math.hypot((inVeh ? v.x : p.x) - m.x, (inVeh ? v.z : p.z) - m.z);
    if (goal.foot) {
      if (inVeh) { if (v.totalSpeed < 6) { I.pressed.add('KeyF'); release(); return; } driveTo(v, m.x, m.z, { stopDist: 3, cruise: 6 }); return; }
      walkTo(m.x, m.z); return;
    }
    if (goal.veh || inVeh) {
      if (!inVeh) { // need a vehicle
        let bv = null, bd = 80 * 80; for (const q of G.vehicles.list) { if (!enterableVeh(q) || q.driver) continue; if (q.owner !== 'player' && !q.mission) continue; const dd = d2(q.x, q.z, p.x, p.z); if (dd < bd) { bd = dd; bv = q; } }
        if (bv) { const dw = bv.doorWorldPos(0); const dd = walkTo(dw.x, dw.z); if (dd < 2.6 && fKey <= 0) { I.pressed.add('KeyF'); fKey = 0.5; } if (fKey > 0) fKey -= dt; return; }
        walkTo(m.x, m.z); return;
      }
      const slow = /Return|Deliver|Bring|Take the .*truck|Grove/i.test(obj) ? 6 : 0;
      driveTo(v, m.x, m.z, { stopDist: Math.max(2, m.radius * 0.45), cruise: far < 40 ? 12 : H.cruise });
      if (en) driveBy(p, en);
      return;
    }
    // mode any, on foot: take a nearby vehicle when far
    if (far > 420) {
      let bv = null, bd = 70 * 70; for (const q of G.vehicles.list) { if (!enterableVeh(q) || q.driver || q.isHeli || q.type === 'bicycle') continue; const dd = d2(q.x, q.z, p.x, p.z); if (dd < bd) { bd = dd; bv = q; } }
      if (bv) { const dw = bv.doorWorldPos(0); const dd = walkTo(dw.x, dw.z); if (dd < 2.6 && fKey <= 0) { I.pressed.add('KeyF'); fKey = 0.5; } if (fKey > 0) fKey -= dt; return; }
    }
    walkTo(m.x, m.z);
  };

  function driveBy(p, tgt) {
    if (!tgt || !p.vehicle || !p.hasGun() || p.weapon.kind !== 'pistol') { return; }
    const v = p.vehicle; const d = Math.hypot(tgt.x - v.x, tgt.z - v.z); if (d > 40) return;
    const yaw = Math.atan2(tgt.x - p.x, tgt.z - p.z); const base = G.camera.yaw;
    G.camera.lookOffYaw = wrap(G.camera.lookOffYaw + wrap(yaw - G.camera.yaw)); G.camera.idleT = 0; G.camera.yaw = yaw;
    G.camera.pitch = -Math.atan2((tgt.y || 0) + 1.3 - (p.y + 1.6), d + 3);
    shoot(!p.weapon.auto);
  }

  // wrap sim: brain before, endFrame after (fast mode)
  const origSim = game.sim.bind(game);
  game.sim = function (dt) {
    if (H.on) { try { H.brain(dt); } catch (e) { console.error('HUM brain error', e.message, e.stack.split('\n')[1]); } }
    if (H.on && G.missions && G.missions.active && !G.game.inCutscene && G.player && G.player.controlEnabled) { try { G.camera.update(dt, dt, G.player, NOIN); } catch (e) { } }
    origSim(dt);
    if (H.fast) { G.input.endFrame(); }
    H.track(dt);
  };
  // stats tracking
  H.reset = () => { H.stats = { t0: G.time, dmg: 0, minHp: 999, deaths: 0, shots: 0, by: {} }; H.lastHp = pl().health + pl().armor; H.idleMax = 0; };
  H.track = function (dt) {
    const p = pl(); if (!p || !H.stats) return; const hp = p.health + p.armor;
    if (hp < H.lastHp) H.stats.dmg += H.lastHp - hp; H.lastHp = hp;
    if (!p.dead) H.stats.minHp = Math.min(H.stats.minHp, p.health);
    H.stats.idleMax = Math.max(H.stats.idleMax || 0, idleT);
    const r = G.missions && G.missions.active;
    if (r && !r.ended && !G.game.inCutscene && r.objText && p.controlEnabled) {
      const nb = r.markers.filter(m => !m.dead).length + r.blips.length + r.pickups.filter(k => !k.dead).length;
      if (nb === 0) { H.stats.noBlip = H.stats.noBlip || {}; const k = r.objText.replace(/<[^>]*>/g, '').slice(0, 50); H.stats.noBlip[k] = +((H.stats.noBlip[k] || 0) + dt).toFixed(1); }
    }
  };
  const odmg = G.player.onDamaged.bind(G.player);
  G.player.onDamaged = function (amount, info) {
    odmg(amount, info); if (!H.stats) return; const src = info && info.source; let k = 'other';
    if (info && info.explosion) k = 'explosion'; else if (info && info.vehicleCrash) k = 'crash'; else if (src) k = (src.mission ? 'M:' : 'A:') + (src.role || '?') + (src.weaponId ? '/' + src.weaponId : (src.weapon && src.weapon.id ? '/' + src.weapon.id : '')); else k = 'noSource';
    H.stats.by = H.stats.by || {}; H.stats.by[k] = Math.round((H.stats.by[k] || 0) + amount);
  };
  { const r0 = G.police.raise.bind(G.police); G.police.raise = (n, reason, min) => { if (H.stats && reason) { H.stats.raises = H.stats.raises || {}; H.stats.raises[reason] = (H.stats.raises[reason] || 0) + 1; } return r0(n, reason, min); }; }
  G.events.on('playerDied', i => { if (!H.stats) return; const s = i && i.source; H.stats.fatal = i && i.explosion ? 'explosion' : i && i.vehicleCrash ? 'crash' : s ? ((s.mission ? 'M:' : 'A:') + (s.role || '?') + '/' + (s.weaponId || '')) : 'unknown'; });
  G.events.on('playerBusted', () => { if (H.stats) H.stats.fatal = 'busted'; });
  H.reset();
  window.HUM_READY = true;
})();
