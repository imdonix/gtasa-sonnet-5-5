// World: chunk streaming (terrain + ground textures + buildings + props), static collision, water, signals.
import * as THREE from 'three';
import { Terrain, CHUNK, chunkKey, CHUNK_MIN, CHUNK_MAX, TMIN } from './terrain.js';
import { Placement } from './placement.js';
import { mergeInstances, boxGeo, GeoBuilder } from './geomutil.js';
import { buildSetpieceMeshes } from './setpieces.js';
import { SpatialHash, circleVsObb, segVsObb, clamp, TAU } from './util.js';
import { CLS, WORLD_HALF } from './mapdata.js';

export class World {
  constructor(scene, map, mods) {
    this.scene = scene; this.map = map;
    this.mods = mods;                    // {buildings, props}
    this.terrain = new Terrain(map);
    this.placement = null;
    this.chunks = new Map();
    this.colHash = new SpatialHash(16);
    this.loadRadius = 4;                 // in chunks
    this.texHiDist = 1.6;   // (legacy field, tiers are now computed in _wantRes)
    this.group = new THREE.Group(); scene.add(this.group);
    this.propGeoCache = new Map(); this.propFarCache = new Map();
    this.propNearDist = 1.25 * CHUNK;
    this.bldNearDist = 2.6 * CHUNK;     // beyond this chunk distance buildings are drawn as simple boxes
    this.removedProps = new Set();
    this.quality = { shadows: true };
    this.night = 0;
    this.time = 0;
    this._makeWater();
    this.jobs = [];
    this.stats = { chunks: 0, tris: 0 };
    this.buildingGeoCache = new Map();
  }

  build(progress = () => {}) {
    const propDefs = this.mods.props ? this.mods.props.PROP_DEFS : null;
    this.placement = new Placement(this.map, this.terrain, 20240607);
    this.placement.build(propDefs);
    progress('Placing buildings…', 0.6);
    // index colliders
    for (const c of this.placement.colliders) this._indexCollider(c);
    // per-chunk lists
    this.chunkBuildings = new Map(); this.chunkProps = new Map();
    for (const b of this.placement.buildings) {
      const R = Math.hypot(b.hw, b.hd);
      const c0 = Math.floor((b.x - R) / CHUNK), c1 = Math.floor((b.x + R) / CHUNK), d0 = Math.floor((b.z - R) / CHUNK), d1 = Math.floor((b.z + R) / CHUNK);
      const cx = Math.floor(b.x / CHUNK), cz = Math.floor(b.z / CHUNK);
      const k = chunkKey(cx, cz); let arr = this.chunkBuildings.get(k); if (!arr) this.chunkBuildings.set(k, arr = []); arr.push(b);
    }
    for (const p of this.placement.props) {
      const k = chunkKey(Math.floor(p.x / CHUNK), Math.floor(p.z / CHUNK)); let arr = this.chunkProps.get(k); if (!arr) this.chunkProps.set(k, arr = []); arr.push(p);
    }
    this.signals = this.placement.signals;
    this.landmarks = this.placement.landmarks;
    this.buildingMat = this.mods.buildings ? this.mods.buildings.createBuildingMaterial() : null;
    this.propMat = this.mods.props ? this.mods.props.createPropMaterial() : new THREE.MeshLambertMaterial({ vertexColors: true });
    if (!this.buildingMat) this.buildingMat = { material: new THREE.MeshLambertMaterial({ vertexColors: true }), setNight() {} };
    // hand-authored set-pieces (Vinewood sign, pier + ferris wheel, airport, cranes, flood towers)
    try { this.setpieces = buildSetpieceMeshes(this.placement.setpieces, this.terrain, this.propMat); this.scene.add(this.setpieces.group); } catch (e) { console.warn('setpieces failed', e); this.setpieces = null; }
    progress('World generated', 0.7);
  }

  _indexCollider(c) {
    if (c.r !== undefined && c.hw === undefined) this.colHash.insertBounds(c, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);
    else { const R = Math.hypot(c.hw, c.hd); this.colHash.insertBounds(c, c.x - R, c.z - R, c.x + R, c.z + R); }
  }
  removeCollider(c) {
    if (c.r !== undefined && c.hw === undefined) this.colHash.remove(c, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);
    else { const R = Math.hypot(c.hw, c.hd); this.colHash.remove(c, c.x - R, c.z - R, c.x + R, c.z + R); }
  }

