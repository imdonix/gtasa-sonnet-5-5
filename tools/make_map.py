#!/usr/bin/env python3
"""
Los Santos Rising - procedural city layout generator.

Writes (deterministically, fixed seed):
    assets/map.png        1024x1024 flat-colour class map (roads, water, terrain classes)
    assets/zones.png      R = zone type, G = district id, B = gang territory id
    assets/height.png     height in metres = ((R*256+G)/256)-20
    assets/districts.json district table (ids match the G channel)
    assets/map_preview.png hill-shaded labelled overview for humans

Only Python 3 + Pillow are used (no numpy).  Run:  python3 tools/make_map.py     (about 20-25 s)

Pipeline:  coastline + land mask  ->  natural hills  ->  road design (freeways, avenues/streets on a warped grid, coast road,
diagonal boulevard, hill switchbacks, stadium ring, airport)  ->  planarise into a graph, prune dead ends, fix junction spacing
->  grade-limited road profiles + terrain shaped around them (height.png)  ->  warped power-diagram districts, zones, gangs
(zones.png, districts.json)  ->  supersampled constant-width road rasterisation (map.png)  ->  validation report + preview.
"""
import json, math, os, random, sys, time
from collections import defaultdict, deque
from itertools import accumulate
from operator import sub
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageMath

T0 = time.time()
N = 1024
ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
SEED = 20240611
RNG = random.Random(SEED)

def log(*a):
    print('[%5.1fs]' % (time.time() - T0), *a, flush=True)

# --------------------------------------------------------------------------- colours (SPEC)
WATER = (24, 70, 130); SAND = (226, 208, 158); GRASS = (84, 138, 66); SCRUB = (150, 132, 88)
LAND = (150, 150, 146); CONCRETE = (196, 196, 190)
R_STREET = (255, 255, 255); R_AVENUE = (255, 240, 120); R_FREEWAY = (255, 150, 50); RUNWAY = (60, 60, 70)
ROAD_COL = {'S': R_STREET, 'A': R_AVENUE, 'F': R_FREEWAY}
ROAD_W = {'S': 5, 'A': 8, 'F': 12}
RANK = {'S': 0, 'A': 1, 'F': 2}

# zone ids
Z_NONE, Z_RES_LOW, Z_RES_MID, Z_COMM, Z_DOWN, Z_IND, Z_BEACH, Z_RICH, Z_PARK, Z_AIR, Z_DOCKS, Z_STAD, Z_WILD, Z_CEM = range(14)

# --------------------------------------------------------------------------- small math helpers
def sstep(t):
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    return t * t * (3 - 2 * t)

def _h(ix, iy, seed):
    n = (ix * 374761393 + iy * 668265263 + seed * 1442695041) & 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
    n ^= n >> 16
    return (n & 0xffff) / 32767.5 - 1.0

def vnoise(x, y, seed=0):
    ix = math.floor(x); iy = math.floor(y)
    fx = x - ix; fy = y - iy
    sx = fx * fx * (3 - 2 * fx); sy = fy * fy * (3 - 2 * fy)
    a = _h(ix, iy, seed); b = _h(ix + 1, iy, seed); c = _h(ix, iy + 1, seed); d = _h(ix + 1, iy + 1, seed)
    top = a + (b - a) * sx; bot = c + (d - c) * sx
    return top + (bot - top) * sy

def fbm(x, y, seed=0, octaves=3):
    tot = 0.0; amp = 1.0; norm = 0.0
    for o in range(octaves):
        tot += amp * vnoise(x, y, seed + 17 * o); norm += amp
        x *= 2.0; y *= 2.0; amp *= 0.5
    return tot / norm

def catmull(pts, step=8.0):
    """Catmull-Rom spline through pts, resampled roughly every `step` px."""
    P = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        L = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
        n = max(1, int(L / step))
        for k in range(n):
            t = k / n; t2 = t * t; t3 = t2 * t
            out.append(tuple(0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2
                                    + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3) for c in (0, 1)))
    out.append(tuple(pts[-1]))
    return out

def resample(pts, step):
    """Resample a polyline to (roughly) uniform spacing."""
    out = [pts[0]]; acc = 0.0
    for a, b in zip(pts, pts[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L == 0: continue
        d = step - acc
        while d <= L:
            t = d / L
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)); d += step
        acc = L - (d - step)
    if math.hypot(out[-1][0] - pts[-1][0], out[-1][1] - pts[-1][1]) > step * 0.3: out.append(pts[-1])
    else: out[-1] = pts[-1]
    return out

def dist_pt_seg(px, py, ax, ay, bx, by):
    dx = bx - ax; dy = by - ay
    L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t

def poly_len(pts):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))

def draw_thick(draw, pts, fill, width, caps=True):
    """Constant-width polyline with round joints (no anti-aliasing)."""
    pts = [(float(x), float(y)) for x, y in pts]
    if len(pts) < 2: return
    draw.line(pts, fill=fill, width=width)
    if caps:
        r = width / 2.0
        for x, y in pts[1:-1]:
            draw.ellipse([x - r + 0.5, y - r + 0.5, x + r - 0.5, y + r - 0.5], fill=fill)

# --------------------------------------------------------------------------- image helpers (F-mode blur in pure python)
def f_to_rows(img):
    data = list(img.getdata()); w, h = img.size
    return [data[i * w:(i + 1) * w] for i in range(h)]

def rows_to_f(rows):
    im = Image.new('F', (len(rows[0]), len(rows))); im.putdata([v for r in rows for v in r]); return im

def _box_rows(rows, r):
    n = 2 * r + 1; inv = 1.0 / n; out = []
    for row in rows:
        p = [row[0]] * r + list(row) + [row[-1]] * r
        a = [0.0] + list(accumulate(p))
        out.append([v * inv for v in map(sub, a[n:], a[:-n])])
    return out

def blur_f(img, r, passes=2):
    rows = f_to_rows(img)
    for _ in range(passes):
        rows = _box_rows(rows, r)
        rows = [list(c) for c in zip(*rows)]
        rows = _box_rows(rows, r)
        rows = [list(c) for c in zip(*rows)]
    return rows_to_f(rows)

def shift_img(img, dx, dy):
    out = Image.new(img.mode, img.size, 0)
    out.paste(img, (dx, dy))
    return out

def dilate_step(m, k):
    if k % 2 == 0:
        return m.filter(ImageFilter.MaxFilter(3))
    r = m
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        r = ImageChops.lighter(r, shift_img(m, dx, dy))
    return r

def dist_from(mask, maxd):
    """Approximate (octagonal) distance in px to the nearest 255 pixel of `mask`, capped at maxd. 'L' image."""
    cur = mask.point(lambda v: 255 if v else 0)
    acc = Image.new('L', mask.size, 0)
    for k in range(maxd):
        acc = ImageChops.add(acc, cur.point(lambda v: 0 if v else 1))
        cur = dilate_step(cur, k)
    return acc


# =========================================================================== 1. COASTLINE / LAND
COAST_CTRL = [(58, -30), (60, 0), (110, 150), (150, 260), (120, 330), (135, 420), (170, 520), (215, 600), (270, 660),
              (320, 720), (430, 792), (510, 855), (565, 915), (612, 962), (670, 992), (760, 996), (1060, 996)]
coast_nominal = catmull(COAST_CTRL, 6.0)

def wobble(pts):
    out = []
    s = 0.0
    for i, p in enumerate(pts):
        if i: s += math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1])
        a = pts[max(0, i - 2)]; b = pts[min(len(pts) - 1, i + 2)]
        tx, ty = b[0] - a[0], b[1] - a[1]; L = math.hypot(tx, ty) or 1
        nx, ny = ty / L, -tx / L                       # land-side normal (land is to the east / north)
        d = 7.0 * vnoise(s / 75.0, 0.3, 101) + 3.5 * vnoise(s / 30.0, 7.7, 102)
        # keep the border & the airport coast calm
        if p[1] < 20 or p[1] > 985: d *= 0.2
        out.append((p[0] + nx * d, p[1] + ny * d))
    return out

coast = wobble(coast_nominal)
land_mask = Image.new('L', (N, N), 0)
_d = ImageDraw.Draw(land_mask)
_d.polygon(coast + [(1100, 996), (1100, -100), (58, -100)], fill=255)
# harbour inlet + small notch (docks), carved out of the land
INLET = [(925, 940, 955, 1030)]
for r_ in INLET: _d.rectangle(r_, fill=0)
# Santa Maria pier (sticks out into the sea)
PIER = [(283, 678), (236, 694)]          # from shore towards the sea (WSW)
land_nopier = land_mask.copy()

def draw_pier(draw, val=255):
    (x0, y0), (x1, y1) = PIER
    draw.line([(x0 + 6, y0 - 2), (x1, y1)], fill=val, width=6)
    draw.line([(x1, y1 - 8), (x1 - 2, y1 + 9)], fill=val, width=6)   # T head
def draw_dock_piers(draw, val=255):
    draw.rectangle([958, 975, 972, 1012], fill=val)
draw_pier(_d); draw_dock_piers(_d)

water_mask = land_mask.point(lambda v: 0 if v else 255)
log('coast done; computing distance fields')
dl_img = dist_from(water_mask, 90)      # land pixels: distance to water (0 in water)
dw_img = dist_from(land_mask, 70)       # water pixels: distance to land
dl = dl_img.load(); dwt = dw_img.load(); landpx = land_mask.load()

# =========================================================================== 2. NATURAL HILLS (low-res python function)
def range_y0(x):
    if x < 330: return 232 + 58 * sstep((330 - x) / 110.0)
    if x > 640: return 232 - 17 * sstep((x - 640) / 110.0)
    return 232.0

def range_height(x, y):
    """North hill range + border rises (metres above basin)."""
    y0 = range_y0(x)
    u = max(0.0, (y0 - y) / 190.0)
    h = 78.0 * (u ** 1.25) if u <= 1.0 else 78.0 + 14.0 * (u - 1.0)
    fw = 0.30 + 0.70 * sstep((x - 190) / 300.0)           # west (Richman) hills are lower
    h *= fw
    if h > 0:
        h *= 0.9 + 0.2 * (0.5 + 0.5 * fbm(x / 130.0, y / 130.0, 3, 2))
        h += 7.0 * fbm(x / 52.0, y / 64.0, 5, 2) * sstep(u * 5.0) * (0.4 + 0.6 * fw)      # gullies and spurs
    # local bumps (Vinewood sign crest, ridge variety)
    for bx, by, bs, ba in ((430, 152, 34, 12), (600, 150, 50, 8), (330, 175, 40, 5), (250, 150, 40, 4)):
        d2 = ((x - bx) ** 2 + (y - by) ** 2) / (2.0 * bs * bs)
        if d2 < 9: h += ba * math.exp(-d2)
    # eastern border wall / north border wall: take the taller, plus a little of the other
    wall = 95.0 * sstep((x - 975) / 52.0)
    hn = 55.0 * sstep((55 - y) / 55.0)
    base = h + hn
    tot = max(base, wall) + 0.25 * min(base, wall)
    return tot if tot < 105 else 105 + (tot - 105) * 0.35

