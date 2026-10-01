#!/usr/bin/env python3
"""
Convert an ARBITRARY top-down city map picture (for example a Los Santos radar/atlas image) into the asset
format used by Los Santos Rising (map.png / zones.png / height.png / districts.json), using colour heuristics.

    python3 tools/import_map.py path/to/los_santos_map.png --out assets_custom
    # then open  http://localhost:8080/?map=assets_custom/

Heuristics (Pillow only, no numpy):
  * water   = blue-ish pixels            (override with --water R,G,B --water-tol 40)
  * parks   = green pixels
  * roads   = pixels clearly brighter than their surroundings (--roads light, default) or darker (--roads dark);
              thickness decides street / avenue / freeway
  * beaches = land within a few px of the water
  * zones   = road density (commercial / downtown) + optional discs you provide (see --zone)
  * heights = flat city basin, smooth coast, optional Gaussian hills (--hills x,y,radius,height)
  * districts/gangs = copied from a template districts.json (default: assets/districts.json); each land pixel
    gets the nearest district seed.  Provide your own file with --districts to match your picture.

Everything is deterministic.  The result is meant as a starting point: check assets_custom/map_preview.png.
"""
import argparse, json, math, os, sys
from PIL import Image, ImageFilter, ImageChops, ImageDraw

N = 1024
WATER = (24, 70, 130); SAND = (226, 208, 158); GRASS = (84, 138, 66); SCRUB = (150, 132, 88); LAND = (150, 150, 146)
CONCRETE = (196, 196, 190); STREET = (255, 255, 255); AVENUE = (255, 240, 120); FREEWAY = (255, 150, 50)


def parse_rgb(s):
    return tuple(int(v) for v in s.split(','))


