// Particle effects (instanced camera-facing quads), tracers, flashes, rain.
import * as THREE from 'three';
import { clamp, lerp } from './util.js';

const vert = `
attribute vec3 aPos; attribute vec4 aCol; attribute vec2 aSR; // size, rotation
varying vec4 vCol; varying vec2 vUv;
void main(){
  vUv = position.xy + 0.5;
  vec4 mv = viewMatrix * vec4(aPos, 1.0);
  float c = cos(aSR.y), s = sin(aSR.y);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aSR.x;
  mv.xy += q;
  vCol = aCol;
  gl_Position = projectionMatrix * mv;
}`;
const frag = `
uniform sampler2D uTex; varying vec4 vCol; varying vec2 vUv;
void main(){ vec4 t = texture2D(uTex, vUv); gl_FragColor = vec4(vCol.rgb, vCol.a * t.a); if (gl_FragColor.a < 0.01) discard; }`;

function makeSoftTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  if (kind === 'smoke') {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    // lumpy
    for (let i = 0; i < 6; i++) { const px = 16 + Math.random() * 32, py = 16 + Math.random() * 32, r = 10 + Math.random() * 10; const g2 = x.createRadialGradient(px, py, 0, px, py, r); g2.addColorStop(0, 'rgba(255,255,255,0.25)'); g2.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g2; x.fillRect(0, 0, 64, 64); }
  } else {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c); return t;
}

class Pool {
  constructor(scene, max, additive, kind) {
    this.max = max; this.n = 0;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry(); g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.aCol.setUsage(THREE.DynamicDrawUsage);
    this.aSR = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2); this.aSR.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos); g.setAttribute('aCol', this.aCol); g.setAttribute('aSR', this.aSR);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uTex: { value: makeSoftTexture(kind) } } });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 6 : 5;
    scene.add(this.mesh);
    // particle state
    this.px = new Float32Array(max); this.py = new Float32Array(max); this.pz = new Float32Array(max);
    this.vx = new Float32Array(max); this.vy = new Float32Array(max); this.vz = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.rot = new Float32Array(max); this.rotV = new Float32Array(max);
    this.c0 = new Float32Array(max * 4); this.c1 = new Float32Array(max * 4);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
  }
  emit(o) {
    let i;
    if (this.n < this.max) i = this.n++; else i = (Math.random() * this.max) | 0;
    this.px[i] = o.x; this.py[i] = o.y; this.pz[i] = o.z; this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0; this.vz[i] = o.vz || 0;
    this.life[i] = this.maxLife[i] = o.life || 1; this.s0[i] = o.s0 ?? 1; this.s1[i] = o.s1 ?? o.s0 ?? 1;
    this.rot[i] = o.rot ?? Math.random() * 6.28; this.rotV[i] = o.rotV ?? 0; this.drag[i] = o.drag ?? 0; this.grav[i] = o.grav ?? 0;
    const a = o.c0 || [1, 1, 1, 1], b = o.c1 || a;
    for (let k = 0; k < 4; k++) { this.c0[i * 4 + k] = a[k]; this.c1[i * 4 + k] = b[k]; }
  }
  update(dt) {
    let i = 0;
    const pa = this.aPos.array, ca = this.aCol.array, sa = this.aSR.array;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { // swap remove
        const l = this.n - 1;
        if (i !== l) this._copy(l, i);
        this.n--; continue;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      const dr = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= dr; this.vy[i] = this.vy[i] * dr - this.grav[i] * dt; this.vz[i] *= dr;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.rotV[i] * dt;
      pa[i * 3] = this.px[i]; pa[i * 3 + 1] = this.py[i]; pa[i * 3 + 2] = this.pz[i];
      for (let k = 0; k < 4; k++) ca[i * 4 + k] = this.c0[i * 4 + k] + (this.c1[i * 4 + k] - this.c0[i * 4 + k]) * t;
      sa[i * 2] = this.s0[i] + (this.s1[i] - this.s0[i]) * t; sa[i * 2 + 1] = this.rot[i];
      i++;
    }
    this.mesh.geometry.instanceCount = this.n;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSR.needsUpdate = true;
  }
  _copy(a, b) {
    for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'maxLife', 's0', 's1', 'rot', 'rotV', 'drag', 'grav']) this[k][b] = this[k][a];
    for (let k = 0; k < 4; k++) { this.c0[b * 4 + k] = this.c0[a * 4 + k]; this.c1[b * 4 + k] = this.c1[a * 4 + k]; }
  }
}

