import test from "node:test";
import assert from "node:assert/strict";
import {
  BALANCE,
  DIFFICULTIES,
  makeConfig,
  PRESET_SEEDS,
  seconds,
} from "../src/engine/config.js";
import type { Difficulty } from "../src/engine/config.js";
import { buildPlan, validatePlan } from "../src/engine/schedule.js";
import { Game, accuracy, detectionRate, replayAt } from "../src/engine/game.js";
import { actorViews, personScene, seatPosition } from "../src/engine/world.js";
import { buildTutorialPlan } from "../src/engine/tutorial.js";
import {
  clientToWorld,
  contains,
  fitWorld,
  pick,
  pickWithProtection,
  sceneGeometry,
} from "../src/render/geometry.js";
import type { DrawOp } from "../src/render/geometry.js";
import { LocalStore, conditionKey } from "../src/storage.js";
import type { Plan, RunRecord } from "../src/engine/types.js";

const plan = buildPlan(makeConfig());
const difficulties = Object.keys(DIFFICULTIES) as Difficulty[];
function pointFor(
  ops: DrawOp[],
  actorId: number,
): { x: number; y: number } | undefined {
  for (const op of ops.filter((o) => o.actorId === actorId)) {
    const s = op.shape;
    const p =
      s.kind === "rect"
        ? { x: s.x + s.w / 2, y: s.y + s.h / 2 }
        : s.kind === "ellipse"
          ? { x: s.x, y: s.y }
          : s.kind === "poly" || s.kind === "line"
            ? {
                x: (s.points[0] + s.points[2]) / 2,
                y: (s.points[1] + s.points[3]) / 2,
              }
            : undefined;
    if (p && pick(ops, p.x, p.y) === actorId) return p;
  }
}

test("三档难度 × 五预设及 100 个额外种子：总数、窗口、并发、预算与行程约束", () => {
  for (const difficulty of difficulties) {
    for (const seed of [
      ...PRESET_SEEDS.map((s) => s.id),
      ...Array.from({ length: 100 }, (_, i) => `constraint-${i}`),
    ]) {
      const p = buildPlan(makeConfig(seed, difficulty));
      assert.deepEqual(validatePlan(p), [], `${difficulty} / ${seed}`);
      assert.equal(p.people.length, 48);
      assert.equal(new Set(p.events.map((e) => e.id)).size, p.events.length);
      for (const kind of [
        "device",
        "notes",
        "peeking",
        "passing",
        "restroom",
      ]) {
        assert.ok(p.events.some((e) => e.kind === kind));
      }
      for (let scene = 4; scene < 6; scene++)
        assert.ok(p.visits.some((v) => v.scene === scene && !v.eventId));
    }
  }
});

test("所有预设计分机会在开始、中段和最后有效 tick 都有实际可见且可拾取的人物", () => {
  for (const difficulty of difficulties)
    for (const seed of PRESET_SEEDS.map((s) => s.id)) {
      const p = buildPlan(makeConfig(seed, difficulty));
      for (const event of p.events)
        for (const t of [
          event.start,
          Math.floor((event.start + event.end) / 2),
          event.end - 1,
        ]) {
          const { ops, actors } = sceneGeometry(p, t, event.scene);
          for (const id of event.actors) {
            assert.ok(actors.some((a) => a.person.id === id));
            assert.ok(pointFor(ops, id), `${event.id} / ${id} 没有可见命中区`);
          }
        }
    }
});

test("人物公共区行程唯一，考场离座、连接时间和返回状态一致", () => {
  for (const visit of plan.visits) {
    const person = plan.people[visit.actorId];
    assert.equal(personScene(plan, person, visit.depart), -1);
    assert.equal(personScene(plan, person, visit.arrive), visit.scene);
    assert.equal(personScene(plan, person, visit.exit), -1);
    assert.equal(personScene(plan, person, visit.returned), person.room);
    for (const tick of [
      visit.depart,
      visit.arrive,
      visit.exit,
      visit.returned,
    ]) {
      assert.ok(
        actorViews(plan, tick).filter((a) => a.person.id === person.id)
          .length <= 1,
      );
    }
  }
});

