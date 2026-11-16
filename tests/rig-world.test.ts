import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Vector3 } from "three";
import { makeConfig, PRESET_SEEDS, seconds } from "../src/engine/config.js";
import { buildPlan } from "../src/engine/schedule.js";
import type { Plan, RecordEntry } from "../src/engine/types.js";
import {
  rigActors,
  rigDoorOpen,
  rigSeat,
  rigCamera,
  projectRig,
  RIG_STAND_TIME,
  RIG_SETTLE_TIME,
} from "../src/render/rig-world.js";

function fixture(publicEvent = false): Plan {
  const plan = buildPlan({
    ...makeConfig("rig-journey-test"),
    visualVersion: "rig-5",
  });
  // 第三排左端到右后门是最长行程，不能只用门边的短路线验收。
  const person = plan.people[8];
  plan.visits = [
    {
      actorId: person.id,
      scene: 4,
      slot: 1,
      depart: seconds(10),
      arrive: seconds(24),
      exit: seconds(46),
      returned: seconds(60),
      ...(publicEvent ? { eventId: "rig-public-event" } : {}),
    },
  ];
  plan.events = publicEvent
    ? [
        {
          id: "rig-public-event",
          kind: "restroom",
          scene: 4,
          actors: [person.id],
          variant: 0,
          prepare: seconds(31),
          start: seconds(34),
          end: seconds(39),
        },
      ]
    : [];
  return plan;
}
const actorAt = (plan: Plan, tick: number) =>
  rigActors(plan, tick).find((state) => state.person.id === 8);
const deltaAngle = (a: number, b: number) =>
  Math.atan2(Math.sin(b - a), Math.cos(b - a));

test("三维行程依次起身、沿行间走门、开门离场、公共区、回门回座，始终只出现在一个机位", () => {
  const plan = fixture(true),
    visit = plan.visits[0],
    phases = new Set<string>();
  const before = JSON.stringify(plan);
  let previous = actorAt(plan, 0);
  for (let tick = 0; tick <= visit.returned + RIG_STAND_TIME; tick++) {
    const actors = rigActors(plan, tick);
    assert.equal(
      new Set(actors.map((state) => state.person.id)).size,
      actors.length,
    );
    const actor = actors.find((state) => state.person.id === 8);
    if (actor) {
      phases.add(actor.journeyPhase);
      assert.ok(actor.stand >= 0 && actor.stand <= 1);
      assert.ok(
        actor.walkSpeed >= 0 && actor.walkSpeed < 1.7,
        `${actor.journeyPhase} 不应急跑 ${actor.walkSpeed}`,
      );
      for (const value of [
        actor.x,
        actor.y,
        actor.z,
        actor.heading,
        actor.walkPhase,
      ])
        assert.ok(Number.isFinite(value));
      if (previous && actor.scene === previous.scene) {
        assert.ok(
          Math.hypot(actor.x - previous.x, actor.z - previous.z) < 0.13,
          "相邻 tick 发生位置跳变",
        );
        assert.ok(
          Math.abs(deltaAngle(previous.heading, actor.heading)) < 0.7,
          "转弯发生瞬时九十度旋转",
        );
        assert.ok(Math.abs(actor.stand - previous.stand) < 0.12, "起坐突变");
      }
    } else if (previous?.scene === visit.scene) {
      assert.ok(Math.abs(previous.x) > 6.6, "公共区只能从镜头边缘外离开");
    } else if (previous?.scene === plan.people[8].room) {
      assert.ok(
        previous.x > 4.85 && Math.abs(previous.z + 3.6) < 0.01,
        "教室人物不能在座位上突然消失",
      );
    }
    previous = actor;
  }
  for (const phase of [
    "seated",
    "standing-up",
    "room-out",
    "opening-door",
    "crossing-out",
    "public-in",
    "public-stay",
    "public-out",
    "crossing-in",
    "room-in",
    "sitting-down",
  ])
    assert.ok(phases.has(phase), `缺少 ${phase}`);
  assert.equal(actorAt(plan, visit.depart - RIG_STAND_TIME)?.stand, 0);
  assert.equal(actorAt(plan, visit.depart)?.stand, 1);
  assert.equal(actorAt(plan, visit.returned)?.stand, 1);
  assert.equal(actorAt(plan, visit.returned + RIG_STAND_TIME)?.stand, 0);
  assert.equal(JSON.stringify(plan), before);
});

