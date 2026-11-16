import test from "node:test";
import assert from "node:assert/strict";
import {
  containsPhoto,
  PHOTO_ASSETS,
  photoHead,
} from "../src/render/photo-assets.js";
import type { PhotoImageShape } from "../src/render/photo-assets.js";

const peopleAssets = ["people", "peopleB", "peopleC"] as const;

test("56 张人物帧的真实头部在正向和镜像中均可命中，透明四角不命中", () => {
  for (const asset of peopleAssets) {
    const frameCount = asset === "peopleC" ? 24 : 16;
    assert.equal(PHOTO_ASSETS[asset].frames.length, frameCount);
    for (let frame = 0; frame < frameCount; frame++) {
      const metadata = PHOTO_ASSETS[asset].frames[frame];
      assert.ok(metadata.headX !== undefined && metadata.headY !== undefined);
      for (const flipX of [false, true]) {
        const shape: PhotoImageShape = {
          asset,
          frame,
          x: 47,
          y: 83,
          w: metadata.w * 0.19,
          h: metadata.h * 0.19,
          flipX,
        };
        const head = photoHead(shape);
        assert.equal(
          containsPhoto(shape, head.x, head.y),
          true,
          `${asset}/${frame}/${flipX} 的头部不在真实不透明像素上`,
        );
        for (const u of [0.005, 0.995])
          for (const v of [0.005, 0.995])
            assert.equal(
              containsPhoto(
                shape,
                shape.x + u * shape.w,
                shape.y + v * shape.h,
              ),
              false,
              `${asset}/${frame}/${flipX} 的透明角落被误当作身体`,
            );
        assert.equal(containsPhoto(shape, shape.x - 0.01, head.y), false);
        assert.equal(containsPhoto(shape, shape.x + shape.w, head.y), false);
        assert.equal(containsPhoto(shape, head.x, shape.y + shape.h), false);
      }
    }
  }
});

test("照片透明拾取在非等比缩放、平移和镜像后保持同一源像素结果", () => {
  for (const asset of peopleAssets)
    for (let frame = 0; frame < PHOTO_ASSETS[asset].frames.length; frame++) {
      const metadata = PHOTO_ASSETS[asset].frames[frame];
      const original: PhotoImageShape = {
        asset,
        frame,
        x: 0,
        y: 0,
        w: metadata.w,
        h: metadata.h,
      };
      for (const flipX of [false, true]) {
        const transformed: PhotoImageShape = {
          ...original,
          x: 133.25,
          y: -27.5,
          w: metadata.w * 0.237,
          h: metadata.h * 0.181,
          flipX,
        };
        for (let iy = 0; iy < 17; iy++)
          for (let ix = 0; ix < 17; ix++) {
            // 取真实掩码格中心，避免恰好位于像素边界时的浮点舍入歧义。
            const u =
              (Math.floor(((ix + 0.5) / 17) * metadata.maskWidth) + 0.5) /
              metadata.maskWidth;
            const v =
              (Math.floor(((iy + 0.5) / 17) * metadata.maskHeight) + 0.5) /
              metadata.maskHeight;
            const expected = containsPhoto(
              original,
              u * metadata.w,
              v * metadata.h,
            );
            assert.equal(
              containsPhoto(
                transformed,
                transformed.x + (flipX ? 1 - u : u) * transformed.w,
                transformed.y + v * transformed.h,
              ),
              expected,
              `${asset}/${frame}/${flipX} 在 ${u},${v} 的变换结果不一致`,
            );
          }
      }
    }
});

test("照片家具仅实体部分阻挡，桌腿和椅背的真实镂空保持透明", () => {
  for (const frame of [0, 1]) {
    const shape: PhotoImageShape = {
      asset: "furniture",
      frame,
      x: 100,
      y: 50,
      w: 90,
      h: 87,
    };
    assert.equal(
      containsPhoto(shape, 145, 50 + 87 * 0.35),
      true,
      "桌面应阻挡后方人物",
    );
    assert.equal(
      containsPhoto(shape, 145, 50 + 87 * 0.85),
      false,
      "桌腿之间应能看见后方内容",
    );
  }
  for (const frame of [2, 3]) {
    const shape: PhotoImageShape = {
      asset: "furniture",
      frame,
      x: 100,
      y: 50,
      w: 45,
      h: 76,
    };
    assert.equal(
      containsPhoto(shape, 122.5, 50 + 76 * 0.15),
      true,
      "椅背木板应阻挡",
    );
    assert.equal(
      containsPhoto(shape, 122.5, 50 + 76 * 0.35),
      false,
      "椅背与坐垫之间应保持镂空",
    );
    assert.equal(
      containsPhoto(shape, 122.5, 50 + 76 * 0.65),
      true,
      "椅子坐垫应阻挡",
    );
  }
});
