import test from "node:test";
import assert from "node:assert/strict";
import {
  inArmRegion,
  meshBounds,
  meshPoint,
  meshUV,
} from "../src/render/photo-mesh.js";
import type { PhotoMesh } from "../src/render/photo-mesh.js";
import { containsPhoto, PHOTO_ASSETS } from "../src/render/photo-assets.js";

function curvedMesh(mirrored = false): PhotoMesh {
  const uv: number[] = [],
    xy: number[] = [],
    triangles: number[] = [];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) {
      const u = col / 2,
        v = row / 2;
      uv.push(u, v);
      xy.push(
        100 + (mirrored ? 1 - u : u) * 67 + (1 - v) * 13,
        40 + v * 109 + Math.sin(u * Math.PI) * (1 - v) * 3,
      );
    }
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 2; col++) {
      const a = row * 3 + col;
      triangles.push(a, a + 1, a + 4, a, a + 4, a + 3);
    }
  return { uv, xy, triangles };
}

test("连续网格在弯曲、非等比缩放与镜像后可逆，三角公共边没有拾取空洞", () => {
  for (const mirrored of [false, true]) {
    const mesh = curvedMesh(mirrored);
    for (let y = 0; y <= 20; y++)
      for (let x = 0; x <= 20; x++) {
        const u = x / 20,
          v = y / 20;
        const point = meshPoint(mesh, u, v);
        assert.ok(point);
        const recovered = meshUV(mesh, point.x, point.y);
        assert.ok(recovered);
        assert.ok(Math.abs(recovered.u - u) < 1e-7);
        assert.ok(Math.abs(recovered.v - v) < 1e-7);
      }
    const bounds = meshBounds(mesh);
    assert.ok(bounds.w >= 67 && bounds.h >= 109);
    assert.equal(meshUV(mesh, bounds.x - 0.1, bounds.y), undefined);
    assert.equal(meshPoint(mesh, -0.01, 0.5), undefined);
  }
});

test("变形后的32个人物仍按源照片透明度拾取，真实头部可点且透明角落不变实心", () => {
  for (const asset of ["people", "peopleB"] as const)
    for (let frame = 0; frame < 16; frame++) {
      const data = PHOTO_ASSETS[asset].frames[frame];
      const photo = { asset, frame, x: 0, y: 0, w: 1, h: 1 };
      for (const mirrored of [false, true]) {
        const mesh = curvedMesh(mirrored);
        const head = meshPoint(
          mesh,
          data.headX! / data.w,
          data.headY! / data.h,
        )!;
        const recovered = meshUV(mesh, head.x, head.y)!;
        assert.equal(containsPhoto(photo, recovered.u, recovered.v), true);
        for (const u of [0.005, 0.995])
          for (const v of [0.005, 0.995]) {
            const point = meshPoint(mesh, u, v)!;
            const original = meshUV(mesh, point.x, point.y)!;
            assert.equal(containsPhoto(photo, original.u, original.v), false);
          }
      }
    }
});

test("桌前图层只包含前臂和手，头部、胸口、腿和图框四角不会重复贴在桌上", () => {
  assert.equal(inArmRegion(0.32, 0.49), true);
  assert.equal(inArmRegion(0.68, 0.49), true);
  for (const [u, v] of [
    [0.5, 0.1],
    [0.5, 0.35],
    [0.5, 0.75],
    [0, 0],
    [1, 1],
  ])
    assert.equal(inArmRegion(u, v), false);
  for (let y = 0; y <= 30; y++)
    for (let x = 0; x <= 30; x++)
      assert.equal(
        inArmRegion(x / 30, y / 30),
        inArmRegion(1 - x / 30, y / 30),
      );
});

test("退化或空网格不产生不可见命中区", () => {
  const empty: PhotoMesh = { uv: [], xy: [], triangles: [] };
  assert.equal(meshPoint(empty, 0.5, 0.5), undefined);
  assert.equal(meshUV(empty, 0, 0), undefined);
  assert.deepEqual(meshBounds(empty), { x: 0, y: 0, w: 0, h: 0 });
  const collapsed: PhotoMesh = {
    uv: [0, 0, 1, 0, 0, 1],
    xy: [10, 10, 10, 10, 10, 10],
    triangles: [0, 1, 2],
  };
  assert.equal(meshUV(collapsed, 10, 10), undefined);
});