def bump_height(x, y):
    """Low rolling hills inside the city (Las Colinas, Verdant Bluffs)."""
    h = 0.0
    for bx, by, bs, ba in ((850, 385, 58, 22), (330, 600, 46, 16), (845, 330, 40, 8), (250, 330, 40, 6)):
        d2 = ((x - bx) ** 2 + (y - by) ** 2) / (2.0 * bs * bs)
        if d2 < 9: h += ba * math.exp(-d2)
    return h

def basin_height(x, y):
    return 2.3 - 0.9 * (y / 1024.0) + 0.25 * fbm(x / 160.0, y / 160.0, 9, 2)

LR = 4
def build_lowres(fn):
    n = N // LR + 2
    im = Image.new('F', (n, n))
    im.putdata([fn(min(N - 1, i * LR), min(N - 1, j * LR)) for j in range(n) for i in range(n)])
    big = im.resize((n * LR, n * LR), Image.BICUBIC)
    return big.crop((0, 0, N, N))

log('building natural terrain')
range_F = build_lowres(range_height)
bump_F = build_lowres(bump_height)
basin_F = build_lowres(basin_height)
range_px = range_F.load()

# =========================================================================== 3. ROAD NETWORK DESIGN
class Line:
    __slots__ = ('cls', 'pts', 'keep', 'tag')
    def __init__(self, cls, pts, keep=False, tag=''):
        self.cls = cls; self.pts = [(float(x), float(y)) for x, y in pts]; self.keep = keep; self.tag = tag

LINES = []
def add_line(cls, pts, keep=False, tag=''):
    LINES.append(Line(cls, pts, keep, tag)); return LINES[-1]

# ---- coast road ("Santa Monica"-like avenue along the beach): nominal coast offset inland
def offset_polyline(pts, d):
    out = []
    for i, p in enumerate(pts):
        a = pts[max(0, i - 3)]; b = pts[min(len(pts) - 1, i + 3)]
        tx, ty = b[0] - a[0], b[1] - a[1]; L = math.hypot(tx, ty) or 1
        out.append((p[0] + ty / L * d, p[1] - tx / L * d))
    return out

def smooth_poly(pts, k=3, iters=2):
    for _ in range(iters):
        out = []
        for i in range(len(pts)):
            lo = max(0, i - k); hi = min(len(pts), i + k + 1)
            xs = pts[lo:hi]
            out.append((sum(p[0] for p in xs) / len(xs), sum(p[1] for p in xs) / len(xs)))
        out[0] = pts[0]; out[-1] = pts[-1]
        pts = out
    return pts

_cn = resample(coast_nominal, 10.0)
_cr = smooth_poly(offset_polyline(_cn, 36.0), 4, 3)
COAST_ROAD = [p for p in _cr if 252 <= p[1] <= 884 and 0 < p[0] < N]
COAST_ROAD = resample(COAST_ROAD, 9.0)
add_line('A', COAST_ROAD, tag='coast')

def coast_road_at_y(y):
    return min(COAST_ROAD, key=lambda p: abs(p[1] - y))

# ---- freeways
fw1_start = coast_road_at_y(382)
FW_CTRL = [(fw1_start[0] - 14, 384), (250, 376), (350, 373), (450, 365), (560, 353), (650, 346), (700, 344), (731, 357),
           (744, 392), (744, 450), (742, 560), (745, 680), (744, 746)]
FW = resample(catmull(FW_CTRL, 8.0), 9.0)
add_line('F', FW, tag='freeway')
# airport access avenue (continues the freeway south), terminal road
ACCESS = [(744, 740), (744, 812), (744, 850)]
add_line('A', ACCESS, tag='airport')
add_line('S', [(690, 850), (744, 850), (796, 850)], keep=True, tag='terminal')

# ---- river (concrete channel)
RIVER_CTRL = [(592, 232), (630, 252), (660, 280), (672, 320), (672, 380), (672, 560), (672, 620), (676, 640), (692, 655), (720, 664),
              (746, 672), (780, 690), (805, 712), (820, 738), (828, 765), (836, 795), (848, 830), (862, 868), (870, 910),
              (872, 950), (872, 990)]
RIVER = resample(catmull(RIVER_CTRL, 8.0), 8.0)
RIVER_W = 14

def rasterize_lines(pts_list, width):
    m = Image.new('L', (N, N), 0); d = ImageDraw.Draw(m)
    for pts in pts_list:
        draw_thick(d, pts, 255, width)
    return m

river_mask = rasterize_lines([RIVER], 2 * 21)            # no street within 21 px of the centre line
fw_mask_img = rasterize_lines([FW[:-1]], 2 * 30)         # keep-out around freeways for streets
river_mk = river_mask.load(); fw_mk = fw_mask_img.load()

# ---- exclusion rectangles (no generic grid inside)
AIRPORT_RECT = (575, 832, 838, 976)
STADIUM_LOT = (850, 577, 960, 677)
CEMETERY_RECT = (690, 254, 790, 286)
DOCKS_RECT = (880, 830, 980, 992)
GOLF_CENTER = (205, 228)
def in_rect(x, y, r, m=0):
    return r[0] - m <= x <= r[2] + m and r[1] - m <= y <= r[3] + m
def excluded(x, y):
    return (in_rect(x, y, AIRPORT_RECT, 6) or in_rect(x, y, STADIUM_LOT) or in_rect(x, y, CEMETERY_RECT, 4))

# ---- the grid
XS = [(225, 'S'), (290, 'A'), (345, 'S'), (400, 'A'), (455, 'S'), (510, 'A'), (565, 'S'), (620, 'A'), (708, 'S'),
      (795, 'S'), (845, 'A'), (905, 'S'), (965, 'A')]
YS = [(240, 'S'), (295, 'A'), (350, 'S'), (410, 'A'), (460, 'S'), (515, 'A'), (570, 'S'), (625, 'A'), (680, 'S'),
      (740, 'A'), (795, 'S'), (850, 'A'), (905, 'S')]
FW1_CROSS = {290, 400, 510, 620}          # avenue columns allowed to cross freeway 1
FW2_CROSS = {410, 515, 625, 740}          # avenue rows allowed to cross freeway 2
RIVER_CROSS_ROWS = {295, 515, 625, 740}   # avenue rows that get a bridge over the river

def warp(x, y):
    dx = 7.0 * vnoise(x / 240.0, y / 240.0, 11); dy = 7.0 * vnoise(x / 240.0 + 9, y / 240.0, 12)
    m = sstep((max(abs(x - 520) * 0.9, abs(y - 480) * 1.3) - 140) / 90.0)       # downtown stays rigid
    return x + dx * m, y + dy * m

def thr_water(x, y):
    return 26 if in_rect(x, y, DOCKS_RECT) else 64

def coast_road_dist(x, y):
    return min(dist_pt_seg(x, y, a[0], a[1], b[0], b[1])[0] for a, b in zip(COAST_ROAD, COAST_ROAD[1:]) if abs(a[1] - y) < 40 and abs(a[0] - x) < 60) \
        if any(abs(a[1] - y) < 40 and abs(a[0] - x) < 60 for a in COAST_ROAD) else 1e9

def node_ok(x, y):
    if not (8 < x < N - 8 and 8 < y < N - 8): return False
    if coast_road_dist(x, y) < 27: return False
    xi, yi = int(x), int(y)
    if not landpx[xi, yi]: return False
    if dl[xi, yi] < thr_water(x, y): return False
    if range_px[xi, yi] > 5.0: return False
    if excluded(x, y): return False
    if river_mk[xi, yi] or fw_mk[xi, yi]: return False
    return True

def edge_ok(a, b, cls, orient, coord):
    """Test the straight segment a-b.  Crossing the river/freeway is only allowed for specific avenues."""
    L = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(2, int(L / 4))
    hit_river = hit_fw = False
    for k in range(n + 1):
        t = k / n; x = a[0] + (b[0] - a[0]) * t; y = a[1] + (b[1] - a[1]) * t
        xi, yi = int(x), int(y)
        if not (0 <= xi < N and 0 <= yi < N) or not landpx[xi, yi]: return False
        if dl[xi, yi] < thr_water(x, y) * 0.8: return False
        if range_px[xi, yi] > 6.0: return False
        if excluded(x, y): return False
        if river_mk[xi, yi]: hit_river = True
        if fw_mk[xi, yi]: hit_fw = True
    if hit_river:
        if not (cls == 'A' and orient == 'h' and coord in RIVER_CROSS_ROWS): return False
    if hit_fw:
        if not (cls == 'A' and ((orient == 'v' and coord in FW1_CROSS) or (orient == 'h' and coord in FW2_CROSS))): return False
    return True

GRID_NODES = {}
for i, (x, _) in enumerate(XS):
    for j, (y, _) in enumerate(YS):
        wx, wy = warp(x, y)
        GRID_NODES[(i, j)] = (round(wx), round(wy))
VALID = {k: node_ok(*v) for k, v in GRID_NODES.items()}

def build_grid_edges():
    edges = []
    for j, (y, cy) in enumerate(YS):                      # rows
        for i in range(len(XS)):
            if not VALID[(i, j)]: continue
            for k in range(i + 1, min(len(XS), i + 5)):
                if VALID[(k, j)]:
                    if (k == i + 1 or cy == 'A') and edge_ok(GRID_NODES[(i, j)], GRID_NODES[(k, j)], cy, 'h', y):
                        edges.append(((i, j), (k, j), cy, 'h', y))
                    break
                if cy != 'A': break
    for i, (x, cx) in enumerate(XS):                      # columns
        for j in range(len(YS)):
            if not VALID[(i, j)]: continue
            for k in range(j + 1, min(len(YS), j + 5)):
                if VALID[(i, k)]:
                    if (k == j + 1 or cx == 'A') and edge_ok(GRID_NODES[(i, j)], GRID_NODES[(i, k)], cx, 'v', x):
                        edges.append(((i, j), (i, k), cx, 'v', x))
                    break
                if cx != 'A': break
    return edges
GRID_EDGES = build_grid_edges()
log('grid: %d valid nodes, %d edges' % (sum(VALID.values()), len(GRID_EDGES)))

# stubs from grid ends towards the coast road (T junctions), extended a bit past it (overshoot is pruned later)
def ray_hit_polyline(p, d, poly, maxd):
    best = None
    for a, b in zip(poly, poly[1:]):
        rx, ry = d; sx, sy = b[0] - a[0], b[1] - a[1]
        den = rx * sy - ry * sx
        if abs(den) < 1e-9: continue
        qx, qy = a[0] - p[0], a[1] - p[1]
        t = (qx * sy - qy * sx) / den; u = (qx * ry - qy * rx) / den
        if 4 < t <= maxd and 0 <= u <= 1 and (best is None or t < best): best = t
    return best

STUB_CANDS = []
GRID_NB = defaultdict(set)
for (a, b, cls, orient, coord) in GRID_EDGES:
    GRID_NB[a].add(b); GRID_NB[b].add(a)
