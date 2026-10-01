// Road-graph navigation: A* routing, lane following helpers, traffic signals.
import { edgePointAt, CLS } from './mapdata.js';
import { clamp, lerp } from './util.js';

export class RoadNav {
  constructor(map, signals) {
    this.map = map;
    this.nodes = map.nodes; this.edges = map.edges;
    this.signals = signals || [];
    this.sigByNode = new Map();
    for (const s of this.signals) this.sigByNode.set(s.node, s);
    this.time = 0;
    this.mainNodes = this.nodes.filter(n => n.deg >= 2);
  }
  update(dt) { this.time += dt; }

  // other end of edge from node
  other(e, nodeId) { return e.a === nodeId ? e.b : e.a; }

  // signal state for an arm axis at a node: 'green'|'yellow'|'red'
  lightState(nodeId, axis) {
    const sig = this.sigByNode.get(nodeId); if (!sig) return 'green';
    const cycle = 30, t = (this.time + nodeId * 7.3) % cycle;
    // axis 0 green 0-12, yellow 12-14, all-red 14-15, axis 1 green 15-27, yellow 27-29, all-red 29-30
    const p = axis === 0 ? t : (t + 15) % cycle;
    if (p < 12) return 'green'; if (p < 14) return 'yellow'; return 'red';
  }

  // A* over nodes; returns list of steps [{edge, dir}] from node a to node b, or null
  route(fromNode, toNode, avoidEdge = -1) {
    if (fromNode === toNode) return [];
    const nodes = this.nodes, edges = this.edges;
    const open = new Map(); const came = new Map(); const g = new Map();
    const h = (n) => Math.hypot(nodes[n].x - nodes[toNode].x, nodes[n].z - nodes[toNode].z);
    g.set(fromNode, 0); open.set(fromNode, h(fromNode));
    let guard = 0;
    while (open.size && guard++ < 6000) {
      let cur = -1, cf = 1e18;
      for (const [n, f] of open) if (f < cf) { cf = f; cur = n; }
      if (cur === toNode) {
        const steps = []; let n = cur;
        while (came.has(n)) { const c = came.get(n); steps.push({ edge: edges[c.edge], dir: c.dir }); n = c.from; }
        return steps.reverse();
      }
      open.delete(cur);
      for (const eid of nodes[cur].edges) {
        const e = edges[eid]; if (eid === avoidEdge && cur === fromNode) continue;
        const dir = e.a === cur ? 1 : -1; const nb = dir > 0 ? e.b : e.a; if (nb === cur) continue;
        const ng = g.get(cur) + e.len * (e.cls === CLS.FREEWAY ? 0.6 : e.cls === CLS.AVENUE ? 0.8 : 1);
        if (ng < (g.get(nb) ?? 1e18)) { g.set(nb, ng); came.set(nb, { from: cur, edge: eid, dir }); open.set(nb, ng + h(nb)); }
      }
    }
    return null;
  }

  nearestNodeTo(x, z, minDeg = 2) { return this.map.nearestNode(x, z, 1e9, minDeg); }

  // position along travel lane: agent {edge, dir, s, lane}
  lanePoint(agent, s, out = {}) {
    const e = agent.edge; const sa = agent.dir > 0 ? s : e.len - s;
    edgePointAt(e, clamp(sa, 0, e.len), out);
    let tx = out.tx * agent.dir, tz = out.tz * agent.dir;
    const off = this.laneOffset(e, agent.lane);
    out.x += -tz * off; out.z += tx * off; out.tx = tx; out.tz = tz;
    return out;
  }
  laneOffset(e, lane = 0) {
    if (e.cls === CLS.FREEWAY) return 3.8 + lane * 3.6;
    if (e.cls === CLS.AVENUE) return 2.3 + lane * 3.5;
    return 2.4;
  }
  laneCount(e) { return e.cls === CLS.FREEWAY ? 3 : e.cls === CLS.AVENUE ? 2 : 1; }

  // choose the following edge at the end of agent's edge. prefers route steps if agent.route present.
  chooseNext(agent, rnd = Math.random) {
    const e = agent.edge; const nodeId = agent.dir > 0 ? e.b : e.a; const node = this.nodes[nodeId];
    if (agent.route && agent.route.length) {
      const st = agent.route[0];
      if (st.edge.a === nodeId || st.edge.b === nodeId) { agent.route.shift(); return { edge: st.edge, dir: st.edge.a === nodeId ? 1 : -1 }; }
      agent.route = null;
    }
    const opts = node.edges.filter(id => id !== e.id).map(id => this.edges[id]);
    if (!opts.length) return { edge: e, dir: -agent.dir, uturn: true };   // dead end: turn around
    // prefer straight-ish
    const tx = agent.dir > 0 ? (e.pts[e.pts.length - 1].x - e.pts[e.pts.length - 2].x) : (e.pts[0].x - e.pts[1].x);
    const tz = agent.dir > 0 ? (e.pts[e.pts.length - 1].z - e.pts[e.pts.length - 2].z) : (e.pts[0].z - e.pts[1].z);
    const tl = Math.hypot(tx, tz) || 1;
    const scored = opts.map(o => {
      const d = o.a === nodeId ? 1 : -1; const p0 = d > 0 ? o.pts[0] : o.pts[o.pts.length - 1], p1 = d > 0 ? o.pts[1] : o.pts[o.pts.length - 2];
      const ox = p1.x - p0.x, oz = p1.z - p0.z, ol = Math.hypot(ox, oz) || 1;
      const dot = (tx * ox + tz * oz) / (tl * ol);
      return { edge: o, dir: d, w: 0.5 + Math.max(0, dot + 0.5) * 1.2 + (o.cls >= e.cls ? 0.3 : 0) };
    });
    let tot = 0; for (const s of scored) tot += s.w; let r = rnd() * tot;
    for (const s of scored) { r -= s.w; if (r <= 0) return s; }
    return scored[scored.length - 1];
  }

  // Snap a world position to a lane agent on the nearest road edge facing `heading` (yaw) direction.
  agentAt(x, z, yaw, maxR = 60) {
    const nr = this.map.nearestRoad(x, z, maxR); if (!nr) return null;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const dir = (nr.tx * fx + nr.tz * fz) >= 0 ? 1 : -1;
    const e = nr.edge;
    return { edge: e, dir, s: dir > 0 ? nr.s : e.len - nr.s, lane: Math.floor(Math.random() * this.laneCount(e)), route: null, next: null };
  }
}
