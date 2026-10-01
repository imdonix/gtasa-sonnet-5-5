// Night lighting extras: street-lamp pools, vehicle headlight beams + player spotlights, dynamic traffic signals.
import * as THREE from 'three';
import { G } from './state.js';
import { clamp, dist2 } from './util.js';

function radialTexture(stops, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2); for (const [t, col] of stops) g.addColorStop(t, col);
  x.fillStyle = g; x.fillRect(0, 0, size, size); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function beamTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const x = c.getContext('2d');
  // trapezoid fan: narrow at the top (car), wide at bottom
  const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, 'rgba(255,245,210,0.95)'); g.addColorStop(0.35, 'rgba(255,240,200,0.45)'); g.addColorStop(1, 'rgba(255,240,200,0)');
  x.fillStyle = g; x.beginPath(); x.moveTo(24, 0); x.lineTo(40, 0); x.lineTo(62, 128); x.lineTo(2, 128); x.closePath(); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Lights {
  constructor() {
    this.lampTex = radialTexture([[0, 'rgba(255,214,140,0.85)'], [0.4, 'rgba(255,190,110,0.35)'], [1, 'rgba(255,170,90,0)']]);
    this.haloTex = radialTexture([[0, 'rgba(255,240,200,1)'], [0.3, 'rgba(255,220,150,0.5)'], [1, 'rgba(255,200,120,0)']]);
    this.beamTex = beamTexture();
    // street lamps
    this.lamps = G.world.placement.props.filter(p => p.kind === 'lamp');
    this.maxLamps = 40; this.pool = [];
    const poolMat = new THREE.MeshBasicMaterial({ map: this.lampTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const haloMat = new THREE.SpriteMaterial({ map: this.haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < this.maxLamps; i++) {
      const m = new THREE.Mesh(geo, poolMat); m.scale.set(19, 1, 19); m.visible = false; m.renderOrder = 3; G.scene.add(m);
      const h = new THREE.Sprite(haloMat); h.scale.set(1.8, 1.8, 1); h.visible = false; G.scene.add(h);
      this.pool.push({ m, h });
    }
    this.beamMat = new THREE.MeshBasicMaterial({ map: this.beamTex, opacity: 0.55, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    this.beamGeo = new THREE.PlaneGeometry(9, 24); this.beamGeo.rotateX(-Math.PI / 2); this.beamGeo.translate(0, 0, 12.5);
    // player's real headlights
    this.spot = new THREE.SpotLight(0xfff0d0, 0, 70, 0.55, 0.7, 1.2); this.spot.castShadow = false; G.scene.add(this.spot); G.scene.add(this.spot.target);
    this.spot2 = new THREE.PointLight(0xffd8a0, 0, 16, 2); G.scene.add(this.spot2);
    // flood-light towers (docks / airport apron / stadium car parks): big soft pools of cool light on the ground
    this.floods = (G.world.placement.setpieces && G.world.placement.setpieces.floods) || [];
    this.floodTex = radialTexture([[0, 'rgba(255,250,232,0.62)'], [0.45, 'rgba(255,244,215,0.25)'], [1, 'rgba(255,240,205,0)']], 64);
    const fmat = new THREE.MeshBasicMaterial({ map: this.floodTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.floodPool = [];
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(geo, fmat.clone()); m.scale.set(64, 1, 64); m.visible = false; m.renderOrder = 3; G.scene.add(m); this.floodPool.push(m); }
    this.floodTimer = 0;
    // traffic signals
    this.sigMeshes = new Map();
    this.timer = 0;
    this.lampTimer = 0;
  }

  update(dt) {
    const dark = G.sky.dark; const cam = G.cam.position;
    this.updateLamps(dt, dark, cam);
    this.updateFloods(dt, dark, cam);
    this.updateBeams(dark, cam);
    this.updateSignals(dt, cam);
    if (G.models.props.setPropNight) G.models.props.setPropNight(G.world.propMat, dark);
  }

  updateLamps(dt, dark, cam) {
    this.lampTimer -= dt;
    if (this.lampTimer <= 0) {
      this.lampTimer = 0.4;
      // nearest N lamps to camera
      const near = [];
      for (const p of this.lamps) { const d = dist2(p.x, p.z, cam.x, cam.z); if (d < 130 * 130) near.push([d, p]); }
      near.sort((a, b) => a[0] - b[0]);
      this.active = near.slice(0, this.maxLamps).map(e => e[1]);
    }
    const on = dark > 0.3;
    for (let i = 0; i < this.pool.length; i++) {
      const pr = this.pool[i]; const p = this.active && this.active[i];
      if (!on || !p || p.removed) { pr.m.visible = false; pr.h.visible = false; continue; }
      const y = G.world.groundY(p.x, p.z);
      pr.m.position.set(p.x + (p.lx || 0), y + 0.2, p.z + (p.lz || 0)); pr.m.visible = true; pr.m.material.opacity = clamp((dark - 0.3) * 2, 0, 1);
      pr.h.position.set(p.x, y + 7.6, p.z); pr.h.visible = true; pr.h.material.opacity = clamp((dark - 0.3) * 2, 0, 1);
    }
  }

  updateFloods(dt, dark, cam) {
    this.floodTimer -= dt;
    if (this.floodTimer <= 0) {
      this.floodTimer = 0.5;
      const near = []; for (const f of this.floods) { const d = dist2(f.x, f.z, cam.x, cam.z); if (d < 280 * 280) near.push([d, f]); }
      near.sort((a, b) => a[0] - b[0]); this.floodActive = near.slice(0, this.floodPool.length).map(e => e[1]);
    }
    const on = dark > 0.3;
    for (let i = 0; i < this.floodPool.length; i++) {
      const m = this.floodPool[i], f = this.floodActive && this.floodActive[i];
      if (!on || !f) { m.visible = false; continue; }
      m.position.set(f.x, G.world.groundY(f.x, f.z) + 0.25, f.z); m.visible = true; m.material.opacity = clamp((dark - 0.3) * 2, 0, 1);
    }
  }

  updateBeams(dark, cam) {
    const on = dark > 0.45;
    for (const v of G.vehicles.list) {
      const want = on && v.lights && !v.wrecked && !v.isBike && dist2(v.x, v.z, cam.x, cam.z) < 110 * 110;
      if (want && !v.beam) { v.beam = new THREE.Mesh(this.beamGeo, this.beamMat); v.beam.position.set(0, 0.18, v.def.length / 2 - 0.3); v.beam.renderOrder = 4; v.group.add(v.beam); }
      if (v.beam) { v.beam.visible = !!want;  }
    }
    // real spot for the player's vehicle
    const pv = G.player.vehicle;
    if (pv && dark > 0.45 && pv.lights && !pv.wrecked) {
      const f = { x: Math.sin(pv.yaw), z: Math.cos(pv.yaw) };
      this.spot.position.set(pv.x + f.x * 1.6, pv.y + 0.5, pv.z + f.z * 1.6);
      this.spot.target.position.set(pv.x + f.x * 22, pv.y - 1.2, pv.z + f.z * 22); this.spot.intensity = 60 * clamp((dark - 0.45) * 3, 0, 1);
      this.spot2.position.set(pv.x + f.x * 6, pv.y + 1.4, pv.z + f.z * 6); this.spot2.intensity = 6 * clamp((dark - 0.45) * 3, 0, 1);
    } else { this.spot.intensity = 0; this.spot2.intensity = 0; }
  }

  updateSignals(dt, cam) {
    this.timer -= dt; if (this.timer > 0) return; this.timer = 0.25;
    const P = G.models.props; const nav = G.nav; const W = G.world;
    const keep = new Set();
    for (const sig of W.signals) {
      if (dist2(sig.x, sig.z, cam.x, cam.z) > 170 * 170) continue;
      for (let i = 0; i < sig.arms.length; i++) {
        const arm = sig.arms[i]; const key = sig.node + ':' + i; keep.add(key);
        const st = nav.lightState(sig.node, arm.axis); const variant = st === 'green' ? 1 : st === 'yellow' ? 2 : 0;
        let m = this.sigMeshes.get(key);
        if (!m) {
          m = new THREE.Mesh(W._propGeo('trafficlight', variant), W.propMat); m.castShadow = true;
          m.position.set(arm.x, W.groundY(arm.x, arm.z), arm.z); m.rotation.y = Math.atan2(arm.ux, arm.uz); m.userData.variant = variant; G.scene.add(m); this.sigMeshes.set(key, m);
        } else if (m.userData.variant !== variant) { m.geometry = W._propGeo('trafficlight', variant); m.userData.variant = variant; }
      }
    }
    for (const [k, m] of this.sigMeshes) if (!keep.has(k)) { G.scene.remove(m); this.sigMeshes.delete(k); }
  }
}