  // ------------------------------------------------------------------ water
  _makeWater() {
    const c = document.createElement('canvas'); c.width = c.height = 256; const ctx = c.getContext('2d');
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 400; i++) { const x = Math.random() * 256, y = Math.random() * 256, r = 4 + Math.random() * 14; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, Math.random() < 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(128,128,128,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(120, 120); tex.colorSpace = THREE.SRGBColorSpace;
    this.waterTex = tex;
    this.waterMat = new THREE.MeshPhongMaterial({ color: 0x2a78a8, map: tex, transparent: true, opacity: 0.82, shininess: 120, specular: 0x99bbdd });
    const g = new THREE.PlaneGeometry(5600, 5600); g.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(g, this.waterMat); this.water.position.y = 0; this.water.renderOrder = 1;
    this.scene.add(this.water);
    // deep sea floor: hides the void beyond the terrain mesh edge (terrain ends 256 m beyond the map) so the open sea is uniform
    const fg = new THREE.PlaneGeometry(6400, 6400); fg.rotateX(-Math.PI / 2);
    this.seaFloor = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ color: 0x0f3158 })); this.seaFloor.position.y = -9;
    this.scene.add(this.seaFloor);
  }

  // ------------------------------------------------------------------ streaming
  chunkAt(x, z) { return [Math.floor(x / CHUNK), Math.floor(z / CHUNK)]; }

  _makeTexture(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    // the painted canvas has a small border around the chunk: map uv 0..1 onto the inner part only
    if (canvas._rep) { tex.repeat.set(canvas._rep, canvas._rep); tex.offset.set(canvas._off, canvas._off); }
    return tex;
  }

  // Lambert terrain material + a world-space multiplicative detail noise that fades out with distance (crisp ground near the camera)
  _terrainMaterial(tex) {
    if (!this.detailTex) { this.detailTex = this.terrain.makeDetailTexture(); this.detailU = { value: this.detailTex }; this.wetU = { value: 0 }; }
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const U = this.detailU;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uDetail = U; sh.uniforms.uWet = this.wetU;
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec2 vTW;\nvoid main() {').replace('#include <begin_vertex>', '#include <begin_vertex>\n vTW = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform sampler2D uDetail; uniform float uWet; varying vec2 vTW;\nvoid main() {')
        .replace('#include <map_fragment>', `#include <map_fragment>
        { float dd = length(vViewPosition); float fd = 1.0 - smoothstep(18.0, 95.0, dd);
          float nA = texture2D(uDetail, vTW * 0.41).r, nB = texture2D(uDetail, vTW * 2.3).r, nC = texture2D(uDetail, vTW * 0.05).r;
          float dv = (nA - 0.5) * 0.34 + (nB - 0.5) * 0.3;
          diffuseColor.rgb *= (1.0 + dv * fd + (nC - 0.5) * 0.16 * (1.0 - smoothstep(60.0, 260.0, dd))) * (1.0 - uWet * 0.3); }`);
    };
    mat.customProgramCacheKey = () => 'lsr-terrain-detail';
    return mat;
  }

  _loadTerrainChunk(ch, res) {
    const canvas = this.terrain.paintChunk(ch.cx, ch.cz, res);
    const tex = this._makeTexture(canvas);
    try { const R = window.G && window.G.renderer; if (R && R.initTexture) R.initTexture(tex); } catch (e) { /* ignore */ }
    if (ch.terrain) { const old = ch.terrain.material.map; ch.terrain.material.map = tex; ch.terrain.material.needsUpdate = true; if (old) old.dispose(); ch.res = res; return; }
    const geo = this.terrain.chunkGeometry(ch.cx, ch.cz);
    const mat = this._terrainMaterial(tex);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(ch.cx * CHUNK + CHUNK / 2, 0, ch.cz * CHUNK + CHUNK / 2);
    mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    this.group.add(mesh); ch.terrain = mesh; ch.res = res;
  }

  _buildingGeo(b) {
    const B = this.mods.buildings;
    if (!B) return boxGeo(b.w, b.h, b.d, 0x999088);
    try {
      const g = B.generateBuilding({ type: b.type, w: b.w, d: b.d, h: b.h, seed: b.seed });
      if (g) return g;
    } catch (e) { console.warn('building gen failed', b.type, e); }
    return boxGeo(b.w, b.h, b.d, 0x999088);
  }

  *_chunkJob(ch) {
    // terrain first
    const res = ch.wantRes; this._loadTerrainChunk(ch, res); yield;
    // buildings
    const bl = this.chunkBuildings.get(chunkKey(ch.cx, ch.cz));
    if (bl && bl.length) {
      let items = [], tris = 0, talls = [], tallTris = 0; const farItems = [];
      let t0 = performance.now();
      const mk = (list, lod) => {
        const merged = mergeInstances(list, { uv: true });
        for (const it of list) if (it.geo.userData.temp !== false) it.geo.dispose();
        const mesh = new THREE.Mesh(merged, this.buildingMat.material);
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.userData.lod = lod;
        this.group.add(mesh); if (!ch.buildings) ch.buildings = mesh; else (ch.extra || (ch.extra = [])).push(mesh);
      };
      const flush = () => { if (items.length) { mk(items, true); items = []; tris = 0; } };
      const flushTall = () => { if (talls.length) { mk(talls, false); talls = []; tallTris = 0; } };
      for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        const geo = this._buildingGeo(b);
        this._refineCollider(b, geo);
        const tr = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
        const tall = b.h >= 38 || b.type === 'stadium' || b.type === 'terminal' || b.type === 'hangar' || b.type === 'city_hall';     // silhouettes stay detailed at range
        if (b.y - b.hmin > 1.1) { const pod = this._podium(b); const it = { geo: pod, x: b.x, y: 0, z: b.z, yaw: b.yaw }; (tall ? talls : items).push(it); }
        if (tall) { talls.push({ geo, x: b.x, y: b.y, z: b.z, yaw: b.yaw }); tallTris += tr; }
        else { items.push({ geo, x: b.x, y: b.y, z: b.z, yaw: b.yaw }); farItems.push({ geo: this._lodBox(geo, b), x: b.x, y: b.y, z: b.z, yaw: b.yaw }); tris += tr; }
        if (tris > 28000) { yield; flush(); yield; t0 = performance.now(); }
        else if (tallTris > 28000) { yield; flushTall(); yield; t0 = performance.now(); }
        else if (performance.now() - t0 > 2.2) { yield; t0 = performance.now(); }
      }
      yield; flush(); yield; flushTall(); yield;
      if (farItems.length) {
        const fm = new THREE.Mesh(mergeInstances(farItems, { uv: true }), this.buildingMat.material);
        fm.castShadow = false; fm.receiveShadow = false; fm.matrixAutoUpdate = false; fm.visible = false;
        this.group.add(fm); ch.buildingsFar = fm;
        for (const it of farItems) it.geo.dispose();
      }
      this._applyChunkLod(ch); yield;
    }
    // props
    yield* this._propJob(ch);
    ch.ready = true;
  }

  _propGeo(kind, variant) {
    const key = kind + ':' + variant;
    let g = this.propGeoCache.get(key);
    if (g === undefined) {
      try { g = this.mods.props ? this.mods.props.createPropGeometry(kind, variant) : null; } catch (e) { console.warn('prop gen failed', kind, e); g = null; }
      if (!g) g = boxGeo(0.6, 1.2, 0.6, 0x55aa55);
      this.propGeoCache.set(key, g);
    }
    return g;
  }

  // simplified stand-in for a heavy prop, used in far chunks (palms/trees: trunk + crown blob; others: mean-coloured bounding box)
  _propGeoFar(kind, variant) {
    const key = kind + ':' + variant;
    let g = this.propFarCache.get(key);
    if (g !== undefined) return g;
    const near = this._propGeo(kind, variant);
    const tris = near.attributes.position.count / 3;
    g = null;
    if (tris > 150 || kind === 'lamp') {
      const bb = near.boundingBox || (near.computeBoundingBox(), near.boundingBox);
      const H = bb.max.y, B = new GeoBuilder();
      if (kind === 'palm' || kind === 'palm_small') {
        B.tube([0, 0, 0], [0, H * 0.88, 0], 0.32, 0.2, 5, 0x7a5a3a, false);
        const cy = H * 0.9, R = H * 0.3;
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + variant, ca = Math.cos(a), sa = Math.sin(a), px = -sa, pz = ca; B.tri([0, cy, 0], [ca * R + px * 0.5, cy - R * 0.45, sa * R + pz * 0.5], [ca * R - px * 0.5, cy - R * 0.45, sa * R - pz * 0.5], 0x3c8a3a); B.tri([0, cy, 0], [ca * R - px * 0.5, cy - R * 0.45, sa * R - pz * 0.5], [ca * R + px * 0.5, cy - R * 0.45, sa * R + pz * 0.5], 0x2f7a30); }
      } else if (kind === 'tree') {
        B.tube([0, 0, 0], [0, H * 0.55, 0], 0.36, 0.26, 5, 0x6a4c30, false);
        const geo = new THREE.IcosahedronGeometry(1, 0).toNonIndexed(), P = geo.attributes.position, R = H * 0.3, cy = H * 0.68;
        for (let i = 0; i < P.count; i += 3) B.tri([P.getX(i) * R, cy + P.getY(i) * R * 1.1, P.getZ(i) * R], [P.getX(i + 1) * R, cy + P.getY(i + 1) * R * 1.1, P.getZ(i + 1) * R], [P.getX(i + 2) * R, cy + P.getY(i + 2) * R * 1.1, P.getZ(i + 2) * R], 0x3f8a3a);
        geo.dispose();
      } else if (kind === 'bush') {
        const geo = new THREE.IcosahedronGeometry(1, 0).toNonIndexed(), P = geo.attributes.position;
        const rx = (bb.max.x - bb.min.x) / 2, rz = (bb.max.z - bb.min.z) / 2, ry = (bb.max.y - bb.min.y) / 2, cy = bb.min.y + ry * 0.9;
        for (let i = 0; i < P.count; i += 3) B.tri([P.getX(i) * rx, cy + P.getY(i) * ry, P.getZ(i) * rz], [P.getX(i + 1) * rx, cy + P.getY(i + 1) * ry, P.getZ(i + 1) * rz], [P.getX(i + 2) * rx, cy + P.getY(i + 2) * ry, P.getZ(i + 2) * rz], 0x3b8a3a);
        geo.dispose();
      } else {
        // mean vertex colour + bounding box
        const C = near.attributes.color; let r = 0, gg = 0, bl = 0, n = C ? C.count : 0;
        for (let i = 0; i < n; i++) { r += Math.min(C.getX(i), 1); gg += Math.min(C.getY(i), 1); bl += Math.min(C.getZ(i), 1); }
        const col = n ? [r / n, gg / n, bl / n] : [0.6, 0.6, 0.6];
        const w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z, cx = (bb.max.x + bb.min.x) / 2, cz = (bb.max.z + bb.min.z) / 2;
        if (kind === 'lamp') { B.tube([0, 0, 0], [0, H * 0.96, 0], 0.13, 0.08, 4, col, false); B.box(0, H * 0.94, cz * 0.5, 0.3, 0.2, Math.max(0.6, d * 0.7), col); }
        else B.box(cx, bb.min.y, cz, Math.max(w, 0.2), Math.max(H - bb.min.y, 0.2), Math.max(d, 0.2), col);
      }
      g = B.build(); g.userData.temp = false;
    }
    this.propFarCache.set(key, g);
    return g;
  }

  *_propJob(ch) {
    this._disposePropMeshes(ch);
    const pl = this.chunkProps.get(chunkKey(ch.cx, ch.cz)); if (!pl) return;
    const items = [], far = [];
    let t0 = performance.now();
    for (const p of pl) {
      if (p.removed || p.kind === 'trafficlight') continue;
      const y = p.y ?? this.terrain.groundY(p.x, p.z);
      if (p.geo) { items.push({ geo: p.geo, x: 0, y: 0, z: 0, yaw: 0, s: 1 }); continue; }   // custom world-space geometry (wires)
      const geo = this._propGeo(p.kind, p.variant);
      items.push({ geo, x: p.x, y, z: p.z, yaw: p.yaw, s: p.s });
      const fg = this._propGeoFar(p.kind, p.variant);
      if (fg) far.push({ geo: fg, x: p.x, y, z: p.z, yaw: p.yaw, s: p.s });
      else if (geo.boundingBox && geo.boundingBox.max.y * (p.s || 1) >= 2.4) far.push({ geo, x: p.x, y, z: p.z, yaw: p.yaw, s: p.s });
      if (performance.now() - t0 > 2.2) { yield; t0 = performance.now(); }
    }
    const build = function* (list, dst, shadow, visible) {
      let cur = [], tris = 0;
      const flush = () => { if (!cur.length) return; const mesh = new THREE.Mesh(mergeInstances(cur, { uv: false }), this.propMat); mesh.castShadow = shadow; mesh.receiveShadow = false; mesh.matrixAutoUpdate = false; mesh.visible = visible; this.group.add(mesh); dst.push(mesh); cur = []; tris = 0; };
      for (const it of list) { cur.push(it); tris += it.geo.attributes.position.count / 3; if (tris > 22000) { flush(); yield; } }
      flush();
    }.bind(this);
    yield* build(far, ch.propsFar = [], false, false); yield;
    yield* build(items, ch.props = [], true, true);
    this._applyChunkLod(ch);
  }
  _disposePropMeshes(ch) {
    for (const k of ['props', 'propsFar']) if (ch[k]) { for (const m of ch[k]) { this.group.remove(m); m.geometry.dispose(); } ch[k] = null; }
  }
  _buildPropMesh(ch) { const it = this._propJob(ch); while (!it.next().done); }
  _initFlatUV() { if (this._flatUV) return; const t = this.mods.buildings && this.mods.buildings.getFacadeAtlas ? this.mods.buildings.getFacadeAtlas().tiles.flat : null; this._flatUV = t ? [(t.u0 + t.u1) / 2, (t.v0 + t.v1) / 2] : [0.47, 0.085]; }

  // Once a building's geometry is generated we know its true solid footprint (its roofs), so replace the
  // full reserved-footprint collider with that. Parking lots / lawns are part of the reserved footprint
  // but not of the building, so they stop being invisible walls.
  _refineCollider(b, geo) {
    if (b._solidDone) return; b._solidDone = true;
    const s = geo && geo.userData && geo.userData.solid; if (!s || !b.obb) return;
    const w = s.maxX - s.minX, d = s.maxZ - s.minZ; if (!(w > 0.6 && d > 0.6)) return;
    const old = b.obb;
    this.removeCollider(old);
    const i = this.placement.colliders.indexOf(old); if (i >= 0) this.placement.colliders.splice(i, 1);
    const lx = (s.minX + s.maxX) / 2, lz = (s.minZ + s.maxZ) / 2, cs = Math.cos(b.yaw), sn = Math.sin(b.yaw);
    const nobb = { x: b.x + lx * cs + lz * sn, z: b.z - lx * sn + lz * cs, hw: w / 2, hd: d / 2, yaw: b.yaw, h: b.h, kind: 'building', ref: b };
    b.obb = nobb; this.placement.colliders.push(nobb); this._indexCollider(nobb);
  }

  // concrete podium filling the gap under a building on a slope (the generated foundation skirt only goes 2 m down)
  _podium(b) {
    this._initFlatUV();
    const y0 = b.hmin - 0.4, y1 = b.y + 0.05, hw = b.hw - 0.05, hd = b.hd - 0.05;
    const P = [], N = [], I = [];
    const face = (a, c2, d, e, nx, ny, nz) => { const o = P.length / 3; for (const v of [a, c2, d, e]) { P.push(v[0], v[1], v[2]); N.push(nx, ny, nz); } I.push(o, o + 1, o + 2, o, o + 2, o + 3); };
    face([-hw, y0, hd], [hw, y0, hd], [hw, y1, hd], [-hw, y1, hd], 0, 0, 1); face([hw, y0, -hd], [-hw, y0, -hd], [-hw, y1, -hd], [hw, y1, -hd], 0, 0, -1);
    face([hw, y0, hd], [hw, y0, -hd], [hw, y1, -hd], [hw, y1, hd], 1, 0, 0); face([-hw, y0, -hd], [-hw, y0, hd], [-hw, y1, hd], [-hw, y1, -hd], -1, 0, 0);
    const nv = P.length / 3, UV = new Float32Array(nv * 2), COL = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { UV[i * 2] = this._flatUV[0]; UV[i * 2 + 1] = this._flatUV[1]; COL[i * 3] = 0.42; COL[i * 3 + 1] = 0.41; COL[i * 3 + 2] = 0.39; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); g.setAttribute('color', new THREE.BufferAttribute(COL, 3));
    g.setIndex(I); g.userData.temp = true; return g;
  }

  // very cheap stand-in for a building: its bounding box, plain tile + mean vertex colour
  _lodBox(geo, b) {
    const bb = geo.userData.bbox || (geo.computeBoundingBox(), { minX: geo.boundingBox.min.x, maxX: geo.boundingBox.max.x, minZ: geo.boundingBox.min.z, maxZ: geo.boundingBox.max.z, minY: geo.boundingBox.min.y, maxY: geo.boundingBox.max.y });
    this._initFlatUV();
    const C = geo.attributes.color; let r = 0, g = 0, bl = 0; const n = C ? C.count : 0;
    for (let i = 0; i < n; i++) { r += C.getX(i); g += C.getY(i); bl += C.getZ(i); }
    const k = (b.type === 'skyscraper' || b.type === 'office_mid' || b.type === 'office_low' || b.type === 'hospital' ? 0.55 : 0.8) / Math.max(1, n);
    const col = [Math.min(1, r * k), Math.min(1, g * k), Math.min(1, bl * k)];
    const x0 = bb.minX, x1 = bb.maxX, z0 = bb.minZ, z1 = bb.maxZ, y0 = Math.max(bb.minY, -0.5), y1 = bb.maxY;
    const P = [], N = [], I = [];
    const face = (a, bb2, c, d, nx, ny, nz) => { const o = P.length / 3; for (const v of [a, bb2, c, d]) { P.push(v[0], v[1], v[2]); N.push(nx, ny, nz); } I.push(o, o + 1, o + 2, o, o + 2, o + 3); };
    face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1); face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1);
    face([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0); face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0);
    face([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0, 1, 0);
    const nv = P.length / 3, UV = new Float32Array(nv * 2), COL = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { UV[i * 2] = this._flatUV[0]; UV[i * 2 + 1] = this._flatUV[1]; const roof = N[i * 3 + 1] > 0.5 ? 0.85 : 1; COL[i * 3] = col[0] * roof; COL[i * 3 + 1] = col[1] * roof; COL[i * 3 + 2] = col[2] * roof; }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g2.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g2.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); g2.setAttribute('color', new THREE.BufferAttribute(COL, 3));
    g2.setIndex(I); g2.userData.temp = true;
    return g2;
  }

  _applyChunkLod(ch) {
    { const farB = ch.d > this.bldNearDist;
      if (ch.buildings && ch.buildings.userData.lod) ch.buildings.visible = !farB;
      if (ch.extra) for (const m of ch.extra) if (m.userData.lod) m.visible = !farB;
      if (ch.buildingsFar) ch.buildingsFar.visible = farB; }
    const far = ch.d > this.propNearDist;
    if (ch.props) for (const m of ch.props) m.visible = !far;
    if (ch.propsFar) for (const m of ch.propsFar) m.visible = far;
  }
  rebuildPropChunk(x, z) { const ch = this.chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK))); if (ch) this._buildPropMesh(ch); }

  _unloadChunk(ch) {
    if (ch.extra) { for (const m of ch.extra) { this.group.remove(m); m.geometry.dispose(); } ch.extra = null; }
    this._disposePropMeshes(ch);
    for (const k of ['terrain', 'buildings', 'buildingsFar']) {
      const m = ch[k]; if (!m) continue;
      this.group.remove(m); m.geometry.dispose();
      if (k === 'terrain') { if (m.material.map) m.material.map.dispose(); m.material.dispose(); }
      ch[k] = null;
    }
  }

  // called every frame with the focus position (player/camera). budgetMs limits streaming work.
  update(dt, fx, fz, budgetMs = 4) {
    this.time += dt;
    const cx0 = Math.floor(fx / CHUNK), cz0 = Math.floor(fz / CHUNK), R = this.loadRadius;
    // ensure wanted chunks exist
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const cx = cx0 + dx, cz = cz0 + dz;
      if (cx < CHUNK_MIN || cx > CHUNK_MAX || cz < CHUNK_MIN || cz > CHUNK_MAX) continue;
      const d = Math.hypot((cx + 0.5) * CHUNK - fx, (cz + 0.5) * CHUNK - fz);
      if (d > (R + 0.6) * CHUNK) continue;
      const k = chunkKey(cx, cz);
      let ch = this.chunks.get(k);
      if (!ch) {
        const wantRes = this._wantRes(d, 0);
        ch = { cx, cz, key: k, d, wantRes, ready: false, job: null };
        this.chunks.set(k, ch);
        ch.job = this._chunkJob(ch); this.jobs.push(ch);
      } else {
        ch.d = d;
        if (ch.ready && !ch.repaint) { const w = this._wantRes(d, ch.res); if (w !== ch.res) ch.repaint = w; }
      }
    }
    // unload far
    for (const [k, ch] of this.chunks) {
      const d = Math.hypot((ch.cx + 0.5) * CHUNK - fx, (ch.cz + 0.5) * CHUNK - fz);
      ch.d = d;
      if (d > (R + 1.4) * CHUNK) { this._unloadChunk(ch); this.chunks.delete(k); const i = this.jobs.indexOf(ch); if (i >= 0) this.jobs.splice(i, 1); }
    }
    for (const ch of this.chunks.values()) if (ch.ready) this._applyChunkLod(ch);
    if (this.setpieces) this.setpieces.update(dt);
    { const Gg = window.G; const wet = Gg && Gg.sky ? Gg.sky.rain : 0; if (this.wetU) this.wetU.value += (wet - this.wetU.value) * Math.min(1, dt * 0.5); }
    this._parkedHook();
    // pump jobs nearest-first within budget
    const t0 = performance.now();
    this.jobs.sort((a, b) => a.d - b.d);
    while (this.jobs.length && performance.now() - t0 < budgetMs) {
      const ch = this.jobs[0];
      const r = ch.job.next();
      if (r.done) { this.jobs.shift(); ch.job = null; }
      else if (this.jobs.length > 1 && performance.now() - t0 > budgetMs) break;
    }
    if (!this.jobs.length && performance.now() - t0 < budgetMs) {
      let best = null; for (const ch of this.chunks.values()) if (ch.repaint && (!best || ch.d < best.d)) best = ch;
      if (best) { this._loadTerrainChunk(best, best.repaint); best.repaint = 0; }
    }
    // water follows focus
    this.water.position.x = Math.round(fx / 50) * 50; this.water.position.z = Math.round(fz / 50) * 50;
    this.waterTex.offset.x = (this.time * 0.004) % 1; this.waterTex.offset.y = (this.time * 0.0025) % 1;
    this.water.position.y = Math.sin(this.time * 0.6) * 0.04;
    this.seaFloor.position.x = this.water.position.x; this.seaFloor.position.z = this.water.position.z;
  }

  // ambient parked cars: seed a few along the roads of chunks the player approaches (Population only seeds near the spawn point)
  _parkedHook() {
    const G = window.G; if (!G || !G.game || G.game.state !== 'play' || !G.population || !G.population.seedParked || !G.vehicles) return;
    if ((this._parkT = (this._parkT || 0) + 1) % 6) return;
    if (G.vehicles.list.length > 110) return;
    let best = null;
    for (const ch of this.chunks.values()) if (ch.ready && !ch.parkedSeeded && ch.d < 1.7 * CHUNK && (!best || ch.d < best.d)) best = ch;
    if (!best) return;
    best.parkedSeeded = true;
    const x = (best.cx + 0.5) * CHUNK, z = (best.cz + 0.5) * CHUNK, zone = this.map.zoneAt(x, z);
    const n = { 1: 3, 2: 4, 3: 4, 4: 3, 6: 3, 7: 1, 5: 1, 10: 1, 9: 0 }[zone] ?? 0;
    if (n) { try { G.population.seedParked(x, z, 78, n); } catch (e) { /* ignore */ } }
  }

  // ground texture resolution tier for a chunk at distance d (with hysteresis against the current tier)
  _wantRes(d, cur) {
    const b1 = 1.15 * CHUNK, b2 = 2.7 * CHUNK;
    const t = d < b1 ? 1024 : d < b2 ? 512 : 256;
    if (!cur) return t;
    if (t > cur) { const bnd = cur === 256 ? b2 : b1; return d < bnd - 0.25 * CHUNK ? t : cur; }
    if (t < cur) { const bnd = cur === 1024 ? b1 : b2; return d > bnd + 0.4 * CHUNK ? t : cur; }
    return cur;
  }

  pendingJobs() { return this.jobs.length; }

  // synchronous load of everything around a point (used at start / teleport) with progress callback
  async preload(fx, fz, radius = 2, progress = () => {}) {
    const old = this.loadRadius; this.loadRadius = radius;
    this.update(0, fx, fz, 0);
    let total = this.jobs.length, n = 0;
    while (this.jobs.length) {
      this.update(0, fx, fz, 12);
      n++; progress('Building city…', 0.7 + 0.28 * (1 - this.jobs.length / Math.max(1, total)));
      await new Promise(r => setTimeout(r, 0));
    }
    this.loadRadius = old;
  }

  // ------------------------------------------------------------------ queries
  groundY(x, z) { return this.terrain.groundY(x, z); }
  isWater(x, z) { return this.terrain.groundY(x, z) < -0.05; }
  surfaceAt(x, z) { // 'road'|'sidewalk'|'grass'|'sand'|'water'|'concrete'
    const c = this.map.classAt(x, z);
    if (this.terrain.groundY(x, z) < -0.1 || c === CLS.WATER) return 'water';
    const rd = this.map.roadDistAt(x, z);
    if (rd < 0) return 'road';
    if (rd < 3.2) return 'sidewalk';
    if (c === CLS.SAND) return 'sand'; if (c === CLS.GRASS || c === CLS.SCRUB) return 'grass'; if (c === CLS.CONCRETE || c === CLS.RUNWAY) return 'concrete';
    return 'grass';
  }

  // push a circle out of static colliders. returns accumulated push {x,z} (applied into pos object in-place). pos: {x,z}
  pushCircle(pos, r, out = null, y0 = 0, y1 = 2) {
    let hit = false;
    const list = this.colHash.queryRadius(pos.x, pos.z, r + 40, this._q || (this._q = []));
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.dead) continue;
        if (c.hw !== undefined) {
          const p = circleVsObb(c, pos.x, pos.z, r);
          if (p) { pos.x += p.nx * p.depth; pos.z += p.nz * p.depth; hit = true; if (out) { out.nx = p.nx; out.nz = p.nz; out.c = c; } }
        } else {
          const dx = pos.x - c.x, dz = pos.z - c.z, rr = r + c.r, d2 = dx * dx + dz * dz;
          if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-4; const dep = rr - d; pos.x += dx / d * dep; pos.z += dz / d * dep; hit = true; if (out) { out.nx = dx / d; out.nz = dz / d; out.c = c; } }
        }
      }
    }
    return hit;
  }

  // nearest static collider hit along 2D segment; returns {t, c} with t in [0,1] (fraction of the segment) or null.
  // heights ay, by: bullet altitude at a and b; ignores colliders lower than the bullet altitude at hit point.
  raycast(ax, az, bx, bz, ay = 1.5, by = 1.5) {
    const minx = Math.min(ax, bx) - 2, maxx = Math.max(ax, bx) + 2, minz = Math.min(az, bz) - 2, maxz = Math.max(az, bz) + 2;
    const list = this.colHash.query(minx, minz, maxx, maxz, this._q2 || (this._q2 = []));
    let best = 1e9, bc = null;
    for (const c of list) {
      let t = -1;
      if (c.hw !== undefined) t = segVsObb(c, ax, az, bx, bz);
      else {
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9; const tt = clamp(((c.x - ax) * dx + (c.z - az) * dz) / l2, 0, 1);
        const px = ax + dx * tt, pz = az + dz * tt; if ((px - c.x) ** 2 + (pz - c.z) ** 2 < c.r * c.r) t = tt;
      }
      if (t >= 0 && t < best) {
        const y = ay + (by - ay) * t; const gy = this.terrain.groundY(c.x, c.z);
        if (y < gy + (c.h ?? 3)) { best = t; bc = c; }
      }
    }
    return bc ? { t: best, c: bc } : null;
  }

  setNight(n) { this.night = n; if (this.buildingMat.setNight) this.buildingMat.setNight(n); }
}