test("行走方向与实际位移一致，脚步相位由路程驱动，桌子只从行间绕行", () => {
  const plan = fixture(),
    seats = plan.people.filter((person) => person.room === 0).map(rigSeat);
  let previous = actorAt(plan, 0);
  const directions = new Set<number>();
  for (let tick = 1; tick < plan.visits[0].returned; tick++) {
    const actor = actorAt(plan, tick);
    if (actor && previous && actor.scene === previous.scene) {
      const dx = actor.x - previous.x,
        dz = actor.z - previous.z,
        distance = Math.hypot(dx, dz);
      if (distance > 0.005 && actor.walkSpeed > 0.1) {
        assert.ok(
          Math.sin(actor.heading) * dx + Math.cos(actor.heading) * dz > 0,
          "人物不能一直正面滑行或倒退",
        );
        assert.ok(
          actor.walkDistance > previous.walkDistance,
          "移动时脚步相位必须前进",
        );
        directions.add(Math.round(Math.atan2(dx, dz) / (Math.PI / 2)));
      }
      if (
        actor.walkSpeed === 0 &&
        previous.walkSpeed === 0 &&
        actor.journeyPhase === previous.journeyPhase
      )
        assert.equal(
          actor.walkDistance,
          previous.walkDistance,
          "停步时不能原地踏步",
        );
    }
    if (actor?.scene === 0 && actor.stand > 0.99)
      for (const seat of seats)
        assert.ok(
          !(
            Math.abs(actor.x - seat.x) < 0.6 &&
            actor.z > seat.z + 0.05 &&
            actor.z < seat.z + 0.99
          ),
          "人物路线穿过桌子实体",
        );
    previous = actor;
  }
  assert.ok(directions.size >= 3, "需实际包含左右与纵深方向的脚步");
});

test("公共区在准备前完成入场和转身，有效窗口保持站位；举报后平滑恢复且不改原计划", () => {
  const plan = fixture(true),
    event = plan.events[0];
  const stationary = actorAt(plan, event.prepare)!;
  assert.equal(stationary.journeyPhase, "public-stay");
  assert.equal(stationary.walkSpeed, 0);
  assert.ok(Math.abs(stationary.heading) < 1e-8);
  for (let tick = event.start; tick < event.end; tick++) {
    const actor = actorAt(plan, tick)!;
    assert.equal(actor.x, stationary.x);
    assert.equal(actor.z, stationary.z);
    assert.equal(actor.eventWeight, 1);
    assert.equal(actor.eventActive, true);
  }
  const caught = new Set([event.id]),
    caughtTick = event.start + seconds(1);
  const records: RecordEntry[] = [
    {
      id: "caught-test",
      tick: caughtTick,
      scene: 4,
      actorId: 8,
      x: 0,
      y: 0,
      eventId: event.id,
      verdict: "caught",
      reason: "三维行程恢复验收",
      delta: 100,
    },
  ];
  const before = JSON.stringify({ plan, records });
  let weight = 1;
  for (let tick = caughtTick; tick <= caughtTick + RIG_SETTLE_TIME; tick++) {
    const actor = rigActors(plan, tick, caught, records).find(
      (state) => state.person.id === 8,
    )!;
    assert.ok(actor.eventWeight <= weight && actor.eventWeight >= 0);
    assert.ok(weight - actor.eventWeight < 0.12);
    weight = actor.eventWeight;
    assert.equal(actor.eventActive, false);
    assert.deepEqual(
      rigActors(structuredClone(plan), tick, caught, structuredClone(records)),
      rigActors(plan, tick, caught, records),
    );
  }
  assert.equal(weight, 0);
  assert.equal(JSON.stringify({ plan, records }), before);
});

