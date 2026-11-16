import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  DIFFICULTIES,
  makeConfig,
  RULE_VERSION,
  VISUAL_VERSION,
  seconds,
} from "../src/engine/config.js";
import type { Difficulty } from "../src/engine/config.js";
import { buildPlan, validatePlan } from "../src/engine/schedule.js";
import { Game, replayAt } from "../src/engine/game.js";
import { rigActors } from "../src/render/rig-world.js";
import { buildTutorialPlan } from "../src/engine/tutorial.js";

test("新迁移预算保持三档固定事件数、完整机会与人员预约约束", () => {
  assert.equal(RULE_VERSION, "1.1.0");
  assert.equal(VISUAL_VERSION, "rig-5");
  for (const difficulty of Object.keys(DIFFICULTIES) as Difficulty[]) {
    for (let i = 0; i < 50; i++) {
      const plan = buildPlan(makeConfig(`rig-schedule-${i}`, difficulty));
      assert.deepEqual(validatePlan(plan), [], `${difficulty}/${i}`);
      assert.equal(plan.events.length, DIFFICULTIES[difficulty].count);
      for (const visit of plan.visits) {
        assert.equal(visit.arrive - visit.depart, seconds(14));
        assert.equal(visit.returned - visit.exit, seconds(14));
        assert.ok(visit.exit - visit.arrive >= seconds(8));
      }
    }
  }
});

test("长行程高压种子的贪心死路可确定性重排，机会和完整观察窗口保持不变", () => {
  const config = makeConfig("stress-1379", "pressure");
  const before = JSON.stringify(config);
  const plan = buildPlan(config);
  assert.deepEqual(validatePlan(plan), []);
  assert.equal(plan.events.length, DIFFICULTIES.pressure.count);
  assert.deepEqual(
    buildPlan(structuredClone(config)),
    plan,
    "重建不能依赖时间或上一次重排状态",
  );
  const alternate = buildPlan({ ...config, visualVersion: "motion-4" });
  assert.deepEqual(
    alternate.events,
    plan.events,
    "画面条件不能改变冲突恢复后的计分计划",
  );
  assert.deepEqual(alternate.visits, plan.visits);
  for (const event of plan.events) {
    const window = event.end - event.start;
    assert.ok(window >= seconds(DIFFICULTIES.pressure.window[0]));
    assert.ok(window <= seconds(DIFFICULTIES.pressure.window[1]));
    for (const id of event.actors) {
      const actor = rigActors(plan, event.start).find(
        (state) => state.person.id === id,
      );
      assert.equal(actor?.scene, event.scene);
      assert.equal(
        actor?.walkSpeed,
        0,
        "不能通过赶路中提前开始机会来回避预约冲突",
      );
    }
  }
  for (const visit of plan.visits) {
    assert.equal(visit.arrive - visit.depart, seconds(14));
    assert.equal(visit.returned - visit.exit, seconds(14));
  }
  assert.equal(JSON.stringify(config), before);
});

test("新规则完整预约教室双向通道且稳定重建，非调度异常直接抛出不重试", () => {
  for (const difficulty of Object.keys(DIFFICULTIES) as Difficulty[]) {
    const config = makeConfig("morning-01", difficulty);
    const plan = buildPlan(config);
    assert.deepEqual(buildPlan(structuredClone(config)), plan);
    const passages = plan.visits.flatMap((visit) => [
      { room: plan.people[visit.actorId].room, begin: visit.arrive - seconds(8.5), end: visit.arrive },
      { room: plan.people[visit.actorId].room, begin: visit.exit, end: visit.exit + seconds(8.5) },
    ]);
    for (let i = 0; i < passages.length; i++)
      for (const other of passages.slice(i + 1)) {
        const current = passages[i];
        assert.ok(current.room !== other.room || current.begin >= other.end || other.begin >= current.end,
          "同一教室的进出过道不能同时预约，不能靠最后赶路掩盖计划冲突");
      }
    for (const event of plan.events.filter((event) => event.kind === "restroom" && event.actors.length > 1))
      assert.equal(new Set(event.actors.map((id) => plan.people[id].room)).size, event.actors.length,
        "同时去公共区交换材料的同伴应来自不同教室，避免同门叠穿");
  }
  const sentinel = new TypeError("验收注入的配置读取异常");
  const broken = makeConfig("rig-error-boundary");
  let reads = 0;
  Object.defineProperty(broken, "difficulty", {
    get() {
      reads++;
      throw sentinel;
    },
  });
  assert.throws(
    () => buildPlan(broken),
    (error) => error === sentinel,
  );
  assert.equal(reads, 1, "配置或程序错误不能被当作预约冲突吞掉重试");
});