for (i, j), ok in VALID.items():
    if not ok: continue
    for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ni, nj = i + di, j + dj
        if not (0 <= ni < len(XS) and 0 <= nj < len(YS)):
            if di == -1 and i == 0:                     # westmost column: let the row run out to the coast road
                p = GRID_NODES[(i, j)]; t = ray_hit_polyline(p, (-1.0, 0.0), COAST_ROAD, 110)
                if t is not None:
                    cls = YS[j][1]
                    STUB_CANDS.append((-RANK[cls], t, cls, p, (p[0] - t, p[1]), (p[0] - t - 7, p[1])))
            continue
        if (ni, nj) in GRID_NB[(i, j)] or VALID[(ni, nj)]: continue
        p = GRID_NODES[(i, j)]; q = GRID_NODES[(ni, nj)]
        qx, qy = int(q[0]), int(q[1])
        if 0 <= qx < N and 0 <= qy < N and landpx[qx, qy] and dl[qx, qy] >= thr_water(*q): continue   # not a coast problem
        L = math.hypot(q[0] - p[0], q[1] - p[1]); d = ((q[0] - p[0]) / L, (q[1] - p[1]) / L)
        t = ray_hit_polyline(p, d, COAST_ROAD, 110)
        if t is None: continue
        cls = YS[j][1] if dj == 0 else XS[i][1]
        STUB_CANDS.append((-RANK[cls], t, cls, p, (p[0] + d[0] * t, p[1] + d[1] * t), (p[0] + d[0] * (t + 7), p[1] + d[1] * (t + 7))))
STUB_CANDS.sort()
STUB_HITS = []
for _r, t, cls, p, hit, end in STUB_CANDS:
    if any(math.hypot(hit[0] - h[0], hit[1] - h[1]) < 34 for h in STUB_HITS): continue
    STUB_HITS.append(hit); add_line(cls, [p, end], tag='stub')

def grid_pt(x, y):
    return GRID_NODES[([k for k, (xx, _) in enumerate(XS) if xx == x][0], [k for k, (yy, _) in enumerate(YS) if yy == y][0])]

def curved(p, q, amp, n=7):
    L = math.hypot(q[0] - p[0], q[1] - p[1]); nx, ny = -(q[1] - p[1]) / L, (q[0] - p[0]) / L
    out = []
    for k in range(n + 1):
        t = k / n; o = amp * math.sin(math.pi * t)
        out.append((p[0] + (q[0] - p[0]) * t + nx * o, p[1] + (q[1] - p[1]) * t + ny * o))
    return out

CURVE_RNG = random.Random(SEED + 5)
for (a, b, cls, orient, coord) in GRID_EDGES:
    p, q = GRID_NODES[a], GRID_NODES[b]
    in_dt = 395 < (p[0] + q[0]) / 2 < 650 and 380 < (p[1] + q[1]) / 2 < 590
    if cls == 'S' and not in_dt and math.hypot(q[0] - p[0], q[1] - p[1]) < 80 and CURVE_RNG.random() < 0.22 \
            and not (abs(p[0] - 905) < 5 and 560 < p[1] < 690):
        amp = CURVE_RNG.choice((-1, 1)) * CURVE_RNG.uniform(4, 8)
        add_line(cls, curved(p, q, amp), tag='grid')
    else:
        add_line(cls, [p, q], tag='grid')

# ---- docks: two short quay roads
add_line('S', [grid_pt(905, 905), (905, 948)], keep=True, tag='dock')
add_line('A', [grid_pt(965, 905), (965, 962)], keep=True, tag='dock')

# ---- stadium ring road (oval) + four connectors to the surrounding streets
ST_C = (905, 625); ST_A = 38; ST_B = 34
ring = [(ST_C[0] + ST_A * math.cos(2 * math.pi * k / 56), ST_C[1] + ST_B * math.sin(2 * math.pi * k / 56)) for k in range(57)]
add_line('S', ring, tag='ring')
for gx, gy in ((845, 625), (965, 625), (905, 570), (905, 680)):
    n_ = grid_pt(gx, gy)
    th = math.atan2((n_[1] - ST_C[1]) / ST_B, (n_[0] - ST_C[0]) / ST_A)
    add_line('S', [n_, (ST_C[0] + (ST_A - 1) * math.cos(th), ST_C[1] + (ST_B - 1) * math.sin(th))], tag='ring_conn')

