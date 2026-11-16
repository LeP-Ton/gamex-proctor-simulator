import test from "node:test";
import assert from "node:assert/strict";
import { makeConfig, seconds } from "../src/engine/config.js";
import { Game, replayAt } from "../src/engine/game.js";
import { buildPlan } from "../src/engine/schedule.js";
import { normalBehavior, seatPosition } from "../src/engine/world.js";
import type {
  ActorView,
  Person,
  Plan,
  PlannedEvent,
  RecordEntry,
} from "../src/engine/types.js";
import {
  candidatePose,
  candidateProfile,
  gestureEnvelope,
  MOTION_SETTLE,
  physicalEvent,
} from "../src/render/candidate-motion.js";
import type { MotionPose } from "../src/render/candidate-motion.js";

const positionFields = [
  "leanX",
  "leanY",
  "headY",
  "shoulders",
  "leftX",
  "leftY",
  "rightX",
  "rightY",
  "elbowLeftX",
  "elbowLeftY",
  "elbowRightX",
  "elbowRightY",
  "stride",
  "walkBob",
] as const;

function viewAt(
  plan: Plan,
  person: Person,
  tick: number,
  scene = person.room,
): ActorView {
  return {
    person,
    scene,
    ...seatPosition(person),
    ...normalBehavior(plan, person, tick),
  };
}

function adjacentPoseIsContinuous(
  before: MotionPose,
  after: MotionPose,
  label: string,
) {
  for (const key of positionFields) {
    assert.ok(
      Number.isFinite(before[key]) && Number.isFinite(after[key]),
      `${label}/${key} 非有限数值`,
    );
    assert.ok(
      Math.abs(after[key] - before[key]) < 4,
      `${label}/${key} 相邻 tick 位移过大`,
    );
  }
  assert.ok(
    Math.abs(after.headAngle - before.headAngle) < 0.2,
    `${label} 头部转角突变`,
  );
}

test("普通动作包络在首尾归零，范围内平滑起落且不会溢出", () => {
  assert.equal(gestureEnvelope(0), 0);
  assert.equal(gestureEnvelope(1), 0);
  assert.equal(gestureEnvelope(-1), 0);
  assert.equal(gestureEnvelope(2), 0);
  assert.ok(gestureEnvelope(0.5) > 0.8);
  let previous = gestureEnvelope(0);
  for (let sample = 1; sample <= 1000; sample++) {
    const next = gestureEnvelope(sample / 1000);
    assert.ok(next >= 0 && next <= 1);
    assert.ok(Math.abs(next - previous) < 0.02, "动作包络存在不连续跳变");
    previous = next;
  }
});

test("48个人物参数稳定且签名不同，同房同类优先分配不同底片并覆盖20个基础外观", () => {
  for (const seed of ["morning-01", "motion-profiles", "quiet-room"]) {
    const plan = buildPlan(makeConfig(seed, "standard"));
    const baseline = JSON.stringify(plan);
    const restored = structuredClone(plan);
    const signatures = new Set<string>();
    const looks = new Set<string>();
    for (const person of plan.people) {
      const profile = candidateProfile(plan, person);
      assert.deepEqual(profile, candidateProfile(plan, person));
      assert.deepEqual(
        profile,
        candidateProfile(restored, restored.people[person.id]),
      );
      signatures.add(JSON.stringify(profile));
      looks.add(`${profile.asset}/${profile.frame}`);
    }
    assert.equal(signatures.size, 48, `${seed} 的人物参数重复`);
    assert.equal(looks.size, 20, `${seed} 未覆盖20个基础外观`);
    for (let room = 0; room < 4; room++)
      for (const gender of ["male", "female"] as const) {
        const peers = plan.people.filter(
          (person) => person.room === room && person.gender === gender,
        );
        const unique = new Set(
          peers.map((person) => {
            const profile = candidateProfile(plan, person);
            return `${profile.asset}/${profile.frame}`;
          }),
        );
        assert.equal(
          unique.size,
          Math.min(10, peers.length),
          `${seed}/${room}/${gender} 过早重复底片`,
        );
      }
    assert.equal(JSON.stringify(plan), baseline);
    assert.deepEqual(
      buildPlan(plan.config),
      plan,
      "查询人物外观不能消耗事件随机数",
    );
  }
});

