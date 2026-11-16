#!/usr/bin/env python3
"""为连贯动作版本准备新增人物图集，不改变已交付的照片素材。

只做无损 WebP 格式转换、按真实间隙划分帧及透明像素元数据提取。
需要 Pillow；原始 PNG 不会被修改。现有五个素材的数据和拾取算法不变。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import runpy
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE_SIZE = (1536, 1024)
# 根据 alpha≥16 的内容间隙校准；不能按等宽、等高网格裁切人物。
COLUMNS = [0, 304, 544, 784, 1024, 1264, 1536]
ROWS = [0, 254, 510, 766, 1024]
HEADS = [
    [(180, 35), (420, 32), (660, 36), (904, 34), (1144, 34), (1384, 34)],
    [(184, 286), (424, 286), (668, 286), (910, 286), (1151, 287), (1391, 286)],
    [(188, 540), (426, 542), (653, 540), (904, 539), (1140, 539), (1382, 538)],
    [(184, 790), (424, 792), (651, 791), (902, 793), (1146, 792), (1388, 790)],
]
BASE_IDS = {"people", "peopleB", "classroom", "furniture", "public"}


def base_payload(source: str) -> tuple[dict, re.Match[str], int]:
    pattern = r"(?:export\s+)?const\s+(?:BASE_)?PHOTO_ASSETS\s*:[^=]+?=\s*"
    match = re.search(pattern, source)
    if not match:
        raise ValueError("未找到原照片素材数据，停止修改公共模块。")
    payload, end = json.JSONDecoder().raw_decode(source[match.end():])
    if set(payload) != BASE_IDS:
        raise ValueError("原照片素材集合变化，需人工核对后再扩展。")
    return payload, match, match.end() + end


def preserve_and_extend_registry() -> str:
    target = ROOT / "src/render/photo-assets.ts"
    source = target.read_text(encoding="utf-8")
    original, match, end = base_payload(source)
    digest = hashlib.sha256(json.dumps(original, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if "BASE_PHOTO_ASSETS" not in match.group():
        prefix = 'const BASE_PHOTO_ASSETS: Readonly<Record<Exclude<PhotoAssetId, "peopleC">, PhotoAsset>> = '
        data = source[match.end():end]
        suffix = source[end:]
        if not suffix.startswith(";"):
            raise ValueError("原素材定义格式变化，停止扩展。")
        source = source[:match.start()] + prefix + data + suffix[:1] + '\nexport const PHOTO_ASSETS: Readonly<Record<PhotoAssetId, PhotoAsset>> = { ...BASE_PHOTO_ASSETS, ...MOTION_PHOTO_ASSETS };' + suffix[1:]
    type_match = re.search(r"export\s+type\s+PhotoAssetId\s*=\s*([^;]+);", source)
    if not type_match:
        raise ValueError("未找到照片素材 ID 类型。")
    if '"peopleC"' not in type_match.group(1):
        source = source[:type_match.end() - 1] + ' | "peopleC"' + source[type_match.end() - 1:]
    import_line = 'import { MOTION_PHOTO_ASSETS } from "./motion-photo-assets.js";\n'
    if import_line not in source:
        source = import_line + source
    after, _, _ = base_payload(source)
    if original != after:
        raise ValueError("原五个素材数据发生变化，停止保存。")
    target.write_text(source, encoding="utf-8")
    return digest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--people", type=Path, required=True, help="6列×4行的12身份原始人物 PNG")
    args = parser.parse_args()
    image = Image.open(args.people).convert("RGBA")
    if image.size != SOURCE_SIZE:
        raise ValueError("原图尺寸变化，须重新检查各帧间隙与头部锚点。")
    # 复用首版提取函数，保证保守 alpha 掩码的语义完全一致。
    frame_data = runpy.run_path(str(ROOT / "scripts/prepare-photo-assets.py"))["frame_data"]
    frames = []
    summary = []
    for row in range(4):
        for column in range(6):
            box = (COLUMNS[column], ROWS[row], COLUMNS[column + 1], ROWS[row + 1])
            frame = frame_data(image, box, True, HEADS[row][column])
            # 头点须落在整个保守掩码单元内，不能只保证单个源像素可见。
            mx = min(frame["maskWidth"] - 1, frame["headX"] * frame["maskWidth"] // frame["w"])
            my = min(frame["maskHeight"] - 1, frame["headY"] * frame["maskHeight"] // frame["h"])
            runs = frame["rowsRLE"][my]
            if not any(runs[i] <= mx < runs[i + 1] for i in range(0, len(runs), 2)):
                raise ValueError(f"头部锚点未通过保守透明掩码：{row}/{column}")
            frames.append(frame)
            summary.append({
                "frame": row * 6 + column,
                "身份": ("男" if row in (0, 2) else "女") + str(column + 1),
                "姿势": "坐姿" if row < 2 else "站姿",
                "源裁剪": [frame["x"], frame["y"], frame["w"], frame["h"]],
                "源头点": list(HEADS[row][column]),
                "局部头点": [frame["headX"], frame["headY"]],
            })
    output = ROOT / "public/assets/motion-4"
    output.mkdir(parents=True, exist_ok=True)
    target = output / "peopleC.webp"
    image.save(target, "WEBP", lossless=True, quality=100, method=6, exact=True)
    decoded = Image.open(target).convert("RGBA")
    if decoded.size != image.size or decoded.tobytes() != image.tobytes():
        raise ValueError("无损 WebP 与原图 RGBA 像素不一致。")
    asset = {"peopleC": {"url": "assets/motion-4/peopleC.webp", "width": image.width, "height": image.height, "frames": frames}}
    header = '''// 此文件由 scripts/prepare-motion-assets.py 生成，仅增加第四版人物素材。
// 帧0—5男坐姿、6—11女坐姿、12—17男站姿、18—23女站姿；同列为同一身份。
export interface MotionPhotoFrame {
  x: number; y: number; w: number; h: number;
  maskWidth: number; maskHeight: number;
  rowsRLE: readonly (readonly number[])[];
  headX: number; headY: number;
}
export const MOTION_PHOTO_ASSETS: Readonly<Record<"peopleC", {
  url: string; width: number; height: number;
  frames: readonly MotionPhotoFrame[];
}>> = '''
    (ROOT / "src/render/motion-photo-assets.ts").write_text(header + json.dumps(asset, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    original_digest = preserve_and_extend_registry()
    (output / "source-frames.json").write_text(json.dumps({
        "原始文件": args.people.name,
        "像素尺寸": list(SOURCE_SIZE),
        "行边界": ROWS,
        "列边界": COLUMNS,
        "裁剪透明度阈值": 16,
        "拾取透明度阈值": 128,
        "旧五素材元数据SHA256": original_digest,
        "帧": summary,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"peopleC：{image.width}×{image.height}，24帧、12身份，{target.stat().st_size:,}字节，RGBA逐像素无损验证通过。")
    print(f"原五素材元数据保持不变：{original_digest}")
    print("源头点：" + json.dumps(HEADS))


if __name__ == "__main__":
    main()