test("开始包含、结束不包含；准备阶段、结束之后都不会提前或延迟得分", () => {
  const e = plan.events[0];
  const early = new Game(plan);
  early.advanceTo(e.start - 1);
  early.report(e.scene, e.actors[0]);
  assert.equal(early.score.false, 1);
  assert.equal(early.score.caught, 0);
  assert.match(early.records[0].reason, /举报过早/);
  const atStart = new Game(plan);
  atStart.advanceTo(e.start);
  atStart.report(e.scene, e.actors[0]);
  assert.equal(atStart.score.caught, 1);
  const last = new Game(plan);
  last.advanceTo(e.end - 1);
  last.report(e.scene, e.actors[0]);
  assert.equal(last.score.caught, 1);
  const atEnd = new Game(plan);
  atEnd.advanceTo(e.end);
  atEnd.report(e.scene, e.actors[0]);
  assert.equal(atEnd.score.caught, 0);
  assert.equal(atEnd.score.missed, 1);
  assert.equal(atEnd.score.false, 1);
  assert.match(atEnd.records.at(-1)!.reason, /举报过晚/);
});

test("重复点击、多人事件与结束检查只能产生一次正确计分", () => {
  const e = plan.events.find((e) => e.actors.length > 1)!;
  const g = new Game(plan);
  g.advanceTo(e.start);
  g.report(e.scene, e.actors[0]);
  g.report(e.scene, e.actors[0]);
  g.report(e.scene, e.actors[1]);
  assert.equal(g.score.caught, 1);
  assert.equal(g.score.false, 0);
  assert.equal(g.records.filter((r) => r.eventId === e.id).length, 1);
  g.advanceTo(e.end);
  assert.ok(!g.missed.has(e.id));
  assert.equal(g.records.filter((r) => r.eventId === e.id).length, 1);
});

test("0.5 秒保护结束后重复人物可误报，但同 tick 不影响另一机位", () => {
  const p = buildPlan(makeConfig("same-tick", "pressure"));
  const first = p.events.find((e) =>
    p.events.some(
      (o) => o.id !== e.id && o.start <= e.start && e.start < o.end,
    ),
  )!;
  const other = p.events.find(
    (o) => o.id !== first.id && o.start <= first.start && first.start < o.end,
  )!;
  const g = new Game(p);
  g.advanceTo(first.start);
  g.report(first.scene, first.actors[0]);
  g.report(other.scene, other.actors[0]);
  assert.equal(g.score.caught, 2);
  g.advanceTo(first.start + BALANCE.repeatProtection);
  g.report(first.scene, first.actors[0]);
  assert.equal(g.score.false, 1);
});

test("误报冷却只影响对应机位，不缓存点击，边界恢复有效", () => {
  const g = new Game(plan);
  g.report(0, null);
  g.report(0, null);
  g.report(1, null);
  assert.equal(g.score.false, 2);
  assert.equal(g.inputs.length, 3);
  g.advanceTo(BALANCE.falseCooldown - 1);
  g.report(0, null);
  assert.equal(g.score.false, 2);
  g.step();
  g.report(0, null);
  assert.equal(g.score.false, 3);
  assert.equal(g.records.length, 3);
});

test("每次正确先增加连击再计算倍率；漏查清空连击且罚分不乘倍率", () => {
  const g = new Game(plan);
  for (const e of plan.events) {
    g.advanceTo(e.start);
    g.report(e.scene, e.actors[0]);
  }
  g.advanceTo(plan.config.duration);
  assert.equal(g.score.caught, plan.events.length);
  assert.equal(g.score.missed, 0);
  assert.equal(
    g.score.total,
    4 * 100 + 5 * 120 + (plan.events.length - 9) * 150,
  );
  assert.equal(g.score.maxCombo, plan.events.length);
  assert.equal(g.multiplier, 1.5);
  const missed = new Game(plan);
  missed.advanceTo(plan.config.duration);
  assert.equal(missed.score.total, -100 * plan.events.length);
  assert.equal(missed.score.combo, 0);
  assert.equal(missed.score.missed + missed.score.caught, plan.events.length);
});

