# contact sheet: python3 tools/qa_world_sheet.py out.png prefix_or_files... (reads PNGs from the scratchpad dir)
import sys, glob, os
from PIL import Image, ImageDraw
S = '/tmp/claude-1001/-home-tamasmagyar-Work-testgame/2244238a-7010-4c23-9327-bbc7bc4690bf/scratchpad/'
out = sys.argv[1]; names = sys.argv[2:]
files = []
for n in names: files += sorted(glob.glob(S + n + '*.png')) if not os.path.exists(S + n + '.png') else [S + n + '.png']
cols = 3 if len(files) > 4 else 2
w, h = (427, 240) if cols == 3 else (640, 360)
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * h))
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((w, h)); d = ImageDraw.Draw(im); d.text((6, 4), os.path.basename(f)[:-4], fill=(255, 255, 0))
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(S + out)
print(S + out)
