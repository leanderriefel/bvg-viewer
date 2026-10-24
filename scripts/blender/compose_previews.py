"""Lay out Blender-rendered QA views as contact sheets. Requires Pillow."""

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
CATALOG = json.loads((ROOT / "public/models/vehicles/catalog.json").read_text(encoding="utf-8"))
VIEWS = {view["id"]: view for view in json.loads((ROOT / "public/models/vehicles/previews/views.json").read_text())}
COLORS = {"s-bahn": "#42864B", "u-bahn": "#3476A6", "tram": "#BE5148", "bus": "#9B688C",
          "regional": "#B84C42", "long-distance": "#686D66", "ferry": "#4F99A3"}


def font(size, bold=False):
    candidates = ["C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
                  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default(size=size)


def sheet(models, columns, destination, title):
    card_w, card_h, gap, margin, header = 440, 282, 16, 40, 164
    rows = math.ceil(len(models) / columns)
    width = margin * 2 + columns * card_w + (columns - 1) * gap
    height = header + rows * card_h + (rows - 1) * gap + 62
    image = Image.new("RGB", (width, height), "#F3F2EB")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((margin, 27, margin + 49, 76), radius=12, fill="#F0CA25")
    draw.text((margin + 9, 31), "B", font=font(32, True), fill="#222B2D")
    draw.text((margin + 68, 24), "BERLIN IN MOTION", font=font(35, True), fill="#253135")
    draw.text((margin + 68, 70), title, font=font(19), fill="#68726D")
    draw.line((margin, 126, width - margin, 126), fill="#D4D6CE", width=2)
    for index, model in enumerate(models):
        row, column = divmod(index, columns)
        x, y = margin + column * (card_w + gap), header + row * (card_h + gap)
        draw.rounded_rectangle((x, y, x + card_w, y + card_h), radius=13, fill="#FCFCF7", outline="#DDE0D5")
        rendered = Image.open(ROOT / f"public/models/vehicles/previews/{model['id']}.png").convert("RGBA")
        rendered.thumbnail((card_w - 26, 207), Image.Resampling.LANCZOS)
        image.paste(rendered, (x + (card_w - rendered.width) // 2, y + 8), rendered)
        draw.ellipse((x + 18, y + 225, x + 27, y + 234), fill=COLORS[model["mode"]])
        label = model["name"].replace(" · ", " / ")
        label_font = font(18, True)
        if draw.textlength(label, font=label_font) > card_w - 55:
            label_font = font(15, True)
        draw.text((x + 37, y + 216), label, font=label_font, fill="#293638")
        view = VIEWS[model["id"]]
        detail = f"{view['shownCars']}-car detail / {view['totalCars']}-car asset" if view["detail"] else f"{model['cars']} section{'s' if model['cars'] != 1 else ''}"
        info = f"{model['nominalDimensions']['length']:g} m  /  {detail}  /  {model['triangles']:,} tris"
        draw.text((x + 18, y + 250), info, font=font(14), fill="#6C766F")
    draw.text((margin, height - 39), "49 ORIGINAL MODELS  /  7 MODES  /  METRES +Y UP +Z FORWARD  /  GLB + BLENDER SOURCE  /  CC0", font=font(16), fill="#59655F")
    image.save(destination, optimize=True)


sheet(CATALOG["models"], 7, ROOT / "assets/vehicles/fleet-preview.png", "The complete 49-model collection · original low-poly geometry")
samples = {"sbahn-480", "sbahn-483", "ubahn-a3", "ubahn-jk", "tram-flexity-long", "tram-moderus-gamma",
           "bus-bvg-double-deck", "bus-bvg-electric-articulated", "odeg-desiro-hc", "neb-mireo-h", "ice-3", "ferry-faehrbaer"}
sheet([model for model in CATALOG["models"] if model["id"] in samples], 4,
      ROOT / "assets/vehicles/fleet-samples.png", "Selected families · full collection includes 49 models and 266 service entries")
