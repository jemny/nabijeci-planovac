#!/usr/bin/env python3
"""Draw the app icon (teal rounded square, white lightning bolt) as PNGs without any dependency."""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "icons")
TEAL, WHITE = (10, 127, 108), (255, 255, 255)
BOLT = [(0.58, 0.12), (0.26, 0.56), (0.47, 0.56), (0.40, 0.88), (0.74, 0.42), (0.53, 0.42), (0.62, 0.12)]


def inside(poly, x, y):
    c = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def pixel(u, v, maskable):
    r = 0.0 if maskable else 0.2  # corner radius as a share of the size (maskable = full bleed)
    if r:
        cx, cy = min(max(u, r), 1 - r), min(max(v, r), 1 - r)
        if (u - cx) ** 2 + (v - cy) ** 2 > r * r:
            return None
    s = 0.8 if maskable else 1.0  # keep the bolt inside the maskable safe zone
    bu, bv = 0.5 + (u - 0.5) / s, 0.5 + (v - 0.5) / s
    return WHITE if inside(BOLT, bu, bv) else TEAL


def png(size, path, maskable=False, ss=3):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc, n = [0, 0, 0, 0], ss * ss
            for sy in range(ss):
                for sx in range(ss):
                    col = pixel((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, maskable)
                    if col:
                        acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 255
            a = acc[3] / n
            row += bytes([int(acc[0] / max(acc[3] / 255, 1e-9)) if a else 0,
                          int(acc[1] / max(acc[3] / 255, 1e-9)) if a else 0,
                          int(acc[2] / max(acc[3] / 255, 1e-9)) if a else 0, int(a)])
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
                + chunk(b"IDAT", raw) + chunk(b"IEND", b""))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    png(180, os.path.join(OUT, "icon-180.png"), maskable=True)   # iOS adds its own rounding
    png(192, os.path.join(OUT, "icon-192.png"))
    png(512, os.path.join(OUT, "icon-512.png"))
    png(512, os.path.join(OUT, "icon-maskable-512.png"), maskable=True)
    print("icons written to", OUT)