export class FX {
  constructor(scene, terrain) {
    this.scene = scene; this.terrain = terrain;
    this.smoke = new Pool(scene, 1600, false, 'smoke');
    this.glow = new Pool(scene, 1200, true, 'glow');
    // tracers
    const TR = 40; this.tracerN = TR;
    const tg = new THREE.BufferGeometry(); this.tracePos = new Float32Array(TR * 6); this.traceCol = new Float32Array(TR * 6);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracePos, 3).setUsage(THREE.DynamicDrawUsage)); tg.setAttribute('color', new THREE.BufferAttribute(this.traceCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerLines = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracerLines.frustumCulled = false; scene.add(this.tracerLines);
    this.tracers = [];
    // point light pool for flashes
    this.flashLights = []; for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffaa55, 0, 40, 2); scene.add(l); this.flashLights.push({ l, t: 0, dur: 0.1, peak: 0 }); }
    this._tmp = new THREE.Vector3();
  }
  update(dt) {
    this.smoke.update(dt); this.glow.update(dt);
    // tracers
    this.tracePos.fill(0);
    let k = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]; t.life -= dt;
      if (t.life <= 0) { this.tracers.splice(i, 1); continue; }
    }
    for (let i = 0; i < this.tracers.length && k < this.tracerN; i++, k++) {
      const t = this.tracers[i]; const a = t.life / t.maxLife;
      const f0 = 1 - a, f1 = clamp(f0 + 0.35, 0, 1); // moving streak
      this.tracePos[k * 6] = lerp(t.ax, t.bx, f0); this.tracePos[k * 6 + 1] = lerp(t.ay, t.by, f0); this.tracePos[k * 6 + 2] = lerp(t.az, t.bz, f0);
      this.tracePos[k * 6 + 3] = lerp(t.ax, t.bx, f1); this.tracePos[k * 6 + 4] = lerp(t.ay, t.by, f1); this.tracePos[k * 6 + 5] = lerp(t.az, t.bz, f1);
      for (let q = 0; q < 6; q += 3) { this.traceCol[k * 6 + q] = 1.0; this.traceCol[k * 6 + q + 1] = 0.85 * a + 0.1; this.traceCol[k * 6 + q + 2] = 0.45 * a; }
    }
    this.tracerLines.geometry.attributes.position.needsUpdate = true; this.tracerLines.geometry.attributes.color.needsUpdate = true;
    for (const f of this.flashLights) { if (f.t > 0) { f.t -= dt; f.l.intensity = Math.max(0, f.t / f.dur) * f.peak; } else f.l.intensity = 0; }
  }
  tracer(a, b, life = 0.09) { this.tracers.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, life, maxLife: life }); if (this.tracers.length > this.tracerN) this.tracers.shift(); }
  flash(x, y, z, peak = 6, dur = 0.12, color = 0xffaa55, dist = 30) {
    let f = this.flashLights.find(q => q.t <= 0) || this.flashLights[0];
    f.l.position.set(x, y, z); f.l.color.setHex(color); f.l.distance = dist; f.t = f.dur = dur; f.peak = peak;
  }
  // ---- presets
  muzzle(x, y, z, dirx, dirz, size = 0.5) {
    this.glow.emit({ x, y, z, vx: dirx * 2, vz: dirz * 2, life: 0.06, s0: size, s1: size * 0.3, c0: [1, 0.85, 0.4, 1], c1: [1, 0.5, 0.1, 0] });
    this.glow.emit({ x: x + dirx * 0.35, y, z: z + dirz * 0.35, life: 0.05, s0: size * 0.7, s1: size * 0.2, c0: [1, 1, 0.8, 1], c1: [1, 0.6, 0.2, 0] });
    this.flash(x, y, z, 5, 0.07);
  }
  smokePuff(x, y, z, size = 1.2, life = 1.4, dark = 0.5, vy = 1.2) {
    const g = dark; this.smoke.emit({ x, y, z, vx: (Math.random() - 0.5) * 0.6, vy, vz: (Math.random() - 0.5) * 0.6, life, s0: size * 0.5, s1: size * 2.4, c0: [g, g, g, 0.55], c1: [g * 0.8, g * 0.8, g * 0.8, 0], rotV: (Math.random() - 0.5) * 1.2, drag: 0.6 });
  }
  dust(x, y, z, n = 4, size = 0.8, col = [0.62, 0.56, 0.46]) {
    for (let i = 0; i < n; i++) this.smoke.emit({ x, y, z, vx: (Math.random() - 0.5) * 2.5, vy: Math.random() * 1.5, vz: (Math.random() - 0.5) * 2.5, life: 0.6 + Math.random() * 0.6, s0: size * 0.4, s1: size * 1.8, c0: [col[0], col[1], col[2], 0.5], c1: [col[0], col[1], col[2], 0], drag: 2 });
  }
  sparks(x, y, z, n = 6, nx = 0, nz = 0) {
    for (let i = 0; i < n; i++) this.glow.emit({ x, y, z, vx: nx * 3 + (Math.random() - 0.5) * 5, vy: Math.random() * 4, vz: nz * 3 + (Math.random() - 0.5) * 5, life: 0.25 + Math.random() * 0.3, s0: 0.12, s1: 0.03, c0: [1, 0.85, 0.4, 1], c1: [1, 0.4, 0.1, 0], grav: 12 });
  }
  blood(x, y, z, dx = 0, dz = 0, n = 8) {
    for (let i = 0; i < n; i++) this.smoke.emit({ x, y, z, vx: dx * 2 + (Math.random() - 0.5) * 3, vy: Math.random() * 2.5, vz: dz * 2 + (Math.random() - 0.5) * 3, life: 0.4 + Math.random() * 0.4, s0: 0.18, s1: 0.1, c0: [0.55, 0.02, 0.02, 0.9], c1: [0.3, 0.0, 0.0, 0], grav: 9, drag: 0.5 });
  }
  splash(x, z, n = 12, size = 1) {
    for (let i = 0; i < n; i++) this.smoke.emit({ x, y: 0.1, z, vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4, vz: (Math.random() - 0.5) * 4, life: 0.6 + Math.random() * 0.4, s0: 0.3 * size, s1: 0.15 * size, c0: [0.85, 0.92, 1, 0.8], c1: [0.85, 0.92, 1, 0], grav: 9 });
  }
  fire(x, y, z, size = 1.4) {
    this.glow.emit({ x: x + (Math.random() - 0.5) * size * 0.6, y, z: z + (Math.random() - 0.5) * size * 0.6, vy: 1.5 + Math.random() * 2, life: 0.5 + Math.random() * 0.4, s0: size * 0.9, s1: size * 0.25, c0: [1, 0.6, 0.15, 0.9], c1: [0.8, 0.1, 0, 0], drag: 0.5 });
    if (Math.random() < 0.5) this.smokePuff(x + (Math.random() - 0.5) * size, y + 0.8, z + (Math.random() - 0.5) * size, size * 1.0, 1.8, 0.2, 2.2);
  }
  explosion(x, y, z, r = 8) {
    const n = Math.floor(14 + r * 2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, e = Math.random() * 1.2, sp = (2 + Math.random() * 5) * r / 8;
      this.glow.emit({ x, y: y + 0.5, z, vx: Math.cos(a) * sp, vy: e * sp * 0.9 + 1, vz: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.5, s0: r * 0.5, s1: r * 0.25, c0: [1, 0.75, 0.25, 1], c1: [0.9, 0.2, 0, 0], drag: 1.2 });
    }
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, sp = (1 + Math.random() * 4) * r / 8, g = 0.1 + Math.random() * 0.25;
      this.smoke.emit({ x, y: y + 1, z, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 5 * r / 8, vz: Math.sin(a) * sp, life: 1.8 + Math.random() * 1.6, s0: r * 0.4, s1: r * 1.4, c0: [g, g, g, 0.8], c1: [g, g, g, 0], drag: 0.7, rotV: (Math.random() - 0.5) });
    }
    for (let i = 0; i < 18; i++) { const a = Math.random() * 6.28, sp = 5 + Math.random() * 14; this.glow.emit({ x, y: y + 1, z, vx: Math.cos(a) * sp, vy: 4 + Math.random() * 12, vz: Math.sin(a) * sp, life: 0.8 + Math.random() * 0.8, s0: 0.35, s1: 0.1, c0: [1, 0.7, 0.2, 1], c1: [1, 0.2, 0, 0], grav: 14 }); }
    this.flash(x, y + 2, z, 40, 0.5, 0xffaa44, 90);
  }
  tireSmoke(x, y, z, vx, vz) { this.smoke.emit({ x, y, z, vx: vx * 0.2 + (Math.random() - 0.5) * 0.6, vy: 0.6, vz: vz * 0.2 + (Math.random() - 0.5) * 0.6, life: 0.9, s0: 0.5, s1: 1.8, c0: [0.85, 0.85, 0.85, 0.35], c1: [0.8, 0.8, 0.8, 0], drag: 1.2 }); }
  debris(x, y, z, n = 6, col = [0.3, 0.3, 0.3]) { for (let i = 0; i < n; i++) this.smoke.emit({ x, y, z, vx: (Math.random() - 0.5) * 7, vy: 2 + Math.random() * 6, vz: (Math.random() - 0.5) * 7, life: 0.8 + Math.random() * 0.6, s0: 0.22, s1: 0.18, c0: [col[0], col[1], col[2], 1], c1: [col[0], col[1], col[2], 0], grav: 14 }); }
}

