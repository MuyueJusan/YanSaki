#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make-icons.py —— 从 GitHub 头像生成 Android 图标资源。

⚠ 为什么不用 Pillow：本机 pip 走代理拉不到 PyPI（实测卡死 4 分钟无输出）。
  所以这里用**标准库 zlib** 手写 PNG 解码/编码 + 面积平均缩放，零依赖。
  PNG 的结构就是 IHDR + IDAT(zlib) + IEND，够用，不必为一次性的图标生成装一整套图像库。

用法：
    python tools/make-icons.py <源图.png> <输出 res 目录>

产出：
    mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png          传统方形图标
    mipmap-{...}dpi/ic_launcher_round.png                传统圆形图标（角上透明）
    mipmap-{...}dpi/ic_launcher_foreground.png           自适应图标前景（108dp 满幅）
    mipmap-anydpi-v26/ic_launcher.xml                    自适应图标描述
    mipmap-anydpi-v26/ic_launcher_round.xml
"""
import os
import struct
import sys
import zlib

# ============ PNG 解码 ============

def png_read(path):
    """读 8 位 PNG，返回 (w, h, bytearray RGBA)。"""
    data = open(path, 'rb').read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('不是 PNG')
    pos, idat, plte, trns = 8, b'', None, None
    w = h = bd = ct = None
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b'IHDR':
            w, h, bd, ct, _comp, _filt, inter = struct.unpack('>IIBBBBB', body)
            if bd != 8:
                raise ValueError('只支持 8 位色深，实际 %d' % bd)
            if inter != 0:
                raise ValueError('不支持隔行扫描')
        elif typ == b'PLTE':
            plte = body
        elif typ == b'tRNS':
            trns = body
        elif typ == b'IDAT':
            idat += body
        elif typ == b'IEND':
            break

    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    raw = zlib.decompress(idat)
    stride = w * ch
    out = bytearray(stride * h)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if f == 1:
            for i in range(ch, stride):
                line[i] = (line[i] + line[i - ch]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                b = prev[i]
                c = prev[i - ch] if i >= ch else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        elif f != 0:
            raise ValueError('未知 filter %d' % f)
        out[y * stride:(y + 1) * stride] = line
        prev = line

    # 统一转 RGBA
    rgba = bytearray(w * h * 4)
    for i in range(w * h):
        if ct == 6:
            rgba[i * 4:i * 4 + 4] = out[i * 4:i * 4 + 4]
        elif ct == 2:
            rgba[i * 4:i * 4 + 3] = out[i * 3:i * 3 + 3]
            rgba[i * 4 + 3] = 255
        elif ct == 0:
            v = out[i]
            rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v
            rgba[i * 4 + 3] = 255
        elif ct == 4:
            v = out[i * 2]
            rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v
            rgba[i * 4 + 3] = out[i * 2 + 1]
        elif ct == 3:
            idx = out[i]
            rgba[i * 4:i * 4 + 3] = plte[idx * 3:idx * 3 + 3]
            rgba[i * 4 + 3] = trns[idx] if (trns and idx < len(trns)) else 255
    return w, h, rgba


def png_write(path, w, h, rgba):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    blob = b'\x89PNG\r\n\x1a\n'
    blob += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    blob += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    blob += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(blob)


# ============ 缩放 ============

def resize(src, sw, sh, dw, dh):
    """面积平均（box filter）。缩小是正解；放大时退化成最近邻，够用。"""
    out = bytearray(dw * dh * 4)
    for dy in range(dh):
        y0 = dy * sh // dh
        y1 = max(y0 + 1, (dy + 1) * sh // dh)
        for dx in range(dw):
            x0 = dx * sw // dw
            x1 = max(x0 + 1, (dx + 1) * sw // dw)
            r = g = b = a = n = 0
            for y in range(y0, y1):
                base = y * sw * 4
                for x in range(x0, x1):
                    i = base + x * 4
                    r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]
                    n += 1
            o = (dy * dw + dx) * 4
            out[o] = r // n; out[o + 1] = g // n; out[o + 2] = b // n; out[o + 3] = a // n
    return out


def crop(src, sw, x, y, cw, ch):
    out = bytearray(cw * ch * 4)
    for j in range(ch):
        out[j * cw * 4:(j + 1) * cw * 4] = src[((y + j) * sw + x) * 4:((y + j) * sw + x + cw) * 4]
    return out


def round_mask(rgba, size):
    """把方形抠成圆，角上 alpha=0（给 26 以下的圆形启动器用）。"""
    out = bytearray(rgba)
    c = (size - 1) / 2.0
    r = size / 2.0
    for y in range(size):
        dy = y - c
        for x in range(size):
            dx = x - c
            d = (dx * dx + dy * dy) ** 0.5
            if d > r:
                out[(y * size + x) * 4 + 3] = 0
            elif d > r - 1.5:
                # 边缘一像素做抗锯齿，否则圆周一圈锯齿
                out[(y * size + x) * 4 + 3] = int(out[(y * size + x) * 4 + 3] * (r - d) / 1.5)
    return out


# ============ 主流程 ============

# 裁切框：源图上取一块方形的「头部特写」。
# ⚠ 这几个数是**看出来的**，不是算出来的 —— 改了必须重看 build/icon-preview.png。
# 实测源图是 460x460（不是 512：GitHub 不会把原图放大），脸的水平中心约在 x=202。
# x0 取 0 时脸落在 47% 处，最接近正中；再往右挪反而把脸推向左。
# 边长 430 略小于 xxxhdpi 自适应图标的 432 ⇒ 只放大 1.005 倍，肉眼无差。
CROP_X, CROP_Y, CROP_SIDE = 0, 0, 430

DENSITIES = [
    ('mdpi', 48, 108),
    ('hdpi', 72, 162),
    ('xhdpi', 96, 216),
    ('xxhdpi', 144, 324),
    ('xxxhdpi', 192, 432),
]

ADAPTIVE_XML = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/shed_backdrop" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
'''


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    src_path, res_dir = sys.argv[1], sys.argv[2]

    sw, sh, src = png_read(src_path)
    print('源图 %dx%d' % (sw, sh))

    side = min(CROP_SIDE, sw - CROP_X, sh - CROP_Y)
    base = crop(src, sw, CROP_X, CROP_Y, side, side)
    print('裁切 (%d,%d) 边长 %d' % (CROP_X, CROP_Y, side))

    for name, legacy_px, adaptive_px in DENSITIES:
        d = os.path.join(res_dir, 'mipmap-' + name)
        os.makedirs(d, exist_ok=True)

        square = resize(base, side, side, legacy_px, legacy_px)
        png_write(os.path.join(d, 'ic_launcher.png'), legacy_px, legacy_px, square)

        rnd = round_mask(square, legacy_px)
        png_write(os.path.join(d, 'ic_launcher_round.png'), legacy_px, legacy_px, rnd)

        # 自适应图标前景：108dp 满幅。启动器只会露出中间 72dp（=2/3），
        # 所以这里**故意**让它满幅铺满，四周那圈是被裁掉的余量。
        fg = resize(base, side, side, adaptive_px, adaptive_px)
        png_write(os.path.join(d, 'ic_launcher_foreground.png'), adaptive_px, adaptive_px, fg)

        print('  mipmap-%-8s legacy=%d adaptive=%d' % (name, legacy_px, adaptive_px))

    anydpi = os.path.join(res_dir, 'mipmap-anydpi-v26')
    os.makedirs(anydpi, exist_ok=True)
    for fn in ('ic_launcher.xml', 'ic_launcher_round.xml'):
        with open(os.path.join(anydpi, fn), 'w', encoding='utf-8') as f:
            f.write(ADAPTIVE_XML)
    print('  mipmap-anydpi-v26/ic_launcher.xml + ic_launcher_round.xml')

    # 预览：把「108dp 前景 + 圆形遮罩后可见区域」画出来，供人眼核对
    prev_px = 432
    fg = resize(base, side, side, prev_px, prev_px)
    # 叠一层遮罩：可见区（中央 2/3）保持原样，被裁掉的部分压暗
    vis = bytearray(fg)
    lo = prev_px // 6
    hi = prev_px - lo
    for y in range(prev_px):
        for x in range(prev_px):
            if x < lo or x >= hi or y < lo or y >= hi:
                i = (y * prev_px + x) * 4
                vis[i] = vis[i] // 3
                vis[i + 1] = vis[i + 1] // 3
                vis[i + 2] = vis[i + 2] // 3
    out_dir = os.path.join(os.path.dirname(res_dir.rstrip('/\\')), 'build')
    os.makedirs(out_dir, exist_ok=True)
    png_write(os.path.join(out_dir, 'icon-preview.png'), prev_px, prev_px, vis)
    print('预览 → build/icon-preview.png（中间亮区 = 启动器实际会露出的部分）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
