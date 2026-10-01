// Procedural city placement: derives buildings, landmarks and props from the map data.
import { CLS, ZONE, GANG, MPP, WORLD_HALF, edgePointAt, ROAD_WIDTH } from './mapdata.js';
import { mulberry32, clamp, lerp, SpatialHash, obbOverlap, obbContains, pickWeighted, TAU, hash2 } from './util.js';
import { layoutSetpieces } from './setpieces.js';
import { GeoBuilder } from './geomutil.js';

// [minW,maxW, minD,maxD, minH,maxH]
export const SIZES = {
  house_small: [8, 11, 10, 14, 3.2, 3.6], house_ranch: [12, 16, 9, 12, 3.2, 3.6], house_two_story: [9, 12, 10, 13, 6.4, 7], duplex: [12, 16, 10, 13, 6.4, 7],
  apartment_low: [16, 26, 14, 20, 9.5, 12], apartment_mid: [20, 30, 16, 24, 17, 24], liquor_store: [10, 14, 10, 14, 4, 4.4],
  shop_strip: [18, 34, 10, 16, 4.5, 6], office_low: [16, 28, 14, 24, 10, 16], office_mid: [22, 34, 20, 30, 28, 55], skyscraper: [28, 48, 28, 48, 70, 200],
  warehouse: [24, 50, 26, 44, 8, 11], warehouse_small: [14, 22, 16, 24, 6, 8], factory: [30, 50, 30, 44, 10, 14], villa: [14, 24, 14, 22, 7, 10],
  mansion: [22, 32, 18, 26, 9, 12], beach_house: [9, 14, 10, 14, 6, 9], motel: [28, 40, 14, 18, 6, 7], gas_station: [16, 24, 18, 26, 5, 5.5],
  fast_food: [14, 20, 14, 20, 5, 6], church: [14, 20, 24, 34, 12, 14], school: [40, 60, 18, 26, 9, 10], hospital: [40, 60, 26, 40, 22, 30],
  police_station: [26, 36, 22, 30, 10, 12], city_hall: [40, 56, 34, 46, 28, 32], bank: [22, 30, 20, 28, 12, 14], terminal: [90, 130, 30, 45, 14, 16],
  hangar: [40, 55, 40, 55, 16, 18], parking_garage: [30, 44, 30, 44, 20, 28], garage_shop: [14, 20, 14, 20, 5, 5.5], gym: [18, 26, 16, 22, 7, 8],
  nightclub: [16, 24, 16, 22, 7, 8], stadium: [140, 140, 110, 110, 35, 35]
};

const ZONE_PLANS = {
  [ZONE.RES_LOW]: [['house_small', 58], ['house_ranch', 14], ['house_two_story', 10], ['duplex', 8], ['apartment_low', 4], ['church', 1], ['garage_shop', 1.5], ['liquor_store', 1.5], ['school', 0.5]],
  [ZONE.RES_MID]: [['apartment_low', 40], ['duplex', 14], ['house_two_story', 10], ['apartment_mid', 14], ['motel', 4], ['shop_strip', 8], ['house_small', 6], ['school', 1], ['church', 1.5], ['office_low', 1.5]],
  [ZONE.COMMERCIAL]: [['shop_strip', 28], ['office_low', 14], ['office_mid', 7], ['liquor_store', 5], ['fast_food', 8], ['gas_station', 6], ['garage_shop', 6], ['motel', 4], ['gym', 3], ['nightclub', 3], ['apartment_low', 6], ['parking_garage', 3], ['bank', 1.5]],
  [ZONE.DOWNTOWN]: [['skyscraper', 52], ['office_mid', 22], ['office_low', 8], ['parking_garage', 8], ['bank', 2], ['apartment_mid', 4], ['shop_strip', 4]],
  [ZONE.INDUSTRIAL]: [['warehouse', 44], ['warehouse_small', 20], ['factory', 10], ['garage_shop', 10], ['office_low', 6], ['gas_station', 4], ['shop_strip', 4]],
  [ZONE.BEACH]: [['beach_house', 58], ['shop_strip', 14], ['motel', 6], ['apartment_low', 10], ['fast_food', 6], ['nightclub', 2], ['gym', 2]],
  [ZONE.RICH]: [['villa', 52], ['mansion', 34], ['house_ranch', 10], ['house_two_story', 4]],
  [ZONE.AIRPORT]: [['hangar', 50], ['warehouse', 40], ['office_low', 10]],
  [ZONE.DOCKS]: [['warehouse', 60], ['warehouse_small', 25], ['office_low', 5], ['factory', 10]]
};
const BUILDABLE = new Set([ZONE.RES_LOW, ZONE.RES_MID, ZONE.COMMERCIAL, ZONE.DOWNTOWN, ZONE.INDUSTRIAL, ZONE.BEACH, ZONE.RICH, ZONE.AIRPORT, ZONE.DOCKS]);
const SETBACK = {
  [ZONE.RES_LOW]: [5, 9], [ZONE.RES_MID]: [2.5, 5], [ZONE.COMMERCIAL]: [1, 3], [ZONE.DOWNTOWN]: [0.5, 1.5], [ZONE.INDUSTRIAL]: [4, 9],
  [ZONE.BEACH]: [2.5, 5], [ZONE.RICH]: [8, 14], [ZONE.AIRPORT]: [8, 14], [ZONE.DOCKS]: [6, 12]
};
const LOT_GAP = { [ZONE.RES_LOW]: [1.5, 3.5], [ZONE.RES_MID]: [1.5, 3], [ZONE.COMMERCIAL]: [0.5, 2], [ZONE.DOWNTOWN]: [0.5, 1.5], [ZONE.INDUSTRIAL]: [2, 5], [ZONE.BEACH]: [1.5, 3], [ZONE.RICH]: [6, 12], [ZONE.AIRPORT]: [6, 12], [ZONE.DOCKS]: [3, 6] };
const YARD_ZONES = new Set([ZONE.RES_LOW, ZONE.RES_MID, ZONE.RICH, ZONE.BEACH]);
const MULTI = new Set(['hedge_segment', 'wall_segment', 'jersey_barrier', 'billboard']);
const HOUSES = new Set(['house_small', 'house_ranch', 'house_two_story', 'duplex', 'villa', 'mansion', 'beach_house']);

export class Placement {
  constructor(map, terrain, seed = 1337) {
    this.map = map; this.terrain = terrain; this.rng = mulberry32(seed);
    this.buildings = []; this.props = []; this.landmarks = {}; this.signals = [];
    this.occ = new SpatialHash(24);       // building OBBs
    this.propOcc = new SpatialHash(8);    // prop circles (for spacing)
    this.downtown = { x: 0, z: 0 };
    this.colliders = [];                  // static colliders: OBBs {x,z,hw,hd,yaw,h,kind} and circles {x,z,r,h}
    this._computeDowntown();
  }

  _computeDowntown() {
    const m = this.map; let sx = 0, sz = 0, n = 0;
    for (let i = 0; i < m.zone.length; i += 3) if (m.zone[i] === ZONE.DOWNTOWN) { sx += i % m.N; sz += (i / m.N) | 0; n++; }
    if (n) { this.downtown = { x: ((sx / n) - m.N / 2) * MPP, z: ((sz / n) - m.N / 2) * MPP }; }
  }

  // ------------------------------------------------------------------ lots
  lotValid(cx, cz, w, d, yaw, o = {}) {
    const m = this.map, hw = w / 2, hd = d / 2, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const minRd = o.minRoadDist ?? 3.0, slopeMax = o.slope ?? 3.0;
    let hmin = 1e9, hmax = -1e9;
    const pts = [[0, 0], [-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, -hd], [0, hd], [-hw, 0], [hw, 0]];
    for (const [lx, lz] of pts) {
      const x = cx + lx * cs + lz * sn, z = cz - lx * sn + lz * cs;
      if (Math.abs(x) > WORLD_HALF - 20 || Math.abs(z) > WORLD_HALF - 20) return false;
      if (m.roadDistAt(x, z) < minRd) return false;
      const c = m.classAt(x, z);
      if (c === CLS.WATER || c === CLS.CONCRETE && !o.allowConcrete || c === CLS.RUNWAY || (c >= CLS.STREET && c <= CLS.FREEWAY)) return false;
      if (c === CLS.SAND && !o.allowSand) return false;
      const h = this.terrain.groundY(x, z); if (h < hmin) hmin = h; if (h > hmax) hmax = h;
      if (hmin < 0.6) return false;
    }
    if (hmax - hmin > slopeMax) return false;
    const box = { x: cx, z: cz, hw: hw + (o.gap ?? 1.5), hd: hd + (o.gap ?? 1.5), yaw };
    const R = Math.hypot(hw, hd) + 6;
    const near = this.occ.queryRadius(cx, cz, R);
    for (const b of near) if (obbOverlap(box, b.obb)) return false;
    return true;
  }