// Rain: streak lines around the camera
export class Rain {
  constructor(scene) {
    this.N = 1500; const g = new THREE.BufferGeometry(); this.pos = new Float32Array(this.N * 6); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.seed = new Float32Array(this.N * 3); for (let i = 0; i < this.N; i++) { this.seed[i * 3] = Math.random(); this.seed[i * 3 + 1] = Math.random(); this.seed[i * 3 + 2] = Math.random(); }
    this.mat = new THREE.LineBasicMaterial({ color: 0xb4c2d2, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(g, this.mat); this.lines.frustumCulled = false; scene.add(this.lines); this.t = 0;
  }
  update(dt, camPos, intensity) {
    this.mat.opacity = Math.min(0.55, intensity * 0.6); this.lines.visible = intensity > 0.05; if (!this.lines.visible) return;
    this.t += dt; const R = 26, H = 22;
    const n = Math.floor(this.N * clamp(intensity, 0, 1));
    for (let i = 0; i < this.N; i++) {
      if (i >= n) { this.pos.fill(0, i * 6, i * 6 + 6); continue; }
      const sx = this.seed[i * 3], sy = this.seed[i * 3 + 1], sz = this.seed[i * 3 + 2];
      const y = ((sy * H - this.t * 24) % H + H) % H; // falling
      const x = camPos.x + (sx - 0.5) * 2 * R, z = camPos.z + (sz - 0.5) * 2 * R, yy = camPos.y - 6 + y;
      this.pos[i * 6] = x; this.pos[i * 6 + 1] = yy; this.pos[i * 6 + 2] = z; this.pos[i * 6 + 3] = x - 0.16; this.pos[i * 6 + 4] = yy + 1.1; this.pos[i * 6 + 5] = z - 0.08;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
