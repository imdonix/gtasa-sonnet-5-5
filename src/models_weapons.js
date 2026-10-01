// Weapon / hand-held item models for Los Santos Rising (PEDS worker).
// Every model faces +Z (muzzle / blade / business end), +Y is up, origin = centre of the grip.
// Geometry is built once per weapon id (vertex coloured, merged) and cached; instances share geometry + material.
import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------------------
// GeoBuilder: tiny merged-geometry builder with per-piece vertex colours (also used by models_peds.js)
// ---------------------------------------------------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(),
      _s = new THREE.Vector3(), _c = new THREE.Color();

export class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.c = []; }

  _add(geo, color, x, y, z, rx, ry, rz, sx, sy, sz) {
    _c.set(color);
    _e.set(rx, ry, rz, 'XYZ'); _q.setFromEuler(_e);
    _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(_m);
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    for (let i = 0; i < P.length; i++) { this.p.push(P[i]); this.n.push(N[i]); }
    for (let i = 0; i < P.length; i += 3) this.c.push(_c.r, _c.g, _c.b);
    g.dispose();
    return this;
  }
  box(w, h, d, x, y, z, color, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.BoxGeometry(1, 1, 1); this._add(g, color, x, y, z, rx, ry, rz, w, h, d); g.dispose(); return this;
  }
  cyl(rTop, rBot, h, seg, x, y, z, color, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, false);
    this._add(g, color, x, y, z, rx, ry, rz, sx, sy, sz); g.dispose(); return this;
  }
  // cylinder along Z from z0 (radius r0) to z1 (radius r1 at +Z end)
  cylZ(r0, r1, z0, z1, x, y, color, seg = 8, sx = 1, sy = 1) {
    return this.cyl(r1, r0, z1 - z0, seg, x, y, (z0 + z1) / 2, color, Math.PI / 2, 0, 0, sx, 1, sy);
  }
  sphere(r, x, y, z, color, sx = 1, sy = 1, sz = 1, ws = 8, hs = 6, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.SphereGeometry(r, ws, hs); this._add(g, color, x, y, z, rx, ry, rz, sx, sy, sz); g.dispose(); return this;
  }
  // spherical cap (from the pole down to polar angle thetaLen)
  cap(r, thetaLen, x, y, z, color, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, ws = 10, hs = 6) {
    const g = new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, thetaLen);
    this._add(g, color, x, y, z, rx, ry, rz, sx, sy, sz); g.dispose(); return this;
  }
  // loft of rounded cross sections along Y. sections: [{y,w,d,x?,z?}]
  loft(sections, color, o = {}) {
    const n = o.n || 10, pw = o.p || 2.4, capT = o.capTop !== false, capB = o.capBottom !== false;
    const rings = sections.length, V = [];
    for (let i = 0; i < rings; i++) {
      const s = sections[i];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        const px = Math.sign(c) * Math.pow(Math.abs(c), 2 / pw), pz = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / pw);
        V.push((s.x || 0) + px * s.w / 2, s.y, (s.z || 0) + pz * s.d / 2);
      }
    }
    const idx = [];
    for (let i = 0; i < rings - 1; i++) for (let k = 0; k < n; k++) {
      const a = i * n + k, b = i * n + (k + 1) % n, c = (i + 1) * n + k, d = (i + 1) * n + (k + 1) % n;
      idx.push(a, c, b, b, c, d);
    }
    if (capT) { const ci = V.length / 3; const s = sections[rings - 1]; V.push(s.x || 0, s.y, s.z || 0); for (let k = 0; k < n; k++) idx.push(ci, (rings - 1) * n + k, (rings - 1) * n + (k + 1) % n); }
    if (capB) { const ci = V.length / 3; const s = sections[0]; V.push(s.x || 0, s.y, s.z || 0); for (let k = 0; k < n; k++) idx.push(ci, (k + 1) % n, k); }
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
    g.setIndex(idx); g.computeVertexNormals();
    // make sure normals point outwards (winding depends on ring direction)
    const nn = g.attributes.normal, pp = g.attributes.position;
    const mid = Math.floor(rings / 2) * n;
    const s0 = sections[Math.floor(rings / 2)];
    const dx = pp.getX(mid) - (s0.x || 0), dz = pp.getZ(mid) - (s0.z || 0);
    if (nn.getX(mid) * dx + nn.getZ(mid) * dz < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
    this._add(g, color, 0, 0, 0, 0, 0, 0, 1, 1, 1); g.dispose(); return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------------------------------
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
// kind: 'pistol'|'long'|'melee'|'throw'|'rpg'|'tool'
export const WEAPON_DEFS = {
  fist:      { name: 'Fists',          kind: 'melee',  twoHanded: false, muzzle: V3(0, 0, 0.1),     grip2: V3(0, 0, 0),         length: 0 },
  bat:       { name: 'Baseball Bat',   kind: 'melee',  twoHanded: false, muzzle: V3(0, 0, 0.80),    grip2: V3(0, 0, -0.105),    length: 0.95 },
  knife:     { name: 'Knife',          kind: 'melee',  twoHanded: false, muzzle: V3(0, 0, 0.26),    grip2: V3(0, 0, 0),         length: 0.3 },
  pistol:    { name: '9mm Pistol',     kind: 'pistol', twoHanded: false, muzzle: V3(0, 0.075, 0.17), grip2: V3(0, -0.03, 0.02), length: 0.2 },
  deagle:    { name: 'Desert Eagle',   kind: 'pistol', twoHanded: false, muzzle: V3(0, 0.09, 0.27),  grip2: V3(0, -0.035, 0.03), length: 0.3 },
  shotgun:   { name: 'Pump Shotgun',   kind: 'long',   twoHanded: true,  muzzle: V3(0, 0.06, 0.79),  grip2: V3(0, -0.012, 0.36), length: 1.2 },
  smg:       { name: 'Micro SMG',      kind: 'long',   twoHanded: true,  muzzle: V3(0, 0.055, 0.27), grip2: V3(0, -0.012, 0.17), length: 0.45 },
  ak47:      { name: 'AK-47',          kind: 'long',   twoHanded: true,  muzzle: V3(0, 0.056, 0.73), grip2: V3(0, -0.012, 0.25), length: 1.1 },
  sniper:    { name: 'Sniper Rifle',   kind: 'long',   twoHanded: true,  muzzle: V3(0, 0.06, 1.05),  grip2: V3(0, -0.012, 0.33), length: 1.55 },
  rpg:       { name: 'RPG Launcher',   kind: 'rpg',    twoHanded: true,  muzzle: V3(0, 0.13, 0.78),  grip2: V3(0, 0.0, 0.24),    length: 1.35 },
  grenade:   { name: 'Grenade',        kind: 'throw',  twoHanded: false, muzzle: V3(0, 0.02, 0.04),  grip2: V3(0, 0, 0),         length: 0.1 },
  molotov:   { name: 'Molotov',        kind: 'throw',  twoHanded: false, muzzle: V3(0, 0.2, 0),      grip2: V3(0, 0, 0),         length: 0.3 },
  spraycan:  { name: 'Spray Can',      kind: 'tool',   twoHanded: false, muzzle: V3(0, 0.118, 0.03), grip2: V3(0, 0, 0),         length: 0.17 },
  cellphone: { name: 'Cellphone',      kind: 'tool',   twoHanded: false, muzzle: V3(0, 0, 0.06),     grip2: V3(0, 0, 0),         length: 0.12 },
  camera:    { name: 'Camera',         kind: 'tool',   twoHanded: false, muzzle: V3(0, 0.0, 0.1),    grip2: V3(0, 0, 0),         length: 0.15 },
};

// ---------------------------------------------------------------------------------------------------------
// Geometry recipes
// ---------------------------------------------------------------------------------------------------------
const K = { metal: 0x2e3138, dark: 0x16171a, steel: 0x7d838e, chrome: 0xc3c8d0, wood: 0x8a5428, wood2: 0x5a3418,
            rubber: 0x1e1e20, olive: 0x4a5636, bake: 0x7a3c18, green: 0x3a4a30, brass: 0xb8923a };

const RECIPES = {
  fist(b) { },

  bat(b) {
    const W = 0xc9a060, W2 = 0xa67b40;
    b.cylZ(0.016, 0.016, -0.15, 0.24, 0, 0, K.rubber, 8);          // taped handle
    b.sphere(0.025, 0, 0, -0.155, W2, 1, 1, 0.6);                   // knob
    b.cylZ(0.016, 0.035, 0.24, 0.6, 0, 0, W, 10);                   // taper
    b.cylZ(0.035, 0.037, 0.6, 0.78, 0, 0, W, 10);                   // barrel
    b.sphere(0.037, 0, 0, 0.78, W, 1, 1, 0.7, 10, 6);               // rounded end
    b.cylZ(0.0375, 0.0375, 0.66, 0.69, 0, 0, W2, 10);               // dark band (brand)
  },

  knife(b) {
    b.box(0.024, 0.034, 0.11, 0, 0, 0, K.rubber);
    b.box(0.026, 0.006, 0.112, 0, 0.0, 0, K.dark, 0, 0, 0, 1, 1, 1);
    b.box(0.008, 0.048, 0.014, 0, 0.004, 0.062, K.steel);            // guard
    b.box(0.005, 0.034, 0.15, 0, 0.004, 0.14, K.chrome);             // blade
    b.cyl(0, 0.0175, 0.06, 4, 0, 0.004, 0.245, K.chrome, Math.PI / 2, 0, Math.PI / 4, 0.3, 1, 1); // tip (flattened diamond)
    b.box(0.0055, 0.006, 0.12, 0, 0.0195, 0.135, K.steel);           // spine
  },

  pistol(b) {
    b.box(0.03, 0.108, 0.048, 0, 0, -0.008, K.rubber, 0.2);          // grip (raked)
    b.box(0.032, 0.012, 0.052, 0, -0.058, -0.024, K.steel, 0.2);     // mag base
    b.box(0.03, 0.03, 0.135, 0, 0.042, 0.045, K.dark);               // frame
    b.box(0.032, 0.036, 0.19, 0, 0.078, 0.05, K.metal);              // slide
    for (let i = 0; i < 4; i++) b.box(0.034, 0.03, 0.005, 0, 0.078, -0.028 + i * 0.011, K.dark);
    b.cylZ(0.008, 0.008, 0.14, 0.172, 0, 0.078, K.steel, 8);         // barrel tip
    b.box(0.008, 0.01, 0.012, 0, 0.099, -0.03, K.dark);              // rear sight
    b.box(0.006, 0.01, 0.01, 0, 0.099, 0.135, K.dark);               // front sight
    b.box(0.012, 0.007, 0.05, 0, 0.022, 0.05, K.dark);               // trigger guard bottom
    b.box(0.012, 0.03, 0.007, 0, 0.034, 0.078, K.dark);              // trigger guard front
    b.box(0.006, 0.018, 0.007, 0, 0.035, 0.04, K.steel);             // trigger
  },

  deagle(b) {
    b.box(0.036, 0.122, 0.056, 0, 0, -0.01, K.rubber, 0.2);
    b.box(0.038, 0.012, 0.06, 0, -0.064, -0.028, K.chrome, 0.2);
    b.box(0.036, 0.034, 0.18, 0, 0.048, 0.06, K.chrome);
    b.box(0.04, 0.05, 0.26, 0, 0.09, 0.08, K.chrome);                // slide (big, silver)
    b.box(0.03, 0.012, 0.26, 0, 0.12, 0.08, K.dark);                 // rib
    for (let i = 0; i < 5; i++) b.box(0.042, 0.04, 0.006, 0, 0.088, -0.03 + i * 0.012, K.steel);
    b.cylZ(0.012, 0.012, 0.2, 0.27, 0, 0.09, K.dark, 8);             // barrel
    b.box(0.014, 0.01, 0.014, 0, 0.128, 0.0, K.dark); b.box(0.008, 0.012, 0.012, 0, 0.128, 0.2, K.dark);
    b.box(0.012, 0.007, 0.06, 0, 0.026, 0.06, K.chrome);
    b.box(0.012, 0.034, 0.007, 0, 0.04, 0.092, K.chrome);
    b.box(0.007, 0.02, 0.007, 0, 0.042, 0.05, K.dark);
  },

  shotgun(b) {
    b.box(0.042, 0.088, 0.3, 0, 0.0, -0.27, K.wood, 0.14);           // stock
    b.box(0.044, 0.1, 0.02, 0, -0.035, -0.425, K.rubber, 0.14);      // butt pad
    b.box(0.03, 0.095, 0.042, 0, 0.0, 0.0, K.wood2, 0.28);           // pistol grip
    b.box(0.048, 0.068, 0.23, 0, 0.048, 0.03, K.metal);              // receiver
    b.box(0.03, 0.008, 0.08, 0, 0.084, 0.03, K.dark);                // ejection port
    b.cylZ(0.0175, 0.0175, 0.14, 0.79, 0, 0.065, K.dark, 8);         // barrel
    b.cylZ(0.0135, 0.0135, 0.14, 0.64, 0, 0.022, K.steel, 8);        // mag tube
    b.box(0.054, 0.044, 0.18, 0, 0.012, 0.36, K.wood);               // pump
    for (let i = 0; i < 4; i++) b.box(0.056, 0.046, 0.008, 0, 0.012, 0.3 + i * 0.03, K.wood2);
    b.cylZ(0.005, 0.005, 0.76, 0.79, 0, 0.088, K.brass, 6);          // bead
    b.box(0.012, 0.007, 0.05, 0, 0.022, 0.02, K.dark); b.box(0.012, 0.035, 0.007, 0, 0.036, 0.048, K.dark);
  },

  smg(b) {
    b.box(0.032, 0.14, 0.046, 0, -0.027, -0.002, K.rubber, 0.12);    // grip / mag housing
    b.box(0.036, 0.014, 0.05, 0, -0.098, -0.014, K.dark, 0.12);      // mag base
    b.box(0.044, 0.076, 0.21, 0, 0.052, 0.03, K.metal);              // body
    b.box(0.038, 0.012, 0.19, 0, 0.096, 0.03, K.dark);               // top cover
    b.cylZ(0.019, 0.019, 0.13, 0.19, 0, 0.056, K.metal, 8);          // shroud
    b.cylZ(0.011, 0.011, 0.19, 0.27, 0, 0.056, K.dark, 8);           // barrel
    b.box(0.006, 0.016, 0.006, 0, 0.11, 0.0, K.dark); b.box(0.006, 0.016, 0.006, 0, 0.11, 0.17, K.dark);
    b.box(0.007, 0.007, 0.2, 0.02, 0.07, -0.18, K.steel); b.box(0.007, 0.007, 0.2, -0.02, 0.07, -0.18, K.steel); // folded wire stock
    b.box(0.046, 0.007, 0.007, 0, 0.07, -0.28, K.steel);
    b.box(0.022, 0.05, 0.022, 0, 0.0, 0.17, K.rubber);               // fore grip
    b.box(0.012, 0.007, 0.05, 0, 0.0, 0.05, K.dark); b.box(0.012, 0.03, 0.007, 0, 0.014, 0.075, K.dark);
  },

  ak47(b) {
    b.box(0.032, 0.092, 0.046, 0, -0.02, -0.004, K.rubber, 0.3);     // pistol grip
    b.box(0.047, 0.07, 0.3, 0, 0.05, -0.01, K.metal);                // receiver
    b.box(0.04, 0.016, 0.3, 0, 0.09, -0.01, K.dark);                 // dust cover
    b.box(0.054, 0.046, 0.2, 0, 0.03, 0.245, K.wood);                // lower handguard
    b.box(0.05, 0.03, 0.2, 0, 0.072, 0.245, K.wood2);                // upper handguard
    b.cylZ(0.012, 0.012, 0.15, 0.43, 0, 0.09, K.steel, 8);           // gas tube
    b.cylZ(0.011, 0.011, 0.34, 0.69, 0, 0.056, K.dark, 8);           // barrel
    b.box(0.022, 0.034, 0.03, 0, 0.07, 0.42, K.metal);               // gas block
    b.box(0.007, 0.032, 0.007, 0, 0.09, 0.64, K.dark);               // front sight
    b.cylZ(0.0165, 0.0165, 0.67, 0.73, 0, 0.056, K.dark, 8);         // muzzle brake
    b.box(0.045, 0.108, 0.3, 0, 0.012, -0.31, K.wood, 0.1);          // wooden stock
    b.box(0.046, 0.115, 0.02, 0, -0.012, -0.465, K.rubber, 0.1);
    // curved banana magazine
    let y = 0.018, z = 0.065;
    for (let i = 0; i < 5; i++) {
      const a = i * 0.2;
      b.box(0.027, 0.05, 0.038, 0, y - Math.cos(a) * 0.024, z + Math.sin(a) * 0.024, K.bake, -a);
      y -= Math.cos(a) * 0.046; z += Math.sin(a) * 0.046;
    }
    b.box(0.012, 0.007, 0.05, 0, 0.0, 0.03, K.dark); b.box(0.012, 0.03, 0.007, 0, 0.014, 0.055, K.dark);
  },

  sniper(b) {
    b.box(0.046, 0.105, 0.36, 0, 0.0, -0.3, K.green, 0.06);          // stock
    b.box(0.04, 0.04, 0.14, 0, 0.07, -0.3, K.green, 0.06);           // cheek riser
    b.box(0.048, 0.115, 0.022, 0, -0.008, -0.49, K.rubber, 0.06);
    b.box(0.03, 0.095, 0.045, 0, 0.0, 0.0, K.green, 0.28);           // grip
    b.box(0.046, 0.07, 0.32, 0, 0.05, 0.05, K.metal);                // receiver
    b.box(0.046, 0.055, 0.28, 0, 0.03, 0.34, K.green);               // fore-end
    b.cylZ(0.0145, 0.011, 0.2, 1.0, 0, 0.062, K.dark, 8);            // long barrel
    b.cylZ(0.02, 0.02, 0.98, 1.05, 0, 0.062, K.dark, 8);             // muzzle brake
    b.cylZ(0.022, 0.022, -0.04, 0.3, 0, 0.14, K.dark, 10);           // scope tube
    b.cylZ(0.025, 0.033, 0.3, 0.39, 0, 0.14, K.dark, 10);            // objective bell
    b.cylZ(0.03, 0.03, 0.389, 0.394, 0, 0.14, 0x5a86b4, 10);         // lens
    b.cylZ(0.028, 0.02, -0.09, -0.04, 0, 0.14, K.dark, 10);          // eyepiece
    b.box(0.018, 0.04, 0.022, 0, 0.11, 0.06, K.steel); b.box(0.018, 0.04, 0.022, 0, 0.11, 0.24, K.steel);
    b.box(0.022, 0.03, 0.02, 0, 0.165, 0.15, K.steel);               // turret
    b.box(0.05, 0.012, 0.012, -0.045, 0.07, -0.05, K.steel); b.sphere(0.014, -0.075, 0.07, -0.05, K.dark);  // bolt handle
    b.box(0.03, 0.05, 0.08, 0, -0.004, 0.09, K.dark);                // magazine
    b.box(0.006, 0.006, 0.2, 0.024, 0.0, 0.55, K.steel); b.box(0.006, 0.006, 0.2, -0.024, 0.0, 0.55, K.steel); // folded bipod
    b.box(0.012, 0.007, 0.05, 0, 0.0, 0.03, K.dark); b.box(0.012, 0.03, 0.007, 0, 0.014, 0.055, K.dark);
  },

  rpg(b) {
    const T = K.olive;
    b.cylZ(0.046, 0.046, -0.42, 0.44, 0, 0.13, T, 10);               // tube
    b.cylZ(0.074, 0.046, -0.6, -0.42, 0, 0.13, K.dark, 10);          // rear flare
    b.cylZ(0.052, 0.052, 0.4, 0.47, 0, 0.13, K.metal, 10);           // front lip
    b.cylZ(0.058, 0.058, 0.47, 0.565, 0, 0.13, K.brass, 10);         // warhead body
    b.cylZ(0.058, 0.01, 0.565, 0.79, 0, 0.13, 0x3d4a2c, 10);         // warhead cone
    b.cylZ(0.011, 0.011, 0.79, 0.81, 0, 0.13, K.dark, 6);
    b.box(0.04, 0.045, 0.07, 0, 0.065, 0.0, K.metal);                // tube mount
    b.box(0.03, 0.09, 0.045, 0, 0.0, -0.005, K.rubber, 0.2);         // pistol grip
    b.box(0.026, 0.086, 0.032, 0, 0.04, 0.24, K.rubber);             // fore grip
    b.box(0.014, 0.05, 0.012, 0.05, 0.19, 0.12, K.dark);             // sight
    b.box(0.03, 0.02, 0.08, 0, 0.196, -0.05, K.metal);
    b.box(0.012, 0.007, 0.05, 0, 0.012, 0.045, K.dark);
    for (const s of [-1, 1]) b.box(0.006, 0.04, 0.05, 0, 0.13 + s * 0.0, 0.5 + 0.0, K.dark, 0, 0, s > 0 ? Math.PI / 2 : 0); // fins cross
  },

  grenade(b) {
    const O = 0x4a5a2a, D = 0x35421d;
    b.sphere(0.037, 0, 0, 0, O, 1, 1.2, 1, 10, 8);
    for (const y of [-0.022, 0, 0.022]) b.cyl(0.0385, 0.0385, 0.006, 10, 0, y, 0, D);
    b.cyl(0.015, 0.018, 0.02, 8, 0, 0.05, 0, K.steel);               // fuse housing
    b.box(0.008, 0.07, 0.016, 0.03, 0.02, 0, K.steel, 0, 0, -0.12);   // spoon lever
    b.sphere(0.011, -0.02, 0.065, 0, K.brass, 1, 0.5, 1, 8, 4);      // pin ring
  },

  molotov(b) {
    const G = 0x2f7038;
    b.cyl(0.03, 0.034, 0.17, 10, 0, -0.01, 0, G);                    // bottle body
    b.cyl(0.0345, 0.0345, 0.06, 10, 0, -0.03, 0, 0xd9cfa8);          // label
    b.cyl(0.011, 0.03, 0.05, 10, 0, 0.1, 0, G);                      // shoulder
    b.cyl(0.011, 0.011, 0.07, 8, 0, 0.16, 0, G);                     // neck
    b.cyl(0.016, 0.013, 0.05, 8, 0, 0.2, 0, 0xe8dcc0);               // rag plug
    b.box(0.014, 0.05, 0.008, 0.01, 0.175, 0, 0xe8dcc0, 0, 0, -0.5); // hanging rag
    b.cyl(0.028, 0.032, 0.06, 10, 0, -0.06, 0, 0xc98a2a);            // liquid tint at the bottom
  },

  spraycan(b) {
    b.cyl(0.033, 0.033, 0.15, 10, 0, 0, 0, 0xc83030);
    b.cyl(0.0335, 0.0335, 0.055, 10, 0, -0.005, 0, 0xeeeeee);
    b.cyl(0.0345, 0.0345, 0.012, 10, 0, -0.078, 0, K.steel);
    b.cyl(0.015, 0.033, 0.025, 10, 0, 0.087, 0, 0xc83030);
    b.cyl(0.017, 0.017, 0.028, 10, 0, 0.112, 0, K.dark);
    b.box(0.012, 0.012, 0.022, 0, 0.12, 0.014, 0xffffff);
  },

  cellphone(b) {
    b.box(0.056, 0.014, 0.112, 0, 0, 0, 0x22252b);
    b.box(0.046, 0.002, 0.07, 0, 0.0075, 0.012, 0x7fb4e6);           // screen (+Y side)
    b.box(0.04, 0.002, 0.03, 0, 0.0075, -0.038, 0x444a55);           // keypad
    b.box(0.008, 0.012, 0.03, 0.02, 0.0, 0.07, K.dark);              // little antenna
  },

  camera(b) {
    b.box(0.09, 0.06, 0.05, 0, 0, 0, 0x22252b);
    b.cylZ(0.022, 0.022, 0.025, 0.06, 0, 0.0, K.dark, 10);
    b.cylZ(0.016, 0.016, 0.06, 0.063, 0, 0.0, 0x5a86b4, 10);
    b.box(0.02, 0.012, 0.02, 0.03, 0.036, 0, K.steel);
  },
};

// ---------------------------------------------------------------------------------------------------------
// Cache + factory
// ---------------------------------------------------------------------------------------------------------
const _cache = new Map();
let _mat = null, _flameMat = null;
export function getWeaponMaterial() {
  if (!_mat) _mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 28, specular: 0x333333 });
  return _mat;
}

