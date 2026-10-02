"""Render the Retell Dashboard logo to SVG (favicon), ICO (exe/window) and PNG.

The mark: a brass crescent moon (after-hours) over a scribe-red line climbing to
a witness dot (calls converting), on a night-slate plate. One geometry drives
every output so the favicon, the exe and the window icon always match.

    python scripts/make_logo.py            # needs Pillow (not a project dependency)
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

REPO = Path(__file__).resolve().parent.parent
SVG_OUT = REPO / "dashboard" / "frontend" / "public" / "favicon.svg"
ICO_OUT = REPO / "dashboard" / "host" / "app.ico"
PNG_OUT = REPO / "dashboard" / "design-reference" / "logo.png"

# Palette — the Measured Bench tokens, shifted for a dark plate.
PLATE_TOP, PLATE_BOTTOM = (36, 44, 60), (17, 21, 30)
MOON = "#d9a441"
STAR = "#e9e6dc"
LINE = "#e0563f"
RULE = "#5b6374"

# Geometry on a 64-unit grid.
MOON_C, MOON_R = (25.0, 24.0), 13.0
BITE_C, BITE_R = (31.0, 19.0), 11.0
STARS = [((47.0, 14.0), 1.6), ((53.0, 24.0), 1.1), ((41.0, 8.5), 0.9)]
TREND = [(11.0, 50.0), (24.0, 43.0), (34.0, 46.5), (50.0, 32.0)]
DOT_R = 4.2
BASE_Y = 55.0


def write_svg() -> None:
    pts = " ".join(f"{x:g},{y:g}" for x, y in TREND)
    tip = TREND[-1]
    stars = "\n".join(
        f'  <circle cx="{x:g}" cy="{y:g}" r="{r:g}" fill="{STAR}"/>' for (x, y), r in STARS
    )
    hexs = ["#%02x%02x%02x" % c for c in (PLATE_TOP, PLATE_BOTTOM)]
    SVG_OUT.write_text(
        f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{hexs[0]}"/>
      <stop offset="1" stop-color="{hexs[1]}"/>
    </linearGradient>
    <mask id="crescent">
      <circle cx="{MOON_C[0]:g}" cy="{MOON_C[1]:g}" r="{MOON_R:g}" fill="#fff"/>
      <circle cx="{BITE_C[0]:g}" cy="{BITE_C[1]:g}" r="{BITE_R:g}" fill="#000"/>
    </mask>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#plate)"/>
{stars}
  <circle cx="{MOON_C[0]:g}" cy="{MOON_C[1]:g}" r="{MOON_R:g}" fill="{MOON}" mask="url(#crescent)"/>
  <line x1="11" y1="{BASE_Y:g}" x2="53" y2="{BASE_Y:g}" stroke="{RULE}" stroke-width="2" stroke-linecap="round"/>
  <polyline points="{pts}" fill="none" stroke="{LINE}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="{tip[0]:g}" cy="{tip[1]:g}" r="{DOT_R:g}" fill="{LINE}" stroke="{hexs[1]}" stroke-width="1.5"/>
</svg>
""",
        encoding="utf-8",
    )


def render(size_px: int = 1024) -> Image.Image:
    s = size_px / 64

    def box(c, r):
        return [(c[0] - r) * s, (c[1] - r) * s, (c[0] + r) * s, (c[1] + r) * s]

    # Plate: vertical gradient clipped to a rounded square.
    grad = Image.new("RGBA", (size_px, size_px))
    gd = ImageDraw.Draw(grad)
    for y in range(size_px):
        t = y / (size_px - 1)
        gd.line(
            [(0, y), (size_px, y)],
            fill=tuple(round(a + (b - a) * t) for a, b in zip(PLATE_TOP, PLATE_BOTTOM)) + (255,),
        )
    plate_mask = Image.new("L", (size_px, size_px), 0)
    ImageDraw.Draw(plate_mask).rounded_rectangle([0, 0, size_px - 1, size_px - 1], radius=14 * s, fill=255)
    img = Image.new("RGBA", (size_px, size_px), (0, 0, 0, 0))
    img.paste(grad, (0, 0), plate_mask)
    d = ImageDraw.Draw(img)

    for c, r in STARS:
        d.ellipse(box(c, r), fill=STAR)

    # Crescent = moon disc minus the offset "bite" disc.
    moon = Image.new("L", img.size, 0)
    ImageDraw.Draw(moon).ellipse(box(MOON_C, MOON_R), fill=255)
    bite = Image.new("L", img.size, 0)
    ImageDraw.Draw(bite).ellipse(box(BITE_C, BITE_R), fill=255)
    img.paste(Image.new("RGBA", img.size, MOON), (0, 0), ImageChops.subtract(moon, bite))

    def stroke(points, width, fill):
        px = [(x * s, y * s) for x, y in points]
        d.line(px, fill=fill, width=round(width * s), joint="curve")
        for p in points:  # round caps + joins
            d.ellipse(box(p, width / 2), fill=fill)

    stroke([(11, BASE_Y), (53, BASE_Y)], 2, RULE)
    stroke(TREND, 4, LINE)
    tip = TREND[-1]
    d.ellipse(box(tip, DOT_R + 0.75), fill=PLATE_BOTTOM)
    d.ellipse(box(tip, DOT_R), fill=LINE)
    return img


def main() -> None:
    write_svg()
    big = render()
    PNG_OUT.parent.mkdir(parents=True, exist_ok=True)
    big.resize((512, 512), Image.LANCZOS).save(PNG_OUT)
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    big.resize((256, 256), Image.LANCZOS).save(ICO_OUT, sizes=[(n, n) for n in sizes])
    for p in (SVG_OUT, ICO_OUT, PNG_OUT):
        print("wrote", p.relative_to(REPO))


if __name__ == "__main__":
    main()