test("可见性拾取遵守逆绘制顺序，家具阻挡人物，普通试卷不能穿透命中", () => {
  const body: DrawOp = {
    shape: { kind: "rect", x: 0, y: 0, w: 30, h: 30 },
    fill: "#fff",
    actorId: 1,
  };
  const desk: DrawOp = {
    shape: { kind: "rect", x: 0, y: 15, w: 30, h: 20 },
    fill: "#aaa",
  };
  assert.equal(pick([body, desk], 10, 10), 1);
  assert.equal(pick([body, desk], 10, 20), null);
  assert.equal(pick([body, { ...body, actorId: 2 }], 10, 10), 2);
  assert.equal(
    contains(
      { shape: { kind: "line", points: [0, 0, 20, 0] }, width: 8 },
      10,
      3.9,
    ),
    true,
  );
  assert.equal(
    contains(
      { shape: { kind: "ellipse", x: 10, y: 10, rx: 5, ry: 5 } },
      16,
      10,
    ),
    false,
  );
  const { ops } = sceneGeometry(plan, 0, 0);
  const pos = seatPosition(plan.people[0]);
  assert.equal(pick(ops, pos.x + 30, pos.y + 31), null);
  for (const size of [
    { width: 440, height: 256 },
    { width: 900, height: 525 },
    { width: 391, height: 228 },
  ]) {
    const p = clientToWorld(50 + size.width * 0.5, 70 + size.height * 0.5, {
      left: 50,
      top: 70,
      ...size,
    });
    assert.ok(Math.abs(p.x - 300) < 0.0001 && Math.abs(p.y - 175) < 0.0001);
  }
  const fit = fitWorld(1172, 254);
  const roundTrip = clientToWorld(
    20 + fit.offsetX + 356 * fit.scale,
    30 + fit.offsetY + 210 * fit.scale,
    { left: 20, top: 30, width: 1172, height: 254 },
  );
  assert.ok(
    Math.abs(roundTrip.x - 356) < 0.0001 &&
      Math.abs(roundTrip.y - 210) < 0.0001,
  );
  assert.equal(
    contains(
      { shape: { kind: "rect", x: 0, y: 0, w: 20, h: 20, radius: 5 } },
      0,
      0,
    ),
    false,
  );
});

test("五类事件两个变体都有区别于正常与准备的物品或组合姿势", () => {
  const plans = Array.from({ length: 8 }, (_, i) =>
    buildPlan(makeConfig(`visual-${i}`, "pressure")),
  );
  for (const kind of ["device", "notes", "peeking", "passing", "restroom"])
    for (let variant = 0; variant < 2; variant++) {
      const p = plans.find((p) =>
        p.events.some((e) => e.kind === kind && e.variant === variant),
      )!;
      const e = p.events.find((e) => e.kind === kind && e.variant === variant)!;
      const active = sceneGeometry(p, e.start + 1, e.scene).ops.filter(
        (o) => o.actorId === e.actors[0],
      );
      const prepare = sceneGeometry(p, e.start - 1, e.scene).ops.filter(
        (o) => o.actorId === e.actors[0],
      );
      if (kind === "peeking") {
        const person = p.people[e.actors[0]];
        const pos = seatPosition(person);
        assert.ok(
          active.some(
            (o) =>
              o.shape.kind === "ellipse" &&
              o.shape.rx === 12 &&
              Math.abs(o.shape.x - pos.x) === 28,
          ),
        );
      } else {
        const color = kind === "device" ? "#62c9d2" : "#f1ca61";
        assert.ok(
          active.some((o) => o.fill === color),
          `${kind}/${variant}`,
        );
        assert.ok(!prepare.some((o) => o.fill === color));
      }
    }
});

test("物品收起后的原位置重复输入也受保护，其他可见人物优先且保护严格到期", () => {
  const item: DrawOp = {
    shape: { kind: "rect", x: 10, y: 10, w: 20, h: 20 },
    fill: "#fff",
    actorId: 1,
  };
  const empty: DrawOp = {
    shape: { kind: "rect", x: 0, y: 0, w: 60, h: 60 },
    fill: "#aaa",
  };
  const protection = new Map([[1, 10]]);
  assert.equal(
    pickWithProtection([empty], [empty, item], protection, 9, 15, 15),
    1,
  );
  assert.equal(
    pickWithProtection([empty], [empty, item], protection, 10, 15, 15),
    null,
  );
  assert.equal(
    pickWithProtection(
      [empty, { ...item, actorId: 2 }],
      [empty, item],
      protection,
      9,
      15,
      15,
    ),
    2,
  );
  assert.equal(
    pickWithProtection([empty], [empty, item], protection, 9, 45, 45),
    null,
  );
});

