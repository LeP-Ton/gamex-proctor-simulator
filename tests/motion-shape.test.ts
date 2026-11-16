import test from "node:test";
import assert from "node:assert/strict";
import { PRESET_SEEDS } from "../src/engine/config.js";
import { makeConfig } from "./legacy-config.js";
import { buildPlan } from "../src/engine/schedule.js";
import { sceneGeometry } from "../src/render/geometry.js";
import type { ImageShape } from "../src/render/geometry.js";
import { containsPhoto } from "../src/render/photo-assets.js";
import { meshPoint } from "../src/render/photo-mesh.js";
import type { Plan, PlannedEvent } from "../src/engine/types.js";

const plans = [
  buildPlan(makeConfig("morning-01", "standard")),
  ...PRESET_SEEDS.map(({ id }) => buildPlan(makeConfig(id, "pressure"))),
];
const kinds = ["device", "notes", "peeking", "passing", "restroom"] as const;
const snapshots = new Map<string, ReadonlyMap<number, ImageShape>>();

function people(
  planIndex: number,
  tick: number,
  scene: number,
): ReadonlyMap<number, ImageShape> {
  const key = `${planIndex}/${tick}/${scene}`;
  const saved = snapshots.get(key);
  if (saved) return saved;
  const result = new Map<number, ImageShape>();
  for (const op of sceneGeometry(plans[planIndex], tick, scene).ops)
    if (
      op.shape.kind === "image" &&
      op.shape.role === "person" &&
      op.shape.mesh &&
      op.actorId !== undefined
    )
      result.set(op.actorId, op.shape);
  snapshots.set(key, result);
  return result;
}

function representative(
  plan: Plan,
  kind: PlannedEvent["kind"],
  variant: number,
): PlannedEvent {
  const event = plan.events.find(
    (candidate) => candidate.kind === kind && candidate.variant === variant,
  );
  assert.ok(
    event,
    `${plan.config.seed}/${plan.config.difficulty} 缺少 ${kind}/${variant}`,
  );
  return event;
}

function cross(
  data: readonly number[],
  a: number,
  b: number,
  c: number,
): number {
  return (
    (data[b * 2] - data[a * 2]) * (data[c * 2 + 1] - data[a * 2 + 1]) -
    (data[b * 2 + 1] - data[a * 2 + 1]) * (data[c * 2] - data[a * 2])
  );
}

test("固定种子与五个高压预设的十种动作关键时刻，实际照片网格保持源三角朝向且不塌陷", () => {
  for (let planIndex = 0; planIndex < plans.length; planIndex++) {
    const plan = plans[planIndex];
    for (const kind of kinds)
      for (const variant of [0, 1]) {
        const event = representative(plan, kind, variant);
        for (const tick of [
          event.start,
          Math.floor((event.start + event.end) / 2),
          event.end - 1,
        ]) {
          const shapes = people(planIndex, tick, event.scene);
          assert.ok(
            event.actors.every((id) => shapes.has(id)),
            "有效动作参与者应实际出现在画面中",
          );
          // 同机位的正常活动也必须检查，思考与归还文具曾造成非目标人物的手部翻面。
          for (const [actorId, shape] of shapes) {
            const mesh = shape.mesh!;
            for (let i = 0; i < mesh.triangles.length; i += 3) {
              const a = mesh.triangles[i],
                b = mesh.triangles[i + 1],
                c = mesh.triangles[i + 2];
              const sourceArea = cross(mesh.uv, a, b, c);
              const visibleArea = cross(mesh.xy, a, b, c);
              if (sourceArea * visibleArea <= 1e-8) {
                const u =
                  (mesh.uv[a * 2] + mesh.uv[b * 2] + mesh.uv[c * 2]) / 3;
                const v =
                  (mesh.uv[a * 2 + 1] +
                    mesh.uv[b * 2 + 1] +
                    mesh.uv[c * 2 + 1]) /
                  3;
                const opaque = containsPhoto(
                  {
                    asset: shape.asset,
                    frame: shape.frame,
                    x: 0,
                    y: 0,
                    w: 1,
                    h: 1,
                  },
                  u,
                  v,
                );
                assert.fail(
                  `${plan.config.seed}/${plan.config.difficulty}/${event.id}/${tick} 人物${actorId}三角${i / 3}在${opaque ? "不透明纹理" : "透明边界"}处翻面或塌陷`,
                );
              }
            }
          }
        }
      }
  }
});

test("动作进出、有效窗口与相邻模拟tick的真实手部网格没有突跳", () => {
  for (let planIndex = 0; planIndex < plans.length; planIndex++) {
    const plan = plans[planIndex];
    for (const kind of kinds)
      for (const variant of [0, 1]) {
        const event = representative(plan, kind, variant);
        const ticks = new Set([
          event.prepare - 1,
          event.prepare,
          event.start - 1,
          event.start,
          Math.floor((event.start + event.end) / 2),
          event.end - 1,
          event.end,
          event.end + 1,
        ]);
        for (const tick of ticks) {
          if (tick < 0 || tick + 1 >= plan.config.duration) continue;
          const before = people(planIndex, tick, event.scene);
          const after = people(planIndex, tick + 1, event.scene);
          for (const [actorId, shape] of before) {
            const next = after.get(actorId);
            if (!next) continue;
            assert.equal(
              next.asset,
              shape.asset,
              "同一角色相邻tick不能换身份底片",
            );
            assert.equal(
              next.frame,
              shape.frame,
              "同一场景的连续动作不能硬切姿态帧",
            );
            const wristY = shape.asset === "peopleC" ? 0.55 : 0.5;
            const handU = shape.asset === "peopleC" ? 0.41 : 0.35;
            const anchor = meshPoint(shape.mesh!, 0.5, 0.72)!;
            const nextAnchor = meshPoint(next.mesh!, 0.5, 0.72)!;
            for (const u of [handU, 1 - handU]) {
              const hand = meshPoint(shape.mesh!, u, wristY)!;
              const nextHand = meshPoint(next.mesh!, u, wristY)!;
              // 公共区正常行走的整身平移不算手部拉扯，比较手相对髋部的局部位移。
              const displacement = Math.hypot(
                nextHand.x - nextAnchor.x - (hand.x - anchor.x),
                nextHand.y - nextAnchor.y - (hand.y - anchor.y),
              );
              assert.ok(
                displacement < 4,
                `${plan.config.seed}/${event.id}/${tick} 人物${actorId}手部相邻tick突跳${displacement.toFixed(2)}世界单位`,
              );
              if (event.scene < 4) {
                const absolute = Math.hypot(
                  nextHand.x - hand.x,
                  nextHand.y - hand.y,
                );
                assert.ok(
                  absolute < 4,
                  `${plan.config.seed}/${event.id}/${tick} 坐姿手部绝对位置突跳${absolute.toFixed(2)}世界单位`,
                );
              }
            }
          }
        }
      }
  }
});
