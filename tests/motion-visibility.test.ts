import test from "node:test";
import assert from "node:assert/strict";
import { makeConfig } from "./legacy-config.js";
import { buildPlan } from "../src/engine/schedule.js";
import { contains, sceneGeometry } from "../src/render/geometry.js";
import type { DrawOp } from "../src/render/geometry.js";
import type { PlannedEvent } from "../src/engine/types.js";

const plan = buildPlan(makeConfig("morning-01", "standard"));

function eventFor(kind: PlannedEvent["kind"], variant: number): PlannedEvent {
  const event = plan.events.find(
    (e) => e.kind === kind && e.variant === variant,
  );
  assert.ok(event, `固定种子缺少 ${kind}/${variant}`);
  return event;
}

function propFor(
  event: PlannedEvent,
  tick: number,
): { ops: DrawOp[]; prop: DrawOp; index: number } {
  const { ops } = sceneGeometry(plan, tick, event.scene);
  const index = ops.findIndex((op) => {
    if (op.actorId === undefined || !event.actors.includes(op.actorId))
      return false;
    if (event.kind === "peeking") return op.stroke === "#30383a";
    return op.fill === (event.kind === "device" ? "#62c9d2" : "#f1ca61");
  });
  assert.ok(index >= 0, `${event.id}/${tick} 缺少实际绘制的违规物品或抄写笔`);
  return { ops, prop: ops[index], index };
}

function middlePoints(prop: DrawOp): { x: number; y: number }[] {
  const shape = prop.shape;
  if (shape.kind === "line") {
    return [
      {
        x: (shape.points[0] + shape.points.at(-2)!) / 2,
        y: (shape.points[1] + shape.points.at(-1)!) / 2,
      },
    ];
  }
  let x: number, y: number, width: number, height: number;
  if (shape.kind === "poly") {
    const xs = shape.points.filter((_, i) => i % 2 === 0);
    const ys = shape.points.filter((_, i) => i % 2 === 1);
    x = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    y = ys.reduce((sum, value) => sum + value, 0) / ys.length;
    width = Math.max(...xs) - Math.min(...xs);
    height = Math.max(...ys) - Math.min(...ys);
  } else if (shape.kind === "rect") {
    x = shape.x + shape.w / 2;
    y = shape.y + shape.h / 2;
    width = shape.w;
    height = shape.h;
  } else {
    assert.fail("违规物品应使用可检查的可见填充面");
  }
  return [
    { x, y },
    { x: x - width * 0.15, y },
    { x: x + width * 0.15, y },
    { x, y: y - height * 0.15 },
    { x, y: y + height * 0.15 },
  ].filter((point) => contains(prop, point.x, point.y));
}

function coveringImage(
  ops: readonly DrawOp[],
  propIndex: number,
  point: { x: number; y: number },
): DrawOp | undefined {
  // 材料上的文字或折痕不是遮挡；后画照片则会真正盖住材料，即使 actorId 相同。
  return ops
    .slice(propIndex + 1)
    .find(
      (op) =>
        op.shape.kind === "image" &&
        op.blocks !== false &&
        contains(op, point.x, point.y),
    );
}

test("固定传纸与公共区交换的整个有效窗口都能看见材料中部，不被后画桌面或人体藏住", () => {
  for (const [kind, variant] of [
    ["passing", 0],
    ["restroom", 1],
  ] as const) {
    const event = eventFor(kind, variant);
    for (let tick = event.start; tick < event.end; tick++) {
      const { ops, prop, index } = propFor(event, tick);
      const points = middlePoints(prop);
      assert.ok(
        points.length >= 3,
        `${event.id}/${tick} 材料填充面不足以检查中部可见性`,
      );
      // 这两处交接把纸放在前景手上，中心不应落到接收者整身照片或桌面之后。
      assert.equal(
        coveringImage(ops, index, points[0]),
        undefined,
        `${event.id}/${tick} 交接材料中心被后画照片盖住`,
      );
      const visible = points.filter(
        (point) => !coveringImage(ops, index, point),
      );
      assert.ok(
        visible.length > 0,
        `${event.id}/${tick} 的材料中部全部被后画照片遮住，不能只凭人物可点击判为可辨认`,
      );
    }
  }
});

test("其他八种固定动作在有效窗口开始、中段和末尾的关键物品中心可见", () => {
  for (const kind of [
    "device",
    "notes",
    "peeking",
    "passing",
    "restroom",
  ] as const)
    for (const variant of [0, 1]) {
      if (
        (kind === "passing" && variant === 0) ||
        (kind === "restroom" && variant === 1)
      )
        continue;
      const event = eventFor(kind, variant);
      for (const tick of [
        event.start,
        Math.floor((event.start + event.end) / 2),
        event.end - 1,
      ]) {
        const { ops, prop, index } = propFor(event, tick);
        const center = middlePoints(prop)[0];
        assert.ok(center && contains(prop, center.x, center.y));
        assert.equal(
          coveringImage(ops, index, center),
          undefined,
          `${kind}/${variant}/${tick} 关键物品中心被照片盖住`,
        );
      }
    }
});