test("同种子、配置及输入完全复现；观察几何与渲染采样不消耗计分随机数", () => {
  assert.deepEqual(buildPlan(plan.config), plan);
  const original = JSON.stringify(plan);
  for (const tick of [0, 23, 177, 3300, 7199])
    for (let scene = 0; scene < 6; scene++) sceneGeometry(plan, tick, scene);
  assert.equal(JSON.stringify(plan), original);
  const g = new Game(plan);
  for (const e of plan.events.filter((_, i) => i % 3 !== 0)) {
    g.advanceTo(e.start + 2);
    g.report(e.scene, e.actors[0], 100, 110);
  }
  g.advanceTo(plan.config.duration);
  const replay = replayAt(plan, g.inputs, plan.config.duration);
  assert.deepEqual(replay.score, g.score);
  assert.deepEqual(replay.records, g.records);
  const snapshot = JSON.stringify({ score: g.score, plan, inputs: g.inputs });
  replayAt(plan, g.inputs, 100);
  replayAt(plan, g.inputs, 5000);
  assert.equal(
    JSON.stringify({ score: g.score, plan, inputs: g.inputs }),
    snapshot,
  );
});

test("完整六分钟模拟：所有事件唯一结算，成绩指标定义正确", () => {
  const g = new Game(plan);
  while (!g.ended) g.step();
  assert.equal(g.tick, seconds(360));
  assert.equal(g.score.missed, plan.events.length);
  g.step();
  assert.equal(g.tick, seconds(360));
  assert.equal(accuracy(g.score), null);
  assert.equal(detectionRate(g.score, 0), null);
  assert.equal(accuracy({ ...g.score, caught: 3, false: 1 }), 0.75);
  assert.equal(detectionRate({ ...g.score, caught: 12 }, 48), 0.25);
});

test("本地记录最近十局，最佳按种子、难度、时长、版本、布局、辅助分别隔离", () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
  };
  const local = new LocalStore(storage);
  const run: RunRecord = {
    id: "a",
    date: "2026-11-13T05:00:00.000Z",
    config: plan.config,
    plan,
    score: new Game(plan).score,
    eventCount: plan.events.length,
    inputs: [],
    pauses: [],
  };
  local.saveRun(run);
  for (const change of [
    { seed: "b" },
    { difficulty: "beginner" as const },
    { duration: 12 },
    { ruleVersion: "next" },
    { layout: "practice" as const },
    { debug: true },
  ]) {
    assert.notEqual(
      conditionKey({ ...run, config: { ...run.config, ...change } }),
      conditionKey(run),
    );
  }
  for (let i = 0; i < 15; i++)
    local.saveRun({ ...run, id: String(i), score: { ...run.score, total: i } });
  assert.equal(local.data.recent.length, 10);
  assert.equal(local.data.best[conditionKey(run)], 14);
  const loaded = new LocalStore(storage);
  assert.equal(loaded.data.recent.length, 10);
  const broken = new LocalStore({
    getItem: () => "{",
    setItem: () => {
      throw new Error("存储已满");
    },
  });
  assert.equal(broken.available, false);
  assert.doesNotThrow(() => broken.saveRun(run));
});

test("渐进教学使用两路、四路、六路真实事件并有并发演示和正常来访", () => {
  const tutorial = buildTutorialPlan();
  assert.equal(tutorial.events.length, 8);
  assert.ok(
    tutorial.events
      .filter((e) => e.start < seconds(36))
      .every((e) => e.scene < 2),
  );
  assert.ok(
    tutorial.events
      .filter((e) => e.start < seconds(77))
      .every((e) => e.scene < 4),
  );
  assert.ok(
    tutorial.events.some((e, i) =>
      tutorial.events.slice(i + 1).some((o) => e.start === o.start),
    ),
  );
  for (const e of tutorial.events)
    for (const id of e.actors) {
      const { ops } = sceneGeometry(tutorial, e.start, e.scene);
      assert.ok(pointFor(ops, id));
    }
  assert.ok(tutorial.visits.some((v) => !v.eventId));
});
