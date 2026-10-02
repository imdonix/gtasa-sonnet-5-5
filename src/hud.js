// In-game HUD: radar, bars, money, wanted stars, weapon, subtitles, objectives, popups, prompts.
import { G } from './state.js';
import { clamp, lerp, fmtMoney, pad2, dist2 } from './util.js';
import { CLS, MPP, HALF, ROAD_WIDTH, MAP_N } from './mapdata.js';
import { WEAPONS } from './weapons.js';

const $ = (id) => document.getElementById(id);
const el = (tag, id, cls, html) => { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

const MAP_COLORS = { water: '#3b6f9c', land: '#b8b5ad', sand: '#e6d8a8', grass: '#8fb27a', scrub: '#c2ad7e', concrete: '#cfcfca', road: '#f4f4f0', avenue: '#fff2a0', freeway: '#ffb35c', bld: '#8d8a84', hill: '#a9a488' };

export class HUD {
  constructor() {
    const root = $('hud');
    this.root = root;
    root.innerHTML = '';
    // top-right block
    const tr = el('div', 'tr', 'shadowed');
    tr.innerHTML = `<div id="clock">12:00</div><div id="money">$0</div><div id="moneyDelta"></div>
      <div id="barRow1"><span class="bar" id="hp" style="width:150px"><i></i></span></div>
      <div id="barRow2"><span class="bar" id="ar" style="width:150px"><i></i></span><span class="bar" id="st" style="width:70px"><i></i></span></div>
      <div id="stars"></div><div id="weapon"></div><div id="timer"></div><div id="progress"></div><div id="counter"></div>`;
    root.appendChild(tr);
    const rw = el('div', 'radarWrap'); rw.innerHTML = '<canvas id="radar" width="420" height="420"></canvas><div id="radarN">N</div>'; root.appendChild(rw);
    root.appendChild(el('div', 'tracker', 'shadowed'));
    root.appendChild(el('div', 'zoneName', 'shadowed')); root.appendChild(el('div', 'vehName', 'shadowed')); root.appendChild(el('div', 'speedo', 'shadowed'));
    root.appendChild(el('div', 'notes', 'shadowed')); root.appendChild(el('div', 'subs', 'shadowed')); root.appendChild(el('div', 'objective', 'shadowed')); root.appendChild(el('div', 'prompt'));
    root.appendChild(el('div', 'crosshair', null, '<i></i>')); root.appendChild(el('div', 'scope')); root.appendChild(el('div', 'vignette')); root.appendChild(el('div', 'flash'));
    root.appendChild(el('div', 'big', 'shadowed')); root.appendChild(el('div', 'bigSub', 'shadowed')); root.appendChild(el('div', 'mp', 'shadowed')); root.appendChild(el('div', 'mtitle', 'shadowed'));
    const rp = el('div', 'radioPop', 'shadowed', '<div class="n"></div><div class="t"></div>'); root.appendChild(rp);
    document.body.appendChild(el('div', 'fade'));
    this.e = {}; for (const id of ['clock', 'money', 'moneyDelta', 'hp', 'ar', 'st', 'stars', 'weapon', 'timer', 'progress', 'counter', 'zoneName', 'vehName', 'speedo', 'notes', 'subs', 'objective', 'prompt', 'crosshair', 'scope', 'vignette', 'flash', 'big', 'bigSub', 'mp', 'mtitle', 'radioPop', 'radar', 'radarN', 'tracker', 'fade']) this.e[id] = $(id);
    this.radar = this.e.radar.getContext('2d');
    this.stars = 0; this.moneyShown = 0; this.lastZone = ''; this.zoneT = 0; this.subQueue = []; this.subT = 0; this.objText = '';
    this.moneyDeltaT = 0; this.moneyDeltaSum = 0; this.flashStars = false; this.seen = false; this.vehNameT = 0; this.lastVeh = null;
    this.radarRange = 120; this.hitT = 0;
    this.mapCanvas = null; this.timerVal = null; this.radioT = 0;
    this.buildStars();
  }
  buildStars() { let h = ''; for (let i = 0; i < 6; i++) h += '<span>★</span>'; this.e.stars.innerHTML = h; }

  // ------------------------------------------------------------ map canvas (shared by radar + big map)
  buildMapCanvas(map, placement) {
    const S = 2048, k = S / MAP_N; // px per source px
    const c = document.createElement('canvas'); c.width = c.height = S; const ctx = c.getContext('2d');
    const img = ctx.createImageData(MAP_N, MAP_N); const d = img.data; const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const col = { [CLS.WATER]: hex(MAP_COLORS.water), [CLS.SAND]: hex(MAP_COLORS.sand), [CLS.GRASS]: hex(MAP_COLORS.grass), [CLS.SCRUB]: hex(MAP_COLORS.scrub), [CLS.LAND]: hex(MAP_COLORS.land), [CLS.CONCRETE]: hex(MAP_COLORS.concrete), [CLS.RUNWAY]: [110, 110, 120], [CLS.STREET]: hex(MAP_COLORS.land), [CLS.AVENUE]: hex(MAP_COLORS.land), [CLS.FREEWAY]: hex(MAP_COLORS.land) };
    for (let i = 0; i < MAP_N * MAP_N; i++) {
      let cc = col[map.cls[i]] || [150, 150, 150];
      let r = cc[0], g = cc[1], b = cc[2];
      if (map.cls[i] !== CLS.WATER) { const h = map.heightPx[i]; const s = clamp((h - 2) / 120, 0, 1); r = lerp(r, r * 0.82, s); g = lerp(g, g * 0.85, s); b = lerp(b, b * 0.8, s); }
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    }
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = MAP_N; tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(tmp, 0, 0, S, S);
    // buildings
    if (placement) { ctx.fillStyle = 'rgba(120,116,110,0.85)'; for (const b of placement.buildings) { ctx.save(); const cx = (b.x / MPP + HALF) * k, cz = (b.z / MPP + HALF) * k; ctx.translate(cx, cz); ctx.rotate(b.yaw); ctx.fillRect(-b.hw / MPP * k, -b.hd / MPP * k, b.w / MPP * k, b.d / MPP * k); ctx.restore(); } }
    // roads
    const W = (x) => (x / MPP + HALF) * k;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const pass of [0, 1]) for (const e of map.edges) {
      ctx.beginPath(); e.pts.forEach((p, i) => { const X = W(p.x), Y = W(p.z); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      const w = e.w / MPP * k;
      if (pass === 0) { ctx.strokeStyle = '#5f6168'; ctx.lineWidth = w + 2.5; } else { ctx.strokeStyle = e.cls === CLS.FREEWAY ? MAP_COLORS.freeway : e.cls === CLS.AVENUE ? MAP_COLORS.avenue : MAP_COLORS.road; ctx.lineWidth = w; }
      ctx.stroke();
    }
    this.mapCanvas = c; this.mapK = k;
    // district labels for big map
    this.districts = map.districts.map(d => ({ name: d.name, x: (d.cx - MAP_N / 2) * MPP, z: (d.cy - MAP_N / 2) * MPP }));
  }

  getGangOverlay() {
    if (this._gangOv && !this._gangDirty) return this._gangOv;
    const S = 512, k = MAP_N / S; const c = this._gangOv || document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d'); const img = x.createImageData(S, S); const m = G.map;
    const col = { 1: [63, 200, 90], 2: [154, 79, 208], 3: [232, 198, 58], 4: [58, 123, 224] };
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const g = m.gang[(j * k) * MAP_N + i * k]; if (!g) continue; const cc = col[g]; const o = (j * S + i) * 4; img.data[o] = cc[0]; img.data[o + 1] = cc[1]; img.data[o + 2] = cc[2]; img.data[o + 3] = 255; }
    x.putImageData(img, 0, 0); this._gangOv = c; this._gangDirty = false; return c;
  }
  // ------------------------------------------------------------ API
  notify(text, type = '') { const n = el('div', null, 'n ' + type, text); this.e.notes.appendChild(n); setTimeout(() => { n.style.opacity = 0; setTimeout(() => n.remove(), 700); }, 3200); while (this.e.notes.children.length > 6) this.e.notes.firstChild.remove(); }
  subtitle(text, dur = 3, speaker = '') { this.subQueue.push({ text, dur, speaker }); if (this.subT <= 0) this.nextSub(); }
  nextSub() { const s = this.subQueue.shift(); if (!s) { this.e.subs.innerHTML = ''; this.subT = 0; return; } this.e.subs.innerHTML = (s.speaker ? `<span class="sp">${s.speaker}:</span> ` : '') + s.text; this.subT = s.dur; }
  clearSubs() { this.subQueue.length = 0; this.subT = 0; this.e.subs.innerHTML = ''; }
  objective(text) { this.objText = text || ''; this.e.objective.innerHTML = text || ''; }
  prompt(html) { const p = this.e.prompt; if (html) { p.innerHTML = html; p.style.display = 'block'; } else p.style.display = 'none'; }
  setWanted(n, flash) { this.stars = n; const s = this.e.stars.children; for (let i = 0; i < 6; i++) s[i].className = i < n ? 'on' : ''; if (flash) { this.e.stars.classList.add('flash'); setTimeout(() => this.e.stars.classList.remove('flash'), 1800); } }
  setPoliceSeen(v) { this.seen = v; }
  moneyChanged(delta) { this.moneyDeltaSum += delta; this.moneyDeltaT = 2.5; this.e.money.classList.add('bump'); setTimeout(() => this.e.money.classList.remove('bump'), 200); }
  damageFlash(a) { const f = this.e.flash; f.style.transition = 'none'; f.style.opacity = clamp(a / 60, 0.12, 0.5); requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = 0; }); }
  hitMarker(head) { const c = this.e.crosshair; c.classList.remove('hit'); void c.offsetWidth; c.classList.add('hit'); }
  weaponChanged() { this.updateWeapon(true); }
  timer(label, secs) { this.timerVal = secs; this.timerLabel = label; const t = this.e.timer; t.style.display = secs == null ? 'none' : 'block'; }
  progress(label, frac) { const p = this.e.progress; if (frac == null) { p.style.display = 'none'; return; } p.style.display = 'block'; p.innerHTML = `<span class="lbl">${label}</span><span class="bar"><i style="width:${clamp(frac, 0, 1) * 100}%"></i></span>`; }
  counter(text) { const c = this.e.counter; if (text == null) c.style.display = 'none'; else { c.style.display = 'block'; c.innerHTML = text; } }
  big(text, cls, sub, dur = 0) { const b = this.e.big; b.className = 'shadowed ' + (cls || ''); b.textContent = text; b.style.opacity = 1; this.e.bigSub.textContent = sub || ''; this.e.bigSub.style.opacity = sub ? 1 : 0; if (dur) setTimeout(() => this.hideBig(), dur * 1000); }
  hideBig() { this.e.big.style.opacity = 0; this.e.bigSub.style.opacity = 0; }
  missionPassed(title, reward, extra) { clearTimeout(this._failT); const m = this.e.mp; m.className = 'shadowed'; m.innerHTML = `<div class="t">MISSION PASSED!</div><div class="s">${title}</div><div class="r">${reward ? fmtMoney(reward) : ''}</div>${extra ? `<div class="s" style="font-size:24px;color:#ddd">${extra}</div>` : ''}`; m.style.opacity = 1; setTimeout(() => m.style.opacity = 0, 5200); }
  missionFailed(reason) {
    const m = this.e.mp; m.className = 'shadowed fail';
    m.innerHTML = `<div class="t">MISSION FAILED!</div><div class="s">${reason || ''}</div><div class="fb"><button class="mretry" id="mpRetry">Retry mission</button><span class="hint">restarts from the beginning</span></div>`;
    m.style.opacity = 1;
    clearTimeout(this._failT);
    this._failT = setTimeout(() => { m.style.opacity = 0; if (G.missions) G.missions.clearRetry(); }, 14000);
    const b = $('mpRetry');
    if (b) b.onclick = () => { if (G.missions && G.missions.retryLast()) clearTimeout(this._failT); };
  }
  dismissFail() { clearTimeout(this._failT); this.e.mp.style.opacity = 0; }
  missionTitle(text) { const m = this.e.mtitle; m.textContent = text; m.style.opacity = 1; setTimeout(() => m.style.opacity = 0, 3800); }
  fade(to, ms = 800) { const f = this.e.fade; f.style.transition = `opacity ${ms}ms`; f.style.opacity = to; }
  radioPopup(name, track) { const r = this.e.radioPop; r.querySelector('.n').textContent = name; r.querySelector('.t').textContent = track || ''; r.style.opacity = 1; this.radioT = 3.2; }
  setCinematic(on) { this.root.classList.toggle('cine', !!on); let t = document.getElementById('cineTop'); if (!t) { t = document.createElement('div'); t.id = 'cineTop'; t.className = 'cbar'; document.body.appendChild(t); const b = document.createElement('div'); b.id = 'cineBot'; b.className = 'cbar'; b.innerHTML = '<span>Press ENTER to skip</span>'; document.body.appendChild(b); } document.getElementById('cineTop').classList.toggle('on', !!on); document.getElementById('cineBot').classList.toggle('on', !!on); }
  toast(text) { const t = $('toast'); t.textContent = text; t.style.display = 'block'; clearTimeout(this._tt); this._tt = setTimeout(() => t.style.display = 'none', 2500); }

  updateWeapon(force) {
    const p = G.player; if (!p) return;
    const W = p.weapon, s = p.wslot;
    let html;
    if (W.melee || W.id === 'fist') html = `<div class="wn">${W.name}</div>`;
    else if (W.kind === 'tool') html = `<div class="wn">${W.name}</div>`;
    else html = `<div class="wn">${W.name}</div><div class="wa">${s.clip}<span style="font-size:16px;color:#bbb"> / ${s.ammo}</span>${p.reloadT > 0 ? ' <span style="font-size:13px;color:#f3c35a">RELOADING</span>' : ''}</div>`;
    if (html !== this._wHtml || force) { this._wHtml = html; this.e.weapon.innerHTML = html; }
  }

  update(dt) {
    const p = G.player; if (!p) return;
    // time
    this.e.clock.textContent = G.sky.timeString;
    // money roll
    const tgt = p.money; this.moneyShown += (tgt - this.moneyShown) * Math.min(1, dt * 8); if (Math.abs(tgt - this.moneyShown) < 1) this.moneyShown = tgt;
    this.e.money.textContent = fmtMoney(Math.round(this.moneyShown));
    if (this.moneyDeltaT > 0) { this.moneyDeltaT -= dt; const md = this.e.moneyDelta; md.style.opacity = 1; md.textContent = (this.moneyDeltaSum >= 0 ? '+' : '') + fmtMoney(this.moneyDeltaSum); md.style.color = this.moneyDeltaSum >= 0 ? '#4fd36b' : '#e23a3a'; if (this.moneyDeltaT <= 0) { md.style.opacity = 0; this.moneyDeltaSum = 0; } }
    // bars
    this.e.hp.firstChild.style.width = clamp(p.health / p.maxHealth, 0, 1) * 100 + '%';
    this.e.ar.style.display = p.armor > 0.5 ? 'inline-block' : 'none'; this.e.ar.firstChild.style.width = clamp(p.armor / 100, 0, 1) * 100 + '%';
    this.e.st.style.display = p.stamina < p.maxStamina - 1 ? 'inline-block' : 'none'; this.e.st.firstChild.style.width = clamp(p.stamina / p.maxStamina, 0, 1) * 100 + '%';
    this.e.vignette.style.boxShadow = `inset 0 0 160px rgba(180,0,0,${p.health < 30 ? 0.5 * (1 - p.health / 30) : 0})`;
    this.updateWeapon();
    if (this.timerVal != null) { const t = Math.max(0, this.timerVal); this.e.timer.textContent = (this.timerLabel ? this.timerLabel + ' ' : '') + Math.floor(t / 60) + ':' + pad2(Math.floor(t % 60)); this.e.timer.style.color = t < 15 ? '#ff5050' : '#fff'; }
    // subtitles
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) this.nextSub(); }
    // zone name
    const z = G.map.districtAt(p.vehicle ? p.vehicle.x : p.x, p.vehicle ? p.vehicle.z : p.z);
    const zn = z ? z.name : (G.world.isWater(p.x, p.z) ? 'San Andreas Bay' : '');
    if (zn !== this.lastZone && zn) { this.lastZone = zn; this.e.zoneName.textContent = zn; this.e.zoneName.style.opacity = 1; this.zoneT = 3.6; }
    if (this.zoneT > 0) { this.zoneT -= dt; if (this.zoneT <= 0) this.e.zoneName.style.opacity = 0; }
    // vehicle name + speedo
    const v = p.vehicle;
    if (v !== this.lastVeh) { this.lastVeh = v; if (v) { this.e.vehName.textContent = v.name; this.e.vehName.style.opacity = 1; this.vehNameT = 3; } }
    if (this.vehNameT > 0) { this.vehNameT -= dt; if (this.vehNameT <= 0) this.e.vehName.style.opacity = 0; }
    this.e.speedo.style.display = v ? 'block' : 'none';
    if (v) { const k = Math.round(v.speedKmh); this.e.speedo.innerHTML = `${k}<small> km/h</small><div style="font-size:13px;opacity:.85;margin-top:-2px">${Math.round(clamp(v.health / v.maxHealth, 0, 1) * 100)}% condition</div>`; }
    // crosshair
    const aimShow = (p.aimMode && !p.vehicle) || (p.vehicle && p.aimMode);
    const scoped = aimShow && p.weapon.scope;
    this.e.crosshair.style.display = aimShow && !scoped ? 'block' : 'none';
    this.e.crosshair.classList.toggle('lock', !!p.lockTarget && aimShow);
    this.e.scope.style.display = scoped ? 'block' : 'none';
    // radio popup
    if (this.radioT > 0) { this.radioT -= dt; if (this.radioT <= 0) this.e.radioPop.style.opacity = 0; }
    this.e.stars.classList.toggle('flash', this.stars > 0 && this.seen && false);
    if (this.stars > 0) { const ss = this.e.stars.children; const blink = !this.seen && G.police.hideT > 0 && Math.floor(G.time * 4) % 2; for (let i = 0; i < 6; i++) ss[i].style.opacity = (i < this.stars && blink) ? 0.3 : 1; }
    this.updateTracker();
    this.drawRadar(dt);
  }

  // persistent "next quest" line above the radar: names the mission and the distance to walk/drive
  updateTracker() {
    const t = this.e.tracker, M = G.missions;
    if (!t) return;
    let tag = '', title = '', dist = null;
    if (M && G.game.state === 'play' && !G.game.inCutscene) {
      const pl = G.player, px = pl.vehicle ? pl.vehicle.x : pl.x, pz = pl.vehicle ? pl.vehicle.z : pl.z;
      if (M.active) {
        const r = M.active; tag = 'MISSION'; title = r.title;
        let best = Infinity;
        for (const m of r.markers) if (!m.dead) best = Math.min(best, Math.hypot(m.x - px, m.z - pz));
        for (const b of r.blips) if (!b.hidden) best = Math.min(best, Math.hypot(b.x - px, b.z - pz));
        if (best < Infinity) dist = best;
      } else {
        const mb = G.blips.list.find(x => x.nextQuest && !x.hidden);
        const def = mb ? null : M.nextMain();
        if (mb) { tag = 'NEXT MISSION'; title = mb.label; dist = Math.hypot(mb.x - px, mb.z - pz); }
        else if (def) { tag = 'NEXT MISSION'; title = def.title; const e = M.startMarkers.get(def.id); if (e) dist = Math.hypot(e.marker.x - px, e.marker.z - pz); }
      }
    }
    if (!title) { t.style.display = 'none'; this._trkKey = null; return; }
    const key = tag + '|' + title;
    if (this._trkKey !== key) {
      this._trkKey = key;
      t.innerHTML = '<span class="tag"></span> <span class="ttl"></span> <span class="d"></span>';
      t.querySelector('.tag').textContent = tag;
      t.querySelector('.ttl').textContent = title;
      this._trkD = t.querySelector('.d');
    }
    if (this._trkD) this._trkD.textContent = dist == null ? '' : '· ' + (dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m');
    t.style.display = 'block';
  }

  drawRadar(dt) {
    const c = this.radar, S = 420, R = S / 2, p = G.player;
    if (!this.mapCanvas) return;
    const v = p.vehicle; const px = v ? v.x : p.x, pz = v ? v.z : p.z;
    const yaw = v ? v.yaw : (G.camera ? G.camera.yaw : p.yaw);
    const targetRange = v ? 150 + clamp(v.totalSpeed * 2.2, 0, 90) : 105;
    this.radarRange = lerp(this.radarRange, targetRange, Math.min(1, dt * 3));
    const ppm = (R - 8) / this.radarRange;
    c.clearRect(0, 0, S, S);
    c.save(); c.beginPath(); c.arc(R, R, R - 4, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#26323c'; c.fillRect(0, 0, S, S);
    c.translate(R, R); c.rotate(yaw - Math.PI); c.scale(ppm, ppm);
    c.translate(-px, -pz);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.mapCanvas, -HALF * MPP, -HALF * MPP, MAP_N * MPP, MAP_N * MPP);
    c.globalAlpha = 0.3; c.drawImage(this.getGangOverlay(), -HALF * MPP, -HALF * MPP, MAP_N * MPP, MAP_N * MPP); c.globalAlpha = 1;
    c.restore();
    // vignette rim
    const g = c.createRadialGradient(R, R, R * 0.7, R, R, R); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)'); c.fillStyle = g; c.beginPath(); c.arc(R, R, R - 4, 0, Math.PI * 2); c.fill();
    // blips
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const drawBlip = (b, bx, bz) => {
      const dx = bx - px, dz = bz - pz;
      let sx = (-dx * cs + dz * sn) * ppm, sy = (-dx * sn - dz * cs) * ppm;
      let d = Math.hypot(sx, sy); const lim = R - 16; let edge = false;
      const wantArrow = !!(b.edgeArrow || b.nextQuest);
      if (d > lim) { edge = true; const k = (wantArrow ? lim - 14 : lim) / d; sx *= k; sy *= k; }
      const x = R + sx, y = R + sy;
      c.save(); c.translate(x, y);
      if (b.flash && Math.floor(G.time * 3) % 2) c.globalAlpha = 0.35;
      const col = b.color || '#fff';
      if (b.icon === 'square') { c.fillStyle = '#000'; c.fillRect(-9, -9, 18, 18); c.fillStyle = col; c.fillRect(-7, -7, 14, 14); }
      else if (b.icon === 'tri') { c.fillStyle = '#000'; c.beginPath(); c.moveTo(0, -11); c.lineTo(10, 8); c.lineTo(-10, 8); c.closePath(); c.fill(); c.fillStyle = col; c.beginPath(); c.moveTo(0, -8); c.lineTo(7, 6); c.lineTo(-7, 6); c.closePath(); c.fill(); }
      else if (b.icon === 'text') { const r1 = b.nextQuest ? 12 : 9; c.fillStyle = '#000'; c.beginPath(); c.arc(0, 0, r1 + 2, 0, 6.3); c.fill(); c.fillStyle = col; c.beginPath(); c.arc(0, 0, r1, 0, 6.3); c.fill(); c.fillStyle = '#000'; c.font = 'bold ' + (b.nextQuest ? 15 : 13) + 'px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(b.text || '', 0, 1); }
      else { c.fillStyle = '#000'; c.beginPath(); c.arc(0, 0, 8, 0, 6.3); c.fill(); c.fillStyle = col; c.beginPath(); c.arc(0, 0, 6, 0, 6.3); c.fill(); }
      if (b.nextQuest) { // pulsing ring so the main quest blip stands out from shops/activities
        const ph = Math.sin(G.time * 5);
        c.globalAlpha = 0.5 + 0.5 * ph;
        c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.beginPath(); c.arc(0, 0, (b.icon === 'text' ? 16 : 11) + ph * 2, 0, 6.3); c.stroke();
        c.globalAlpha = 1;
      }
      c.restore();
      if (edge && wantArrow) { // off-radar direction arrow on the rim
        const a = Math.atan2(sy, sx);
        c.save(); c.translate(R + Math.cos(a) * (R - 15), R + Math.sin(a) * (R - 15)); c.rotate(a + Math.PI / 2);
        c.fillStyle = '#000'; c.beginPath(); c.moveTo(0, -10); c.lineTo(8, 7); c.lineTo(-8, 7); c.closePath(); c.fill();
        c.fillStyle = col; c.beginPath(); c.moveTo(0, -7); c.lineTo(5.5, 5); c.lineTo(-5.5, 5); c.closePath(); c.fill();
        c.restore();
      }
    };
    for (const b of G.blips.list) { if (b.hidden || b.nextQuest) continue; drawBlip(b, b.x, b.z); }
    for (const b of G.blips.list) { if (b.hidden || !b.nextQuest) continue; drawBlip(b, b.x, b.z); }
    if (G.waypoint) drawBlip({ color: '#ff4fa0', icon: 'tri', edgeArrow: true }, G.waypoint.x, G.waypoint.z);
    // player arrow (center)
    c.save(); c.translate(R, R); c.rotate(-((v ? v.yaw : p.yaw) - yaw)); c.fillStyle = '#000'; c.beginPath(); c.moveTo(0, -13); c.lineTo(10, 11); c.lineTo(0, 6); c.lineTo(-10, 11); c.closePath(); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -10); c.lineTo(7, 8); c.lineTo(0, 4); c.lineTo(-7, 8); c.closePath(); c.fill(); c.restore();
    // cop circle when wanted
    // frame ring
    c.lineWidth = 6; c.strokeStyle = '#000'; c.beginPath(); c.arc(R, R, R - 3, 0, Math.PI * 2); c.stroke();
    if (this.stars > 0) { c.lineWidth = 4; c.strokeStyle = Math.floor(G.time * 3) % 2 ? '#3a6fd8' : '#d83a3a'; c.beginPath(); c.arc(R, R, R - 7, 0, Math.PI * 2); c.stroke(); }
    // health/armor arcs on radar rim
    c.lineWidth = 5; c.lineCap = 'butt';
    const arc = (frac, a0, a1, col) => { c.strokeStyle = col; c.beginPath(); c.arc(R, R, R - 9, a0, a0 + (a1 - a0) * frac); c.stroke(); };
    c.globalAlpha = 0.9; arc(clamp(p.health / p.maxHealth, 0, 1), Math.PI * 0.55, Math.PI * 0.95, '#d83a3a');
    if (p.armor > 0) arc(clamp(p.armor / 100, 0, 1), Math.PI * 1.05, Math.PI * 1.45, '#e8e8e8'); c.globalAlpha = 1;
  }
}
