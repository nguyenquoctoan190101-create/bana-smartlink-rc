"""Build deterministic Ba Na SmartLink brand assets from the approved logo.

The source image contains a large white safe area.  UI containers previously
compensated by enlarging and clipping the image, which could cut the mark on
small screens.  This script creates tightly cropped, transparent-corner marks
that can be displayed with ``object-fit: contain`` without losing any detail.
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image


OUTPUT_SIZES = (96, 192, 512)


def _foreground_bounds(image: Image.Image, threshold: int = 245) -> tuple[int, int, int, int]:
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    xs: list[int] = []
    ys: list[int] = []
    for y in range(height):
        for x in range(width):
            if min(pixels[x, y]) < threshold:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise ValueError("Logo source does not contain detectable foreground pixels.")
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def _transparent_connected_background(image: Image.Image, threshold: int = 246) -> Image.Image:
    """Remove only near-white pixels connected to the crop boundary.

    The white letterform inside the green mark is enclosed, so it remains
    opaque while the white corner pixels around the rounded square disappear.
    """

    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    seen = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def is_background(x: int, y: int) -> bool:
        red, green, blue, _ = pixels[x, y]
        return min(red, green, blue) >= threshold

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if seen[index] or not is_background(x, y):
            return
        seen[index] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        red, green, blue, _ = pixels[x, y]
        whiteness = min(red, green, blue)
        alpha = max(0, min(255, (255 - whiteness) * 28))
        pixels[x, y] = (red, green, blue, alpha)
        if x:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    return rgba


def build(source: Path, output_dir: Path) -> list[Path]:
    image = Image.open(source)
    left, top, right, bottom = _foreground_bounds(image)
    crop = image.crop((left, top, right, bottom))
    crop = _transparent_connected_background(crop)

    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for size in OUTPUT_SIZES:
        resized = crop.resize((size, size), Image.Resampling.LANCZOS)
        target = output_dir / f"ba-na-brand-mark-{size}.png"
        resized.save(target, optimize=True)
        written.append(target)
    return written


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    for path in build(args.source.resolve(), args.output_dir.resolve()):
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