def fit_square(img, mode, fill):
    w, h = img.size
    if mode == 'crop':
        s = min(w, h); img = img.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
    else:
        s = max(w, h); bg = Image.new('RGB', (s, s), fill); bg.paste(img, ((s - w) // 2, (s - h) // 2)); img = bg
    return img.resize((N, N), Image.LANCZOS)


def band(im, lo, hi):
    return im.point(lambda v: 255 if lo <= v <= hi else 0)


def mask_and(*ms):
    r = ms[0]
    for m in ms[1:]:
        r = ImageChops.multiply(r, m)
    return r


def dilate(m, r):
    for _ in range(r):
        m = m.filter(ImageFilter.MaxFilter(3))
    return m


def erode(m, r):
    for _ in range(r):
        m = m.filter(ImageFilter.MinFilter(3))
    return m


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('input'); ap.add_argument('--out', default='assets_custom')
    ap.add_argument('--fit', choices=['pad', 'crop'], default='pad')
    ap.add_argument('--water', default='auto'); ap.add_argument('--water-tol', type=int, default=48)
    ap.add_argument('--roads', choices=['light', 'dark'], default='light'); ap.add_argument('--road-thresh', type=int, default=14)
    ap.add_argument('--hills', action='append', default=[], help='x,y,radius_px,height_m (pixel coords of the 1024 map); repeatable')
    ap.add_argument('--zone', action='append', default=[], help='zone_id,x,y,radius_px  (1 low res,2 mid res,3 commercial,4 downtown,5 industrial,6 beach,7 rich,9 airport,10 docks,11 stadium,12 wild); repeatable')
    ap.add_argument('--districts', default='assets/districts.json')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    src = Image.open(a.input).convert('RGB')
    img = fit_square(src, a.fit, (30, 60, 110))
    print('image', src.size, '->', img.size)
    hsv = img.convert('HSV'); H, S, V = hsv.split()
    gray = img.convert('L')

    # ---- water
    if a.water == 'auto':
        water = mask_and(band(H, 120, 192), S.point(lambda v: 255 if v > 38 else 0), V.point(lambda v: 255 if v > 40 else 0))
    else:
        c = parse_rgb(a.water); t = a.water_tol
        rr, gg, bb = img.split()
        water = mask_and(*(ch.point(lambda v, c0=c0: 255 if abs(v - c0) <= t else 0) for ch, c0 in zip((rr, gg, bb), c)))
    water = water.filter(ImageFilter.MedianFilter(5))
    water = dilate(erode(water, 2), 2)             # remove speckles
    # drop tiny water bodies (pools) by requiring blurred density
    wd = water.filter(ImageFilter.GaussianBlur(6)).point(lambda v: 255 if v > 120 else 0)
    water = ImageChops.multiply(water, wd)
    print('water px', sum(1 for v in water.getdata() if v) )

    # ---- parks
    green = mask_and(band(H, 48, 116), S.point(lambda v: 255 if v > 55 else 0))
    green = green.filter(ImageFilter.MedianFilter(5))
    green = ImageChops.subtract(green, water)

    # ---- roads
    bg = gray.filter(ImageFilter.GaussianBlur(7))
    if a.roads == 'light':
        diff = ImageChops.subtract(gray, bg)
    else:
        diff = ImageChops.subtract(bg, gray)
    roads = diff.point(lambda v: 255 if v > a.road_thresh else 0)
    roads = ImageChops.subtract(roads, water)
    roads = roads.filter(ImageFilter.MedianFilter(3))
    roads = erode(dilate(roads, 1), 1)             # close tiny gaps
    # remove isolated specks: keep pixels with enough neighbours
    dens = roads.filter(ImageFilter.GaussianBlur(2.5)).point(lambda v: 255 if v > 70 else 0)
    roads = ImageChops.multiply(roads, dens)
    # thickness buckets via repeated erosion
    e1 = erode(roads, 1); e2 = erode(e1, 1); e3 = erode(e2, 1); e4 = erode(e3, 1)
    freeway = dilate(e4, 4)                        # thick roads
    avenue = ImageChops.subtract(dilate(e2, 2), freeway)
    street = ImageChops.subtract(roads, ImageChops.add(avenue, freeway))
    print('road px', sum(1 for v in roads.getdata() if v))

    # ---- base class map
    landmask = water.point(lambda v: 0 if v else 255)
    coast = ImageChops.subtract(dilate(water, 9), water)       # beach band
    cls = Image.new('RGB', (N, N), LAND)
    cls.paste(SAND, mask=ImageChops.multiply(coast, landmask))
    cls.paste(GRASS, mask=green)
    cls.paste(WATER, mask=water)
    cls.paste(STREET, mask=street); cls.paste(AVENUE, mask=avenue); cls.paste(FREEWAY, mask=freeway)
    cls.save(os.path.join(a.out, 'map.png'))

    # ---- zones / districts / gangs
    tpl = json.load(open(a.districts))['districts'] if os.path.exists(a.districts) else [{'id': 1, 'name': 'Los Santos', 'zone': 1, 'gang': 0, 'cx': 512, 'cy': 512}]
    rd = roads.filter(ImageFilter.GaussianBlur(28)); rdd = list(rd.getdata())
    cl = list(cls.getdata()); wl = list(water.getdata()); gl = list(green.getdata())
    # nearest district seed on a coarse grid
    S4 = 256; k = N // S4
    near = [0] * (S4 * S4)
    for j in range(S4):
        for i in range(S4):
            px, py = i * k + k // 2, j * k + k // 2
            best = 1e18; bi = 0
            for t_i, d in enumerate(tpl):
                dd = (d['cx'] - px) ** 2 + (d['cy'] - py) ** 2
                if dd < best: best = dd; bi = t_i
            near[j * S4 + i] = bi
    zones = []
    manual = []
    for z in a.zone:
        zid, zx, zy, zr = (int(float(v)) for v in z.split(','))
        manual.append((zid, zx, zy, zr))
    out = Image.new('RGB', (N, N))
    data = []
    maxd = max(rdd) or 1
    for y in range(N):
        for x in range(N):
            i = y * N + x
            if wl[i]:
                data.append((0, 0, 0)); continue
            d = tpl[near[(y // k) * S4 + (x // k)]]
            zone = d.get('zone', 1)
            dens = rdd[i] / maxd
            # density refinement for generic land districts
            if zone in (1, 2, 3):
                zone = 4 if dens > 0.92 else (3 if dens > 0.62 else (2 if dens > 0.38 else 1))
            if gl[i]: zone = 8
            for zid, zx, zy, zr in manual:
                if (x - zx) ** 2 + (y - zy) ** 2 <= zr * zr: zone = zid
            data.append((zone, d['id'], d.get('gang', 0)))
    out.putdata(data); out.save(os.path.join(a.out, 'zones.png'))

    # ---- heights
    land = landmask.filter(ImageFilter.GaussianBlur(9))
    hills = []
    for hs in a.hills:
        hx, hy, hr, hh = (float(v) for v in hs.split(','))
        hills.append((hx, hy, hr, hh))
    hp = Image.new('RGB', (N, N)); hd = []
    ld = list(land.getdata())
    for y in range(N):
        for x in range(N):
            i = y * N + x
            t = ld[i] / 255.0
            h = -7.0 + 9.5 * min(1.0, t / 0.72) if t < 0.72 else 2.5
            if wl[i]: h = min(h, -0.6)
            elif h < 1.0: h = 1.0
            for hx, hy, hr, hh in hills:
                dd = ((x - hx) ** 2 + (y - hy) ** 2) / (hr * hr)
                if dd < 9: h += hh * math.exp(-dd * 1.2)
            v = int((h + 20) * 256); hd.append((v >> 8, v & 255, 0))
    hp.putdata(hd); hp.save(os.path.join(a.out, 'height.png'))
    json.dump({'districts': tpl}, open(os.path.join(a.out, 'districts.json'), 'w'), indent=1)
    # preview
    prev = Image.blend(img, cls, 0.55); prev.save(os.path.join(a.out, 'map_preview.png'))
    print('written to', a.out)
    print('Play it with   http://localhost:8080/?map=%s/   (keep the trailing slash)' % a.out)


if __name__ == '__main__':
    main()
