#!/usr/bin/env python3
"""Generate extension icons. No dependencies - raw PNG via zlib.

    python tools/make-icons.py

Rendered at 8x and box-downsampled for anti-aliasing, so the 16px icon stays
legible instead of aliasing into mush. Shapes are distance fields, which give
round caps and joins for free.
"""
import math
import os
import struct
import zlib

TEAL = (0x1D, 0x9E, 0x75)
WHITE = (0xFF, 0xFF, 0xFF)
SS = 8  # supersampling factor
SIZES = (16, 32, 48, 128)
OUT = os.path.join(os.path.dirname(__file__), '..', 'extension', 'icons')

# Pulse glyph, in unit-square coordinates: flat in, spike up, spike down, flat out.
PULSE = [(0.15, 0.55), (0.35, 0.55), (0.45, 0.27), (0.58, 0.73), (0.68, 0.55), (0.85, 0.55)]
STROKE = 0.105       # of icon size
CORNER = 0.22        # rounded-square radius, of icon size


def dist_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    span = dx * dx + dy * dy
    t = 0.0 if span == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / span))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def rounded_box(px, py, radius):
    """Signed distance to a rounded unit square; negative inside."""
    qx, qy = abs(px - 0.5) - (0.5 - radius), abs(py - 0.5) - (0.5 - radius)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    return outside + min(max(qx, qy), 0.0) - radius


def render(size):
    hi = size * SS
    half = STROKE / 2
    # Chrome Web Store asks for a 96px mark centered in the 128px store icon.
    # Toolbar sizes stay full-bleed so the pulse remains legible.
    pad = 0.125 if size == 128 else 0.0
    # Supersampled coverage masks, then box-filter down to `size`.
    tile = bytearray(hi * hi)
    glyph = bytearray(hi * hi)
    for y in range(hi):
        py = ((y + 0.5) / hi - pad) / (1 - 2 * pad)
        for x in range(hi):
            px = ((x + 0.5) / hi - pad) / (1 - 2 * pad)
            if not (0 <= px <= 1 and 0 <= py <= 1):
                continue
            i = y * hi + x
            if rounded_box(px, py, CORNER) < 0:
                tile[i] = 1
            d = min(dist_to_segment(px, py, *PULSE[k], *PULSE[k + 1]) for k in range(len(PULSE) - 1))
            if d < half:
                glyph[i] = 1

    px_out = bytearray()
    area = SS * SS
    for y in range(size):
        for x in range(size):
            t = g = 0
            for sy in range(SS):
                row = (y * SS + sy) * hi + x * SS
                for sx in range(SS):
                    t += tile[row + sx]
                    g += glyph[row + sx]
            alpha = t / area
            mix = min(g / area, alpha)  # glyph never spills past the tile
            # Composite white glyph over teal tile, premultiplied by coverage.
            rgb = tuple(round(TEAL[c] * (1 - mix / alpha) + WHITE[c] * (mix / alpha)) if alpha else 0 for c in range(3))
            px_out += bytes(rgb) + bytes([round(alpha * 255)])
    return bytes(px_out)


def write_png(path, size, rgba):
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b''.join(b'\x00' + rgba[y * size * 4:(y + 1) * size * 4] for y in range(size))
    blob = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(blob)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for s in SIZES:
        path = os.path.join(OUT, 'icon-%d.png' % s)
        write_png(path, s, render(s))
        print('%s (%d bytes)' % (os.path.relpath(path), os.path.getsize(path)))