  addBuilding(b) {
    b.hw = b.w / 2; b.hd = b.d / 2;
    b.obb = { x: b.x, z: b.z, hw: b.hw, hd: b.hd, yaw: b.yaw, h: b.h, kind: 'building', ref: b };
    b.y = this.terrain.groundY(b.x, b.z);
    { // footprint height range (podium / floating checks)
      const cs = Math.cos(b.yaw), sn = Math.sin(b.yaw); let lo = 1e9, hi = -1e9;
      for (const [lx, lz] of [[-b.hw, -b.hd], [b.hw, -b.hd], [-b.hw, b.hd], [b.hw, b.hd], [0, -b.hd], [0, b.hd], [-b.hw, 0], [b.hw, 0]]) { const h = this.terrain.groundY(b.x + lx * cs + lz * sn, b.z - lx * sn + lz * cs); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      b.hmin = Math.min(lo, b.y); b.hmax = Math.max(hi, b.y);
    }
    const R = Math.hypot(b.hw, b.hd);
    this.occ.insertBounds(b, b.x - R, b.z - R, b.x + R, b.z + R);
    this.buildings.push(b);
    this.colliders.push(b.obb);
    return b;
  }

  // reserve an oriented rectangle: blocks lots/props (like a building) without being one; optional static collider
  reserve(x, z, hw, hd, yaw = 0, o = {}) {
    const obb = { x, z, hw, hd, yaw, h: o.h || 3, kind: 'reserved' };
    const b = { x, z, hw, hd, obb, reserved: true, type: 'reserved', w: hw * 2, d: hd * 2, yaw };
    const R = Math.hypot(hw, hd);
    this.occ.insertBounds(b, x - R, z - R, x + R, z + R);
    if (o.collide) this.colliders.push({ x, z, hw, hd, yaw, h: o.h || 3, kind: 'setpiece' });
    return b;
  }

  planFor(zone, ctx = {}) {
    const rng = this.rng;
    let table = ZONE_PLANS[zone];
    if (!table) return null;
    if (ctx.avenue && (zone === ZONE.RES_LOW || zone === ZONE.RES_MID) && rng() < 0.65) table = ZONE_PLANS[ZONE.COMMERCIAL];
    const t = pickWeighted(table, e => e[1], rng)[0];
    const S = SIZES[t];
    const w = lerp(S[0], S[1], rng()), d = lerp(S[2], S[3], rng());
    let h = lerp(S[4], S[5], rng());
    if (t === 'skyscraper' || t === 'office_mid') {
      const dd = Math.hypot(ctx.x - this.downtown.x, ctx.z - this.downtown.z);
      const f = clamp(1 - dd / 420, 0, 1);
      h = lerp(S[4], S[5], Math.pow(f, 0.8)) * lerp(0.6, 1.15, rng());
      if (t === 'office_mid') h = lerp(S[4], S[5], rng() * (0.4 + 0.6 * f));
      h = clamp(h, S[4], S[5] * 1.1);
    }
    return { type: t, w, d, h };
  }

  // ------------------------------------------------------------------ frontage
  placeFrontage() {
    const m = this.map, rng = this.rng;
    for (const e of m.edges) {
      if (e.cls === CLS.FREEWAY) continue;
      for (const side of [1, -1]) {
        let s = 3 + rng() * 5;
        const tmp = {};
        while (s < e.len - 4) {
          // probe zone
          edgePointAt(e, s, tmp);
          const nx = side > 0 ? tmp.tz : -tmp.tz, nz = side > 0 ? -tmp.tx : tmp.tx; // left normal for side>0
          const probe = { x: tmp.x + nx * (e.w / 2 + 8), z: tmp.z + nz * (e.w / 2 + 8) };
          const zone = m.zoneAt(probe.x, probe.z);
          if (!BUILDABLE.has(zone)) { s += 8; continue; }
          const plan = this.planFor(zone, { avenue: e.cls === CLS.AVENUE, x: probe.x, z: probe.z });
          if (!plan) { s += 8; continue; }
          let placed = false;
          for (let attempt = 0; attempt < 4 && !placed; attempt++) {
            const k = 1 - attempt * 0.18;
            const w = Math.max(6, plan.w * k), d = Math.max(6, plan.d * (1 - attempt * 0.12));
            if (s + w > e.len - 2) break;
            edgePointAt(e, s + w / 2, tmp);
            const nx2 = side > 0 ? tmp.tz : -tmp.tz, nz2 = side > 0 ? -tmp.tx : tmp.tx;
            const sb = SETBACK[zone] || [2, 4];
            const setback = lerp(sb[0], sb[1], rng());
            const off = e.w / 2 + 3.2 + setback + d / 2;
            const cx = tmp.x + nx2 * off, cz = tmp.z + nz2 * off;
            const yaw = Math.atan2(-nx2, -nz2);
            const opt = { gap: lerp(LOT_GAP[zone]?.[0] ?? 1, LOT_GAP[zone]?.[1] ?? 2, rng()), allowSand: zone === ZONE.BEACH, slope: zone === ZONE.RICH ? 5 : 3, minRoadDist: 3.2 };
            if (this.lotValid(cx, cz, w, d, yaw, opt)) {
              this.addBuilding({ type: plan.type, x: cx, z: cz, yaw, w, d, h: plan.h, seed: (rng() * 1e9) | 0, zone, district: m.districtAt(cx, cz)?.id || 0, front: e.id, setback, roadW: e.w });
              const gap = lerp(LOT_GAP[zone]?.[0] ?? 1, LOT_GAP[zone]?.[1] ?? 2, rng());
              s += w + gap; placed = true;
            }
          }
          if (!placed) s += 7 + rng() * 4;
        }
      }
    }
  }

  // level pads for buildings on sloped ground, then refresh their footprint height range
  terraceBuildings() {
    const T = this.terrain;
    for (const b of this.buildings) {
      if (b.type === 'stadium' || b.type === 'terminal' || b.type === 'hangar') continue;
      if (b.hmax - b.hmin > 0.9) { const y = T.groundY(b.x, b.z); if (T.terrace(b, y)) b.y = y; }
    }
    const cs = (b) => [Math.cos(b.yaw), Math.sin(b.yaw)];
    for (const b of this.buildings) {
      const [c, s] = cs(b); let lo = 1e9, hi = -1e9;
      for (const [lx, lz] of [[0, 0], [-b.hw, -b.hd], [b.hw, -b.hd], [-b.hw, b.hd], [b.hw, b.hd], [0, -b.hd], [0, b.hd], [-b.hw, 0], [b.hw, 0]]) { const h = T.groundY(b.x + lx * c + lz * s, b.z - lx * s + lz * c); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      b.hmin = Math.min(lo, b.y); b.hmax = Math.max(hi, b.y);
    }
  }

  // ------------------------------------------------------------------ interior infill
  placeInfill() {
    const m = this.map, rng = this.rng, step = 13;
    for (let z = -WORLD_HALF + 20; z < WORLD_HALF - 20; z += step) {
      for (let x = -WORLD_HALF + 20; x < WORLD_HALF - 20; x += step) {
        const jx = x + (rng() - 0.5) * step, jz = z + (rng() - 0.5) * step;
        const zone = m.zoneAt(jx, jz);
        if (!BUILDABLE.has(zone)) continue;
        if (zone === ZONE.RICH && rng() < 0.55) continue;
        if (zone === ZONE.AIRPORT && m.classAt(jx, jz) === CLS.GRASS && rng() < 0.6) continue;   // airfield: keep it airy
        if (m.roadDistAt(jx, jz) < 9) continue;
        const plan = this.planFor(zone === ZONE.AIRPORT ? ZONE.INDUSTRIAL : zone, { x: jx, z: jz });
        if (!plan) continue;
        const near = m.nearestRoad(jx, jz, 70);
        let yaw;
        if (near) yaw = Math.atan2(-near.tz, near.tx) + (rng() < 0.5 ? Math.PI : 0);
        else yaw = rng() * TAU;
        // back-row buildings are smaller in residential areas
        let w = plan.w, d = plan.d;
        if (zone === ZONE.RES_LOW || zone === ZONE.RES_MID) { w *= 0.85; d *= 0.85; }
        if (rng() < 0.12 && HOUSES.has(plan.type)) continue;
        for (let attempt = 0; attempt < 3; attempt++) {
          const k = 1 - attempt * 0.2;
          if (this.lotValid(jx, jz, Math.max(6, w * k), Math.max(6, d * k), yaw, { gap: lerp(LOT_GAP[zone]?.[0] ?? 1, LOT_GAP[zone]?.[1] ?? 2, rng()), allowSand: zone === ZONE.BEACH, slope: zone === ZONE.RICH ? 5 : 3, minRoadDist: 5 })) {
            this.addBuilding({ type: plan.type, x: jx, z: jz, yaw, w: Math.max(6, w * k), d: Math.max(6, d * k), h: plan.h, seed: (rng() * 1e9) | 0, zone, district: m.districtAt(jx, jz)?.id || 0, infill: true });
            break;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ landmarks
  // find best valid frontage spot for a lot of size (w,d) closest to (nx,nz) within radius
  findSpot(nx, nz, w, d, o = {}) {
    const m = this.map, rng = this.rng, R = o.radius ?? 160;
    let best = null, bd = 1e18; const tmp = {};
    const seen = new Set();
    const c = m.edgeCell, r = Math.ceil(R / c);
    for (let ix = Math.floor(nx / c) - r; ix <= Math.floor(nx / c) + r; ix++) for (let iz = Math.floor(nz / c) - r; iz <= Math.floor(nz / c) + r; iz++) {
      const arr = m.edgeGrid.get(ix * 10007 + iz); if (!arr) continue;
      for (const sg of arr) {
        const e = sg.e; if (seen.has(e.id)) continue; seen.add(e.id);
        if (o.cls && !o.cls.includes(e.cls)) continue;
        if (e.cls === CLS.FREEWAY) continue;
        for (let s = w / 2 + 2; s < e.len - w / 2 - 2; s += 3) {
          edgePointAt(e, s, tmp);
          const dd = (tmp.x - nx) ** 2 + (tmp.z - nz) ** 2; if (dd > R * R) continue;
          for (const side of [1, -1]) {
            const nx2 = side > 0 ? tmp.tz : -tmp.tz, nz2 = side > 0 ? -tmp.tx : tmp.tx;
            const off = e.w / 2 + 3.2 + (o.setback ?? 2) + d / 2;
            const cx = tmp.x + nx2 * off, cz = tmp.z + nz2 * off;
            const score = (cx - nx) ** 2 + (cz - nz) ** 2; if (score >= bd) continue;
            if (!o.anyZone) { const zone = m.zoneAt(cx, cz); if (!BUILDABLE.has(zone)) continue; if (o.zones && !o.zones.includes(zone)) continue; }
            const yaw = Math.atan2(-nx2, -nz2);
            if (!this.lotValid(cx, cz, w, d, yaw, { gap: o.gap ?? 2, slope: o.slope ?? 3, allowSand: true })) continue;
            bd = score; best = { x: cx, z: cz, yaw };
          }
        }
      }
    }
    return best;
  }

  districtCentre(name) {
    const n = name.toLowerCase();
    let d = this.map.districts.find(q => q.name.toLowerCase() === n) || this.map.districts.find(q => q.name.toLowerCase().includes(n));
    if (!d) return null;
    return { x: (d.cx - this.map.N / 2) * MPP, z: (d.cy - this.map.N / 2) * MPP, d };
  }

  // remove generic buildings overlapping a reserved landmark rect
  _clearFor(x, z, w, d, yaw) {
    const box = { x, z, hw: w / 2 + 2, hd: d / 2 + 2, yaw };
    const R = Math.hypot(w, d) / 2 + 40;
    const near = this.occ.queryRadius(x, z, R);
    for (const b of near) {
      if (b.landmark) continue;
      if (obbOverlap(box, b.obb)) this._removeBuilding(b);
    }
  }
  _removeBuilding(b) {
    const R = Math.hypot(b.hw, b.hd);
    this.occ.remove(b, b.x - R, b.z - R, b.x + R, b.z + R);
    const i = this.buildings.indexOf(b); if (i >= 0) this.buildings.splice(i, 1);
    const k = this.colliders.indexOf(b.obb); if (k >= 0) this.colliders.splice(k, 1);
  }

  placeLandmarks() {
    const rng = this.rng, L = this.landmarks;
    const place = (id, type, district, o = {}) => {
      const S = SIZES[type]; const w = o.w ?? lerp(S[0], S[1], 0.5), d = o.d ?? lerp(S[2], S[3], 0.5), h = o.h ?? lerp(S[4], S[5], 0.5);
      let c = district ? this.districtCentre(district) : null;
      let cx = o.x ?? c?.x ?? 0, cz = o.z ?? c?.z ?? 0;
      let spot = null;
      for (const R of [o.radius ?? 120, 220, 400]) { spot = this.findSpot(cx, cz, w, d, { radius: R, cls: o.cls, zones: o.zones, setback: o.setback, slope: o.slope }); if (spot) break; }
      if (!spot) { console.warn('landmark not placed', id); return null; }
      const b = this.addBuilding({ type, x: spot.x, z: spot.z, yaw: spot.yaw, w, d, h, seed: (rng() * 1e9) | 0, zone: this.map.zoneAt(spot.x, spot.z), landmark: id, name: o.name || id });
      const fx = Math.sin(spot.yaw), fz = Math.cos(spot.yaw);
      const rec = { id, type, name: o.name || id, x: spot.x, z: spot.z, yaw: spot.yaw, w, d, h, door: { x: spot.x + fx * (d / 2 + 2.2), z: spot.z + fz * (d / 2 + 2.2) }, building: b, district: this.map.districtAt(spot.x, spot.z)?.name || '' };
      L[id] = rec; return rec;
    };
    this._place = place;
    // player's house on Grove-style street
    place('home', 'house_small', 'Ganton', { name: 'Emerald Row safehouse', radius: 60, cls: [CLS.STREET], setback: 4, w: 10, d: 12 });
    place('hospital_a', 'hospital', 'Jefferson', { name: 'All Saints General Hospital', cls: [CLS.AVENUE, CLS.STREET], zones: [ZONE.RES_LOW, ZONE.RES_MID, ZONE.COMMERCIAL] });
    place('hospital_b', 'hospital', 'Market', { name: 'County General Hospital', cls: [CLS.AVENUE, CLS.STREET] });
    place('police_hq', 'police_station', 'Commerce', { name: 'Los Santos Police Department', cls: [CLS.AVENUE] });
    place('police_b', 'police_station', 'Vinewood', { name: 'Vinewood Police Station', cls: [CLS.AVENUE, CLS.STREET] });
    place('police_c', 'police_station', 'Idlewood', { name: 'Idlewood Police Station', cls: [CLS.AVENUE, CLS.STREET] });
    place('pns_a', 'garage_shop', 'Idlewood', { name: "Pay 'n' Spray", cls: [CLS.AVENUE], w: 16, d: 16 });
    place('pns_b', 'garage_shop', 'Market', { name: "Pay 'n' Spray", cls: [CLS.AVENUE], w: 16, d: 16 });
    place('pns_c', 'garage_shop', 'Las Colinas', { name: "Pay 'n' Spray", cls: [CLS.AVENUE, CLS.STREET], w: 16, d: 16 });
    place('ammu_a', 'shop_strip', 'Ganton', { name: 'Ammu-Nation', cls: [CLS.AVENUE, CLS.STREET], w: 20, d: 12, h: 4.6, radius: 200 });
    place('ammu_b', 'shop_strip', 'Pershing Square', { name: 'Ammu-Nation', cls: [CLS.AVENUE, CLS.STREET], w: 20, d: 12, h: 4.6 });
    place('ammu_c', 'shop_strip', 'Vinewood', { name: 'Ammu-Nation', cls: [CLS.AVENUE, CLS.STREET], w: 20, d: 12, h: 4.6 });
    place('burger_a', 'fast_food', 'Idlewood', { name: 'Burger Bonanza', cls: [CLS.AVENUE] });
    place('burger_b', 'fast_food', 'Downtown Financial', { name: 'Burger Bonanza', cls: [CLS.AVENUE, CLS.STREET] });
    place('pizza_a', 'fast_food', 'Jefferson', { name: 'Pizza Stack', cls: [CLS.AVENUE] });
    place('pizza_b', 'fast_food', 'Vinewood', { name: 'Pizza Stack', cls: [CLS.AVENUE] });
    place('chicken_a', 'fast_food', 'Willowfield', { name: "Clucky's", cls: [CLS.AVENUE] });
    place('chicken_b', 'fast_food', 'East Los Santos', { name: "Clucky's", cls: [CLS.AVENUE, CLS.STREET] });
    place('chicken_c', 'fast_food', 'Santa Maria Beach', { name: "Clucky's", cls: [CLS.AVENUE, CLS.STREET] });
    place('gas_a', 'gas_station', 'Ganton', { name: 'Gas Station', cls: [CLS.AVENUE] });
    place('gas_b', 'gas_station', 'Rodeo', { name: 'Gas Station', cls: [CLS.AVENUE] });
    place('gas_c', 'gas_station', 'El Corona', { name: 'Gas Station', cls: [CLS.AVENUE] });
    place('gas_d', 'gas_station', 'Temple', { name: 'Gas Station', cls: [CLS.AVENUE] });
    place('bank', 'bank', 'Pershing Square', { name: 'Los Santos Savings & Trust', cls: [CLS.AVENUE, CLS.STREET], w: 26, d: 24 });
    place('city_hall', 'city_hall', 'Commerce', { name: 'City Hall', cls: [CLS.AVENUE] });
    place('label', 'office_mid', 'Vinewood', { name: 'Hollow Kings Records', cls: [CLS.AVENUE, CLS.STREET], w: 26, d: 24, h: 34 });
    place('club', 'nightclub', 'Vinewood', { name: 'Club Zenith', cls: [CLS.AVENUE, CLS.STREET] });
    place('mansion', 'mansion', 'Vinewood Hills', { name: 'Calloway Estate', cls: [CLS.STREET], w: 30, d: 24, h: 11, radius: 200, slope: 5 });
    place('gym', 'gym', 'Ganton', { name: 'Ganton Gym', cls: [CLS.AVENUE, CLS.STREET], radius: 240 });
    place('church', 'church', 'East Los Santos', { name: 'Church', cls: [CLS.STREET, CLS.AVENUE] });
    place('school', 'school', 'Glen Park', { name: 'School', cls: [CLS.STREET, CLS.AVENUE] });
    place('vk_base', 'house_small', 'Idlewood', { name: 'Violet Kings hideout', cls: [CLS.STREET], radius: 100 });
    place('vk_hq', 'apartment_low', 'Jefferson', { name: 'Violet Kings headquarters', cls: [CLS.STREET, CLS.AVENUE], w: 22, d: 18 });
    place('ls_warehouse', 'warehouse', 'Willowfield', { name: 'Los Soles warehouse', cls: [CLS.STREET, CLS.AVENUE], w: 34, d: 28 });
    place('bl_dock', 'warehouse', 'Ocean Docks', { name: 'Blue Line dock warehouse', cls: [CLS.STREET, CLS.AVENUE], w: 38, d: 30, radius: 260 });
    place('garage_harlan', 'warehouse_small', 'Ocean Flats', { name: 'Chop shop', cls: [CLS.STREET, CLS.AVENUE] });
    place('dealer', 'garage_shop', 'Rodeo', { name: 'Prestige Motors', cls: [CLS.AVENUE], w: 20, d: 18 });
    place('motel', 'motel', 'Verona Beach', { name: 'Sunset Motel', cls: [CLS.AVENUE, CLS.STREET] });
    place('pier_shop', 'shop_strip', 'Santa Maria Beach', { name: 'Pier Arcade', cls: [CLS.AVENUE, CLS.STREET] });
    // stadium: fill STADIUM zone region
    this._placeStadium();
    this._placeAirport();
  }

  _regionStats(zoneId) {
    const m = this.map; let sx = 0, sz = 0, n = 0, minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (let i = 0; i < m.zone.length; i++) if (m.zone[i] === zoneId) {
      const x = i % m.N, z = (i / m.N) | 0; sx += x; sz += z; n++; minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z);
    }
    if (!n) return null;
    return { x: ((sx / n) - m.N / 2) * MPP, z: ((sz / n) - m.N / 2) * MPP, w: (maxx - minx) * MPP, d: (maxz - minz) * MPP, n };
  }

  _placeStadium() {
    const r = this._regionStats(ZONE.STADIUM); const L = this.landmarks;
    if (!r) return;
    // try the region centre first, else shrink
    for (const sc of [1, 0.9, 0.8, 0.7, 0.6]) {
      const w = Math.min(SIZES.stadium[0], r.w * 0.8 * sc), d = Math.min(SIZES.stadium[2], r.d * 0.8 * sc);
      if (w < 70 || d < 60) break;
      for (const yaw of [0, Math.PI / 2]) {
        for (const off of [[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20], [30, 30], [-30, -30], [30, -30], [-30, 30]]) {
          const cx = r.x + off[0], cz = r.z + off[1];
          if (this.lotValid(cx, cz, w, d, yaw, { minRoadDist: 6, allowConcrete: true, gap: 2, slope: 2.5 })) {
            const b = this.addBuilding({ type: 'stadium', x: cx, z: cz, yaw, w, d, h: 35, seed: 4242, zone: ZONE.STADIUM, landmark: 'stadium', name: 'Los Santos Stadium' });
            L.stadium = { id: 'stadium', type: 'stadium', name: 'Los Santos Stadium', x: cx, z: cz, yaw, w, d, h: 35, door: { x: cx + Math.sin(yaw) * (d / 2 + 6), z: cz + Math.cos(yaw) * (d / 2 + 6) }, building: b };
            // the stadium bowl is hollow-ish: only collide the stands ring; keep a simple solid box for now
            return;
          }
        }
      }
    }
    console.warn('stadium not placed', r);
  }

  _placeAirport() {
    const m = this.map, L = this.landmarks;
    const r = this._regionStats(ZONE.AIRPORT); if (!r) return;
    // terminal: row on the north side of the runway(s) closest to airport region centre
    const rw = m.runways[0];
    const terminalSpots = [];
    if (rw) {
      const ux = rw.dirx, uz = rw.dirz; // runway axis
      // perpendicular pointing north (-z)
      let px = -uz, pz = ux; if (pz > 0) { px = -px; pz = -pz; }
      for (const dist of [70, 90, 110, 140]) {
        terminalSpots.push({ x: rw.x + rw.dirx * rw.cu + px * dist, z: rw.z + rw.dirz * rw.cu + pz * dist, yaw: Math.atan2(-px, -pz) * 1 });
      }
    }
    // face the terminal front towards the runway: front faces +Z local => direction (sin,cos) = toward runway = -perp
    for (const sp of terminalSpots) {
      const w = 110, d = 34;
      const yaw = sp.yaw + Math.PI; // front faces runway
      let ok = false;
      for (const ww of [w, 90, 70]) {
        if (this.lotValid(sp.x, sp.z, ww, d, yawFromAxis(rw, sp), { minRoadDist: 4, allowConcrete: true, gap: 3, slope: 2 })) {
          const yw = yawFromAxis(rw, sp);
          const b = this.addBuilding({ type: 'terminal', x: sp.x, z: sp.z, yaw: yw, w: ww, d, h: 15, seed: 777, zone: ZONE.AIRPORT, landmark: 'terminal', name: 'LS International Terminal' });
          L.terminal = { id: 'terminal', type: 'terminal', name: 'LS International Terminal', x: sp.x, z: sp.z, yaw: yw, w: ww, d, h: 15, door: { x: sp.x + Math.sin(yw) * (d / 2 + 3), z: sp.z + Math.cos(yw) * (d / 2 + 3) }, building: b };
          ok = true; break;
        }
      }
      if (ok) break;
    }
    // hangars along the runway
    if (rw) {
      let px = -rw.dirz, pz = rw.dirx; if (pz > 0) { px = -px; pz = -pz; }
      let count = 0;
      for (let u = -rw.len / 2 + 50; u < rw.len / 2 - 50 && count < 4; u += 70) {
        for (const dist of [60, 75, 95]) {
          const x = rw.x + rw.dirx * (rw.cu + u) + px * dist, z = rw.z + rw.dirz * (rw.cu + u) + pz * dist;
          const yw = yawFromAxis(rw, { x, z });
          if (this.lotValid(x, z, 36, 30, yw, { minRoadDist: 4, allowConcrete: true, gap: 4, slope: 2 })) {
            this.addBuilding({ type: 'hangar', x, z, yaw: yw, w: 36, d: 30, h: 15, seed: (this.rng() * 1e9) | 0, zone: ZONE.AIRPORT, name: 'Hangar' }); count++; break;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ props
  addProp(kind, x, z, o = {}) {
    const p = { kind, variant: o.variant ?? 0, x, z, yaw: o.yaw ?? 0, y: o.y, s: o.s ?? 1, solid: o.solid ?? null };
    this.props.push(p);
    return p;
  }

  propClear(x, z, margin = 1.2) {
    const near = this.occ.queryRadius(x, z, 40);
    for (const b of near) if (obbContains(b.obb, x, z, margin)) return false;
    return true;
  }

  placeProps(PROP_DEFS) {
    const m = this.map, rng = this.rng, tmp = {};
    const has = k => !PROP_DEFS || PROP_DEFS[k];
    this.propDefs = PROP_DEFS;
    const add = (kind, x, z, o = {}) => { if (!has(kind)) return null; if (kind !== 'trafficlight' && kind !== 'container' && m.roadDistAt(x, z) < 0.3) return null; return this.addProp(kind, x, z, o); };
    const propSpacingOk = (x, z, r) => { const n = this.propOcc.queryRadius(x, z, r); for (const q of n) if ((q.x - x) ** 2 + (q.z - z) ** 2 < r * r) return false; return true; };
    const reg = (p, r) => { if (p) this.propOcc.insertPoint({ x: p.x, z: p.z }, p.x, p.z); };
    // ---- street furniture along edges
    for (const e of m.edges) {
      const na = m.nodes[e.a], nb = m.nodes[e.b];
      const ta = (na.deg >= 3 ? na.maxW / 2 + 7 : 3), tb = (nb.deg >= 3 ? nb.maxW / 2 + 7 : 3);
      if (e.cls === CLS.FREEWAY) {
        // barriers/lamps on the freeway shoulder
        for (let s = ta + 10; s < e.len - tb; s += 55) {
          edgePointAt(e, s, tmp);
          for (const side of [1, -1]) {
            const nx = side > 0 ? tmp.tz : -tmp.tz, nz = side > 0 ? -tmp.tx : tmp.tx;
            add('lamp', tmp.x + nx * (e.w / 2 + 2.2), tmp.z + nz * (e.w / 2 + 2.2), { yaw: Math.atan2(-nx, -nz) });
          }
        }
        continue;
      }
      let lampS = ta + 6 + rng() * 10, treeS = ta + 4 + rng() * 8, sideFlip = 1;
      for (let s = ta; s < e.len - tb; s += 2) {
        edgePointAt(e, s, tmp);
        const nxl = tmp.tz, nzl = -tmp.tx;
        const zone = m.zoneAt(tmp.x + nxl * (e.w / 2 + 6), tmp.z + nzl * (e.w / 2 + 6));
        const zoneR = m.zoneAt(tmp.x - nxl * (e.w / 2 + 6), tmp.z - nzl * (e.w / 2 + 6));
        if (s >= lampS) {
          sideFlip = -sideFlip; lampS = s + 32 + rng() * 8;
          const off = e.w / 2 + 0.9;
          const x = tmp.x + nxl * off * sideFlip, z = tmp.z + nzl * off * sideFlip;
          if (this.propClear(x, z, 0.5)) reg(add('lamp', x, z, { yaw: Math.atan2(-nxl * sideFlip, -nzl * sideFlip) }));
        }
        if (s >= treeS) {
          treeS = s + 14 + rng() * 10;
          for (const side of [1, -1]) {
            const zn = side > 0 ? zone : zoneR;
            const pr = { [ZONE.RES_LOW]: 0.55, [ZONE.RES_MID]: 0.45, [ZONE.COMMERCIAL]: 0.35, [ZONE.DOWNTOWN]: 0.3, [ZONE.BEACH]: 0.6, [ZONE.RICH]: 0.85, [ZONE.PARK]: 0.4, [ZONE.INDUSTRIAL]: 0.1 }[zn] ?? 0;
            if (rng() > pr) continue;
            const off = e.w / 2 + 1.9; const x = tmp.x + nxl * off * side, z = tmp.z + nzl * off * side;
            if (!this.propClear(x, z, 1.0) || !propSpacingOk(x, z, 4)) continue;
            const palm = (zn === ZONE.BEACH || zn === ZONE.COMMERCIAL || zn === ZONE.DOWNTOWN || zn === ZONE.RICH) ? rng() < 0.75 : rng() < 0.4;
            reg(add(palm ? 'palm' : 'tree', x, z, { variant: (rng() * 4) | 0, yaw: rng() * TAU, s: 0.85 + rng() * 0.4 }));
          }
        }
      }
      // misc furniture by zone
      for (let s = ta + 3; s < e.len - tb; s += 9) {
        edgePointAt(e, s, tmp);
        const nxl = tmp.tz, nzl = -tmp.tx;
        for (const side of [1, -1]) {
          const x0 = tmp.x + nxl * (e.w / 2 + 6) * side, z0 = tmp.z + nzl * (e.w / 2 + 6) * side;
          const zn = m.zoneAt(x0, z0); const fy = Math.atan2(-nxl * side, -nzl * side);
          const off = e.w / 2 + 1.0; const x = tmp.x + nxl * off * side, z = tmp.z + nzl * off * side;
          const r = rng();
          if (!propSpacingOk(x, z, 3) || !this.propClear(x, z, 0.4)) continue;
          if ((zn === ZONE.DOWNTOWN || zn === ZONE.COMMERCIAL) && r < 0.22) reg(add(['parkingmeter', 'trashcan', 'bench', 'newspaper', 'phonebooth', 'vending'][(rng() * 6) | 0], x, z, { yaw: fy }));
          else if ((zn === ZONE.RES_LOW || zn === ZONE.RES_MID) && r < 0.09) reg(add(rng() < 0.5 ? 'mailbox' : 'trashcan', x, z, { yaw: fy }));
          else if (r < 0.03) reg(add('hydrant', x, z, { yaw: fy }));
          else if (zn === ZONE.BEACH && r < 0.08) reg(add('bench', x, z, { yaw: fy }));
        }
      }
      // bus stops on avenues
      if (e.cls === CLS.AVENUE || (e.cls === CLS.STREET && e.len > 90 && m.zoneAt(tmp.x, tmp.z) !== ZONE.NONE && (edgePointAt(e, e.len / 2, tmp), m.zoneAt(tmp.x, tmp.z) === ZONE.COMMERCIAL || m.zoneAt(tmp.x, tmp.z) === ZONE.DOWNTOWN))) {
        for (let s = ta + 30; s < e.len - tb - 10; s += 140 + rng() * 60) {
          edgePointAt(e, s, tmp); const side = rng() < 0.5 ? 1 : -1; const nxl = tmp.tz * side, nzl = -tmp.tx * side;
          const x = tmp.x + nxl * (e.w / 2 + 2.6), z = tmp.z + nzl * (e.w / 2 + 2.6);
          if (this.propClear(x, z, 1.5) && m.zoneAt(x, z) !== ZONE.NONE) reg(add('busstop', x, z, { yaw: Math.atan2(-nxl, -nzl) }));
        }
      }
    }
    // ---- traffic signals at junctions
    for (const n of m.nodes) {
      if (n.deg < 3 || n.maxW < 10) continue;
      const sig = { node: n.id, x: n.x, z: n.z, arms: [], props: [] };
      for (const eid of n.edges) {
        const e = m.edges[eid]; if (e.w < 9) continue;
        const atA = e.a === n.id;
        const pt = edgePointAt(e, atA ? Math.min(e.len * 0.5, n.maxW / 2 + 2) : Math.max(e.len * 0.5, e.len - n.maxW / 2 - 2), {});
        const ux = atA ? pt.tx : -pt.tx, uz = atA ? pt.tz : -pt.tz;   // unit vector from node out along the arm
        // approaching traffic right side = (uz, -ux)
        const rx = uz, rz = -ux;
        const x = n.x + ux * (n.maxW / 2 + 1.4) + rx * (e.w / 2 + 0.7), z = n.z + uz * (n.maxW / 2 + 1.4) + rz * (e.w / 2 + 0.7);
        const axis = Math.abs(ux) > Math.abs(uz) ? 0 : 1;
        sig.arms.push({ edge: eid, atA, ux, uz, axis, x, z });
        const p = add('trafficlight', x, z, { yaw: Math.atan2(ux, uz), variant: axis });
        if (p) { p.signal = sig; sig.props.push(p); }
      }
      if (sig.arms.length >= 3) this.signals.push(sig);
    }
    // ---- zone scatter
    const step = 9;
    for (let z = -WORLD_HALF + 10; z < WORLD_HALF - 10; z += step) {
      for (let x = -WORLD_HALF + 10; x < WORLD_HALF - 10; x += step) {
        const px = x + (rng() - 0.5) * step, pz = z + (rng() - 0.5) * step;
        const zone = m.zoneAt(px, pz), cls = m.classAt(px, pz);
        if (cls === CLS.WATER || cls === CLS.RUNWAY || (cls >= CLS.STREET && cls <= CLS.FREEWAY)) continue;
        if (m.roadDistAt(px, pz) < 4) continue;
        const r = rng();
        const y = this.terrain.groundY(px, pz); if (y < 0.7) continue;
        if (!this.propClear(px, pz, 2.5)) continue;
        if (cls === CLS.CONCRETE && zone !== ZONE.DOCKS && zone !== ZONE.STADIUM && zone !== ZONE.AIRPORT && zone !== ZONE.COMMERCIAL && zone !== ZONE.INDUSTRIAL && zone !== ZONE.DOWNTOWN) {
          // river channel / flood-control concrete: litter instead of lawn props
          if (r < 0.012) reg(add(['tyre_stack', 'barrel', 'cone', 'crate', 'jersey_barrier', 'dumpster'][(rng() * 6) | 0], px, pz, { yaw: rng() * TAU }));
        } else if (zone === ZONE.PARK) {
          if (r < 0.34) { if (propSpacingOk(px, pz, 4.5)) reg(add(rng() < 0.3 ? 'palm' : 'tree', px, pz, { variant: (rng() * 4) | 0, yaw: rng() * TAU, s: 0.8 + rng() * 0.6 })); }
          else if (r < 0.46) reg(add('bush', px, pz, { variant: (rng() * 3) | 0, yaw: rng() * TAU, s: 0.8 + rng() * 0.5 }));
          else if (r < 0.485) reg(add('bench', px, pz, { yaw: rng() * TAU }));
          else if (r < 0.495) reg(add('grill', px, pz, { variant: (rng() * 2) | 0, yaw: rng() * TAU }));
          else if (r < 0.505) reg(add('trashcan', px, pz, { variant: (rng() * 2) | 0, yaw: rng() * TAU }));
        } else if (zone === ZONE.WILD || cls === CLS.SCRUB) {
          if (r < 0.085) reg(add('bush', px, pz, { variant: (rng() * 3) | 0, yaw: rng() * TAU, s: 0.8 + rng() * 0.7 }));
          else if (r < 0.115) reg(add('rock', px, pz, { variant: (rng() * 4) | 0, yaw: rng() * TAU, s: 0.7 + rng() * 2.2 }));
          else if (r < 0.128) reg(add('cactus', px, pz, { variant: (rng() * 3) | 0, yaw: rng() * TAU, s: 0.8 + rng() * 0.6 }));
          else if (r < 0.15 && zone === ZONE.WILD) reg(add('tree', px, pz, { variant: (rng() * 4) | 0, yaw: rng() * TAU, s: 0.7 + rng() * 0.5 }));
        } else if (zone === ZONE.CEMETERY) {
          if (r < 0.06) reg(add(rng() < 0.4 ? 'palm' : 'tree', px, pz, { variant: (rng() * 4) | 0, yaw: rng() * TAU }));
        } else if (zone === ZONE.BEACH && cls === CLS.SAND) {
          if (r < 0.02) reg(add('umbrella_beach', px, pz, { variant: (rng() * 4) | 0, yaw: rng() * TAU }));
          else if (r < 0.035) reg(add('palm_small', px, pz, { variant: (rng() * 3) | 0, yaw: rng() * TAU }));
          else if (r < 0.04) reg(add('lifeguard_tower', px, pz, { yaw: Math.PI / 2 }));
        } else if (zone === ZONE.RICH && cls === CLS.GRASS) {
          if (r < 0.14) reg(add(rng() < 0.6 ? 'palm' : 'tree', px, pz, { variant: (rng() * 4) | 0, yaw: rng() * TAU }));
        } else if (zone === ZONE.INDUSTRIAL) {
          if (r < 0.05) reg(add(['crate', 'barrel', 'pallet', 'tyre_stack', 'dumpster'][(rng() * 5) | 0], px, pz, { yaw: rng() * TAU }));
        } else if (zone === ZONE.DOCKS) {
          if (r < 0.3 && (cls === CLS.LAND || cls === CLS.CONCRETE)) {
            const h = 1 + ((rng() * 3) | 0); const yaw = (Math.abs(px) > 0 ? 0 : 0) + ((hash2((px / 30) | 0, (pz / 30) | 0) < 0.5) ? 0 : Math.PI / 2);
            const cx = Math.round(px / 14) * 14, cz = Math.round(pz / 14) * 14;
            if (propSpacingOk(cx, cz, 10) && this.propClear(cx, cz, 4) && m.roadDistAt(cx, cz) > 6 && m.roadDistAt(cx + Math.sin(yaw) * 6.5, cz + Math.cos(yaw) * 6.5) > 2 && m.roadDistAt(cx - Math.sin(yaw) * 6.5, cz - Math.cos(yaw) * 6.5) > 2 && m.classAt(cx + Math.sin(yaw) * 6.5, cz + Math.cos(yaw) * 6.5) !== CLS.WATER && m.classAt(cx - Math.sin(yaw) * 6.5, cz - Math.cos(yaw) * 6.5) !== CLS.WATER && this.lotFreeProp(cx, cz, 14, yaw)) {
              for (let k = 0; k < h; k++) reg(add('container', cx, cz, { variant: (rng() * 6) | 0, yaw, y: this.terrain.groundY(cx, cz) + 2.6 * k, solid: k === 0 ? { hw: 1.25, hd: 6, h: 2.6 * h } : null }));
            }
          }
        } else if (zone === ZONE.STADIUM || zone === ZONE.AIRPORT) { /* nothing */ }
        else if (zone === ZONE.DOWNTOWN || zone === ZONE.COMMERCIAL) {
          if (r < 0.022) reg(add('planter', px, pz, { variant: (rng() * 2) | 0, yaw: rng() * TAU }));
          else if (r < 0.034) reg(add('bench', px, pz, { yaw: Math.round(rng() * 4) * Math.PI / 2 }));
          else if (r < 0.044) reg(add('bike_rack', px, pz, { yaw: Math.round(rng() * 4) * Math.PI / 2 }));
          else if (r < 0.056) reg(add(rng() < 0.6 ? 'palm' : 'tree', px, pz, { variant: (rng() * 4) | 0, yaw: rng() * TAU, s: 0.85 + rng() * 0.35 }));
          else if (r < 0.06 && zone === ZONE.COMMERCIAL) reg(add('foodcart', px, pz, { variant: (rng() * 2) | 0, yaw: rng() * TAU }));
        }
        else if (YARD_ZONES.has(zone) && cls !== CLS.SAND) {
          if (r < 0.028) reg(add(rng() < 0.45 ? 'palm' : 'tree', px, pz, { variant: (rng() * 4) | 0, yaw: rng() * TAU, s: 0.8 + rng() * 0.5 }));
          else if (r < 0.06) reg(add('bush', px, pz, { variant: (rng() * 3) | 0, yaw: rng() * TAU }));
          else if (r < 0.065 && zone === ZONE.RES_LOW) reg(add(rng() < 0.5 ? 'sofa' : 'grill', px, pz, { yaw: rng() * TAU }));
        }
      }
    }
    // ---- yard props next to houses (near front)
    for (const b of this.buildings) {
      if (!HOUSES.has(b.type) || b.zone === ZONE.RICH && rng() < 0.3) continue;
      const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), sx = Math.cos(b.yaw), sz = -Math.sin(b.yaw);
      if (rng() < 0.6) { // tree/bush in front yard corner
        const side = rng() < 0.5 ? -1 : 1;
        const x = b.x + fx * (b.d / 2 + 2.5) + sx * side * (b.w / 2 - 0.5), z = b.z + fz * (b.d / 2 + 2.5) + sz * side * (b.w / 2 - 0.5);
        if (this.propClear(x, z, 1) && m.roadDistAt(x, z) > 4.5 && m.classAt(x, z) !== CLS.WATER) reg(add(rng() < 0.4 ? 'palm' : 'bush', x, z, { variant: (rng() * 3) | 0, yaw: rng() * TAU }));
      }
      if (rng() < 0.5) {
        const x = b.x + fx * (b.d / 2 + 4) + sx * (b.w / 2 + 1), z = b.z + fz * (b.d / 2 + 4) + sz * (b.w / 2 + 1);
        if (this.propClear(x, z, 0.8) && m.roadDistAt(x, z) > 4.5) reg(add('trashcan', x, z, { yaw: rng() * TAU }));
      }
    }
    // ---- landmarks: sign / billboards
    if (!this.landmarks.vinewood_sign) this._placeVinewoodSign(add);
    this.placeExtras(add, propSpacingOk, reg);
    // ---- build static colliders for solid props
    const SOLID = { palm: 0.4, tree: 0.45, lamp: 0.25, trafficlight: 0.25, hydrant: 0.3, busstop: 0, tombstone: 0, bench: 0, mailbox: 0.3, billboard: 0.6, cactus: 0.4, palm_small: 0.3, vending: 0.5, phonebooth: 0.5, newspaper: 0.3, parkingmeter: 0.15, trashcan: 0.35, rock: 0.9, lifeguard_tower: 1.2 };
    for (const p of this.props) {
      const def = PROP_DEFS && PROP_DEFS[p.kind];
      let r = def && def.solid ? (def.radius || 0.4) : (SOLID[p.kind] || 0);
      if (p.solid) { this.colliders.push({ x: p.x, z: p.z, hw: p.solid.hw, hd: p.solid.hd, yaw: p.yaw, h: p.solid.h, kind: 'prop', prop: p }); continue; }
      if (p.kind === 'container' || p.kind === 'dumpster' || p.kind === 'crate' || p.kind === 'pallet' || p.roof || p.kind === 'wire') continue;
      if (MULTI.has(p.kind) && def && def.colliders) {
        const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw), sc = p.s || 1;
        for (const c of def.colliders) this.colliders.push({ x: p.x + (c.x * cs + c.z * sn) * sc, z: p.z + (-c.x * sn + c.z * cs) * sc, r: c.r * sc, h: def.height * sc, kind: 'propc', prop: p });
        continue;
      }
      if (r > 0) { p.r = r * (p.s || 1); this.colliders.push({ x: p.x, z: p.z, r: p.r, h: (def && def.height || 3) * (p.s || 1), kind: 'propc', prop: p }); }
    }
  }


  // ------------------------------------------------------------------ density extras (fences, poles + wires, billboards, signs ...)
  placeExtras(add, propSpacingOk, reg) {
    const m = this.map, rng = this.rng, tmp = {};
    const has = (k) => !this.propDefs || this.propDefs[k];
    const T = this.terrain;
    const fenceHash = new SpatialHash(4);
    // --- line of wall/fence/hedge segments from (x0,z0) to (x1,z1)
    const line = (kind, variants, x0, z0, x1, z1, o = {}) => {
      if (!has(kind)) return 0;
      const Ln = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(Ln / 4); if (n < 1) return 0;
      const dx = (x1 - x0) / Ln, dz = (z1 - z0) / Ln, yaw = Math.atan2(-dz, dx), sc = (Ln / n) / 4;
      let made = 0;
      for (let i = 0; i < n; i++) {
        if (o.gap && i >= o.gap[0] && i < o.gap[1]) continue;
        const a = (i + 0.5) * (Ln / n), cx = x0 + dx * a, cz = z0 + dz * a;
        const ya = T.groundY(cx - dx * 2, cz - dz * 2), yb = T.groundY(cx + dx * 2, cz + dz * 2);
        if (Math.abs(ya - yb) > 0.7 || (ya + yb) / 2 < 0.8) continue;
        if (m.roadDistAt(cx, cz) < 3.7 || m.classAt(cx, cz) === CLS.WATER) continue;
        if (!this.propClear(cx, cz, 0.35) || !this.propClear(cx + dx * 1.9, cz + dz * 1.9, 0.2) || !this.propClear(cx - dx * 1.9, cz - dz * 1.9, 0.2)) continue;
        const near = fenceHash.queryRadius(cx, cz, 2.2); let dup = false; for (const q of near) if ((q.x - cx) ** 2 + (q.z - cz) ** 2 < 4.4) { dup = true; break; }
        if (dup) continue;
        const pr = this.addProp(kind, cx, cz, { variant: variants[(rng() * variants.length) | 0], yaw, s: sc });
        pr.y = Math.min(ya, yb) - 0.05;
        fenceHash.insertPoint({ x: cx, z: cz }, cx, cz); made++;
      }
      return made;
    };
    // --- residential lot boundaries
    for (const b of this.buildings.slice()) {
      if (!HOUSES.has(b.type) || b.landmark) continue;
      const zn = b.zone;
      if (zn !== ZONE.RES_LOW && zn !== ZONE.RES_MID && zn !== ZONE.RICH) continue;
      const cs = Math.cos(b.yaw), sn = Math.sin(b.yaw);       // local x -> (cs,-sn), local z (front) -> (sn,cs)
      const P = (lx, lz) => [b.x + lx * cs + lz * sn, b.z - lx * sn + lz * cs];
      const r = hash2((b.x * 7) | 0, (b.z * 13) | 0);
      let kind, vars;
      if (zn === ZONE.RICH) { kind = r < 0.7 ? 'wall_segment' : 'hedge_segment'; vars = kind === 'wall_segment' ? [0, 1, 2] : [0, 1]; }
      else if (r < 0.42) { kind = 'fence_segment'; vars = [0, 1]; } else if (r < 0.66) { kind = 'hedge_segment'; vars = [0, 1]; } else continue;
      const hwL = b.hw + (zn === ZONE.RICH ? 4 : 1.8), back = -(b.hd + (zn === ZONE.RICH ? 4 : 2.6)), frontZ = b.hd + (b.setback ? Math.max(0.5, b.setback - 1.1) : 2.0);
      const side = hash2((b.x * 3) | 0, (b.z * 5) | 0) < 0.5 ? -1 : 1;
      const a = P(-hwL, back), bb = P(hwL, back), c = P(side * hwL, back), d = P(side * hwL, zn === ZONE.RICH ? frontZ : b.hd);
      line(kind, vars, a[0], a[1], bb[0], bb[1]);
      line(kind, vars, c[0], c[1], d[0], d[1]);
      if (zn === ZONE.RICH && b.front !== undefined) { // front wall with a gate gap in the middle
        const f0 = P(-hwL, frontZ), f1 = P(hwL, frontZ), nseg = Math.floor(Math.hypot(f1[0] - f0[0], f1[1] - f0[1]) / 4);
        line(kind, vars, f0[0], f0[1], f1[0], f1[1], { gap: [Math.floor(nseg / 2) - 1, Math.floor(nseg / 2) + 1] });
        const o = P(-side * hwL, frontZ), o2 = P(-side * hwL, b.hd); line(kind, vars, o[0], o[1], o2[0], o2[1]);
      }
    }
    // --- utility poles + drooping wires along residential / industrial streets
    if (has('utility_pole')) {
      for (const e of m.edges) {
        if (e.cls !== CLS.STREET) continue;
        const na = m.nodes[e.a], nb = m.nodes[e.b];
        const ta = (na.deg >= 3 ? na.maxW / 2 + 9 : 6), tb = (nb.deg >= 3 ? nb.maxW / 2 + 9 : 6);
        edgePointAt(e, e.len / 2, tmp);
        const zn = m.zoneAt(tmp.x, tmp.z);
        if (zn !== ZONE.RES_LOW && zn !== ZONE.RES_MID && zn !== ZONE.INDUSTRIAL && zn !== ZONE.BEACH) continue;
        if (e.len < 70) continue;
        const side = hash2(e.id * 3 + 1, 7) < 0.5 ? 1 : -1, spacing = 38 + hash2(e.id, 3) * 10;
        const poles = [];
        for (let s = ta; s < e.len - tb; s += spacing) {
          edgePointAt(e, s, tmp);
          const nx = tmp.tz * side, nz = -tmp.tx * side;           // side normal
          const x = tmp.x + nx * (e.w / 2 + 3.9), z = tmp.z + nz * (e.w / 2 + 3.9);
          if (!this.propClear(x, z, 1.2) || m.roadDistAt(x, z) < 4.2 || m.classAt(x, z) === CLS.WATER) { poles.push(null); continue; }
          const y = T.groundY(x, z); if (y < 0.8) { poles.push(null); continue; }
          const yaw = Math.atan2(nx, nz);                          // crossarm (local z) perpendicular to the wire run
          const pr = this.addProp('utility_pole', x, z, { yaw }); pr.y = y; poles.push({ x, z, y, nx, nz });
        }
        for (let i = 0; i + 1 < poles.length; i++) {
          const A = poles[i], Bp = poles[i + 1]; if (!A || !Bp) continue;
          if (Math.hypot(A.x - Bp.x, A.z - Bp.z) > 60) continue;
          const gb = new GeoBuilder();
          for (const off of [-1.0, 0, 1.0]) {
            const p0 = [A.x + A.nx * off, A.y + 9.78, A.z + A.nz * off], p1 = [Bp.x + Bp.nx * off, Bp.y + 9.78, Bp.z + Bp.nz * off];
            const N = 5; let prev = p0;
            for (let k = 1; k <= N; k++) {
              const t = k / N, sag = Math.sin(t * Math.PI) * 0.9;
              const q = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t - sag, p0[2] + (p1[2] - p0[2]) * t];
              const nxw = A.nx, nzw = A.nz;
              gb.quad2([prev[0], prev[1], prev[2]], [q[0], q[1], q[2]], [q[0], q[1] + 0.06, q[2]], [prev[0], prev[1] + 0.06, prev[2]], 0x141414);
              prev = q;
            }
          }
          const g = gb.build(); g.userData.temp = true;
          const wp = this.addProp('wire', (A.x + Bp.x) / 2, (A.z + Bp.z) / 2, {}); wp.geo = g; wp.noFar = true; wp.y = 0;
          wp.cx = (A.x + Bp.x) / 2; wp.cz = (A.z + Bp.z) / 2; wp.x = wp.cx; wp.z = wp.cz;
        }
      }
    }
    // --- container stacks behind each quay crane
    if (has('container') && this.setpieces) for (const c of this.setpieces.cranes) {
      const inland = c.yaw > 0 ? -1 : 1;
      for (let ix = 0; ix < 4; ix++) for (let jz = -1; jz <= 1; jz++) {
        const x = c.x + inland * (13 + ix * 3.0), z = c.z + jz * 13.4 + (rng() - 0.5) * 0.6;
        if (rng() < 0.12 || !this.propClear(x, z, 1.5) || m.roadDistAt(x, z) < 4 || !this.lotFreeProp(x, z, 14) || (m.classAt(x, z) !== CLS.CONCRETE && m.classAt(x, z) !== CLS.LAND)) continue;
        const h = 1 + ((rng() * 3) | 0), y0 = T.groundY(x, z);
        for (let k = 0; k < h; k++) { const pr = this.addProp('container', x, z, { variant: (rng() * 6) | 0, yaw: 0, y: y0 + 2.6 * k, solid: k === 0 ? { hw: 1.25, hd: 6, h: 2.6 * h } : null }); }
      }
    }
    // --- cemetery: neat rows of headstones
    if (has('tombstone')) {
      const cr = this._regionStats(ZONE.CEMETERY);
      if (cr) for (let z = cr.z - cr.d / 2 - 8; z < cr.z + cr.d / 2 + 8; z += 5.2) for (let x = cr.x - cr.w / 2 - 8; x < cr.x + cr.w / 2 + 8; x += 3.4) {
        const jx = x + (rng() - 0.5) * 0.6, jz = z + (rng() - 0.5) * 0.8;
        if (m.zoneAt(jx, jz) !== ZONE.CEMETERY || m.classAt(jx, jz) !== CLS.GRASS || m.roadDistAt(jx, jz) < 4 || rng() < 0.12) continue;
        if (((x - cr.x) / 3.4 | 0) % 6 === 0) continue;                       // aisles
        if (!this.propClear(jx, jz, 1.2) || T.groundY(jx, jz) < 0.8) continue;
        const pr = this.addProp('tombstone', jx, jz, { variant: (rng() * 4) | 0, yaw: Math.PI + (rng() - 0.5) * 0.1 }); pr.y = T.groundY(jx, jz);
      }
    }
    // --- street-name signs at junction corners
    if (has('streetsign')) for (const n of m.nodes) {
      if (n.deg < 3 || n.maxW < 9) continue;
      const arms = n.edges.map(eid => { const e = m.edges[eid]; const atA = e.a === n.id; const pt = edgePointAt(e, atA ? Math.min(6, e.len * 0.4) : Math.max(e.len - 6, e.len * 0.6), {}); return Math.atan2(atA ? pt.tz : -pt.tz, atA ? pt.tx : -pt.tx); }).sort((p, q) => p - q);
      let placed = 0;
      for (let i = 0; i < arms.length && placed < 2; i++) {
        const a0 = arms[i], a1 = i + 1 < arms.length ? arms[i + 1] : arms[0] + TAU; let gap = a1 - a0; if (gap > 2.3 || gap < 0.6) continue;
        const am = a0 + gap / 2, dist = n.maxW / 2 * 1.25 + 2.2;
        const x = n.x + Math.cos(am) * dist, z = n.z + Math.sin(am) * dist;
        if (m.roadDistAt(x, z) < 0.8 || !this.propClear(x, z, 0.8) || !propSpacingOk(x, z, 2.5)) continue;
        reg(add('streetsign', x, z, { variant: (rng() * 2) | 0, yaw: am + Math.PI / 2 })); placed++;
      }
    }
    // --- building-attached dressing: rooftop billboards, sidewalk planters, back-alley dumpsters
    for (const b of this.buildings) {
      if (b.landmark || b.infill && rng() < 0.6) continue;
      const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), sx = Math.cos(b.yaw), sz = -Math.sin(b.yaw);
      const t = b.type;
      if (has('billboard') && (t === 'shop_strip' || t === 'office_low' || t === 'garage_shop' || t === 'parking_garage' || t === 'apartment_low') && (b.zone === ZONE.COMMERCIAL || b.zone === ZONE.DOWNTOWN || b.zone === ZONE.RES_MID) && b.w >= 14 && b.d >= 10 && b.h < 30 && rng() < 0.16) {
        const pr = this.addProp('billboard', b.x, b.z, { variant: (rng() * 4) | 0, yaw: b.yaw + (b.front !== undefined ? 0 : Math.PI * (rng() < 0.5 ? 0 : 1)), s: 0.85 });
        pr.y = b.y + b.h - 0.05; pr.roof = true; pr.solid = null;
      }
      if (has('planter') && (b.zone === ZONE.DOWNTOWN || b.zone === ZONE.COMMERCIAL) && b.front !== undefined && (t === 'skyscraper' || t === 'office_mid' || t === 'office_low' || t === 'bank' || t === 'shop_strip') && rng() < 0.6) {
        for (const sd of [-1, 1]) {
          const x = b.x + fx * (b.hd + 1.0) + sx * sd * Math.min(b.hw - 2, 4.5), z = b.z + fz * (b.hd + 1.0) + sz * sd * Math.min(b.hw - 2, 4.5);
          if (m.roadDistAt(x, z) > 3.6 && this.propClear(x, z, 0.6)) reg(add('planter', x, z, { variant: (rng() * 2) | 0, yaw: b.yaw }));
        }
      }
      if (has('dumpster') && (t === 'shop_strip' || t === 'fast_food' || t === 'liquor_store' || t === 'warehouse_small' || t === 'garage_shop') && rng() < 0.4) {
        const x = b.x - fx * (b.hd + 1.6) + sx * (rng() - 0.5) * b.hw, z = b.z - fz * (b.hd + 1.6) + sz * (rng() - 0.5) * b.hw;
        if (m.roadDistAt(x, z) > 4.5 && this.propClear(x, z, 1.0) && T.groundY(x, z) > 0.8) reg(add('dumpster', x, z, { variant: (rng() * 2) | 0, yaw: b.yaw }));
      }
    }
    // --- freeway billboards
    if (has('billboard')) for (const e of m.edges) {
      if (e.cls !== CLS.FREEWAY) continue;
      for (let s = 120 + rng() * 120; s < e.len - 100; s += 240 + rng() * 160) {
        edgePointAt(e, s, tmp); const side = rng() < 0.5 ? 1 : -1, nx = tmp.tz * side, nz = -tmp.tx * side;
        const off = e.w / 2 + 11, x = tmp.x + nx * off, z = tmp.z + nz * off;
        if (!this.propClear(x, z, 6) || m.roadDistAt(x, z) < 8 || T.groundY(x, z) < 0.8 || m.classAt(x, z) === CLS.WATER) continue;
        const pr = this.addProp('billboard', x, z, { variant: (rng() * 4) | 0, yaw: Math.atan2(-nx, -nz), s: 1.1 }); pr.y = T.groundY(x, z);
      }
    }
  }

  lotFreeProp(x, z, r, yaw = 0) {
    const near = this.occ.queryRadius(x, z, r + 30);
    for (const b of near) if (obbOverlap({ x, z, hw: 2.2, hd: 7, yaw }, { ...b.obb, hw: b.hw + 1.5, hd: b.hd + 1.5 })) return false;
    return true;
  }

  _placeVinewoodSign(add) {
    // the Vinewood sign: highest ground near the Vinewood hills district centre
    const c = this.districtCentre('Vinewood Hills') || this.districtCentre('Mulholland'); if (!c) return;
    let best = null, bh = -1e9;
    for (let a = -120; a <= 120; a += 6) for (let b = -160; b <= 60; b += 6) {
      const x = c.x + a - 100, z = c.z + b - 60; if (this.map.roadDistAt(x, z) < 15) continue;
      const h = this.terrain.groundY(x, z); if (h > bh && this.map.zoneAt(x, z) !== ZONE.NONE) { bh = h; best = { x, z }; }
    }
    if (best) { this.landmarks.vinewood_sign = { id: 'vinewood_sign', x: best.x, z: best.z, y: bh, name: 'Vinewood Sign' }; }
  }

  build(PROP_DEFS) {
    this.placeLandmarks();
    layoutSetpieces(this);
    this.placeFrontage();
    this.placeInfill();
    this.terraceBuildings();
    this.placeProps(PROP_DEFS);
    return this;
  }
}

function yawFromAxis(rw, sp) {
  if (!rw) return 0;
  // front (+Z local) must face the runway axis; building long side along the runway (local X along runway direction)
  // local X world = (cos,-sin) = (dirx,dirz) => yaw = atan2(-dirz, dirx); front = +Z local = (sin,cos). choose sign so front points toward runway centre line
  let yaw = Math.atan2(-rw.dirz, rw.dirx);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const toRx = rw.x - sp.x, toRz = rw.z - sp.z;
  if (fx * toRx + fz * toRz < 0) yaw += Math.PI;
  return yaw;
}
