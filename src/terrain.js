// Terrain heightfield, chunk meshes and procedural ground textures (roads painted from the road graph).
import * as THREE from 'three';
import { CLS, ZONE, MPP, WORLD_HALF, ROAD_WIDTH } from './mapdata.js';
import { clamp, lerp, mulberry32, makeNoise } from './util.js';
import { pierSpec } from './setpieces.js';

export const CHUNK = 128;
export const TSTEP = 4;
export const TMIN = -1280;               // terrain extends 256 m beyond the map on all sides
export const TN = 640;                   // quads per side (2560 m / 4 m)
export const CHUNK_MIN = -10, CHUNK_MAX = 9; // inclusive chunk index range
export const chunkKey = (cx, cz) => (cx + 32) * 64 + (cz + 32);

const ZONE_COLORS = {
  [ZONE.RES_LOW]: [132, 148, 88], [ZONE.RES_MID]: [142, 144, 118], [ZONE.COMMERCIAL]: [138, 138, 134], [ZONE.DOWNTOWN]: [124, 124, 126],
  [ZONE.INDUSTRIAL]: [130, 125, 114], [ZONE.BEACH]: [216, 200, 154], [ZONE.RICH]: [98, 142, 80], [ZONE.PARK]: [86, 136, 64],
  [ZONE.AIRPORT]: [150, 150, 146], [ZONE.DOCKS]: [126, 126, 122], [ZONE.STADIUM]: [150, 150, 146], [ZONE.WILD]: [142, 122, 82],
  [ZONE.CEMETERY]: [92, 138, 72], [ZONE.NONE]: [140, 140, 136]
};
const CLS_COLORS = {
  [CLS.WATER]: [28, 78, 118], [CLS.SAND]: [222, 205, 154], [CLS.GRASS]: [86, 136, 62], [CLS.SCRUB]: [146, 126, 84],
  [CLS.CONCRETE]: [186, 186, 180], [CLS.RUNWAY]: [58, 58, 64]
};

