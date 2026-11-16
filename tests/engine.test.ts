import test from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import {
  BALANCE,
  DIFFICULTIES,
  makeConfig,
  PRESET_SEEDS,
  seconds,
  VISUAL_VERSION,
} from "../src/engine/config.js";
import type { Difficulty } from "../src/engine/config.js";
import { buildPlan, validatePlan } from "../src/engine/schedule.js";
import { Game, accuracy, detectionRate, replayAt } from "../src/engine/game.js";
import { actorViews, personScene, seatPosition } from "../src/engine/world.js";
import { buildTutorialPlan } from "../src/engine/tutorial.js";
import {
  clientToWorld,
  contains,
  projectPoint,
  fitWorld,
  pick,
  pickWithProtection,
  sceneGeometry,
} from "../src/render/geometry.js";
import type { DrawOp } from "../src/render/geometry.js";
import { sceneGeometry as monitorGeometry } from "../src/render/monitor-geometry.js";
import { sceneGeometry as photoGeometry } from "../src/render/photo-geometry.js";
import { containsPhoto, photoHead } from "../src/render/photo-assets.js";
import { LocalStore, SAVE_KEY, conditionKey } from "../src/storage.js";
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
      s.kind === "image"
        ? (s.head ?? photoHead(s))
        : s.kind === "rect"
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
  const deskPoint = projectPoint(0, pos.x + 30, pos.y + 31);
  assert.equal(pick(ops, deskPoint.x, deskPoint.y), null);
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
      const activeTick = kind === "peeking" ? e.start + seconds(0.2) : e.start + 1;
      const neutralTick = kind === "peeking" ? Math.max(0, e.prepare - 1) : e.start - 1;
      const active = sceneGeometry(p, activeTick, e.scene).ops.filter(
        (o) => o.actorId === e.actors[0],
      );
      const prepare = sceneGeometry(p, neutralTick, e.scene).ops.filter(
        (o) => o.actorId === e.actors[0],
      );
      if (kind === "peeking") {
        const person = p.people[e.actors[0]];
        const pos = seatPosition(person);
        const activePerson = active.find(
          (o) => o.shape.kind === "image" && o.shape.role === "person",
        )!.shape;
        const beforePerson = prepare.find(
          (o) => o.shape.kind === "image" && o.shape.role === "person",
        )!.shape;
        assert.ok(
          activePerson.kind === "image" && beforePerson.kind === "image",
        );
        const head = activePerson.head ?? photoHead(activePerson);
        const before = beforePerson.head ?? photoHead(beforePerson);
        const neighbor = seatPosition(p.people[e.relatedId!]);
        const paper = projectPoint(e.scene, neighbor.x, neighbor.y + 20);
        assert.ok(
          Math.abs(head.x - paper.x) < Math.abs(before.x - paper.x),
          "窥卷必须实际向邻卷探身",
        );
        assert.ok(
          Math.abs(head.x - projectPoint(e.scene, pos.x, pos.y).x) > 18,
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

test("照片人物的透明边缘不能举报，实际头部像素与左右翻转均可拾取", () => {
  for (const flipX of [false, true]) {
    const image: DrawOp = {
      shape: {
        kind: "image",
        asset: "people",
        frame: 0,
        x: 80,
        y: 40,
        w: 70,
        h: 130,
        flipX,
        role: "person",
      },
      actorId: 5,
    };
    assert.ok(image.shape.kind === "image");
    const head = photoHead(image.shape);
    assert.ok(containsPhoto(image.shape, head.x, head.y));
    assert.ok(contains(image, head.x, head.y));
    assert.equal(pick([image], head.x, head.y), 5);
    assert.equal(containsPhoto(image.shape, 80.1, 40.1), false);
    assert.equal(contains(image, 80.1, 40.1), false);
    assert.equal(pick([image], 80.1, 40.1), null);
    assert.equal(pick([image], 79, head.y), null);
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
    { visualVersion: "other-visual-version" },
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

test("视觉版本隔离新旧成绩，兼容旧最佳键且不改变同种子事件安排", () => {
  const config = makeConfig("visual-version-regression", "standard");
  assert.equal(config.visualVersion, VISUAL_VERSION);
  assert.equal(VISUAL_VERSION, "motion-4");
  const legacyConfig = { ...config };
  delete legacyConfig.visualVersion;
  const legacyPlan = buildPlan(legacyConfig);
  const currentPlan = buildPlan(config);
  const monitorPlan = buildPlan({ ...config, visualVersion: "cctv-2" });
  const photoPlan = buildPlan({ ...config, visualVersion: "photo-3" });
  const alternatePlan = buildPlan({
    ...config,
    visualVersion: "other-visual-version",
  });
  for (const candidate of [currentPlan, monitorPlan, photoPlan, alternatePlan]) {
    assert.deepEqual(candidate.events, legacyPlan.events);
    assert.deepEqual(candidate.visits, legacyPlan.visits);
    assert.deepEqual(candidate.people, legacyPlan.people);
  }

  const legacyRun: RunRecord = {
    id: "legacy-visual",
    date: "2026-11-13T05:00:00.000Z",
    config: legacyConfig,
    plan: legacyPlan,
    score: { ...new Game(legacyPlan).score, total: 850 },
    eventCount: legacyPlan.events.length,
    inputs: [],
    pauses: [],
  };
  const legacyKey = `${config.seed}|standard|${config.duration}|${config.ruleVersion}|desktop|normal|exam`;
  const monitorKey = `${legacyKey}|visual:cctv-2`;
  const photoKey = `${legacyKey}|visual:photo-3`;
  assert.equal(conditionKey(legacyRun), legacyKey);
  const saved = new Map<string, string>([
    [
      SAVE_KEY,
      JSON.stringify({
        best: { [legacyKey]: 900, [monitorKey]: 800, [photoKey]: 700 },
        recent: [],
      }),
    ],
  ]);
  const local = new LocalStore({
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => {
      saved.set(key, value);
    },
  });
  const currentRun: RunRecord = {
    ...legacyRun,
    id: "current-visual",
    config,
    plan: currentPlan,
    score: { ...legacyRun.score, total: 100 },
  };
  assert.equal(
    conditionKey(currentRun),
    `${legacyKey}|visual:${VISUAL_VERSION}`,
  );
  assert.equal(local.saveRun(currentRun), true);
  assert.equal(local.data.best[legacyKey], 900);
  assert.equal(local.data.best[monitorKey], 800);
  assert.equal(local.data.best[photoKey], 700);
  assert.equal(local.data.best[conditionKey(currentRun)], 100);
  assert.equal(local.saveRun(legacyRun), false);
  assert.equal(local.data.best[legacyKey], 900);
  assert.equal(local.data.best[monitorKey], 800);
  assert.equal(local.data.best[photoKey], 700);
  assert.equal(legacyRun.config.visualVersion, undefined);
  const photoRun: RunRecord = {
    ...legacyRun,
    id: "photo-visual",
    config: photoPlan.config,
    plan: photoPlan,
    score: { ...legacyRun.score, total: 650 },
  };
  assert.equal(conditionKey(photoRun), photoKey);
  assert.equal(local.saveRun(photoRun), false);
  assert.equal(local.data.best[photoKey], 700);
  assert.equal(local.data.best[conditionKey(currentRun)], 100);
});

test("第二版监控记录继续使用冻结几何，后续版本不改写旧局与命中条件", () => {
  const oldPlan = buildPlan({
    ...makeConfig("monitor-compatibility"),
    visualVersion: "cctv-2",
  });
  const original = JSON.stringify(oldPlan);
  for (const tick of [0, 300, 1800, 7199])
    for (let scene = 0; scene < 6; scene++) {
      const old = sceneGeometry(oldPlan, tick, scene);
      assert.ok(
        isDeepStrictEqual(old, monitorGeometry(oldPlan, tick, scene)),
        `第二版画面必须与冻结版本完全一致：tick ${tick} / scene ${scene}`,
      );
      for (const actor of old.actors) {
        const point = pointFor(old.ops, actor.person.id);
        assert.ok(point, `第二版可见人物 ${actor.person.id} 必须仍可点击`);
      }
    }
  replayAt(oldPlan, [], 1200);
  assert.equal(JSON.stringify(oldPlan), original);
});

test("第三版照片记录保留精确几何、原命中像素与只读复盘", () => {
  const oldPlan = buildPlan({
    ...makeConfig("photo-compatibility"),
    visualVersion: "photo-3",
  });
  const game = new Game(oldPlan);
  const first = oldPlan.events[0];
  game.advanceTo(first.start + 1);
  game.report(first.scene, first.actors[0]);
  const inputs = game.inputs.map((input) => ({ ...input }));
  const original = JSON.stringify({ plan: oldPlan, inputs });
  for (const tick of [0, first.start + 1, 1800, 7199]) {
    const replay = replayAt(oldPlan, inputs, tick);
    for (let scene = 0; scene < 6; scene++) {
      const visible = sceneGeometry(oldPlan, tick, scene, replay.caught);
      assert.ok(
        isDeepStrictEqual(visible, photoGeometry(oldPlan, tick, scene, replay.caught)),
        `第三版画面必须与冻结版本完全一致：tick ${tick} / scene ${scene}`,
      );
      for (const actor of visible.actors) {
        assert.ok(
          pointFor(visible.ops, actor.person.id),
          `第三版可见人物 ${actor.person.id} 必须仍可点击`,
        );
      }
    }
  }
  assert.equal(JSON.stringify({ plan: oldPlan, inputs }), original);
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

test("旧局复盘保留原始画面几何，新投影不改写旧计划", () => {
  const oldPlan = {
    ...plan,
    config: { ...plan.config, visualVersion: undefined },
  };
  const before = JSON.stringify(oldPlan);
  const old = sceneGeometry(oldPlan, 300, 0);
  const modern = sceneGeometry(plan, 300, 0);
  assert.notDeepEqual(old.ops, modern.ops);
  assert.ok(
    !old.ops.some((o) => o.shape.kind === "ellipse" && o.shape.role === "head"),
  );
  assert.ok(
    modern.ops.some(
      (o) => o.shape.kind === "image" && o.shape.role === "person",
    ),
  );
  assert.ok(
    !modern.ops.some(
      (o) => o.shape.kind === "ellipse" && o.shape.role === "head",
    ),
    "照片人物不能通过隐形头部椭圆扩大命中",
  );
  replayAt(oldPlan, [], 900);
  assert.equal(JSON.stringify(oldPlan), before);
});
