# contact sheet: python3 tools/qa_vis_sheet.py out.png cols cellW prefix... (reads PNGs from the scratchpad dir, names sorted)
import sys, glob, os
from PIL import Image, ImageDraw
S = '/tmp/claude-1001/-home-tamasmagyar-Work-testgame/2244238a-7010-4c23-9327-bbc7bc4690bf/scratchpad/'
out = sys.argv[1]; cols = int(sys.argv[2]); cw = int(sys.argv[3]); names = sys.argv[4:]
files = []
for n in names:
    files += [n] if os.path.exists(n) else sorted(glob.glob(S + n + '*.png'))
ims = [Image.open(f).convert('RGB') for f in files]
ch = int(cw * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * cw, rows * ch))
for i, (f, im) in enumerate(zip(files, ims)):
    im = im.resize((cw, ch), Image.LANCZOS); d = ImageDraw.Draw(im); d.text((5, 3), os.path.basename(f)[:-4], fill=(255, 255, 0))
    sheet.paste(im, ((i % cols) * cw, (i // cols) * ch))
sheet.save(S + out); print(S + out)