export class Terrain {
  constructor(map) {
    this.map = map;
    const V = TN + 1;
    this.V = V;
    this.H = new Float32Array(V * V);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const x = TMIN + i * TSTEP, z = TMIN + j * TSTEP;
      let h = map.heightPxAt(x, z);
      // beyond the map edge the (clamped) height field would end in a sheer mesa wall: slope it down into the sea instead
      const o = Math.hypot(Math.max(0, Math.abs(x) - WORLD_HALF), Math.max(0, Math.abs(z) - WORLD_HALF));
      if (o > 0) { const t = clamp(o / 230, 0, 1), ss = t * t * (3 - 2 * t); h = lerp(h, Math.min(h, -7.5), ss); }
      this.H[j * V + i] = h;
    }
    this.pier = pierSpec(map);
    if (this.pier) this._applyPier(this.pier);
    this.noiseTile = this._makeNoiseTile();
    this.texCache = new Map();
    this._edgeChunks = null;
  }

  // level a building pad into the heightfield (cut + fill) so houses on slopes sit on terraces instead of floating.
  // Vertices inside earlier pads are locked; road surfaces are never touched.
  terrace(b, y, margin = 4.3, blend = 6) {
    const V = this.V, H = this.H, map = this.map; if (!this.locked) this.locked = new Uint8Array(V * V);
    const cs = Math.cos(b.yaw), sn = Math.sin(b.yaw), R = Math.hypot(b.hw, b.hd) + margin + blend;
    const i0 = Math.max(0, Math.floor((b.x - R - TMIN) / TSTEP)), i1 = Math.min(V - 1, Math.ceil((b.x + R - TMIN) / TSTEP));
    const j0 = Math.max(0, Math.floor((b.z - R - TMIN) / TSTEP)), j1 = Math.min(V - 1, Math.ceil((b.z + R - TMIN) / TSTEP));
    const edits = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * V + i; if (this.locked[k]) continue;
      const x = TMIN + i * TSTEP, z = TMIN + j * TSTEP, dx = x - b.x, dz = z - b.z;
      const lx = Math.abs(dx * cs - dz * sn) - b.hw, lz = Math.abs(dx * sn + dz * cs) - b.hd;
      const d = Math.hypot(Math.max(lx, 0), Math.max(lz, 0));   // distance outside the rectangle (0 inside)
      if (d > margin + blend) continue;
      if (map.roadDistAt(x, z) < 3.8 || map.classAt(x, z) === CLS.WATER) continue;
      const t = d <= margin ? 0 : clamp((d - margin) / blend, 0, 1), ss = t * t * (3 - 2 * t);
      const nh = lerp(y, H[k], ss);
      if (d <= margin && Math.abs(H[k] - y) > 4.5) return false;     // too steep to level sensibly
      edits.push(k, nh, d <= margin ? 1 : 0);
    }
    for (let e = 0; e < edits.length; e += 3) { H[edits[e]] = edits[e + 1]; if (edits[e + 2]) this.locked[edits[e]] = 1; }
    return true;
  }

  // raise the heightfield into a flat deck (walkable / drivable) for the Santa Maria pier
  _applyPier(p) {
    const V = this.V, H = this.H;
    for (let j = 0; j < V; j++) {
      const z = TMIN + j * TSTEP; if (z < p.z0 - 8 || z > p.z1 + 8) continue;
      for (let i = 0; i < V; i++) {
        const x = TMIN + i * TSTEP, dx = Math.abs(x - p.cx); if (dx > p.hw + 8) continue;
        const tx = clamp((dx - p.hw) / 4, 0, 1), tz0 = clamp((p.z0 - z) / 4, 0, 1), tz1 = clamp((z - p.z1) / 4, 0, 1);
        const t = Math.max(tx, tz0, tz1);
        const k = j * V + i, h0 = H[k];
        H[k] = Math.max(h0, lerp(p.deck, h0, t));
      }
    }
  }

  // exact height of the rendered mesh (same triangulation as chunk geometry)
  groundY(x, z) {
    const V = this.V;
    let fx = (x - TMIN) / TSTEP, fz = (z - TMIN) / TSTEP;
    fx = clamp(fx, 0, TN - 1e-4); fz = clamp(fz, 0, TN - 1e-4);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, H = this.H, k = j * V + i;
    const h00 = H[k], h10 = H[k + 1], h01 = H[k + V], h11 = H[k + V + 1];
    return tx >= tz ? h00 + (h10 - h00) * tx + (h11 - h10) * tz : h00 + (h11 - h01) * tx + (h01 - h00) * tz;
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.5;
    const hx = this.groundY(x + e, z) - this.groundY(x - e, z), hz = this.groundY(x, z + e) - this.groundY(x, z - e);
    return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  }

  chunkGeometry(cx, cz) {
    const n = CHUNK / TSTEP, vx = n + 1;
    const pos = new Float32Array(vx * vx * 3), nor = new Float32Array(vx * vx * 3), uv = new Float32Array(vx * vx * 2);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const tmp = new THREE.Vector3();
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const k = j * vx + i, x = x0 + i * TSTEP, z = z0 + j * TSTEP;
      pos[k * 3] = x - (x0 + CHUNK / 2); pos[k * 3 + 1] = this.groundY(x, z); pos[k * 3 + 2] = z - (z0 + CHUNK / 2);
      this.normalAt(x, z, tmp); nor[k * 3] = tmp.x; nor[k * 3 + 1] = tmp.y; nor[k * 3 + 2] = tmp.z;
      uv[k * 2] = i / n; uv[k * 2 + 1] = j / n;
    }
    const idx = new Uint16Array(n * n * 6); let q = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * vx + i, b = a + 1, c = a + vx, d = c + 1; // a=00 b=10 c=01 d=11
      idx[q++] = a; idx[q++] = c; idx[q++] = d;
      idx[q++] = a; idx[q++] = d; idx[q++] = b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }

  // truly tileable noise (wrap-around value noise) so the pattern is continuous across chunk borders
  _lattice(S, n, rnd) {
    const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = rnd();
    const out = new Float32Array(S * S), f = n / S;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const fx = x * f, fy = y * f, ix = Math.floor(fx), iy = Math.floor(fy); let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const x0 = ix % n, y0 = iy % n, x1 = (ix + 1) % n, y1 = (iy + 1) % n;
      const a = g[y0 * n + x0] + (g[y0 * n + x1] - g[y0 * n + x0]) * tx, b = g[y1 * n + x0] + (g[y1 * n + x1] - g[y1 * n + x0]) * tx;
      out[y * S + x] = a + (b - a) * ty;
    }
    return out;
  }
  _makeNoiseTile() {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
    const r = mulberry32(99);
    const n1 = this._lattice(S, 28, r), n2 = this._lattice(S, 6, r);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const k = y * S + x;
      const v = 0.5 * r() + 0.32 * n1[k] + 0.18 * n2[k];
      const g = clamp(Math.floor(128 + (v - 0.5) * 150), 0, 255);
      const i = k * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  // soft, blotchy multiplicative detail tile (RepeatWrapping texture used by the terrain shader near the camera)
  makeDetailTexture() {
    const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
    const r = mulberry32(2024);
    const a = this._lattice(S, 8, r), b = this._lattice(S, 20, r), d = this._lattice(S, 48, r);
    for (let i = 0; i < S * S; i++) {
      const v = 0.45 * a[i] + 0.3 * b[i] + 0.25 * d[i] + (r() - 0.5) * 0.12;
      const g = clamp(Math.floor(v * 255), 0, 255);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4;
    return t;
  }

  _indexEdges() {
    this._edgeChunks = new Map();
    for (const e of this.map.edges) {
      let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
      for (const p of e.pts) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); minz = Math.min(minz, p.z); maxz = Math.max(maxz, p.z); }
      const m = e.w / 2 + 6;
      // add to every chunk its bbox touches (coarse)
      const c0 = Math.floor((minx - m) / CHUNK), c1 = Math.floor((maxx + m) / CHUNK), d0 = Math.floor((minz - m) / CHUNK), d1 = Math.floor((maxz + m) / CHUNK);
      for (let a = c0; a <= c1; a++) for (let b = d0; b <= d1; b++) {
        const k = chunkKey(a, b); let arr = this._edgeChunks.get(k); if (!arr) this._edgeChunks.set(k, arr = []); arr.push(e);
      }
    }
  }

  // paints ground texture canvas for a chunk. res = pixels per side.
  paintChunk(cx, cz, res) {
    if (!this._edgeChunks) this._indexEdges();
    const map = this.map;
    // the canvas carries a small border (pad) around the chunk so bilinear/mip sampling never mixes in clamped edge texels
    const pad = Math.max(2, Math.round(res / 128)), tot = res + 2 * pad;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = tot;
    canvas._rep = res / tot; canvas._off = pad / tot;
    const ctx = canvas.getContext('2d');
    const s = res / CHUNK, x0 = cx * CHUNK - pad / s, z0 = cz * CHUNK - pad / s, res0 = res;
    res = tot;
    // --- base colours from map classes/zones at source resolution (64 px + 1 px border) ---
    const SP = CHUNK / MPP, B = 2, SW = SP + 2 * B;
    const small = document.createElement('canvas'); small.width = small.height = SW;
    const sctx = small.getContext('2d'), img = sctx.createImageData(SW, SW);
    const N = map.N;
    const px0 = Math.floor(cx * CHUNK / MPP + N / 2) - B, pz0 = Math.floor(cz * CHUNK / MPP + N / 2) - B;
    const H = this.H;
    for (let j = 0; j < SW; j++) for (let i = 0; i < SW; i++) {
      const gx = clamp(px0 + i, 0, N - 1), gz = clamp(pz0 + j, 0, N - 1), gi = gz * N + gx;
      let cls = map.cls[gi]; const zone = map.zone[gi];
      let col;
      if (cls === CLS.LAND || (cls >= CLS.STREET && cls <= CLS.FREEWAY)) {
        col = ZONE_COLORS[zone] || ZONE_COLORS[0];
      } else if (cls === CLS.GRASS && zone !== ZONE.NONE && zone !== ZONE.PARK && zone !== ZONE.CEMETERY && zone !== ZONE.RICH) col = CLS_COLORS[CLS.GRASS];
      else col = CLS_COLORS[cls] || ZONE_COLORS[0];
      let r = col[0], g = col[1], b = col[2];
      if (cls === CLS.SCRUB || zone === ZONE.WILD) { // vary hills by altitude: green low, dusty high
        const h = map.heightPx[gi]; const t = clamp((h - 10) / 90, 0, 1);
        r = lerp(r, 168, t * 0.6); g = lerp(g, 146, t * 0.5); b = lerp(b, 100, t * 0.5);
      }
      if ((cls === CLS.SCRUB || cls === CLS.GRASS || cls === CLS.SAND) && zone !== ZONE.PARK && zone !== ZONE.CEMETERY) { // steep ground shows bare rock
        const hl = map.heightPx[gz * N + clamp(gx - 1, 0, N - 1)], hr = map.heightPx[gz * N + clamp(gx + 1, 0, N - 1)], hu = map.heightPx[clamp(gz - 1, 0, N - 1) * N + gx], hd = map.heightPx[clamp(gz + 1, 0, N - 1) * N + gx];
        const sl = Math.hypot(hr - hl, hd - hu) / (2 * MPP);
        if (sl > 0.3) { const t = clamp((sl - 0.3) / 0.45, 0, 1) * 0.75; r = lerp(r, 128, t); g = lerp(g, 112, t); b = lerp(b, 96, t); }
      }
      if (cls === CLS.WATER) { // deeper = darker
        const h = map.heightPx[gi]; const t = clamp(-h / 8, 0, 1); r = lerp(62, 18, t); g = lerp(110, 52, t); b = lerp(128, 92, t);
      }
      const o = (j * SW + i) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    // world x of px0+B is px0+B ... source px k covers world ((k - N/2) * MPP)
    const offX = (px0 + B - N / 2) * MPP - x0, offZ = (pz0 + B - N / 2) * MPP - z0; // world offset of small(B,B) relative to chunk origin
    ctx.drawImage(small, (offX - B * MPP) * s, (offZ - B * MPP) * s, SW * MPP * s, SW * MPP * s);
    // --- noise overlay ---
    ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.55;
    const tile = this.noiseTile, ts = 256 * (res0 / 512);
    for (let a = -1; pad + a * ts < res; a++) for (let b = -1; pad + b * ts < res; b++) ctx.drawImage(tile, pad + a * ts, pad + b * ts, ts, ts);
    ctx.restore();
    // --- roads ---
    if (this.pier) this._paintPier(ctx, this.pier, x0, z0, s);
    const edges = this._edgeChunks.get(chunkKey(cx, cz));
    if (edges) this._paintRoads(ctx, edges, x0, z0, s, res);
    // --- runways ---
    for (const rw of map.runways) this._paintRunway(ctx, rw, x0, z0, s);
    return canvas;
  }

  _paintPier(ctx, p, x0, z0, s) {
    const X0 = (p.cx - p.hw - 1) - x0, X1 = (p.cx + p.hw + 1) - x0, Z0 = p.z0 - z0, Z1 = p.z1 - z0;
    ctx.fillStyle = 'rgb(112,84,56)'; ctx.fillRect(X0 * s, Z0 * s, (X1 - X0) * s, (Z1 - Z0) * s);
    ctx.fillStyle = 'rgba(40,26,14,0.45)';
    for (let z = p.z0; z < p.z1; z += 1.4) ctx.fillRect(X0 * s, (z - z0) * s, (X1 - X0) * s, 0.07 * s);
  }

  _paintRunway(ctx, rw, x0, z0, s) {
    const cx = (rw.x + rw.dirx * rw.cu - rw.dirz * rw.cv) - x0, cz = (rw.z + rw.dirz * rw.cu + rw.dirx * rw.cv) - z0;
    const L = rw.len, W = rw.wid, ang = Math.atan2(rw.dirz, rw.dirx);
    ctx.save(); ctx.translate(cx * s, cz * s); ctx.rotate(ang);
    const long = L >= W;
    if (!long) ctx.rotate(Math.PI / 2);
    const len = long ? L : W, wid = long ? W : L;
    ctx.fillStyle = '#ffffff';
    // centre dashes
    const dash = 30, gap = 20;
    for (let x = -len / 2 + 60; x < len / 2 - 60; x += dash + gap) ctx.fillRect(x * s, -0.4 * s, dash * s, 0.8 * s);
    // threshold bars
    for (const sd of [-1, 1]) {
      for (let k = -4; k <= 4; k++) { if (k === 0) continue; ctx.fillRect((sd * (len / 2 - 14) - 6) * s, (k * wid / 10 - 0.6) * s, 12 * s, 1.2 * s); }
      ctx.fillRect((sd * (len / 2 - 40) - 1.5) * s, -wid / 2 * 0.7 * s, 3 * s, wid * 0.7 * s);
    }
    // edge lines
    ctx.fillRect(-len / 2 * s, (-wid / 2 + 0.8) * s, len * s, 0.5 * s); ctx.fillRect(-len / 2 * s, (wid / 2 - 1.3) * s, len * s, 0.5 * s);
    ctx.restore();
  }

  _paintRoads(ctx, edges, x0, z0, s, res) {
    const P = (p) => [(p.x - x0) * s, (p.z - z0) * s];
    const path = (pts) => { ctx.beginPath(); pts.forEach((p, i) => { const q = P(p); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); };
    ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
    // sidewalks / shoulders
    for (const e of edges) {
      path(e.pts);
      if (e.cls === CLS.FREEWAY) { ctx.strokeStyle = 'rgb(112,108,100)'; ctx.lineWidth = (e.w + 5) * s; }
      else { ctx.strokeStyle = 'rgb(176,174,166)'; ctx.lineWidth = (e.w + 6.4) * s; }
      ctx.stroke();
    }
    // curb shadow line + asphalt
    for (const e of edges) { path(e.pts); ctx.strokeStyle = 'rgb(58,58,62)'; ctx.lineWidth = (e.w + 0.7) * s; ctx.stroke(); }
    for (const e of edges) {
      path(e.pts);
      ctx.strokeStyle = e.cls === CLS.FREEWAY ? 'rgb(66,66,70)' : e.cls === CLS.AVENUE ? 'rgb(72,72,76)' : 'rgb(78,78,82)';
      ctx.lineWidth = e.w * s; ctx.stroke();
    }
    // wear patches: darker tyre tracks
    ctx.globalAlpha = 0.16;
    for (const e of edges) {
      for (const off of [-e.w * 0.25, e.w * 0.25]) { const op = offsetPoly(e.pts, off); path(op); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.0 * s; ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    // markings
    const mk = Math.max(1.1, 0.16 * s);
    for (const e of edges) {
      const na = this.map.nodes[e.a], nb = this.map.nodes[e.b];
      const ta = na.deg >= 3 ? na.maxW / 2 + 5 : 1.5, tb = nb.deg >= 3 ? nb.maxW / 2 + 5 : 1.5;
      if (e.len < ta + tb + 3) continue;
      const sub = subPoly(e, ta, e.len - tb);
      const yellow = 'rgb(232,190,40)', white = 'rgb(232,232,228)';
      const line = (pts, color, w, dash) => { path(pts); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); };
      if (e.cls === CLS.STREET) {
        line(offsetPoly(sub, 0.18), yellow, mk); line(offsetPoly(sub, -0.18), yellow, mk);
      } else if (e.cls === CLS.AVENUE) {
        line(offsetPoly(sub, 0.18), yellow, mk); line(offsetPoly(sub, -0.18), yellow, mk);
        for (const o of [-3.7, 3.7]) line(offsetPoly(sub, o), white, mk, [3 * s, 6 * s]);
        for (const o of [-7.5, 7.5]) line(offsetPoly(sub, o), white, mk);
      } else { // freeway
        path(sub); ctx.strokeStyle = 'rgb(150,148,142)'; ctx.lineWidth = 2.2 * s; ctx.stroke();
        for (const o of [-1.25, 1.25]) line(offsetPoly(sub, o), yellow, mk);
        for (const o of [-4.9, -8.5, 4.9, 8.5]) line(offsetPoly(sub, o), white, mk, [3 * s, 9 * s]);
        for (const o of [-11.7, 11.7]) line(offsetPoly(sub, o), white, mk * 1.3);
      }
      // crosswalks + stop lines at junction ends
      for (const end of [0, 1]) {
        const n = end ? nb : na; if (n.deg < 3 || e.w < 9) continue;
        const d0 = n.maxW / 2 + 0.8; // distance from node where crosswalk starts
        if (e.len < d0 + 6) continue;
        const sPos = end ? e.len - d0 - 1.5 : d0 + 1.5;
        const pt = pointAtPoly(e, sPos); const dir = end ? [-pt.tx, -pt.tz] : [pt.tx, pt.tz]; // away from node
        ctx.save(); ctx.translate((pt.x - x0) * s, (pt.z - z0) * s); ctx.rotate(Math.atan2(dir[1], dir[0]));
        ctx.fillStyle = white;
        for (let o = -e.w / 2 + 0.9; o <= e.w / 2 - 0.8; o += 0.95) ctx.fillRect(-1.5 * s, (o - 0.22) * s, 3 * s, 0.45 * s);
        // stop line on approach side: approaching traffic travels -dir; its right side vector = (dir.z, -dir.x) in xz => canvas y axis sign
        const sl = 3.0; // behind the crosswalk; approaching traffic's right-hand lane is local -y
        ctx.fillRect((sl - 0.25) * s, -(e.w / 2 - 0.6) * s, 0.5 * s, (e.w / 2 - 0.9) * s);
        ctx.restore();
      }
    }
  }
}

function pointAtPoly(e, s) {
  s = clamp(s, 0, e.len);
  const cum = e.cum; let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const a = e.pts[lo], b = e.pts[lo + 1]; const seg = (cum[lo + 1] - cum[lo]) || 1e-9; const t = (s - cum[lo]) / seg;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: (b.x - a.x) / seg, tz: (b.z - a.z) / seg };
}
export function subPoly(e, s0, s1) {
  const out = [];
  const a = pointAtPoly(e, s0); out.push({ x: a.x, z: a.z });
  for (let i = 1; i < e.pts.length - 1; i++) if (e.cum[i] > s0 && e.cum[i] < s1) out.push(e.pts[i]);
  const b = pointAtPoly(e, s1); out.push({ x: b.x, z: b.z });
  return out;
}
// offset polyline to the LEFT (of travel direction) by d metres (negative = right). left of dir (dx,dz) = (dz,-dx)
export function offsetPoly(pts, d) {
  const n = pts.length, out = [];
  const dirs = [];
  for (let i = 0; i < n - 1; i++) { const dx = pts[i + 1].x - pts[i].x, dz = pts[i + 1].z - pts[i].z, l = Math.hypot(dx, dz) || 1; dirs.push([dx / l, dz / l]); }
  for (let i = 0; i < n; i++) {
    const d0 = dirs[Math.max(0, i - 1)], d1 = dirs[Math.min(n - 2, i)];
    let nx = d0[1] + d1[1], nz = -(d0[0] + d1[0]); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    const dot = nx * d0[1] + nz * -d0[0]; const m = 1 / Math.max(0.5, dot);
    out.push({ x: pts[i].x + nx * d * m, z: pts[i].z + nz * d * m });
  }
  return out;
}
export { pointAtPoly };