test("旧规则三个固定种子的事件和行程完整保留，避免重新生成旧局时漂移", () => {
  const expected = {
    "morning-01":
      "9a1d5a0e3e6f6b3207016cbc9247f6f91f4b40630665f5cd4b600223eec6327d",
    "rainy-window":
      "cfb962313f28e92a5e76961b65a195351e27a4d0b590f26cf1a56ebad08a1fca",
    "quiet-corridor":
      "85d142a5ca2a8a84d70ddc94825dec830b6b8394ae22b56ab0ce2dfa85b3eebf",
  };
  for (const [seed, digest] of Object.entries(expected)) {
    const plan = buildPlan({
      ...makeConfig(seed),
      ruleVersion: "1.0.0",
      visualVersion: "motion-4",
    });
    const actual = createHash("sha256")
      .update(JSON.stringify({ events: plan.events, visits: plan.visits }))
      .digest("hex");
    assert.equal(actual, digest, seed);
  }
});

test("同一规则下切换画面不改变事件随机或行程，规则变化单独隔离", () => {
  const config = makeConfig("rig-visual-random");
  const current = buildPlan(config);
  for (const visualVersion of [
    undefined,
    "cctv-2",
    "photo-3",
    "motion-4",
    "rig-5",
  ]) {
    const other = buildPlan({ ...config, visualVersion });
    assert.deepEqual(other.events, current.events);
    assert.deepEqual(other.visits, current.visits);
  }
});

test("新公共区有效窗口已经站定，真实计分边界和输入复盘保持一致", () => {
  const plan = buildPlan(makeConfig("morning-01"));
  const game = new Game(plan);
  const inputs: {
    tick: number;
    scene: number;
    actorId: number;
    x: number;
    y: number;
  }[] = [];
  for (const event of plan.events) {
    const tick = event.start + 1;
    const states = rigActors(plan, tick);
    for (const id of event.actors) {
      const actor = states.find((a) => a.person.id === id);
      assert.equal(actor?.scene, event.scene);
      if (event.scene >= 4) assert.equal(actor?.walkSpeed, 0);
    }
    game.advanceTo(tick);
    const actorId = event.actors[0];
    const entry = game.report(event.scene, actorId, 300, 180);
    assert.equal(entry?.verdict, "caught");
    inputs.push({ tick, scene: event.scene, actorId, x: 300, y: 180 });
  }
  game.advanceTo(plan.config.duration);
  assert.equal(game.score.caught, plan.events.length);
  const before = JSON.stringify({ plan, inputs });
  const replay = replayAt(plan, inputs, plan.config.duration);
  assert.deepEqual(replay.score, game.score);
  assert.equal(JSON.stringify({ plan, inputs }), before);
});

test("教学保留八个机会，并给三维离场和返回留完整时间", () => {
  const plan = buildTutorialPlan();
  assert.equal(plan.events.length, 8);
  assert.equal(plan.config.visualVersion, "rig-5");
  for (const visit of plan.visits) {
    assert.equal(visit.arrive - visit.depart, seconds(14));
    assert.ok(visit.returned + seconds(0.8) < plan.config.duration);
  }
  for (const event of plan.events) {
    for (const id of event.actors)
      assert.equal(
        rigActors(plan, event.start + 1).find((a) => a.person.id === id)?.scene,
        event.scene,
      );
  }
});
