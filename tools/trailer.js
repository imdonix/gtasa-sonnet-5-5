// Deterministic trailer recorder.  node tools/trailer.js [outDir] [--only S3] [--fps 30]
// Renders the real game frame by frame (fixed dt) in headless Chromium and saves JPEG frames; encode with ffmpeg afterwards.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const args = process.argv.slice(2);
const OUT = args[0] && !args[0].startsWith('--') ? args[0] : 'trailer_frames';
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const FPS = +opt('fps', 30), W = +opt('w', 1280), H = +opt('h', 720), ONLY = opt('only', null);
fs.mkdirSync(OUT, { recursive: true });

// ---- in-page trailer toolkit
function pageSetup() {
  const T = window.T = { t: 0, cam: null, shots: {} };
  const lerp = (a, b, k) => a + (b - a) * k, ease = k => k * k * (3 - 2 * k);
  T.lerp = lerp; T.ease = ease;
  // overlay text
  const el = document.createElement('div'); el.id = 'trText';
  el.style.cssText = 'position:fixed;left:0;right:0;bottom:17%;text-align:center;z-index:50;font:italic 900 64px "Arial Black",Impact,sans-serif;letter-spacing:5px;color:#f7c948;text-shadow:4px 4px 0 #000,0 0 18px rgba(0,0,0,.6);opacity:0;text-transform:uppercase;pointer-events:none';
  document.body.appendChild(el);
  const sub = document.createElement('div'); sub.id = 'trSub';
  sub.style.cssText = 'position:fixed;left:0;right:0;bottom:11%;text-align:center;z-index:50;font:700 26px "Segoe UI",Arial,sans-serif;letter-spacing:6px;color:#fff;text-shadow:2px 2px 0 #000;opacity:0;text-transform:uppercase;pointer-events:none';
  document.body.appendChild(sub);
  const fade = document.createElement('div'); fade.id = 'trFade'; fade.style.cssText = 'position:fixed;inset:0;background:#000;z-index:60;opacity:0;pointer-events:none';
  document.body.appendChild(fade);
  T.text = (t, s, a) => { el.textContent = t || ''; el.style.opacity = t ? a : 0; sub.textContent = s || ''; sub.style.opacity = s ? a : 0; };
  T.fade = a => { fade.style.opacity = a; };
  T.hud = on => { G.hud.root.style.visibility = on ? 'visible' : 'hidden'; };
  T.init = () => {
    game.loop = () => { };               // stop the realtime loop: we drive frames ourselves
    game.renderFrame = () => { };
    G.missions.abortAll(); G.player.invincible = true; G.police.noWanted = false;
    G.sky.lockWeather = true; G.population.enabled = true;
    G.audio.radio.set(-1);
  };
  T.place = async (x, z, yaw, radius = 3) => { game.teleport(x, z, yaw); G.camera.snapTo(G.player); await G.world.preload(x, z, radius); for (let i = 0; i < 4; i++) G.world.update(0, x, z, 60); };
  T.frame = (dt) => {
    game.frame(dt); T.t += dt;
    if (T.cam) { const c = T.cam(T.t); G.cam.position.set(c.x, c.y, c.z); G.cam.lookAt(c.lx, c.ly, c.lz); if (c.fov && Math.abs(G.cam.fov - c.fov) > 0.01) { G.cam.fov = c.fov; G.cam.updateProjectionMatrix(); } G.cam.updateMatrixWorld(); }
    G.renderer.render(G.scene, G.cam);
  };
  T.warm = (sec, dt = 1 / 30) => { for (let i = 0; i < sec / dt; i++) { game.frame(dt); } };
  T.gy = (x, z) => G.world.groundY(x, z);
  // drive the player's vehicle with the AI (the player is flagged as non-player for the duration of ai.update)
  T.drive = (v, mode, o) => { const { DriverAI } = T; const ai = new DriverAI(v, mode, o); v.ai = null; T.ai = ai; T.aiVeh = v; return ai; };
  T.aiStep = (dt) => { if (T.ai && T.aiVeh) { const p = G.player; const f = p.isPlayer; p.isPlayer = false; T.ai.update(dt); p.isPlayer = f; } };
  T.frameDrive = (dt) => { T.aiStep(dt); T.frame(dt); };
  T.carFor = (type, x, z, yaw, color) => { const v = G.vehicles.spawn(type, x, z, yaw, { owner: 'player', color }); v.y = G.world.groundY(x, z) + v.def.wheelRadius; v.applyTransform(); return v; };
  T.laneSpot = (x, z, dir = 1) => { const n = G.map.nearestRoad(x, z, 300); const off = G.nav.laneOffset(n.edge, 0); const tx = n.tx * dir, tz = n.tz * dir; return { x: n.x - tz * off, z: n.z + tx * off, yaw: Math.atan2(tx, tz), nr: n }; };
  T.farNode = (x, z, minD, maxD) => { let best = null, bd = 1e9; for (const n of G.map.nodes) { if (n.deg < 3) continue; const d = Math.hypot(n.x - x, n.z - z); if (d > minD && d < maxD && d < bd + 0) { best = n; bd = d; } } return best || G.map.nearestNode(x + 400, z, 1e9, 3); };
}