test("正常动作周期及手势结束边界的相邻tick没有大幅姿态跳变", () => {
  const plan = {
    ...buildPlan(makeConfig("normal-motion-boundaries", "standard")),
    events: [],
  };
  const actions = new Set<string>();
  let boundaries = 0;
  for (const person of plan.people) {
    let previous = normalBehavior(plan, person, 0);
    for (let tick = 1; tick < plan.config.duration - 1; tick++) {
      const current = normalBehavior(plan, person, tick);
      if (
        current.action !== previous.action ||
        current.actionPhase < previous.actionPhase
      ) {
        actions.add(current.action);
        actions.add(previous.action);
        for (const sample of [tick - 1, tick]) {
          const before = candidatePose(
            plan,
            viewAt(plan, person, sample),
            sample,
          );
          const after = candidatePose(
            plan,
            viewAt(plan, person, sample + 1),
            sample + 1,
          );
          adjacentPoseIsContinuous(
            before,
            after,
            `人物${person.id}/tick${sample}`,
          );
        }
        boundaries++;
      }
      previous = current;
    }
  }
  assert.ok(boundaries > 48, "应实际经过多轮普通动作边界");
  assert.ok(actions.size >= 8, "应覆盖多类普通动作，而非只观察书写");
});

test("五类事件的准备、有效、结束和回正边界均连续，姿态采样不改变计划", () => {
  const plan = buildPlan(makeConfig("event-motion-boundaries", "pressure"));
  const baseline = JSON.stringify(plan);
  const kinds = new Set<string>();
  for (const event of plan.events) {
    const isolated = { ...plan, events: [event] };
    kinds.add(event.kind);
    for (const id of event.actors) {
      const person = plan.people[id];
      for (const boundary of [
        event.prepare,
        event.start,
        event.end,
        event.end + MOTION_SETTLE,
      ])
        for (const tick of [boundary - 1, boundary]) {
          const before = candidatePose(
            isolated,
            viewAt(isolated, person, tick, event.scene),
            tick,
          );
          const after = candidatePose(
            isolated,
            viewAt(isolated, person, tick + 1, event.scene),
            tick + 1,
          );
          adjacentPoseIsContinuous(
            before,
            after,
            `${event.kind}/${id}/tick${tick}`,
          );
        }
    }
  }
  assert.equal(kinds.size, 5);
  assert.equal(JSON.stringify(plan), baseline);
});

test("正确举报时刻来自只读真实记录，0.9秒回正并与同tick重放完全一致", () => {
  assert.equal(MOTION_SETTLE, seconds(0.9));
  const source = buildPlan(makeConfig("caught-motion-settle", "standard"));
  const event = source.events.find(
    (item) => item.kind === "peeking",
  ) as PlannedEvent;
  const plan = { ...source, events: [event] };
  const person = plan.people[event.actors[0]];
  const game = new Game(plan);
  const caughtAt = event.start + seconds(0.4);
  game.advanceTo(caughtAt);
  game.report(event.scene, person.id);
  assert.equal(game.score.caught, 1);
  const records: readonly RecordEntry[] = Object.freeze(
    game.records.map((entry) => Object.freeze({ ...entry })),
  );
  const saved = JSON.stringify({
    plan,
    records,
    score: game.score,
    inputs: game.inputs,
  });
  const neutralPlan = { ...plan, events: [] };
  let previousWeight = 1;
  for (let offset = 0; offset <= MOTION_SETTLE; offset++) {
    const tick = caughtAt + offset;
    const weight = physicalEvent(plan, person, tick, records)?.weight ?? 0;
    assert.ok(
      weight >= 0 && weight <= previousWeight,
      "举报后的物理动作必须逐步回正",
    );
    assert.ok(previousWeight - weight < 0.2, "回正权重存在跳变");
    const view = viewAt(plan, person, tick, event.scene);
    const pose = candidatePose(plan, view, tick, records);
    const replay = replayAt(plan, game.inputs, tick);
    assert.deepEqual(pose, candidatePose(plan, view, tick, replay.records));
    const next = candidatePose(
      plan,
      viewAt(plan, person, tick + 1, event.scene),
      tick + 1,
      records,
    );
    adjacentPoseIsContinuous(pose, next, `正确举报回正/tick${tick}`);
    previousWeight = weight;
  }
  assert.equal(physicalEvent(plan, person, caughtAt, records)?.weight, 1);
  assert.equal(
    physicalEvent(plan, person, caughtAt + MOTION_SETTLE, records),
    undefined,
  );
  const settledTick = caughtAt + MOTION_SETTLE;
  const view = viewAt(plan, person, settledTick, event.scene);
  assert.deepEqual(
    candidatePose(plan, view, settledTick, records),
    candidatePose(neutralPlan, view, settledTick),
  );
  assert.equal(
    JSON.stringify({ plan, records, score: game.score, inputs: game.inputs }),
    saved,
  );
  assert.deepEqual(
    buildPlan(source.config).events,
    source.events,
    "动作播放不能改变计分机会",
  );
});