# =========================================================================== 4. PLANARISE + CLEAN THE GRAPH
class Graph:
    def __init__(self):
        self.nodes = []                 # [(x,y)]
        self.edges = {}                 # id -> dict(a,b,pts,cls,keep,tag)
        self.adj = defaultdict(set)     # node -> set(edge ids)
        self._hash = defaultdict(list)
        self._eid = 0
    def node(self, x, y, tol=2.6):
        cx, cy = int(x // 6), int(y // 6)
        for ix in (cx - 1, cx, cx + 1):
            for iy in (cy - 1, cy, cy + 1):
                for nid in self._hash[(ix, iy)]:
                    nx, ny = self.nodes[nid]
                    if (nx - x) ** 2 + (ny - y) ** 2 <= tol * tol: return nid
        self.nodes.append((x, y)); nid = len(self.nodes) - 1
        self._hash[(cx, cy)].append(nid); return nid
    def add_edge(self, a, b, pts, cls, keep, tag):
        if a == b: return None
        e = self._eid; self._eid += 1
        pts = [self.nodes[a]] + list(pts[1:-1]) + [self.nodes[b]]
        self.edges[e] = dict(a=a, b=b, pts=pts, cls=cls, keep=keep, tag=tag)
        self.adj[a].add(e); self.adj[b].add(e); return e
    def remove_edge(self, e):
        ed = self.edges.pop(e)
        self.adj[ed['a']].discard(e); self.adj[ed['b']].discard(e)
    def deg(self, n): return len(self.adj[n])
    def other(self, e, n):
        ed = self.edges[e]; return ed['b'] if ed['a'] == n else ed['a']
    def length(self, e): return poly_len(self.edges[e]['pts'])

def seg_inter(p, q, r, s, tol=1.6):
    rx, ry = q[0] - p[0], q[1] - p[1]; sx, sy = s[0] - r[0], s[1] - r[1]
    lp = math.hypot(rx, ry); lr = math.hypot(sx, sy)
    if lp < 1e-9 or lr < 1e-9: return None
    den = rx * sy - ry * sx
    if abs(den) < 0.03 * lp * lr: return None            # (nearly) parallel: ignore
    qx, qy = r[0] - p[0], r[1] - p[1]
    t = (qx * sy - qy * sx) / den; u = (qx * ry - qy * rx) / den
    if -tol / lp <= t <= 1 + tol / lp and -tol / lr <= u <= 1 + tol / lr:
        t = min(1.0, max(0.0, t)); u = min(1.0, max(0.0, u))
        return t, u, p[0] + rx * t, p[1] + ry * t
    return None

def planarise(lines):
    segs = []                                 # (line, k, p, q)
    cell = defaultdict(list)
    for li, ln in enumerate(lines):
        for k in range(len(ln.pts) - 1):
            p, q = ln.pts[k], ln.pts[k + 1]
            sid = len(segs); segs.append((li, k, p, q))
            for cx in range(int((min(p[0], q[0]) - 2) // 40), int((max(p[0], q[0]) + 2) // 40) + 1):
                for cy in range(int((min(p[1], q[1]) - 2) // 40), int((max(p[1], q[1]) + 2) // 40) + 1):
                    cell[(cx, cy)].append(sid)
    splits = defaultdict(list)               # (li,k) -> [(t,x,y)]
    seen = set()
    for ids in cell.values():
        for ai in range(len(ids)):
            for bi in range(ai + 1, len(ids)):
                a, b = ids[ai], ids[bi]
                if (a, b) in seen: continue
                seen.add((a, b))
                la, ka, pa, qa = segs[a]; lb, kb, pb, qb = segs[b]
                if la == lb: continue
                r = seg_inter(pa, qa, pb, qb)
                if r:
                    t, u, x, y = r
                    splits[(la, ka)].append((t, x, y)); splits[(lb, kb)].append((u, x, y))
    G = Graph()
    for li, ln in enumerate(lines):
        items = []                           # (pos, x, y, is_node)
        n = len(ln.pts)
        for k in range(n):
            items.append((float(k), ln.pts[k][0], ln.pts[k][1], k == 0 or k == n - 1))
            if k < n - 1:
                for (t, x, y) in splits.get((li, k), ()):
                    items.append((k + t, x, y, True))
        items.sort(key=lambda it: (it[0], not it[3]))
        # merge items that coincide spatially with their predecessor
        merged = []
        for it in items:
            if merged and math.hypot(it[1] - merged[-1][1], it[2] - merged[-1][2]) < 1.8:
                prev = merged[-1]
                if it[3] and not prev[3]: merged[-1] = it
                elif it[3] and prev[3]: pass
                continue
            merged.append(it)
        cur = None; mid = []
        for it in merged:
            if it[3]:
                nid = G.node(it[1], it[2])
                if cur is not None:
                    G.add_edge(cur, nid, [G.nodes[cur]] + mid + [G.nodes[nid]], ln.cls, ln.keep, ln.tag)
                cur = nid; mid = []
            else:
                mid.append((it[1], it[2]))
    return G

def prune_deadends(G, verbose=True):
    removed = 0; changed = True
    while changed:
        changed = False
        for n in range(len(G.nodes)):
            if G.deg(n) == 1:
                e = next(iter(G.adj[n]))
                if not G.edges[e]['keep']:
                    G.remove_edge(e); removed += 1; changed = True
    if verbose: log('pruned %d dead-end edges' % removed)

def components(G):
    parent = list(range(len(G.nodes)))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for ed in G.edges.values():
        ra, rb = find(ed['a']), find(ed['b'])
        if ra != rb: parent[ra] = rb
    comp = defaultdict(list)
    for n in range(len(G.nodes)):
        if G.adj[n]: comp[find(n)].append(n)
    return sorted(comp.values(), key=len, reverse=True)

def keep_largest(G):
    comps = components(G)
    if len(comps) > 1:
        log('components (nodes):', [len(c) for c in comps][:12])
        main = set(comps[0])
        for e in list(G.edges):
            if G.edges[e]['a'] not in main: G.remove_edge(e)
    return comps

def junction_nodes(G, mind=3):
    return [n for n in range(len(G.nodes)) if G.deg(n) >= mind]

def fix_close_junctions(G, mind=20.0, rounds=6):
    for _ in range(rounds):
        J = junction_nodes(G); pairs = []
        for ai in range(len(J)):
            for bi in range(ai + 1, len(J)):
                a, b = J[ai], J[bi]
                if math.hypot(G.nodes[a][0] - G.nodes[b][0], G.nodes[a][1] - G.nodes[b][1]) < mind: pairs.append((a, b))
        if not pairs: return []
        for a, b in pairs:
            cands = []
            for n in (a, b):
                for e in list(G.adj[n]):
                    ed = G.edges[e]
                    if ed['cls'] != 'S' or ed['keep'] or ed['tag'] in ('ring', 'ring_conn', 'terminal'): continue
                    o = G.other(e, n)
                    if o in (a, b): continue
                    if G.deg(n) - 1 >= 2 and G.deg(o) - 1 >= 2: cands.append((G.length(e), e))
            if cands:
                cands.sort(); G.remove_edge(cands[0][1])
        prune_deadends(G, False)
    J = junction_nodes(G); left = []
    for ai in range(len(J)):
        for bi in range(ai + 1, len(J)):
            a, b = J[ai], J[bi]
            if math.hypot(G.nodes[a][0] - G.nodes[b][0], G.nodes[a][1] - G.nodes[b][1]) < mind: left.append((a, b))
    return left


# ---- diagonal boulevard (Vinewood-Boulevard-like) through Rodeo: choose the offset that keeps crossings clean
def find_diagonal(P, Q, shifts):
    dx, dy = Q[0] - P[0], Q[1] - P[1]; L = math.hypot(dx, dy); nx, ny = -dy / L, dx / L
    best = None
    for s_ in shifts:
        A = (P[0] + nx * s_, P[1] + ny * s_); B = (Q[0] + nx * s_, Q[1] + ny * s_)
        cr = []
        for (a, b, cls, orient, coord) in GRID_EDGES:
            pa, pb = GRID_NODES[a], GRID_NODES[b]
            r = seg_inter(A, B, pa, pb, 0.0)
            if r:
                t, u, x, y = r; le = math.hypot(pb[0] - pa[0], pb[1] - pa[1])
                cr.append((t, min(u * le, (1 - u) * le), x, y))
        if len(cr) < 4: continue
        cr.sort()
        sc = min(c[1] for c in cr)
        sc = min([sc] + [math.hypot(c2[2] - c1[2], c2[3] - c1[3]) for c1, c2 in zip(cr, cr[1:])])
        if best is None or sc > best[0]: best = (sc, A, B, cr)
    return best

def add_diagonal(P, Q, name, min_clear=21.0):
    best = None
    for dp in range(-16, 17, 4):                      # vary the end points a bit as well
        for dq in range(-16, 17, 4):
            P2 = (P[0] + dp, P[1] - dp * 0.3); Q2 = (Q[0] + dq * 0.6, Q[1] + dq * 0.4)
            r = find_diagonal(P2, Q2, range(-14, 15, 2))
            if r and (best is None or r[0] > best[0]): best = r
    if not best or best[0] < min_clear:
        log('diagonal %s rejected (clearance %s)' % (name, best[0] if best else None)); return
    sc, A, B, cr = best
    d_ = (B[0] - A[0], B[1] - A[1]); L_ = math.hypot(*d_); d_ = (d_[0] / L_, d_[1] / L_)
    s0 = cr[0]; s1 = cr[-1]
    add_line('A', [(s0[2] - d_[0] * 5, s0[3] - d_[1] * 5), (s1[2] + d_[0] * 5, s1[3] + d_[1] * 5)], tag='diag')
    log('diagonal boulevard %s: min clearance %.1f px, %d crossings' % (name, sc, len(cr)))

add_diagonal((240, 580), (452, 414), 'Vinewood Blvd', 19.0)

# ---- hill roads (hand-placed switchbacks; the terrain is later shaped around them, grades are enforced on the profile)
def hill_road(pts, keep=False, name=''):
    add_line('S', resample(catmull(pts, 6.0), 8.0), keep=keep, tag='hill')
def _g(x, y): return grid_pt(x, y)
A_END = (437, 84); B_END = (572, 92)
# A: Vinewood sign road (two long legs with hairpins)
hill_road([_g(455, 240), (455, 229), (464, 219), (510, 198), (550, 181), (566, 169), (564, 153), (549, 142), (500, 122),
           (455, 104), (440, 94), A_END])
# B: Vinewood Hills road
hill_road([_g(565, 240), (564, 226), (572, 208), (625, 193), (680, 184), (722, 176), (739, 162), (734, 146), (716, 135),
           (670, 122), (625, 110), (590, 101), B_END])
# C: Richman road
hill_road([_g(290, 240), (289, 228), (280, 216), (238, 204), (198, 190), (176, 176), (172, 160), (186, 147), (230, 139),
           (268, 132), (296, 122), (306, 110), (296, 98), (262, 92)], keep=True)
# D: Richman connector
hill_road([_g(345, 240), (347, 222), (342, 204), (326, 188), (318, 170), (322, 150), (312, 136), (296, 122)])
# E: Mulholland Drive (ridge road) linking A - C and A - B
hill_road([A_END, (410, 84), (370, 88), (335, 92), (296, 98)])
hill_road([A_END, (480, 78), (530, 78), (558, 84), B_END])

# villa driveways: short cul-de-sacs uphill from the hill roads
def add_spurs(rng, count=10):
    base = [ln for ln in LINES if ln.tag == 'hill']
    tries = 0; made = 0
    while made < count and tries < 400:
        tries += 1
        ln = rng.choice(base); k = rng.randrange(3, len(ln.pts) - 3)
        p = ln.pts[k]; a = ln.pts[k - 2]; b = ln.pts[k + 2]
        tx, ty = b[0] - a[0], b[1] - a[1]; L = math.hypot(tx, ty) or 1
        nx, ny = -ty / L, tx / L
        if ny > 0: nx, ny = -nx, -ny                   # point uphill (north)
        ln_len = rng.uniform(30, 44)
        pts = [p, (p[0] + nx * ln_len * 0.5 + ny * rng.uniform(-4, 4), p[1] + ny * ln_len * 0.5), (p[0] + nx * ln_len, p[1] + ny * ln_len)]
        ok = True
        for t in (0.35, 0.7, 1.0):
            x = p[0] + nx * ln_len * t; y = p[1] + ny * ln_len * t
            if y < 52 or not landpx[int(x), int(y)] or dl[int(x), int(y)] < 50: ok = False; break
            d, _ = nearest_road(x, y, ignore=LINES.index(ln))
            d_own = min((math.hypot(x - q[0], y - q[1]) for m_, q in enumerate(ln.pts) if abs(m_ - k) > 7), default=1e9)
            if t > 0.3 and min(d, d_own) < 32: ok = False; break
            if t > 0.3:                              # keep away from own road elsewhere & other spurs
                for l2 in LINES:
                    if l2.tag in ('spur',) and min(math.hypot(x - q[0], y - q[1]) for q in l2.pts) < 34: ok = False
        if not ok: continue
        if any(math.hypot(p[0] - q[0], p[1] - q[1]) < 26 for l2 in LINES if l2.tag == 'spur' for q in l2.pts[:1]): continue
        add_line('S', resample(catmull(pts, 4.0), 6.0), keep=True, tag='spur'); rebuild_roadsegs(); made += 1
    log('villa spurs: %d' % made)

ROADSEGS = []
def rebuild_roadsegs():
    ROADSEGS.clear()
    for li, ln in enumerate(LINES):
        if ln.tag in ('stub',): continue
        for a, b in zip(ln.pts, ln.pts[1:]): ROADSEGS.append((a, b, li))
rebuild_roadsegs()
def nearest_road(x, y, ignore=None):
    best = (1e9, None)
    for a, b, li in ROADSEGS:
        if li == ignore: continue
        if x < min(a[0], b[0]) - best[0] or x > max(a[0], b[0]) + best[0] or y < min(a[1], b[1]) - best[0] or y > max(a[1], b[1]) + best[0]: continue
        d, t = dist_pt_seg(x, y, a[0], a[1], b[0], b[1])
        if d < best[0]: best = (d, (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return best
add_spurs(random.Random(SEED + 77), 10)

# =========================================================================== PLANARISE + CLEAN
log('planarising %d lines' % len(LINES))
G = planarise(LINES)
log('graph: %d nodes %d edges' % (len(G.nodes), len(G.edges)))
prune_deadends(G)
keep_largest(G)


# ---- street-level irregularity: omit some street edges, cul-de-sacs, Grove Street
def edge_mid(e):
    pts = G.edges[e]['pts']; return pts[len(pts) // 2]
def in_downtown(x, y): return 390 < x < 655 and 375 < y < 595

MOD_RNG = random.Random(SEED + 9)
cand = [e for e, ed in G.edges.items() if ed['tag'] == 'grid' and ed['cls'] == 'S' and not ed['keep']
        and not in_downtown(*edge_mid(e)) and edge_mid(e)[1] > 300]
MOD_RNG.shuffle(cand)
omitted = 0
for e in cand:
    if omitted >= 13: break
    ed = G.edges[e]
    if G.deg(ed['a']) >= 4 and G.deg(ed['b']) >= 4 and poly_len(ed['pts']) < 80:
        mx, my = edge_mid(e)
        if in_rect(mx, my, STADIUM_LOT, 40): continue
        G.remove_edge(e); omitted += 1
cul = 0
cand = [e for e in list(G.edges) if G.edges[e]['tag'] == 'grid' and G.edges[e]['cls'] == 'S' and not G.edges[e]['keep']
        and not in_downtown(*edge_mid(e)) and edge_mid(e)[1] > 300 and not in_rect(*edge_mid(e), STADIUM_LOT, 40)]
MOD_RNG.shuffle(cand)
CULDESACS = []
def make_culdesac(e, from_node, frac, tag='culdesac'):
    ed = G.edges[e]
    pts = ed['pts'] if ed['a'] == from_node else ed['pts'][::-1]
    total = poly_len(pts); target = total * frac; acc = 0.0; out = [pts[0]]
    for a_, b_ in zip(pts, pts[1:]):
        L = math.hypot(b_[0] - a_[0], b_[1] - a_[1])
        if acc + L >= target:
            t = (target - acc) / L; out.append((a_[0] + (b_[0] - a_[0]) * t, a_[1] + (b_[1] - a_[1]) * t)); break
        acc += L; out.append(b_)
    G.remove_edge(e)
    end = G.node(*out[-1], tol=0.1)
    G.add_edge(from_node, end, out, 'S', True, tag)
    return out[-1]
for e in cand:
    if cul >= 7: break
    ed = G.edges.get(e)
    if not ed: continue
    if 45 < poly_len(ed['pts']) < 80 and min(G.deg(ed['a']), G.deg(ed['b'])) >= 3 and max(G.deg(ed['a']), G.deg(ed['b'])) >= 4:
        keep_end = ed['a'] if G.deg(ed['b']) >= 4 else ed['b']
        CULDESACS.append(make_culdesac(e, keep_end, 0.6)); cul += 1
# Grove Street (Ganton): the street between rows 570/625 on the x=795 column becomes a cul-de-sac off the row-625 avenue
gn_a = grid_pt(795, 570); gn_b = grid_pt(795, 625)
GROVE = None
for e, ed in list(G.edges.items()):
    ends = {G.nodes[ed['a']], G.nodes[ed['b']]}
    if any(math.hypot(n[0] - gn_b[0], n[1] - gn_b[1]) < 3 for n in ends) and any(math.hypot(n[0] - gn_a[0], n[1] - gn_a[1]) < 3 for n in ends):
        nb = ed['a'] if math.hypot(G.nodes[ed['a']][0] - gn_b[0], G.nodes[ed['a']][1] - gn_b[1]) < 3 else ed['b']
        GROVE = make_culdesac(e, nb, 0.55, 'grove'); break
log('omitted %d streets, %d cul-de-sacs, Grove Street end at %s' % (omitted, cul, tuple(round(v) for v in GROVE) if GROVE else None))
prune_deadends(G, False)
left = fix_close_junctions(G, 20.0)
keep_largest(G)
if left: log('WARNING junction pairs < 20px remaining:', [(tuple(round(v) for v in G.nodes[a]), tuple(round(v) for v in G.nodes[b])) for a, b in left])

# =========================================================================== 5. RASTERISE ROADS (+ validation) - map.png draw routine
SS = 4                                                  # supersampling factor for crisp, regular road geometry
def ss_mask(items):
    """items: [(points, width_px, cap_first, cap_last)] -> NxN 'L' mask (0/255) of constant-width round-jointed polylines.
    Drawn at SSx resolution and reduced with a 50 % threshold so edges are regular (no anti-aliasing in the result)."""
    big = Image.new('L', (N * SS, N * SS), 0); d = ImageDraw.Draw(big)
    for pts, w, cf, cl in items:
        off = 0.5 if w % 2 else 0.0                     # odd widths are centred on a pixel, even widths on a pixel edge
        P = [((x + off) * SS, (y + off) * SS) for x, y in pts]
        r = w * SS / 2.0
        d.line(P, fill=255, width=int(w * SS))
        for k, (x, y) in enumerate(P):
            if (k == 0 and cf) or (k == len(P) - 1 and cl) or 0 < k < len(P) - 1:
                d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    return big.resize((N, N), Image.BOX).point(lambda v: 255 if v >= 128 else 0)

def road_masks():
    items = {c: [] for c in 'SAF'}
    for e, ed in G.edges.items():
        capa = G.deg(ed['a']) == 2; capb = G.deg(ed['b']) == 2
        items[ed['cls']].append((ed['pts'], ROAD_W[ed['cls']], capa, capb))
    return {c: ss_mask(items[c]) for c in 'SAF'}

def draw_roads(img):
    for c, m in road_masks().items():
        img.paste(ROAD_COL[c], mask=m)

# =========================================================================== 6. HEIGHT FIELD
log('height field: natural terrain + coast')
CF = [sstep(i / 50.0) for i in range(256)]            # coast ramp factor (land side)
SEA = [0.8 - 0.5 * d if d <= 2 else -0.2 - 7.8 * (1 - math.exp(-(d - 2) / 16.0)) for d in range(256)]
nat_list = list(ImageMath.eval("a+b+c", a=range_F, b=bump_F, c=basin_F).getdata())
dl_list = list(dl_img.getdata()); dw_list = list(dw_img.getdata())
Tl = [0.8 + (t - 0.8) * CF[d] for t, d in zip(nat_list, dl_list)]
_t = Image.new('F', (N, N)); _t.putdata(Tl); Tl = list(blur_f(_t, 3, 2).getdata())        # smooth distance-transform artefacts

def flat_zone(field_list, rect, target, margin=9, blur_r=5):
    """Blend a rectangle (plus margin) towards a constant height: airport, docks, stadium lot, cemetery terrace."""
    m = Image.new('L', (N, N), 0)
    ImageDraw.Draw(m).rectangle([rect[0] - margin, rect[1] - margin, rect[2] + margin, rect[3] + margin], fill=255)
    w = list(blur_f(m.convert('F'), blur_r, 1).getdata())
    return [t + (target - t) * (v / 255.0) for t, v in zip(field_list, w)]
Tl = flat_zone(Tl, AIRPORT_RECT, 2.0, 8)
Tl = flat_zone(Tl, DOCKS_RECT, 1.6, 6)
Tl = flat_zone(Tl, STADIUM_LOT, 2.2, 6)
Tl = flat_zone(Tl, CEMETERY_RECT, 3.4, 8)

# ---- road profiles: vertices every ~6 px along every road, grade-limited, junctions shared
log('road profiles')
ROAD_HALF = {'S': 2.5, 'A': 4.0, 'F': 6.0}
VX = []; VY = []; NODE_V = {}
def node_vertex(n):
    if n not in NODE_V:
        NODE_V[n] = len(VX); VX.append(G.nodes[n][0]); VY.append(G.nodes[n][1])
    return NODE_V[n]
EDGE_CHAIN = {}; CONS = []
GMAX = {'S': 0.08, 'A': 0.08, 'F': 0.05}
for e, ed in G.edges.items():
    pts = resample(ed['pts'], 4.0)
    chain = []
    for k, p in enumerate(pts):
        if k == 0: v = node_vertex(ed['a'])
        elif k == len(pts) - 1: v = node_vertex(ed['b'])
        else:
            v = len(VX); VX.append(p[0]); VY.append(p[1])
        chain.append(v)
    EDGE_CHAIN[e] = (chain, pts)
    for i, j in zip(chain, chain[1:]):
        L = math.hypot(VX[i] - VX[j], VY[i] - VY[j]) * 2.0
        CONS.append((i, j, GMAX[ed['cls']] * L))
H0 = [Tl[min(N - 1, int(y)) * N + min(N - 1, int(x))] for x, y in zip(VX, VY)]
FLATV = []                      # vertices inside a junction share the node height (flat junction plate)
for e, ed in G.edges.items():
    chain, pts = EDGE_CHAIN[e]
    for n, seq in ((ed['a'], chain), (ed['b'], chain[::-1])):
        if G.deg(n) >= 3:
            rj = max(ROAD_HALF[G.edges[ee]['cls']] for ee in G.adj[n]) + 2.0
            nv = NODE_V[n]
            for v in seq[1:-1]:
                if math.hypot(VX[v] - VX[nv], VY[v] - VY[nv]) < rj: FLATV.append((v, nv))
                else: break
# vertex stiffness: basin/grid roads hold the natural ground, hill roads are free to move (they carry the grade)
VK = [1.0] * len(VX)
for e, ed in G.edges.items():
    chain, pts = EDGE_CHAIN[e]
    base_k = 1.0 if ed['tag'] in ('hill', 'spur') else 12.0
    for v in chain:
        k = base_k * (4.0 if H0[v] < 4.5 else 1.0)
        if k > VK[v]: VK[v] = k
HV = list(H0)
def project(iters):
    for it in range(iters):
        for v, nv in FLATV: HV[v] = HV[nv]
        for (i, j, lim) in (CONS if it % 2 == 0 else CONS[::-1]):
            d = HV[i] - HV[j]
            if abs(d) > lim:
                ex = abs(d) - lim; si = 1 if d > 0 else -1
                wi = VK[j] / (VK[i] + VK[j]); wj = 1.0 - wi
                HV[i] -= si * ex * wi; HV[j] += si * ex * wj
    for v, nv in FLATV: HV[v] = HV[nv]
project(600)
NB = defaultdict(list)                       # vertical-curve smoothing along the road graph, then re-project
for (i, j, lim) in CONS: NB[i].append(j); NB[j].append(i)
for _ in range(6):
    HV = [h + (sum(HV[k] for k in NB[v]) / len(NB[v]) - h) * (0.5 / VK[v] ** 0.5) if NB[v] else h for v, h in enumerate(HV)]
project(300)
# hard guarantee: walk outwards from the stiff (basin) vertices and clamp every vertex to the grade limit of its parent
CONS_OF = defaultdict(list)
for (i, j, lim) in CONS: CONS_OF[i].append((j, lim)); CONS_OF[j].append((i, lim))
seen_v = [False] * len(VX); queue = deque()
for v in sorted(range(len(VX)), key=lambda v: -VK[v]):
    if VK[v] >= 40 and not seen_v[v]: seen_v[v] = True; queue.append(v)
while queue:
    v = queue.popleft()
    for (w, lim) in CONS_OF[v]:
        if not seen_v[w]:
            HV[w] = max(HV[v] - lim, min(HV[v] + lim, HV[w])); seen_v[w] = True; queue.append(w)
project(150)
log('road profile: worst vertex-to-vertex grade %.3f' % max(abs(HV[i] - HV[j]) / (math.hypot(VX[i] - VX[j], VY[i] - VY[j]) * 2.0) for i, j, lim in CONS))
log('road profile: max deviation from natural ground %.1f m' % max(abs(a - b) for a, b in zip(HV, H0)))

# ---- paint road heights (absolute) and deviation-from-natural (delta) along each road
CH = Image.new('F', (N, N), 0.0); CD = Image.new('F', (N, N), 0.0); CM = Image.new('L', (N, N), 0)
dH = ImageDraw.Draw(CH); dD = ImageDraw.Draw(CD); dM = ImageDraw.Draw(CM)
def road_samples(e, step=1.5):
    chain, pts = EDGE_CHAIN[e]
    for (i, j) in zip(chain, chain[1:]):
        x0, y0, x1, y1 = VX[i], VY[i], VX[j], VY[j]
        L = math.hypot(x1 - x0, y1 - y0); n = max(1, int(L / step))
        for k in range(n + 1):
            t = k / n
            yield x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, HV[i] + (HV[j] - HV[i]) * t
ORDER = sorted(G.edges.items(), key=lambda kv: RANK[kv[1]['cls']])
for e, ed in ORDER:                                   # pass 1: wide shoulders (height spreads beside the road)
    r = ROAD_HALF[ed['cls']] + 14.0
    for x, y, h in road_samples(e):
        dH.ellipse([x - r, y - r, x + r, y + r], fill=h)
for e, ed in ORDER:                                   # pass 2: carriageways + delta / mask for the inpainting
    r = ROAD_HALF[ed['cls']] + 1.5
    for x, y, h in road_samples(e):
        nat = Tl[min(N - 1, int(y)) * N + min(N - 1, int(x))]
        bb = [x - r, y - r, x + r, y + r]
        dH.ellipse(bb, fill=h); dD.ellipse(bb, fill=h - nat); dM.ellipse(bb, fill=255)

# ---- terrain follows the roads: inpaint the (road - natural) deviation with a decaying diffusion at 1/4 resolution
log('inpainting terrain around roads')
LRN = 256
frac = ImageMath.eval("a/255.0", a=CM.resize((LRN, LRN), Image.BOX).convert('F'))
dsum = CD.resize((LRN, LRN), Image.BOX)
fr = list(frac.getdata()); ds = list(dsum.getdata())
known = [f > 0.06 for f in fr]
dk = [(d / f if f > 0.06 else 0.0) for d, f in zip(ds, fr)]
cur = list(dk)
rng_lr = list(range_F.resize((LRN, LRN), Image.BOX).getdata())
ALPHA = [0.03 - 0.026 * min(1.0, r_ / 12.0) for r_ in rng_lr]        # in the hills the roads influence the terrain further away
for it in range(110):
    rows = [cur[i * LRN:(i + 1) * LRN] for i in range(LRN)]
    rows = _box_rows(rows, 2); rows = [list(c) for c in zip(*rows)]
    rows = _box_rows(rows, 2); rows = [list(c) for c in zip(*rows)]
    flat = [v for r in rows for v in r]
    cur = [dk[i] if known[i] else flat[i] * (1 - ALPHA[i]) for i in range(LRN * LRN)]
delta_lr = Image.new('F', (LRN, LRN)); delta_lr.putdata(cur)
delta_list = list(delta_lr.resize((N, N), Image.BICUBIC).getdata())
Hl = [t + d for t, d in zip(Tl, delta_list)]
# exact road heights on the carriageway (soft shoulders)
CM2 = Image.new('L', (N, N), 0); dM2 = ImageDraw.Draw(CM2)
for e, ed in G.edges.items():
    w_ = ROAD_HALF[ed['cls']] + 7.0
    for x, y, h in road_samples(e, 2.0):
        dM2.ellipse([x - w_, y - w_, x + w_, y + w_], fill=255)
road_w = list(blur_f(CM2.convert('F'), 5, 1).getdata())
ch_list = list(CH.getdata())
Hl = [h + (c - h) * (w / 255.0) for h, c, w in zip(Hl, ch_list, road_w)]
# river bed dip (not under roads)
rv = Image.new('L', (N, N), 0); draw_thick(ImageDraw.Draw(rv), RIVER, 255, RIVER_W + 2)
rv_w = list(blur_f(rv.convert('F'), 2, 1).getdata())
Hl = [h - 1.0 * (v / 255.0) * (1 - min(1.0, w / 255.0)) for h, v, w in zip(Hl, rv_w, road_w)]
# sea floor + coast + piers
pier_mask = ImageChops.subtract(land_mask, land_nopier)
pier_l = list(pier_mask.getdata()); land_l = list(land_mask.getdata())
Hf = []
for h, lnd, d_w, pm in zip(Hl, land_l, dw_list, pier_l):
    if pm: Hf.append(1.5)
    elif lnd: Hf.append(h if h > 0.8 else 0.8)
    else: Hf.append(SEA[d_w])
H_img = Image.new('F', (N, N)); H_img.putdata(Hf)
H_img = blur_f(H_img, 1, 2)
Hf = list(H_img.getdata())
Hf = [(h if h > 0.8 else 0.8) if l else (h if h < 0.3 else 0.3) for h, l in zip(Hf, land_l)]
H_img = Image.new('F', (N, N)); H_img.putdata(Hf)
log('height range %.1f .. %.1f m' % (min(Hf), max(Hf)))
hpx = H_img.load()

def road_grade_stats(verbose=False):
    worst = defaultdict(float); over = defaultdict(int); tot = defaultdict(int)
    for e, ed in G.edges.items():
        pts = resample(ed['pts'], 4.0)
        hs = [hpx[min(N - 1, int(x)), min(N - 1, int(y))] for x, y in pts]
        for k in range(len(hs) - 1):
            g = abs(hs[k + 1] - hs[k]) / (math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]) * 2.0 + 1e-9)
            worst[ed['cls']] = max(worst[ed['cls']], g); tot[ed['cls']] += 1
            if g > 0.12:
                over[ed['cls']] += 1
                if verbose: print('  steep %s %s %.3f at (%d,%d)' % (ed['cls'], ed['tag'], g, pts[k][0], pts[k][1]))
    return worst, over, tot

def hillshade(H, gain=55.0, base=150):
    dx = [a - b for a, b in zip(H[2:], H[:-2])] + [0.0, 0.0]
    dy = [a - b for a, b in zip(H[2 * N:], H[:-2 * N])] + [0.0] * (2 * N)
    vals = [int(base + gain * math.tanh(0.5 * (x + y))) for x, y in zip(dx, dy)]
    im = Image.new('L', (N, N)); im.putdata(vals)
    return im

# =========================================================================== 7. DISTRICTS (power-diagram cells, warped) + zones
# id, name, cx, cy, zone, gang, radius (cell weight), note
DISTRICTS = [
    (1, 'Richman', 250, 170, Z_RICH, 0, 95, 'hillside estates, golf club to the south-west'),
    (2, 'Mulholland', 470, 75, Z_WILD, 0, 110, 'ridge road, scrub hills, a few villas along the road'),
    (3, 'Vinewood Hills', 610, 140, Z_RICH, 0, 100, 'villas on terraces'),
    (4, 'Vinewood', 470, 290, Z_COMM, 0, 62, 'shops and studios mixed with mid-rise apartments'),
    (5, 'Temple', 610, 295, Z_RES_MID, 0, 55, 'apartments next to the river'),
    (6, 'Rodeo', 290, 420, Z_COMM, 0, 66, 'boutiques, some mansions; diagonal boulevard'),
    (7, 'Market', 390, 490, Z_COMM, 0, 60, 'commercial with warehouse blocks'),
    (8, 'Commerce', 520, 430, Z_DOWN, 0, 52, 'downtown core'),
    (9, 'Pershing Square', 520, 505, Z_DOWN, 0, 48, 'downtown core'),
    (10, 'Downtown Financial', 578, 462, Z_DOWN, 0, 46, 'skyscrapers'),
    (11, 'Conference Center', 520, 580, Z_COMM, 0, 55, 'convention and offices'),
    (12, 'Little Mexico', 610, 585, Z_RES_MID, 0, 50, 'dense apartments'),
    (13, 'Verona Beach', 245, 545, Z_BEACH, 0, 75, 'beach strip, boardwalk'),
    (14, 'Santa Maria Beach', 282, 650, Z_BEACH, 0, 60, 'beach, pier at the shore'),
    (15, 'Verdant Bluffs', 340, 610, Z_RES_MID, 0, 50, 'low bluff above the beaches'),
    (16, 'Jefferson', 780, 465, Z_RES_LOW, 2, 60, 'Violet Kings'),
    (17, 'Glen Park', 700, 530, Z_RES_LOW, 2, 42, 'park strip along the river, Violet Kings'),
    (18, 'Idlewood', 705, 610, Z_RES_LOW, 2, 42, 'Violet Kings'),
    (19, 'Ganton', 795, 610, Z_RES_LOW, 1, 55, 'Emerald Row home turf - Grove Street cul-de-sac'),
    (20, 'El Corona', 690, 735, Z_RES_LOW, 3, 55, 'Los Soles'),
    (21, 'Willowfield', 830, 740, Z_IND, 3, 62, 'industrial + housing, Los Soles'),
    (22, 'Playa del Seville', 930, 715, Z_RES_LOW, 0, 55, ''),
    (23, 'East Beach', 930, 590, Z_RES_MID, 0, 50, ''),
    (24, 'Las Colinas', 870, 340, Z_RICH, 0, 92, 'low rolling hills, villas'),
    (25, 'East Los Santos', 930, 480, Z_RES_LOW, 4, 55, 'Blue Line'),
    (26, 'Los Flores', 860, 520, Z_RES_LOW, 4, 50, 'Blue Line'),
    (27, 'Los Santos Stadium', 905, 625, Z_STAD, 0, 40, 'oval ring road, flat concrete lot'),
    (28, 'Ocean Flats', 600, 770, Z_IND, 0, 70, 'industrial'),
    (29, 'Ocean Docks', 935, 890, Z_DOCKS, 0, 70, 'harbour inlet, container yards'),
    (30, 'Los Santos Airport', 710, 900, Z_AIR, 0, 70, 'LS International: runway y~898, x 590..830'),
    (31, 'Las Brisas', 430, 700, Z_RES_LOW, 0, 55, ''),
    (32, 'East Hills', 880, 110, Z_WILD, 0, 100, 'scrub hills, map border'),
    (33, 'Del Perro', 185, 330, Z_RES_MID, 0, 50, ''),
    (34, 'Forest Lawn Cemetery', 740, 270, Z_CEM, 0, 20, 'cemetery east of Temple'),
    (35, 'Richman Golf Club', 205, 255, Z_PARK, 0, 20, 'golf course in the hills'),
]
DIST_BY_ID = {d[0]: d for d in DISTRICTS}
ID_OF = {d[1]: d[0] for d in DISTRICTS}

def clip_half(poly, a, b, c):
    out = []
    for k in range(len(poly)):
        p = poly[k]; q = poly[(k + 1) % len(poly)]
        fp = a * p[0] + b * p[1] - c; fq = a * q[0] + b * q[1] - c
        if fp <= 0: out.append(p)
        if (fp < 0 < fq) or (fq < 0 < fp):
            t = fp / (fp - fq); out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return out

def dwarp(x, y):
    return x + 14.0 * vnoise(x / 110.0, y / 110.0, 31), y + 14.0 * vnoise(x / 110.0 + 7, y / 110.0, 32)

log('districts')
G_img = Image.new('L', (N, N), 0)
gd = ImageDraw.Draw(G_img)
sites = [(d[2], d[3], d[6] ** 2) for d in DISTRICTS]
for ii, d in enumerate(DISTRICTS):
    if d[0] in (34, 35): continue                       # drawn as overrides below
    xi, yi, wi = sites[ii]
    poly = [(-60, -60), (N + 60, -60), (N + 60, N + 60), (-60, N + 60)]
    for jj, (xj, yj, wj) in enumerate(sites):
        if jj == ii or DISTRICTS[jj][0] in (34, 35): continue
        poly = clip_half(poly, 2 * (xj - xi), 2 * (yj - yi), xj * xj + yj * yj - xi * xi - yi * yi - wj + wi)
    dense = []
    for k in range(len(poly)):
        p = poly[k]; q = poly[(k + 1) % len(poly)]
        L = math.hypot(q[0] - p[0], q[1] - p[1]); n = max(1, int(L / 12))
        for m in range(n): dense.append(dwarp(p[0] + (q[0] - p[0]) * m / n, p[1] + (q[1] - p[1]) * m / n))
    gd.polygon(dense, fill=d[0], outline=d[0])
def fill_rect(draw, rect, val, pad=0):
    draw.rectangle([rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad], fill=val)
fill_rect(gd, (AIRPORT_RECT[0] - 4, AIRPORT_RECT[1] - 2, AIRPORT_RECT[2] + 4, AIRPORT_RECT[3] + 2), ID_OF['Los Santos Airport'])
fill_rect(gd, STADIUM_LOT, ID_OF['Los Santos Stadium'])
fill_rect(gd, DOCKS_RECT, ID_OF['Ocean Docks'])
fill_rect(gd, CEMETERY_RECT, ID_OF['Forest Lawn Cemetery'], 3)
GOLF = (205, 255, 47, 27)       # cx, cy, rx, ry
gd.ellipse([GOLF[0] - GOLF[2], GOLF[1] - GOLF[3], GOLF[0] + GOLF[2], GOLF[1] + GOLF[3]], fill=ID_OF['Richman Golf Club'])
GLEN_POLY = [(684, 452), (738, 452), (738, 598), (684, 598)]
gd.polygon(GLEN_POLY, fill=ID_OF['Glen Park'])
G_img = Image.composite(G_img, Image.new('L', (N, N), 0), land_mask)
g_list = list(G_img.getdata())

DMASK = {}
def dmask(i):
    if i not in DMASK: DMASK[i] = G_img.point(lambda v, i=i: 255 if v == i else 0)
    return DMASK[i]
def union_mask(ids):
    m = Image.new('L', (N, N), 0)
    for i in ids: m = ImageChops.lighter(m, dmask(i))
    return m
def and_mask(a, b): return ImageChops.multiply(a, b)
def zmask(Rimg, zones):
    return Rimg.point([255 if v in zones else 0 for v in range(256)])
def line_buffer(edges_pts, r):
    m = Image.new('L', (N, N), 0); d = ImageDraw.Draw(m)
    for pts in edges_pts: draw_thick(d, pts, 255, int(2 * r))
    return m
def rect_mask(rect, pad=0):
    m = Image.new('L', (N, N), 0); fill_rect(ImageDraw.Draw(m), rect, 255, pad); return m

log('zones')
zone_lut = [0] * 256; gang_lut = [0] * 256
for d in DISTRICTS: zone_lut[d[0]] = d[4]; gang_lut[d[0]] = d[5]
R_img = G_img.point(zone_lut)
range_L = ImageMath.eval("convert(a*10,'L')", a=range_F)
hill_mask = and_mask(range_L.point(lambda v: 255 if v > 120 else 0), land_mask)          # > 12 m of range hills
scrub_mask = and_mask(range_L.point(lambda v: 255 if v > 40 else 0), land_mask)          # > 4 m
# hills are wild; rich villas only on terraces along the hill roads
R_img.paste(Z_WILD, mask=hill_mask)
R_img.paste(Z_WILD, mask=and_mask(union_mask((2,)), land_mask))
hill_edges = [ed['pts'] for ed in G.edges.values() if ed['tag'] in ('hill', 'spur')]
for did, rr in ((1, 40), (2, 24), (3, 32)):
    R_img.paste(Z_RICH, mask=and_mask(line_buffer(hill_edges, rr), dmask(did)))
R_img.paste(Z_WILD, mask=and_mask(union_mask((32,)), land_mask))

# block-level mixing of zones inside districts (cells of the street grid)
def cell_polys():
    for i in range(len(XS) - 1):
        for j in range(len(YS) - 1):
            ks = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            if all(VALID[k] for k in ks): yield (i, j), [GRID_NODES[k] for k in ks]
MIX = {4: [(Z_RES_MID, 0.60)], 6: [(Z_RICH, 0.28)], 7: [(Z_IND, 0.40)], 21: [(Z_RES_LOW, 0.50)], 11: [(Z_DOWN, 0.15)],
       5: [(Z_COMM, 0.2)], 31: [(Z_RES_MID, 0.2)], 15: [(Z_RES_LOW, 0.3)], 23: [(Z_RES_LOW, 0.3)]}
MIX_RNG = random.Random(SEED + 35)
for (i, j), quad in cell_polys():
    cx_ = sum(p[0] for p in quad) / 4; cy_ = sum(p[1] for p in quad) / 4
    did = g_list[int(cy_) * N + int(cx_)]
    if not did: continue
    r_ = MIX_RNG.random(); acc = 0.0
    m = Image.new('L', (N, N), 0); ImageDraw.Draw(m).polygon(quad, fill=255)
    for zone, p in MIX.get(did, ()):
        acc += p
        if r_ < acc:
            R_img.paste(zone, mask=and_mask(m, dmask(did))); break
    else:
        if DIST_BY_ID[did][4] in (Z_RES_LOW, Z_RES_MID) and did not in (19, 17, 18) and MIX_RNG.random() < 0.07 and not in_rect(cx_, cy_, STADIUM_LOT, 30):
            R_img.paste(Z_PARK, mask=and_mask(m, dmask(did)))            # small neighbourhood park
# commercial strips along avenues inside residential districts (not Ganton)
ave_edges = [ed['pts'] for ed in G.edges.values() if ed['cls'] == 'A' and ed['tag'] in ('grid', 'diag')]
strip = and_mask(line_buffer(ave_edges, 14), and_mask(zmask(R_img, (Z_RES_LOW, Z_RES_MID)), land_mask))
R_img.paste(Z_COMM, mask=ImageChops.subtract(strip, dmask(19)))
# industrial belt along the river (south of freeway 1)
belt = and_mask(line_buffer([RIVER], 20), zmask(R_img, (Z_RES_LOW, Z_RES_MID, Z_COMM)))
belt = ImageChops.subtract(belt, union_mask((17, 18)))
belt_box = Image.new('L', (N, N), 0); ImageDraw.Draw(belt_box).rectangle([0, 380, N, N], fill=255)
R_img.paste(Z_IND, mask=and_mask(and_mask(belt, belt_box), ImageChops.invert(dmask(19))))
# beaches (sand band 8..14 px wide, varying along the coast)
sand_w = build_lowres(lambda x, y: 8.0 + 6.0 * (0.5 + 0.5 * vnoise(x / 55.0, y / 55.0, 61)))
sand_L = ImageMath.eval("convert(a+0.5,'L')", a=sand_w)
sand_mask = ImageChops.subtract(sand_L, dl_img).point(lambda v: 255 if v > 0 else 0)
sand_mask = and_mask(and_mask(sand_mask, land_mask), range_L.point(lambda v: 255 if v < 80 else 0))
sand_mask = ImageChops.lighter(sand_mask, ImageChops.subtract(land_mask, land_nopier))
R_img.paste(Z_BEACH, mask=ImageChops.subtract(sand_mask, union_mask((29, 30))))
# special areas
R_img.paste(Z_AIR, mask=and_mask(rect_mask((AIRPORT_RECT[0] - 4, AIRPORT_RECT[1] - 2, AIRPORT_RECT[2] + 4, AIRPORT_RECT[3] + 2)), land_mask))
R_img.paste(Z_STAD, mask=rect_mask(STADIUM_LOT))
R_img.paste(Z_DOCKS, mask=and_mask(rect_mask(DOCKS_RECT), land_mask))
R_img.paste(Z_CEM, mask=rect_mask(CEMETERY_RECT, 3))
golf_m = Image.new('L', (N, N), 0)
ImageDraw.Draw(golf_m).ellipse([GOLF[0] - GOLF[2], GOLF[1] - GOLF[3], GOLF[0] + GOLF[2], GOLF[1] + GOLF[3]], fill=255)
R_img.paste(Z_PARK, mask=golf_m)
glen_m = Image.new('L', (N, N), 0); ImageDraw.Draw(glen_m).polygon(GLEN_POLY, fill=255)
R_img.paste(Z_PARK, mask=and_mask(glen_m, land_mask))
R_img = Image.composite(R_img, Image.new('L', (N, N), 0), land_mask)
# gang territory (none in the wild hills)
B_img = G_img.point(gang_lut)
B_img.paste(0, mask=dmask(19))
ganton_m = Image.new('L', (N, N), 0)
ImageDraw.Draw(ganton_m).ellipse([800 - 70, 610 - 55, 800 + 70, 610 + 55], fill=255)
B_img.paste(1, mask=and_mask(ganton_m, land_mask))
B_img.paste(0, mask=zmask(R_img, (Z_WILD,)))
B_img = Image.composite(B_img, Image.new('L', (N, N), 0), land_mask)

# =========================================================================== 8. GROUND CLASSES (map.png)
log('ground classes + roads')

road_tmp = Image.new('RGB', (N, N), (0, 0, 0)); draw_roads(road_tmp)
road_mask_L = road_tmp.convert('L').point(lambda v: 255 if v > 0 else 0)
road_dist = dist_from(road_mask_L, 22); rd_px = road_dist.load()

# residential blocks that are too small for houses (triangles beside the diagonal, ...) become pocket parks
small_blocks = 0
for (i, j), quad in cell_polys():
    cx_ = sum(p[0] for p in quad) / 4; cy_ = sum(p[1] for p in quad) / 4
    if R_img.getpixel((int(cx_), int(cy_))) not in (Z_RES_LOW, Z_RES_MID): continue
    pts = [(cx_, cy_)] + [(cx_ + (p[0] - cx_) * 0.5, cy_ + (p[1] - cy_) * 0.5) for p in quad]
    if max(rd_px[int(x), int(y)] for x, y in pts) < 14:
        m = Image.new('L', (N, N), 0); ImageDraw.Draw(m).polygon(quad, fill=255)
        R_img.paste(Z_PARK, mask=and_mask(m, land_mask)); small_blocks += 1
log('small residential blocks converted to pocket parks: %d' % small_blocks)

map_img = Image.new('RGB', (N, N), WATER)
map_img.paste(LAND, mask=land_mask)
scrub = ImageChops.lighter(scrub_mask, zmask(R_img, (Z_WILD,)))
map_img.paste(SCRUB, mask=and_mask(scrub, land_mask))
grass = ImageChops.lighter(zmask(R_img, (Z_PARK, Z_CEM)), and_mask(dmask(1), land_mask))
map_img.paste(GRASS, mask=and_mask(grass, land_mask))
AIRPORT_APRON = (620, 836, 832, 888)
conc = Image.new('L', (N, N), 0); cd = ImageDraw.Draw(conc)
fill_rect(cd, STADIUM_LOT, 255); fill_rect(cd, DOCKS_RECT, 255)
map_img.paste(CONCRETE, mask=and_mask(conc, land_mask))
ap_grass = and_mask(rect_mask(AIRPORT_RECT), land_mask)
map_img.paste(GRASS, mask=ap_grass)
map_img.paste(CONCRETE, mask=rect_mask(AIRPORT_APRON))
map_img.paste(SAND, mask=and_mask(sand_mask, ImageChops.invert(rect_mask(DOCKS_RECT))))
dmap = ImageDraw.Draw(map_img)
map_img.paste(CONCRETE, mask=ss_mask([(RIVER, RIVER_W, True, True)]))     # the Los Santos River concrete channel
draw_roads(map_img)
# airport: runway, parallel taxiway, three links
RWY_Y = 898; TWY_Y = 878
map_img.paste(RUNWAY, mask=ss_mask([([(590, RWY_Y), (830, RWY_Y)], 8, False, False)]))
map_img.paste(RUNWAY, mask=ss_mask([([(606, TWY_Y), (822, TWY_Y)], 5, False, False)] + [([(x, TWY_Y), (x, RWY_Y)], 5, False, False) for x in (650, 720, 800)]))


# =========================================================================== 9. VALIDATION
log('validation')
ROAD_RGB = {R_STREET, R_AVENUE, R_FREEWAY}
mdata = list(map_img.getdata())
is_road = bytearray(1 if px in ROAD_RGB else 0 for px in mdata)
n_road_px = sum(is_road)
on_water = sum(1 for k in range(N * N) if is_road[k] and not land_l[k])
# (a) flood fill connectivity (8-neighbour) of all road pixels (runway/taxiway excluded by colour)
seen = bytearray(N * N); comp_sizes = []
for k0 in range(N * N):
    if is_road[k0] and not seen[k0]:
        dq = [k0]; seen[k0] = 1; cnt = 0
        while dq:
            k = dq.pop(); cnt += 1; y, x = divmod(k, N)
            for dy in (-1, 0, 1):
                yy = y + dy
                if yy < 0 or yy >= N: continue
                for dx in (-1, 0, 1):
                    xx = x + dx
                    if 0 <= xx < N:
                        kk = yy * N + xx
                        if is_road[kk] and not seen[kk]: seen[kk] = 1; dq.append(kk)
        comp_sizes.append(cnt)
comp_sizes.sort(reverse=True)
# (b) junctions, lengths
deg_hist = defaultdict(int)
for n in range(len(G.nodes)):
    if G.adj[n]: deg_hist[G.deg(n)] += 1
len_cls = defaultdict(float)
for e, ed in G.edges.items(): len_cls[ed['cls']] += G.length(e)
J = junction_nodes(G)
min_sp = min((math.hypot(G.nodes[a][0] - G.nodes[b][0], G.nodes[a][1] - G.nodes[b][1]) for ai, a in enumerate(J) for b in J[ai + 1:]), default=0)
dead_ends = [n for n in range(len(G.nodes)) if G.deg(n) == 1]
# river crossings (road edges touching the channel)
def seg_cross(a, b, c, d):
    r = seg_inter(a, b, c, d, 0.0); return r is not None
river_cross = []
for e, ed in G.edges.items():
    hit = False
    for a, b in zip(ed['pts'], ed['pts'][1:]):
        for c, d in zip(RIVER, RIVER[1:]):
            if min(a[0], b[0]) - 2 <= max(c[0], d[0]) and max(a[0], b[0]) + 2 >= min(c[0], d[0]) and min(a[1], b[1]) - 2 <= max(c[1], d[1]) \
                    and max(a[1], b[1]) + 2 >= min(c[1], d[1]) and seg_cross(a, b, c, d): hit = True; break
        if hit: break
    if hit: river_cross.append((ed['cls'], tuple(round(v) for v in ed['pts'][len(ed['pts']) // 2])))
def parallel_check(min_d=28.0, fan=26.0):
    """Centre-line pairs closer than min_d that are not simply the arms of the same/neighbouring junction."""
    jn = [G.nodes[n] for n in junction_nodes(G)]
    jcell = defaultdict(list)
    for jx, jy in jn: jcell[(int(jx // 30), int(jy // 30))].append((jx, jy))
    def near_junction(x, y):
        for cx in (int(x // 30) - 1, int(x // 30), int(x // 30) + 1):
            for cy in (int(y // 30) - 1, int(y // 30), int(y // 30) + 1):
                for jx, jy in jcell[(cx, cy)]:
                    if (jx - x) ** 2 + (jy - y) ** 2 < fan * fan: return True
        return False
    samples = []
    for e, ed in G.edges.items():
        for p in resample(ed['pts'], 5.0):
            if not near_junction(*p): samples.append((p[0], p[1], e))
    cell = defaultdict(list)
    for k, (x, y, e) in enumerate(samples): cell[(int(x // 30), int(y // 30))].append(k)
    bad = {}
    for k, (x, y, e) in enumerate(samples):
        for cx in (int(x // 30) - 1, int(x // 30), int(x // 30) + 1):
            for cy in (int(y // 30) - 1, int(y // 30), int(y // 30) + 1):
                for k2 in cell[(cx, cy)]:
                    x2, y2, e2 = samples[k2]
                    if e2 == e: continue
                    if {G.edges[e]['a'], G.edges[e]['b']} & {G.edges[e2]['a'], G.edges[e2]['b']}: continue
                    d_ = math.hypot(x - x2, y - y2)
                    if d_ < min_d:
                        key = (min(e, e2), max(e, e2))
                        if key not in bad or d_ < bad[key][0]: bad[key] = (round(d_, 1), round(x), round(y))
    return bad
par_bad = parallel_check()
fw_bad = [tuple(round(v) for v in G.nodes[n]) for n in range(len(G.nodes)) if any(G.edges[e]['cls'] == 'F' for e in G.adj[n])
          and G.deg(n) >= 3 and any(G.edges[e]['cls'] == 'S' for e in G.adj[n])]
fw_junctions = [tuple(round(v) for v in G.nodes[n]) for n in range(len(G.nodes)) if any(G.edges[e]['cls'] == 'F' for e in G.adj[n]) and G.deg(n) >= 3]
wg, og, tg = road_grade_stats()
log('road pixels: %d, on water: %d' % (n_road_px, on_water))
log('road components (px): %s' % comp_sizes[:6])
log('nodes by degree: %s ; junctions(>=3): %d ; closest junction pair: %.1f px ; dead ends (cul-de-sac/lookout): %d' % (dict(deg_hist), len(J), min_sp, len(dead_ends)))
log('road length (px, 2 m/px): ' + ', '.join('%s %.0f px (%.1f km)' % (c, len_cls[c], len_cls[c] * 2 / 1000) for c in 'SAF'))
log('river crossings: %d %s' % (len(river_cross), river_cross))
log('freeway junctions (avenues only): %s ; streets touching freeways: %s' % (fw_junctions, fw_bad))
log('road pairs closer than 28 px (not sharing a junction): %d %s' % (len(par_bad), sorted(par_bad.values())[:12]))
short = sorted((round(G.length(e)), G.edges[e]['cls'], G.edges[e]['tag']) for e in G.edges)[:6]
log('shortest edges (px, class, tag):', short)
log('road grade: worst %s ; samples over 12%%: %s of %s' % ({k: round(v, 3) for k, v in wg.items()}, dict(og), dict(tg)))
# (c) district coverage
zcount = defaultdict(lambda: defaultdict(int)); dcount = defaultdict(int)
r_l = list(R_img.getdata())
for g_, r_ in zip(g_list, r_l):
    if g_: dcount[g_] += 1; zcount[g_][r_] += 1
ZN = ['none', 'res_low', 'res_mid', 'comm', 'downtown', 'industrial', 'beach', 'rich', 'park', 'airport', 'docks', 'stadium', 'wild', 'cemetery']
log('district coverage (px, top zones):')
for d in DISTRICTS:
    zs = sorted(zcount[d[0]].items(), key=lambda kv: -kv[1])[:3]
    log('   %2d %-22s %6d px  %s' % (d[0], d[1], dcount[d[0]], ', '.join('%s %d%%' % (ZN[z], 100 * c // max(1, dcount[d[0]])) for z, c in zs)))
land_px = sum(1 for v in land_l if v); assigned = sum(dcount.values())
log('land pixels %d, with a district %d (%.2f%%)' % (land_px, assigned, 100.0 * assigned / land_px))

# =========================================================================== 10. OUTPUT
log('writing outputs')
ASSETS.mkdir(exist_ok=True)
map_img.save(ASSETS / 'map.png')
Image.merge('RGB', (R_img, G_img, B_img)).save(ASSETS / 'zones.png')
hb = bytearray()
for h in Hf:
    v = int(round((h + 20.0) * 256.0)); v = 0 if v < 0 else 65535 if v > 65535 else v
    hb += bytes((v >> 8, v & 255, 0, 255))
Image.frombytes('RGBA', (N, N), bytes(hb)).save(ASSETS / 'height.png')
# district centres: centroid of the district's pixels (snapped to the nearest pixel that belongs to it)
sums = defaultdict(lambda: [0, 0, 0])
for k, g_ in enumerate(g_list):
    if g_: s_ = sums[g_]; s_[0] += k % N; s_[1] += k // N; s_[2] += 1
djson = []
for d in DISTRICTS:
    sx, sy, c = sums[d[0]] if d[0] in sums else (d[2], d[3], 1)
    cx, cy = (d[2], d[3]) if d[0] not in sums else (sx / c, sy / c)
    if G_img.getpixel((int(cx), int(cy))) != d[0]:
        best = None
        for k, g_ in enumerate(g_list):
            if g_ == d[0]:
                dd = (k % N - cx) ** 2 + (k // N - cy) ** 2
                if best is None or dd < best[0]: best = (dd, k % N, k // N)
        if best: cx, cy = best[1], best[2]
    djson.append(dict(id=d[0], name=d[1], zone=d[4], gang=d[5], cx=int(round(cx)), cy=int(round(cy)), note=d[7]))
notes = dict(ganton_grove_street=dict(cul_de_sac_end_px=[round(GROVE[0]), round(GROVE[1])] if GROVE else None),
             vinewood_sign_px=[430, 150], santa_maria_pier_px=[283, 678], airport_runway=dict(y=RWY_Y, x0=590, x1=830),
             stadium_ring_centre_px=list(ST_C), cemetery_rect=list(CEMETERY_RECT), golf_course=list(GOLF))
with open(ASSETS / 'districts.json', 'w') as f:
    json.dump({'districts': djson, 'landmarks': notes}, f, indent=1)

# ---- preview
def render_preview():
    shade = hillshade(Hf, 75.0, 150)
    sh3 = Image.merge('RGB', (shade, shade, shade))
    lit = ImageChops.multiply(map_img, sh3)
    pv = ImageChops.add(lit, lit, scale=1.2)
    # zone tint (subtle) + gang territory tint
    ztint = {Z_RES_LOW: (255, 235, 150), Z_RES_MID: (255, 170, 90), Z_COMM: (255, 90, 90), Z_DOWN: (190, 90, 220),
             Z_IND: (120, 130, 150), Z_RICH: (60, 210, 210), Z_BEACH: (255, 250, 200), Z_PARK: (60, 200, 60)}
    for z, col in ztint.items():
        pv.paste(col, mask=R_img.point([30 if v == z else 0 for v in range(256)]))
    gcol = {1: (40, 220, 70), 2: (170, 70, 235), 3: (245, 215, 40), 4: (60, 120, 255)}
    for gid, col in gcol.items():
        pv.paste(col, mask=B_img.point([80 if v == gid else 0 for v in range(256)]))
    deep = Image.new('L', (N, N)); deep.putdata([int(max(0, min(90, -h * 10))) if not l else 0 for h, l in zip(Hf, land_l)])
    pv.paste((6, 26, 66), mask=deep)
    pv.paste(map_img, mask=ImageChops.lighter(ImageChops.lighter(road_masks()['S'], road_masks()['A']), road_masks()['F']).point(lambda v: 150 if v else 0))
    d = ImageDraw.Draw(pv)
    try: font = ImageFont.load_default(11)
    except TypeError: font = ImageFont.load_default()
    def label(x, y, text, fill=(255, 255, 255)):
        try: d.text((x, y), text, fill=fill, font=font, stroke_width=2, stroke_fill=(20, 20, 30))
        except Exception: d.text((x, y), text, fill=fill, font=font)
    for dj in djson:
        if dj['name'] in ('Los Santos Airport',): name = 'LS International'
        else: name = dj['name']
        try: tw = d.textlength(name, font=font)
        except Exception: tw = len(name) * 6
        label(dj['cx'] - tw / 2, dj['cy'] - 6, name)
    for text, (lx, ly) in (('VINEWOOD SIGN', (430, 150)), ('Grove St', (GROVE[0], GROVE[1]) if GROVE else (795, 600)),
                           ('Pier', (255, 695)), ('LS River', (673, 440))):
        d.ellipse([lx - 3, ly - 3, lx + 3, ly + 3], outline=(255, 40, 40), fill=(255, 255, 0))
        label(lx + 6, ly - 6, text, (255, 255, 160))
    # legend
    lx, ly = 18, 958
    d.rectangle([lx - 8, ly - 8, lx + 330, ly + 58], fill=(10, 20, 40))
    items = [('res low', ztint[Z_RES_LOW]), ('res mid', ztint[Z_RES_MID]), ('commercial', ztint[Z_COMM]), ('downtown', ztint[Z_DOWN]),
             ('industrial', ztint[Z_IND]), ('rich', ztint[Z_RICH]), ('beach', ztint[Z_BEACH]), ('park', ztint[Z_PARK])]
    for k, (t, c) in enumerate(items):
        x = lx + (k % 4) * 82; y = ly + (k // 4) * 14
        d.rectangle([x, y + 1, x + 9, y + 10], fill=c); d.text((x + 13, y), t, fill=(230, 230, 230), font=font)
    for k, (t, c) in enumerate((('Emerald Row', gcol[1]), ('Violet Kings', gcol[2]), ('Los Soles', gcol[3]), ('Blue Line', gcol[4]))):
        x = lx + k * 82; y = ly + 32
        d.rectangle([x, y + 1, x + 9, y + 10], fill=c); d.text((x + 13, y), t, fill=(230, 230, 230), font=font)
    pv.save(ASSETS / 'map_preview.png')
render_preview()
log('done')