// shot definitions: each has dur (s), setup(page fn), per-frame hook name
const SHOTS = [
  { id: 'S1', dur: 6.0, name: 'flyover' },
  { id: 'S2', dur: 5.0, name: 'walk' },
  { id: 'S3', dur: 8.0, name: 'drive' },
  { id: 'S4', dur: 8.0, name: 'fight' },
  { id: 'S5', dur: 8.0, name: 'police' },
  { id: 'S6', dur: 6.0, name: 'boom' },
  { id: 'S7', dur: 7.0, name: 'night' },
  { id: 'S8', dur: 6.5, name: 'story' },
  { id: 'S9', dur: 5.0, name: 'pier' },
  { id: 'S10', dur: 6.0, name: 'end' }
];

const SETUP = {
  flyover: async () => { const D = G.world.placement.districtCentre('Commerce'); G.sky.hour = 17.7; G.sky.setWeather('smog'); G.sky.haze = 0.5; T.hud(false);
    await T.place(D.x, D.z, 0, 3); const y = T.gy(D.x, D.z);
    const A = { x: D.x - 260, z: D.z + 300 }, B = { x: D.x + 160, z: D.z + 230 };
    T.cam = (t) => { const k = T.ease(Math.min(1, t / 6)); return { x: T.lerp(A.x, B.x, k), y: y + T.lerp(85, 60, k), z: T.lerp(A.z, B.z, k), lx: D.x + T.lerp(-40, 30, k), ly: y + 38, lz: D.z, fov: 55 }; };
    T.text = T.text; T.textAt = t => t > 2.2 ? ['Los Santos Rising', 'Blood & Concrete', Math.min(1, (t - 2.2) / 0.8)] : ['', '', 0]; },
  walk: async () => { G.sky.hour = 12.2; G.sky.setWeather('clear'); T.cam = null; T.hud(true);
    const h = G.landmarks.home.door; const n = G.map.nearestRoad(h.x, h.z, 100); const side = 1; const e = n.edge;
    const x = n.x + n.tz * side * (e.w / 2 + 1.8), z = n.z - n.tx * side * (e.w / 2 + 1.8); const yaw = Math.atan2(n.tx, n.tz);
    await T.place(x, z, yaw, 3); G.camera.yaw = yaw; G.camera.pitch = 0.22; G.input.down.add('KeyW'); T.walkYaw = yaw;
    T.onFrame = (t) => { G.camera.yaw = T.walkYaw - 0.25 * Math.sin(t * 0.6); if (t > 3.6) G.input.down.add('ShiftLeft'); };
    T.textAt = t => t > 0.6 ? ['Welcome Home', 'Jay Mercer is back in Los Santos', Math.min(1, (t - 0.6) / 0.6) * (t > 4.3 ? Math.max(0, (5 - t) / 0.7) : 1)] : ['', '', 0]; },
  drive: async () => { G.input.down.clear(); G.sky.hour = 15.3; G.sky.setWeather('clear'); T.cam = null; T.hud(true);
    const D = G.world.placement.districtCentre('Downtown Financial'); const s = T.laneSpot(D.x, D.z, 1); await T.place(s.x, s.z, s.yaw, 3);
    const v = T.carFor('muscle', s.x, s.z, s.yaw, 0xd01c1c); G.player.enterVehicle(v, 0, true); G.player.controlEnabled = false; v.wake(); G.camera.yaw = s.yaw;
    const dn = T.farNode(s.x, s.z, 500, 900); T.drive(v, 'goto', { dest: { x: dn.x, z: dn.z }, cruise: 34, aggressive: true, ignoreLights: true, stopDist: 25 }); v.vx = Math.sin(s.yaw) * 18; v.vz = Math.cos(s.yaw) * 18;
    T.onFrame = (t) => { v.input.handbrake = (t > 4.6 && t < 5.2); if (t > 4.6 && t < 5.2) { v.input.steer = 1; } G.camera.lookBack = false; };
    T.textAt = t => t > 0.5 ? ['Drive Anything', '18 vehicles · arcade physics · drifts', Math.min(1, (t - 0.5) / 0.6) * (t > 7 ? Math.max(0, (8 - t)) : 1)] : ['', '', 0]; },
  fight: async () => { G.sky.hour = 16.4; G.sky.setWeather('clear'); T.cam = null; T.hud(true); G.player.controlEnabled = true; G.player.vehicle && G.player.exitVehicle(true);
    const b = G.landmarks.vk_base.door; const p = G.player; const { Ped } = T; await T.place(b.x + 16, b.z + 4, -Math.PI / 2, 3);
    p.give('ak47', 900, true); p.give('smg', 500, false); p.equip('ak47'); G.input.locked = true;
    const foes = []; for (let i = 0; i < 7; i++) { const a = -0.9 + i * 0.3; const e = new Ped({ x: p.x - 20 - (i % 3) * 3, z: p.z + Math.sin(a) * 14, role: 'enemy', gang: 2, hostile: true, appearance: G.models.peds.randomAppearance(Math.random, { gang: 2, role: 'gangster' }), weapon: i % 2 ? 'smg' : 'pistol', ammo: 999, health: 60 }); e.sightRange = 70; e.mode = 'loiter'; e.skillAcc = 0.15; G.peds.add(e); foes.push(e); }
    T.foes = foes; G.camera.yaw = Math.atan2(-1, 0) ; G.camera.pitch = 0.12; G.input.buttons.add(2);
    T.onFrame = (t) => { const tgt = T.foes.find(f => !f.dead); if (tgt) { const yaw = Math.atan2(tgt.x - p.x, tgt.z - p.z); G.camera.yaw += ((yaw - G.camera.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * 0.12; } const burst = (Math.floor(t * 2.2) % 2 === 0); if (burst && t > 0.8) { G.input.buttons.add(0); } else G.input.buttons.delete(0); p.health = 100; };
    T.textAt = t => t > 0.4 ? ['Fight For Your Turf', 'Four rival gangs · melee, guns, explosives', Math.min(1, (t - 0.4) / 0.6) * (t > 7 ? Math.max(0, (8 - t)) : 1)] : ['', '', 0]; },
  police: async () => { G.input.buttons.clear(); G.sky.hour = 18.5; G.sky.setWeather('clear'); T.cam = null; T.hud(true); G.player.controlEnabled = false;
    const D = G.world.placement.districtCentre('Conference Center'); const s = T.laneSpot(D.x, D.z, 1); await T.place(s.x, s.z, s.yaw, 3);
    const v = T.carFor('sports', s.x, s.z, s.yaw, 0xf0f0f4); G.player.enterVehicle(v, 0, true); v.wake(); G.camera.yaw = s.yaw;
    const dn = T.farNode(s.x, s.z, 600, 1000); T.drive(v, 'goto', { dest: { x: dn.x, z: dn.z }, cruise: 40, aggressive: true, ignoreLights: true, stopDist: 25 });
    v.vx = Math.sin(s.yaw) * 22; v.vz = Math.cos(s.yaw) * 22; G.police.raise(4, 'trailer', 4); T.warm(0.1); for (let i = 0; i < 160; i++) { T.aiStep(1 / 30); game.frame(1 / 30); }
    T.onFrame = (t) => { G.police.hideT = 0; v.health = Math.max(v.health, 500); };
    T.textAt = t => t > 0.4 ? ['Survive The Heat', 'Wanted levels · roadblocks · helicopters', Math.min(1, (t - 0.4) / 0.6) * (t > 7 ? Math.max(0, (8 - t)) : 1)] : ['', '', 0]; },
  boom: async () => { G.police.clear(); for (const v of G.vehicles.list.slice()) if (v.owner === 'police') G.vehicles.remove(v); if (G.player.vehicle) G.player.exitVehicle(true); G.player.controlEnabled = true; T.ai = null;
    G.sky.hour = 10.2; G.sky.setWeather('clear'); T.hud(false); G.input.down.clear();
    const D = G.world.placement.districtCentre('Idlewood'); const s = T.laneSpot(D.x, D.z, 1); await T.place(s.x + 30, s.z + 30, 0, 3);
    const a = T.carFor('sedan', s.x, s.z, s.yaw, 0x2a6a3a), b = T.carFor('van', s.x + Math.sin(s.yaw) * 7, s.z + Math.cos(s.yaw) * 7, s.yaw, 0xe8d8b0); const c3 = T.carFor('taxi', s.x - Math.sin(s.yaw) * 6, s.z - Math.cos(s.yaw) * 6, s.yaw, 0xffcc00);
    a.owner = b.owner = c3.owner = 'parked'; a.sleeping = b.sleeping = c3.sleeping = true; T.boomPos = { x: s.x, z: s.z, y: T.gy(s.x, s.z) + 1, yaw: s.yaw }; T.boomCars = [a, b, c3];
    T.cam = (t) => { const p = T.boomPos; const ang = p.yaw + 2.2 + t * 0.12; const r = 15 - t * 0.6; return { x: p.x + Math.cos(ang) * r, y: p.y + 2.4 + t * 0.15, z: p.z + Math.sin(ang) * r, lx: p.x, ly: p.y + 1.6, lz: p.z, fov: 50 }; };
    T.onFrame = (t) => { if (!T.boomDone && t > 0.9) { T.boomDone = true; G.combat.explode(T.boomPos.x, T.boomPos.y, T.boomPos.z, 9, 520, { source: G.player }); for (const v of T.boomCars) v.blowUp(G.player); } game.timeScale = t > 0.9 && t < 4.2 ? 0.3 : 1; };
    T.textAt = t => ['', '', 0]; },
  night: async () => { game.timeScale = 1; T.boomDone = false; G.sky.hour = 23.0; G.sky.setWeather('rain'); G.sky.rain = 1; G.sky.cover = 0.85; G.sky.grey = 0.6; T.cam = null; T.hud(true); G.player.controlEnabled = false; G.input.down.clear();
    for (const v of T.boomCars || []) G.vehicles.remove(v);
    const D = G.world.placement.districtCentre('Vinewood'); const s = T.laneSpot(D.x, D.z, 1); await T.place(s.x, s.z, s.yaw, 3);
    const v = T.carFor('coupe', s.x, s.z, s.yaw, 0x1a3a8a); G.player.enterVehicle(v, 0, true); v.wake(); G.camera.yaw = s.yaw;
    const dn = T.farNode(s.x, s.z, 450, 900); T.drive(v, 'goto', { dest: { x: dn.x, z: dn.z }, cruise: 30, stopDist: 25 }); v.vx = Math.sin(s.yaw) * 14; v.vz = Math.cos(s.yaw) * 14;
    T.onFrame = (t) => { G.sky.rain = 1; };
    T.textAt = t => t > 0.4 ? ['A Living City', 'Day and night · weather · traffic · 5 radio stations', Math.min(1, (t - 0.4) / 0.6) * (t > 6 ? Math.max(0, (7 - t)) : 1)] : ['', '', 0]; },
  story: async () => { G.input.down.clear(); T.ai = null; T.cam = null; if (G.player.vehicle) G.player.exitVehicle(true); G.player.controlEnabled = true; G.sky.hour = 12.0; G.sky.lockWeather = true; G.sky.setWeather('clear'); G.sky.rain = 0; G.sky.grey = 0; G.sky.cover = 0.3; T.hud(true);
    for (const v of G.vehicles.list.slice()) if (v.owner === 'police') G.vehicles.remove(v);
    const M = G.missions; M.done.add('m01'); M.refreshStarts(); const def = M.defs[1]; const w = def.where(); await T.place(w.x + 3, w.z + 3, 0, 3); G.player.invincible = true; M.start(def);
    T.onFrame = (t) => { };
    T.textAt = t => t > 0.3 ? ['', '', 0] : ['', '', 0]; },
  pier: async () => { G.missions.abortAll(); game.inCutscene = false; G.camera.endCine(); G.hud.setCinematic(false); G.hud.fade(0, 10); G.hud.clearSubs(); G.hud.objective(''); T.hud(false); G.sky.hour = 18.1; G.sky.setWeather('clear'); G.sky.rain = 0; G.sky.grey = 0; G.sky.lockWeather = true;
    const p = G.landmarks.pier; await T.place(p.x + 20, p.z - 20, 0, 3); const y = 1.5;
    T.cam = (t) => { const k = T.ease(t / 5); return { x: T.lerp(p.x + 75, p.x + 30, k), y: y + T.lerp(16, 9, k), z: T.lerp(p.z - 70, p.z - 25, k), lx: p.x - 4, ly: y + 9, lz: p.z + 20, fov: 54 }; };
    T.textAt = t => t > 0.4 ? ['Explore San Andreas', 'Beaches · hills · docks · airport', Math.min(1, (t - 0.4) / 0.6) * (t > 4 ? Math.max(0, (5 - t)) : 1)] : ['', '', 0]; },
  end: async () => { T.ai = null; G.hud.clearSubs(); T.hud(false); G.sky.hour = 19.2; G.sky.setWeather('clear'); G.sky.rain = 0; G.sky.grey = 0; G.sky.cover = 0.25;
    const D = G.world.placement.districtCentre('Commerce'); await T.place(D.x, D.z, 0, 3); const y = T.gy(D.x, D.z);
    T.cam = (t) => { const a = 0.9 + t * 0.05; return { x: D.x + Math.cos(a) * 330, y: y + 70, z: D.z + Math.sin(a) * 330, lx: D.x, ly: y + 40, lz: D.z, fov: 50 }; };
    T.textAt = t => ['Los Santos Rising', 'Blood & Concrete — play it in your browser', Math.min(1, t / 1.0)]; }
};

(async () => {
  const browser = await puppeteer.launch({ protocolTimeout: 3600000, executablePath: '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
  const page = await browser.newPage(); await page.setViewport({ width: W, height: H });
  page.on('console', m => { const t = m.type(); if (t === 'error') console.log('[page error]', m.text().slice(0, 300)); });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:8080/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.game && window.game.running, { timeout: 180000 });
  await page.evaluate(() => { game.startGame(false); });
  await new Promise(r => setTimeout(r, 3500));
  await page.evaluate(pageSetup);
  await page.evaluate(async () => { const d = await import('/src/driverai.js'); const p = await import('/src/peds.js'); T.DriverAI = d.DriverAI; T.Ped = p.Ped; T.init(); });
  let frame = 0; const dt = 1 / FPS;
  for (const shot of SHOTS) {
    if (ONLY && shot.id !== ONLY) { frame += Math.round(shot.dur * FPS); continue; }
    console.log('shot', shot.id, shot.name);
    await page.evaluate(`(async () => { T.t = 0; T.cam = null; T.onFrame = null; T.textAt = null; T.text('', '', 0); await (${SETUP[shot.name].toString()})(); })()`);
    const n = Math.round(shot.dur * FPS);
    for (let i = 0; i < n; i++) {
      const fade = Math.min(1, i / 6, (n - 1 - i) / 6); // short fade from/to black at cuts
      await page.evaluate((dt, fade) => { if (T.onFrame) T.onFrame(T.t); if (T.textAt) { const a = T.textAt(T.t); T.text(a[0], a[1], a[2]); } T.frameDrive(dt); T.fade(1 - fade); }, dt, fade);
      await page.screenshot({ path: `${OUT}/f_${String(frame).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 });
      frame++;
      if (i % 30 === 0) process.stdout.write('.');
    }
    console.log(' done', frame);
  }
  await browser.close();
  console.log('frames', frame);
})().catch(e => { console.error('TRAILER ERROR', e); process.exit(1); });