test("开门在跨越门洞前完成且两趟行程共用门状态，旧调度按旧规则原样复建", () => {
  const plan = fixture();
  let crossing = 0;
  let reachedAt: number | undefined;
  for (let tick = 0; tick <= plan.visits[0].returned; tick++) {
    const actor = actorAt(plan, tick),
      openness = rigDoorOpen(plan, tick, 0);
    if (actor?.journeyPhase === "opening-door") {
      reachedAt ??= tick;
      if (tick - reachedAt <= seconds(0.3))
        assert.equal(openness, 0, "应先伸手触把，不能手未到门便提前开门");
    }
    assert.ok(openness >= 0 && openness <= 1);
    assert.equal(rigDoorOpen(plan, tick, 4), 0);
    if (
      actor?.journeyPhase === "crossing-out" ||
      actor?.journeyPhase === "crossing-in"
    ) {
      crossing++;
      assert.equal(openness, 1, "人过门时门必须保持全开");
    }
  }
  assert.ok(crossing > 0);
  const old = buildPlan({
    ...makeConfig("morning-01"),
    ruleVersion: "1.0.0",
    visualVersion: "motion-4",
  });
  const digest = createHash("sha256")
    .update(JSON.stringify({ events: old.events, visits: old.visits }))
    .digest("hex");
  assert.equal(
    digest,
    "9a1d5a0e3e6f6b3207016cbc9247f6f91f4b40630665f5cd4b600223eec6327d",
  );
});

test("六个机位的纯投影与实际三维相机一致，修改相机副本不污染其他投影", () => {
  for (let scene = 0; scene < 6; scene++) {
    const camera = rigCamera(scene);
    assert.ok(
      Math.abs(camera.position.x) < 4.56 &&
        camera.position.z < 4.78 &&
        camera.position.y < 3.24,
      "相机必须位于墙内和天花板下，不能从室外看切开的教室",
    );
    const locations =
      scene < 4
        ? fixture()
            .people.filter((person) => person.room === 0)
            .map(rigSeat)
        : [-2.7, -0.9, 0.9, 2.7].flatMap((x) => [
            { x, z: 0.5 },
            { x, z: -2.8 },
          ]);
    for (const location of locations) {
      const point = projectRig(scene, location.x, 1.65, location.z);
      const vector = new Vector3(location.x, 1.65, location.z).project(camera);
      assert.ok(Math.abs(point.x - (vector.x + 1) * 300) < 1e-8);
      assert.ok(Math.abs(point.y - (1 - vector.y) * 175) < 1e-8);
      assert.ok(point.visible && point.scale > 10);
      const crown = projectRig(scene, location.x, 1.85, location.z);
      assert.ok(
        crown.visible && crown.y >= 35,
        "人头不能被顶部28像素监控标识遮住",
      );
      if (scene < 4)
        for (const dx of [-0.45, 0.45])
          for (const dz of [0.21, 0.83])
            assert.ok(
              projectRig(scene, location.x + dx, 0.76, location.z + dz).visible,
              "十二张桌面的四角必须完整入镜，不能为放大人物裁掉关键物品",
            );
      else
        assert.ok(
          projectRig(scene, location.x, 0, location.z).visible,
          "公共区站位应完整看见脚部",
        );
    }
    if (scene < 4)
      for (const x of [4, 4.25, 4.6, 4.95, 5.65])
        for (const z of [-4.15, -3.6, -3.05])
          for (const y of [0, 1.75, 2.1]) {
            const door = projectRig(scene, x, y, z);
            assert.ok(
              door.visible && door.y >= 35,
              "右后门洞、门前和门后脚步必须在监控标识下方完整入镜",
            );
          }
    const previous = projectRig(scene, 0, 1, 0);
    camera.position.set(100, 100, 100);
    camera.updateMatrixWorld(true);
    assert.deepEqual(projectRig(scene, 0, 1, 0), previous);
  }
});

test("公共区左右入出场的完整人体投影位于镜头外，全部预设的有效动作人物已站稳", () => {
  for (const difficulty of ["beginner", "standard", "pressure"] as const)
    for (const { id } of PRESET_SEEDS) {
      const plan = buildPlan(makeConfig(id, difficulty));
      for (const visit of plan.visits) {
        const ends = [1, -1].map((direction) => {
          for (let offset = 0; offset <= seconds(2); offset++) {
            const tick =
              direction > 0 ? visit.arrive + offset : visit.exit - 1 - offset;
            const actor = rigActors(plan, tick).find(
              (state) =>
                state.person.id === visit.actorId &&
                state.scene === visit.scene,
            );
            if (actor) return actor;
          }
          assert.fail("同门排队后仍必须从公共区镜头外入出场");
        });
        for (const actor of ends) {
          assert.equal(actor.scene, visit.scene);
          for (const y of [0, 0.9, 1.8])
            for (const dx of [-0.3, 0.3]) {
              const projection = projectRig(
                actor.scene,
                actor.x + dx,
                y,
                actor.z,
              );
              assert.ok(
                projection.x < 0 || projection.x > 600,
                "公共区人物不能在镜头内部出现或消失",
              );
            }
        }
      }
      for (const event of plan.events)
        for (const tick of [
          event.prepare,
          event.start,
          Math.floor((event.start + event.end) / 2),
          event.end - 1,
        ])
          for (const actorId of event.actors) {
            const actor = rigActors(plan, tick).find(
              (state) => state.person.id === actorId,
            )!;
            assert.equal(actor.scene, event.scene);
            assert.equal(actor.walkSpeed, 0, "有效目标不能仍在赶往站位");
          }
    }
});

