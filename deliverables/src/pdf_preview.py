"""Renders PDF pages into contact sheets for visual QA.
    app\\.venv\\Scripts\\python deliverables\\src\\pdf_preview.py <file.pdf> <out_dir> [pages_per_sheet=6]
"""
import sys
from pathlib import Path

import fitz
from PIL import Image

pdf, out = Path(sys.argv[1]), Path(sys.argv[2])
per = int(sys.argv[3]) if len(sys.argv) > 3 else 6
out.mkdir(parents=True, exist_ok=True)
doc = fitz.open(pdf)
cols, w = 3, 620
pages = []
for page in doc:
    pix = page.get_pixmap(dpi=80)
    pages.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
h = int(w * pages[0].height / pages[0].width)
for s in range(0, len(pages), per):
    chunk = pages[s:s + per]
    rows = (len(chunk) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (w + 10), rows * (h + 10)), "#9ca3af")
    for i, im in enumerate(chunk):
        sheet.paste(im.resize((w, h)), ((i % cols) * (w + 10), (i // cols) * (h + 10)))
    sheet.save(out / f"{pdf.stem}_{s // per + 1:02d}.png")
print(f"{len(pages)} pages -> {out}")
