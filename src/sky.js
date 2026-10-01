// Sky dome, sun/moon lighting, clouds, fog, time-of-day and weather.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, mulberry32 } from './util.js';

const C = (hex) => new THREE.Color(hex);
// keyframes by sun elevation (-1..1 -> we use sin(el)); [top, horizon, sunLight, sunIntensity, hemiSky, hemiGround, hemiIntensity]
const KEYS = [
  { e: -0.25, top: C(0x050a1e), hor: C(0x121d3a), sun: C(0x6677aa), si: 0.0, hs: C(0x4662a8), hg: C(0x26324e), hi: 1.6 },
  { e: -0.06, top: C(0x0a1030), hor: C(0x2a2840), sun: C(0x8a6a70), si: 0.0, hs: C(0x4a6099), hg: C(0x262838), hi: 1.35 },
  { e: 0.0, top: C(0x2a3a70), hor: C(0xe08850), sun: C(0xff9050), si: 0.6, hs: C(0x6a6a90), hg: C(0x3a3030), hi: 0.75 },
  { e: 0.12, top: C(0x3a6cb8), hor: C(0xf0b888), sun: C(0xffc080), si: 1.4, hs: C(0x8aa4cc), hg: C(0x5a5048), hi: 0.95 },
  { e: 0.35, top: C(0x3c82d6), hor: C(0xb4cce8), sun: C(0xfff0d8), si: 2.0, hs: C(0xa8c4ee), hg: C(0x665c50), hi: 1.15 },
  { e: 1.0, top: C(0x2f78d8), hor: C(0xaac8ec), sun: C(0xfff6e8), si: 2.2, hs: C(0xb0ccf4), hg: C(0x6c6254), hi: 1.25 }
];

function sampleKeys(e, out) {
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) if (e >= KEYS[i].e && e <= KEYS[i + 1].e) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  if (e < KEYS[0].e) a = b = KEYS[0]; if (e > KEYS[KEYS.length - 1].e) a = b = KEYS[KEYS.length - 1];
  const t = a === b ? 0 : (e - a.e) / (b.e - a.e);
  out.top.copy(a.top).lerp(b.top, t); out.hor.copy(a.hor).lerp(b.hor, t); out.sun.copy(a.sun).lerp(b.sun, t);
  out.hs.copy(a.hs).lerp(b.hs, t); out.hg.copy(a.hg).lerp(b.hg, t);
  out.si = lerp(a.si, b.si, t); out.hi = lerp(a.hi, b.hi, t);
}