function getGeo(id) {
  let e = _cache.get(id);
  if (e) return e;
  const b = new GeoBuilder();
  (RECIPES[id] || RECIPES.fist)(b);
  e = { geo: b.p.length ? b.build() : null };
  if (id === 'molotov') {
    const f = new GeoBuilder();
    f.cyl(0, 0.022, 0.085, 6, 0, 0.255, 0, 0xff9a1a);
    f.cyl(0, 0.012, 0.055, 6, 0, 0.245, 0, 0xffe25a);
    e.flame = f.build();
  }
  _cache.set(id, e);
  return e;
}

/** createWeaponModel(id) -> THREE.Group (faces +Z, origin at grip). Shares cached geometry & material.
 *  userData: {id, kind, muzzle:Vector3, grip2:Vector3, twoHanded, flame? (molotov flame mesh)} */
export function createWeaponModel(id) {
  const def = WEAPON_DEFS[id] || WEAPON_DEFS.fist;
  const g = new THREE.Group();
  g.name = 'weapon_' + id;
  const e = getGeo(WEAPON_DEFS[id] ? id : 'fist');
  if (e.geo) { const m = new THREE.Mesh(e.geo, getWeaponMaterial()); m.frustumCulled = true; g.add(m); }
  if (e.flame) {
    if (!_flameMat) _flameMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const f = new THREE.Mesh(e.flame, _flameMat); g.add(f); g.userData.flame = f;
  }
  Object.assign(g.userData, { id, kind: def.kind, muzzle: def.muzzle.clone(), grip2: def.grip2.clone(), twoHanded: def.twoHanded, length: def.length });
  return g;
}
