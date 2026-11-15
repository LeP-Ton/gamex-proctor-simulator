#!/usr/bin/env python3
"""把原始生成素材转成 WebP，并提取与真实透明度一致的拾取元数据。

仅做格式准备、帧裁剪边界和透明掩码提取，不重绘、调色或修改人物。
运行需 Pillow；五个 -- 参数分别指向原始 PNG，原图不会被覆盖。
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ALPHA_THRESHOLD = 128


def frame_data(
    image: Image.Image,
    box: tuple[int, int, int, int],
    transparent: bool,
    head: tuple[int, int] | None = None,
) -> dict:
    alpha = image.getchannel("A")
    if transparent:
        # 低透明度的非可见 RGB 不应扩大帧边界；保留正常抗锯齿外缘。
        bounds = alpha.crop(box).point(lambda value: 255 if value >= 16 else 0).getbbox()
        if not bounds:
            raise ValueError(f"空素材帧：{box}")
        x, y = box[0] + bounds[0], box[1] + bounds[1]
        box = (x, y, box[0] + bounds[2], box[1] + bounds[3])
    x, y, right, bottom = box
    width, height = right - x, bottom - y
    # 每格最多覆盖 2×2 源像素，使用最小 alpha，绝不向透明边缘膨胀。
    stride = 2 if transparent else max(width, height)
    mask_width = math.ceil(width / stride)
    mask_height = math.ceil(height / stride)
    rows: list[list[int]] = []
    pixels = alpha.load()
    for my in range(mask_height):
        runs: list[int] = []
        opened = False
        for mx in range(mask_width):
            ax = x + (mx * width) // mask_width
            bx = x + math.ceil((mx + 1) * width / mask_width)
            ay = y + (my * height) // mask_height
            by = y + math.ceil((my + 1) * height / mask_height)
            visible = all(pixels[px, py] >= ALPHA_THRESHOLD for py in range(ay, by) for px in range(ax, bx))
            if visible and not opened:
                runs.append(mx)
                opened = True
            elif not visible and opened:
                runs.append(mx)
                opened = False
        if opened:
            runs.append(mask_width)
        rows.append(runs)
    result = dict(x=x, y=y, w=width, h=height, maskWidth=mask_width, maskHeight=mask_height, rowsRLE=rows)
    if head:
        hx, hy = head
        if not (x <= hx < right and y <= hy < bottom and pixels[hx, hy] >= ALPHA_THRESHOLD):
            raise ValueError(f"头部锚点不在可见像素上：{head} / {box}")
        result.update(headX=hx - x, headY=hy - y)
    return result


HELPERS = '''
export interface PhotoImageShape {
  asset: PhotoAssetId;
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
  flipX?: boolean;
}

export function photoFrame(shape: Pick<PhotoImageShape, "asset" | "frame">): PhotoFrame {
  return PHOTO_ASSETS[shape.asset].frames[shape.frame];
}

export function containsPhoto(shape: PhotoImageShape, x: number, y: number): boolean {
  if (shape.w <= 0 || shape.h <= 0) return false;
  const u = (x - shape.x) / shape.w;
  const v = (y - shape.y) / shape.h;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
  const frame = photoFrame(shape);
  const pixelX = Math.min(frame.maskWidth - 1, Math.floor((shape.flipX ? 1 - u : u) * frame.maskWidth));
  const row = frame.rowsRLE[Math.floor(v * frame.maskHeight)];
  for (let i = 0; i < row.length; i += 2) {
    if (row[i] <= pixelX && pixelX < row[i + 1]) return true;
  }
  return false;
}

export function photoHead(shape: PhotoImageShape): { x: number; y: number } {
  const frame = photoFrame(shape);
  const u = (frame.headX ?? frame.w / 2) / frame.w;
  return {
    x: shape.x + (shape.flipX ? 1 - u : u) * shape.w,
    y: shape.y + (frame.headY ?? frame.h / 2) / frame.h * shape.h,
  };
}
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    asset_ids = ("people", "peopleB", "classroom", "furniture", "public")
    for asset in asset_ids:
        parser.add_argument("--people-b" if asset == "peopleB" else f"--{asset}", dest=asset, type=Path, required=True)
    args = parser.parse_args()
    output = ROOT / "public/assets/photo-3"
    output.mkdir(parents=True, exist_ok=True)
    assets: dict[str, dict] = {}
    for asset in asset_ids:
        image = Image.open(getattr(args, asset)).convert("RGBA")
        width, height = image.size
        frames = []
        if asset in ("people", "peopleB"):
            # 原图四组动作的高度不同，边界依据实际像素间隙而非均分。
            if asset == "people":
                expected_size = (1086, 1448)
                rows = [0, 389, 724, 1105, 1448]
                heads = [
                    [(160, 52), (413, 53), (677, 53), (950, 58)],
                    [(223, 426), (490, 419), (751, 423), (1008, 432)],
                    [(155, 796), (416, 793), (677, 795), (942, 799)],
                    [(154, 1134), (414, 1131), (676, 1141), (948, 1147)],
                ]
            else:
                expected_size = (1199, 1312)
                rows = [0, 338, 649, 987, 1312]
                heads = [
                    [(167, 42), (446, 48), (747, 59), (1036, 62)],
                    [(229, 376), (531, 371), (817, 390), (1100, 390)],
                    [(164, 742), (453, 742), (749, 750), (1041, 750)],
                    [(163, 1020), (443, 1019), (745, 1032), (1039, 1032)],
                ]
            if image.size != expected_size:
                raise ValueError("人物原图尺寸变更，需重新校准动作行边界与头部锚点。")
            for row in range(4):
                for col in range(4):
                    box = (round(col * width / 4), rows[row], round((col + 1) * width / 4), rows[row + 1])
                    frames.append(frame_data(image, box, True, heads[row][col]))
        elif asset == "furniture":
            for row in range(2):
                for col in range(2):
                    box = (round(col * width / 2), round(row * height / 2), round((col + 1) * width / 2), round((row + 1) * height / 2))
                    frames.append(frame_data(image, box, True))
            # 0/1 为完整桌，2/3 为椅；4/5 与 6/7 分别为两张桌的桌面和桌架。
            for index in range(2):
                frame = frames[index]
                split_y = 285
                frames.append(frame_data(image, (frame["x"], frame["y"], frame["x"] + frame["w"], split_y), True))
                frames.append(frame_data(image, (frame["x"], split_y, frame["x"] + frame["w"], frame["y"] + frame["h"]), True))
        else:
            columns, row_count = (2, 2) if asset == "classroom" else (2, 1)
            for row in range(row_count):
                for col in range(columns):
                    frames.append(frame_data(image, (round(col * width / columns), round(row * height / row_count), round((col + 1) * width / columns), round((row + 1) * height / row_count)), False))
        # 透明图无损保存 alpha；不触碰原图的近透明 RGB 或抗锯齿细节。
        image.save(output / f"{asset}.webp", "WEBP", lossless=asset in ("people", "peopleB", "furniture"), quality=94, method=6, exact=True)
        assets[asset] = dict(url=f"assets/photo-3/{asset}.webp", width=width, height=height, frames=frames)
        print(f"{asset}：{width}×{height}，{len(frames)} 帧，{(output / f'{asset}.webp').stat().st_size:,} 字节")
    header = '''// 此文件由 scripts/prepare-photo-assets.py 生成；只保存素材裁剪及真实透明像素信息。
// 帧顺序：人物按动作行×四个身份；家具 0/1整桌、2/3椅、4/5桌0面/架、6/7桌1面/架。
export type PhotoAssetId = "people" | "peopleB" | "classroom" | "furniture" | "public";
export interface PhotoFrame {
  x: number; y: number; w: number; h: number;
  maskWidth: number; maskHeight: number;
  rowsRLE: readonly (readonly number[])[];
  headX?: number; headY?: number;
}
export interface PhotoAsset {
  url: string; width: number; height: number;
  frames: readonly PhotoFrame[];
}
export const PHOTO_ALPHA_THRESHOLD = 128;
export const PHOTO_ASSETS: Readonly<Record<PhotoAssetId, PhotoAsset>> = '''
    target = ROOT / "src/render/photo-assets.ts"
    target.write_text(header + json.dumps(assets, ensure_ascii=False, separators=(",", ":")) + ";\n" + HELPERS, encoding="utf-8")


if __name__ == "__main__":
    main()