const skyVert = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.9999; }`;
const skyFrag = `
varying vec3 vDir; uniform vec3 uTop, uHor, uSunDir, uSunCol, uMoonDir; uniform float uGlow, uNight, uGrey;
void main(){
  vec3 d = normalize(vDir); float h = max(d.y, 0.0);
  vec3 col = mix(uHor, uTop, pow(h, 0.5));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(s, 6.0) * 0.22 + pow(s, 64.0) * 0.35 + smoothstep(0.9994, 0.9998, s) * 4.0) * uGlow;
  float m = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.75, 0.82, 1.0) * smoothstep(0.9993, 0.9996, m) * uNight * 1.6 + vec3(0.3,0.4,0.6) * pow(m, 40.0) * 0.25 * uNight;
  if (d.y < 0.0) col = mix(uHor, uHor * 0.55, clamp(-d.y * 5.0, 0.0, 1.0));
  float l = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(col, vec3(l) * vec3(0.92, 0.95, 1.0), uGrey);
  gl_FragColor = vec4(col, 1.0);
}`;
const cloudVert = `varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const cloudFrag = `
varying vec2 vW; uniform float uTime, uCover, uDark; uniform vec3 uLight, uShade; uniform vec3 uCam; uniform vec3 uFogCol;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, v = 0.0; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main(){
  vec2 p = vW * 0.0011 + vec2(uTime * 0.004, uTime * 0.0015);
  float n = fbm(p);
  float c = smoothstep(1.0 - uCover, 1.0 - uCover + 0.28, n);
  float dist = length(vW - uCam.xz);
  float fade = 1.0 - smoothstep(1800.0, 4200.0, dist);
  vec3 col = mix(uLight, uShade, clamp(c * 0.6 + uDark, 0.0, 1.0) * (0.4 + 0.6 * fbm(p * 2.3 + 7.0)));
  col = mix(col, uFogCol, smoothstep(1200.0, 4000.0, dist) * 0.7);
  gl_FragColor = vec4(col, c * fade * 0.92);
}`;

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.hour = 12.0; this.timeScale = 1.0 / 2.5; // game hours per real second ( 24 min per day = 1 hour / 60 s ) -> overwritten
    this.dayLengthSec = 24 * 60;      // real seconds per in-game day
    this.weather = 'clear'; this.weatherTarget = 'clear'; this.cover = 0.35; this.coverTarget = 0.35; this.rain = 0; this.rainTarget = 0; this.grey = 0; this.greyTarget = 0;
    this.nextWeatherIn = 120; this.haze = 0.2; this.hazeCur = 0.2;
    this.tmp = { top: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), hs: new THREE.Color(), hg: new THREE.Color(), si: 0, hi: 0 };
    this.sunDir = new THREE.Vector3(0, 1, 0); this.moonDir = new THREE.Vector3(0, -1, 0);
    this.night = 0;       // 0 day .. 1 night
    this.fogColor = new THREE.Color(0xaac8ec);

    // dome
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir }, uSunCol: { value: new THREE.Color() }, uGlow: { value: 1 }, uNight: { value: 0 }, uGrey: { value: 0 } }
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), this.skyMat); this.dome.renderOrder = -10; this.dome.frustumCulled = false;
    scene.add(this.dome);
    // stars
    const r = mulberry32(7), sp = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) { const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u); const y = Math.abs(u) * 0.95 + 0.05; sp[i * 3] = Math.cos(a) * s * 2900; sp[i * 3 + 1] = y * 2900; sp[i * 3 + 2] = Math.sin(a) * s * 2900; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat); this.stars.frustumCulled = false; this.stars.renderOrder = -9; scene.add(this.stars);
    // clouds plane
    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: cloudVert, fragmentShader: cloudFrag, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uCover: { value: 0.4 }, uDark: { value: 0 }, uLight: { value: new THREE.Color(0xffffff) }, uShade: { value: new THREE.Color(0x8a94a8) }, uCam: { value: new THREE.Vector3() }, uFogCol: { value: this.fogColor } }
    });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1), this.cloudMat); this.clouds.rotation.x = -Math.PI / 2; this.clouds.position.y = 700; this.clouds.renderOrder = -8; this.clouds.frustumCulled = false;
    scene.add(this.clouds);
    // lights
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x666666, 1.0); scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.0); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -85; sc.right = 85; sc.top = 85; sc.bottom = -85; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun); scene.add(this.sun.target);
    scene.fog = new THREE.Fog(this.fogColor.clone(), 120, 760);
    this.shadowCenter = new THREE.Vector3();
  }

  setShadows(enabled, size = 2048) {
    this.sun.castShadow = enabled;
    if (enabled && this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
  }

  setWeather(w) {
    this.weatherTarget = w;
    const P = { clear: [0.3, 0, 0], cloudy: [0.62, 0, 0.35], smog: [0.3, 0, 0.12], rain: [0.85, 1, 0.75], storm: [0.95, 1, 0.9] }[w] || [0.3, 0, 0];
    this.coverTarget = P[0]; this.rainTarget = P[1]; this.greyTarget = P[2];
    if (w === 'smog') this.haze = 0.65; else this.haze = w === 'clear' ? 0.2 : 0.3;
  }

  get timeString() { const h = Math.floor(this.hour) % 24, m = Math.floor((this.hour % 1) * 60); return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; }

  update(dt, camera, focus) {
    this.hour = (this.hour + dt * 24 / this.dayLengthSec) % 24;
    // auto weather
    this.nextWeatherIn -= dt;
    if (this.nextWeatherIn < 0 && !this.lockWeather) {
      this.nextWeatherIn = 150 + Math.random() * 240;
      const r = Math.random(); this.setWeather(r < 0.5 ? 'clear' : r < 0.68 ? 'smog' : r < 0.85 ? 'cloudy' : 'rain');
    }
    const k = 1 - Math.exp(-dt * 0.25);
    this.hazeCur = lerp(this.hazeCur, this.haze, 1 - Math.exp(-dt * 0.35));
    const smog = clamp((this.hazeCur - 0.3) / 0.35, 0, 1);
    this.cover = lerp(this.cover, this.coverTarget, k); this.rain = lerp(this.rain, this.rainTarget, k); this.grey = lerp(this.grey, this.greyTarget, k);
    // sun position
    const ang = (this.hour - 6) / 24 * Math.PI * 2;      // 0 at 6:00 (horizon, east) ... PI/2 at noon
    const el = Math.sin(ang);
    this.sunDir.set(Math.cos(ang), el, 0.38).normalize();
    this.moonDir.set(-Math.cos(ang), -el, -0.3).normalize();
    sampleKeys(clamp(this.sunDir.y, -0.25, 1), this.tmp);
    const t = this.tmp;
    this.night = 1 - smoothstep(-0.1, 0.1, this.sunDir.y);
    const grey = this.grey, dim = 1 - grey * 0.35 - this.rain * 0.15;
    // smog tint at horizon
    const hor = t.hor.clone(); if (smog > 0) hor.lerp(new THREE.Color(0xd9b983), smog * 0.92 * (1 - this.night * 0.85));
    const greyCol = new THREE.Color(0x8a909a).multiplyScalar(lerp(1, 0.25, this.night));
    const top = t.top.clone().lerp(greyCol, grey * 0.8); hor.lerp(greyCol.clone().multiplyScalar(1.1), grey * 0.85); if (smog > 0) top.lerp(new THREE.Color(0xb7b08c).multiplyScalar(lerp(1, 0.2, this.night)), smog * 0.7);
    this.skyMat.uniforms.uTop.value.copy(top); this.skyMat.uniforms.uHor.value.copy(hor);
    this.skyMat.uniforms.uSunCol.value.copy(t.sun);
    this.skyMat.uniforms.uGlow.value = (1 - grey) * clamp(this.sunDir.y * 6 + 1, 0, 1);
    this.skyMat.uniforms.uNight.value = this.night * (1 - grey * 0.7);
    this.skyMat.uniforms.uGrey.value = grey * 0.3;
    this.starMat.opacity = this.night * (1 - this.cover * 0.8) * (1 - grey);
    this.cloudMat.uniforms.uTime.value += dt; this.cloudMat.uniforms.uCover.value = this.cover;
    this.cloudMat.uniforms.uDark.value = grey * 0.7;
    this.cloudMat.uniforms.uLight.value.copy(t.sun).lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(lerp(1, 0.25, this.night));
    this.cloudMat.uniforms.uShade.value.copy(top).lerp(new THREE.Color(0x70788a), 0.5).multiplyScalar(lerp(0.9, 0.4, this.night));
    // lights
    const sunI = t.si * (1 - grey * 0.55 - smog * 0.25) * clamp(this.sunDir.y * 8, 0, 1);
    this.sun.color.copy(t.sun); this.sun.intensity = sunI;
    this.hemi.color.copy(t.hs); this.hemi.groundColor.copy(t.hg); this.hemi.intensity = t.hi * (this.night > 0.5 ? 1 : dim);
    // moonlight: directional from moon at night via the sun light object (swap direction when sun below horizon)
    let lightDir = this.sunDir;
    if (this.sunDir.y < 0.02) { lightDir = this.moonDir; this.sun.color.set(0x9db4e8); this.sun.intensity = 0.9 * this.night * (1 - grey * 0.4); }
    if (focus) {
      // snap the shadow frustum centre to the shadow-map texel grid (in light space) so shadows do not shimmer while moving
      const ts = 170 / this.sun.shadow.mapSize.x, L = lightDir;
      const rx = L.z, rz = -L.x, rl = Math.hypot(rx, rz) || 1;            // right = normalize(cross(up, L)) (y component is 0)
      const ux = L.y * rz / rl, uy = (L.z * L.z + L.x * L.x) / rl, uz = -L.y * rx / rl;   // up' = cross(L, right)
      const R0 = { x: rx / rl, z: rz / rl };
      const fx = focus.x, fy = focus.y || 0, fz = focus.z;
      const a = fx * R0.x + fz * R0.z, b = fx * ux + fy * uy + fz * uz;
      const da = Math.round(a / ts) * ts - a, db = Math.round(b / ts) * ts - b;
      this.shadowCenter.set(fx + R0.x * da + ux * db, fy + uy * db, fz + R0.z * da + uz * db);
      this.sun.target.position.copy(this.shadowCenter);
      this.sun.position.copy(this.shadowCenter).addScaledVector(lightDir, 180);
      this.sun.target.updateMatrixWorld();
    }
    // fog
    let fogFar = lerp(690, 330, this.rain) * lerp(1, 0.42, smog) * lerp(1, 0.75, grey);
    { const W = window.G && window.G.world; if (W && W.loadRadius) fogFar = Math.min(fogFar, (W.loadRadius + 0.75) * 128); }   // hide chunk pop-in at the streaming radius
    this.fogColor.copy(hor).lerp(new THREE.Color(0x000000), 0).multiplyScalar(1.0);
    this.scene.fog.color.copy(this.fogColor); this.scene.fog.near = lerp(lerp(150, 40, this.rain * 0.7), 12, smog); this.scene.fog.far = fogFar;
    if (camera) { this.dome.position.copy(camera.position); this.stars.position.copy(camera.position); this.clouds.position.x = camera.position.x; this.clouds.position.z = camera.position.z; this.cloudMat.uniforms.uCam.value.copy(camera.position); }
    this.weather = this.rain > 0.5 ? 'rain' : this.grey > 0.25 ? 'cloudy' : this.haze > 0.4 ? 'smog' : 'clear';
  }

  // darkness factor for street lamps / headlights / windows (0 day .. 1 night)
  get dark() { return clamp(this.night + this.grey * 0.25 * (1 - this.night), 0, 1); }
}