test("同房间与同公共入口保持四分之三秒头距，门外完全越过后再隐藏，脚步不急跑", () => {
  const plan = fixture();
  const original = plan.visits[0];
  plan.visits = [1, 4, 8, 11].map((actorId, slot) => ({
    ...original,
    actorId,
    slot,
  }));
  const snapshot = JSON.stringify(plan);
  const doorOut = new Map<number, number>(),
    doorIn = new Map<number, number>();
  const publicIn = new Map<number, number>(),
    publicOut = new Map<number, number>();
  for (let tick = original.depart; tick <= original.returned; tick++) {
    const actors = rigActors(plan, tick);
    assert.equal(new Set(actors.map((actor) => actor.id)).size, actors.length);
    for (const actor of actors.filter((state) => state.visit)) {
      assert.ok(
        actor.walkSpeed <= 1.8,
        `${actor.id}/${actor.journeyPhase} 不能急跑 ${actor.walkSpeed}`,
      );
      if (actor.journeyPhase === "crossing-out" && !doorOut.has(actor.id))
        doorOut.set(actor.id, tick);
      if (actor.journeyPhase === "crossing-in" && !doorIn.has(actor.id)) {
        doorIn.set(actor.id, tick);
        assert.equal(actor.x, 5.65, "返程只能从门后出现");
      }
      if (actor.scene === original.scene) {
        if (!publicIn.has(actor.id)) publicIn.set(actor.id, tick);
        publicOut.set(actor.id, tick);
      }
      if (
        actor.journeyPhase === "crossing-out" &&
        !rigActors(plan, tick + 1).some((next) => next.id === actor.id)
      )
        assert.ok(actor.x > 5.6, "整个人走进门外走廊以后才能隐藏");
    }
  }
  for (const times of [doorOut, doorIn]) {
    const values = [...times.values()].sort((a, b) => a - b);
    assert.equal(values.length, 4);
    for (let i = 1; i < values.length; i++)
      assert.ok(values[i] - values[i - 1] >= seconds(0.75));
  }
  for (const pair of [
    [1, 4],
    [8, 11],
  ]) {
    assert.equal(
      Math.abs(publicIn.get(pair[0])! - publicIn.get(pair[1])!),
      seconds(0.75),
    );
    assert.equal(
      Math.abs(publicOut.get(pair[0])! - publicOut.get(pair[1])!),
      seconds(0.75),
    );
  }
  assert.equal(JSON.stringify(plan), snapshot);
});

test("清晨种子反向过门不再在tick2932叠穿，回程只在门后礼让并保持有限步速", () => {
  const plan = buildPlan(makeConfig("morning-01"));
  const sample = rigActors(plan, 2932);
  const leaving = sample.find((actor) => actor.id === 36);
  const returning = sample.find((actor) => actor.id === 40);
  assert.ok(
    !leaving ||
      !returning ||
      leaving.scene !== returning.scene ||
      Math.hypot(leaving.x - returning.x, leaving.z - returning.z) >= 0.5,
    "已观察到的出入门中心重合必须修复",
  );
  for (let tick = 0; tick < plan.config.duration; tick++) {
    const actors = rigActors(plan, tick);
    for (const actor of actors)
      assert.ok(
        actor.walkSpeed <= 2,
        `${actor.id}/${tick}/${actor.journeyPhase} 礼让后不能急跑 ${actor.walkSpeed}`,
      );
    for (let scene = 0; scene < 4; scene++) {
      const door = actors.filter(
        (actor) =>
          actor.scene === scene &&
          (actor.journeyPhase === "crossing-out" ||
            actor.journeyPhase === "crossing-in"),
      );
      assert.ok(
        !door.some((actor) => actor.journeyPhase === "crossing-out") ||
          !door.some((actor) => actor.journeyPhase === "crossing-in"),
        `${scene}/${tick} 门洞不能同时出现相反方向的过门人物`,
      );
    }
  }
});
