import { hash } from "../engine/random.js";
import { TICK_RATE, seconds } from "../engine/config.js";
import { normalBehavior, visitAt, publicPosition } from "../engine/world.js";
import type {
  ActorView,
  Person,
  Plan,
  PlannedEvent,
  RecordEntry,
} from "../engine/types.js";
import type { PhotoAssetId } from "./photo-assets.js";

export const MOTION_SETTLE = seconds(0.9);
const clamp = (v: number) => Math.max(0, Math.min(1, v));
export const smooth = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
export const gestureEnvelope = (phase: number) =>
  smooth(phase / 0.22) * (1 - smooth((phase - 0.68) / 0.32));
function walkingProgress(plan: Plan, view: ActorView, tick: number) {
  const visit = visitAt(plan, view.person.id, tick);
  if (!visit) return 1;
  const event = visit.eventId
    ? plan.events.find((e) => e.id === visit.eventId)
    : undefined;
  const ordinary = Math.max(
    1,
    Math.min(seconds(2.6), (visit.exit - visit.arrive) * 0.28),
  );
  const entering = event
    ? Math.max(
        1,
        Math.min(seconds(2.6), event.start - visit.arrive - seconds(0.3)),
      )
    : ordinary;
  const exiting = event
    ? Math.max(
        1,
        Math.min(seconds(2.6), visit.exit - event.end - MOTION_SETTLE),
      )
    : ordinary;
  return Math.min(
    1,
    (tick - visit.arrive) / entering,
    (visit.exit - tick) / exiting,
  );
}
export function publicVisualView(
  plan: Plan,
  view: ActorView,
  tick: number,
): ActorView {
  if (view.scene < 4) return view;
  const visit = visitAt(plan, view.person.id, tick);
  if (!visit) return view;
  const target = publicPosition(visit.slot);
  const y =
    !visit.eventId && hash(`${view.person.id}/visit`) % 4 >= 2 ? 141 : target.y;
  const k = walkingProgress(plan, view, tick);
  const entry = target.x < 300 ? -45 : 645;
  // 先走前景通道再进入站位，避开其他候考者的头和材料；镜头边缘外起步。
  const horizontal = smooth(k / 0.68),
    vertical = smooth((k - 0.68) / 0.32);
  return {
    ...view,
    x: entry + (target.x - entry) * horizontal,
    y: 283 + (y - 283) * vertical,
    action: k < 1 ? "walking" : view.action,
  };
}

export interface CandidateProfile {
  asset: PhotoAssetId;
  frame: number;
  standingFrame: number;
  width: number;
  height: number;
  headScale: number;
  hue: number;
  saturation: number;
  brightness: number;
  tempo: number;
  phase: number;
  handed: number;
  restingLean: number;
}
const profiles = new WeakMap<Plan, Map<number, CandidateProfile>>();
export function candidateProfile(plan: Plan, person: Person): CandidateProfile {
  let cached = profiles.get(plan);
  if (!cached) {
    cached = new Map();
    profiles.set(plan, cached);
  }
  let value = cached.get(person.id);
  if (value) return value;
  const key = `${plan.config.seed}/${person.id}/motion-4`;
  const random = (name: string) => (hash(`${key}/${name}`) % 10001) / 10000;
  // 每间考场同一性别先用不同底片，再叠加稳定体态和衣物差异。
  const peers = plan.people
    .filter((p) => p.room === person.room && p.gender === person.gender)
    .sort(
      (a, b) =>
        hash(`${plan.config.seed}/${a.id}/look`) -
        hash(`${plan.config.seed}/${b.id}/look`),
    );
  const index =
    (peers.findIndex((p) => p.id === person.id) + person.room * 3) % 10;
  const gender = person.gender === "female" ? 2 : 0;
  const asset: PhotoAssetId =
    index < 2 ? "people" : index < 4 ? "peopleB" : "peopleC";
  const frame =
    index < 4
      ? gender + (index % 2)
      : (person.gender === "female" ? 6 : 0) + index - 4;
  value = {
    asset,
    frame,
    standingFrame: frame + 12,
    width: 0.91 + random("width") * 0.18,
    height: 0.95 + random("height") * 0.1,
    headScale: 0.96 + random("head") * 0.08,
    hue: -13 + random("hue") * 26,
    saturation: 0.76 + random("saturation") * 0.38,
    brightness: 0.9 + random("brightness") * 0.18,
    tempo: 0.76 + random("tempo") * 0.62,
    phase: random("phase") * Math.PI * 2,
    handed: random("handed") < 0.13 ? -1 : 1,
    restingLean: (random("lean") - 0.5) * 2.4,
  };
  cached.set(person.id, value);
  return value;
}
export interface MotionPose {
  leanX: number;
  leanY: number;
  headAngle: number;
  headY: number;
  shoulders: number;
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
  elbowLeftX: number;
  elbowLeftY: number;
  elbowRightX: number;
  elbowRightY: number;
  stride: number;
  walkBob: number;
  event?: PlannedEvent;
  eventWeight: number;
  gesture: number;
}
export function physicalEvent(
  plan: Plan,
  person: Person,
  tick: number,
  records: readonly RecordEntry[] = [],
) {
  let latest: { event: PlannedEvent; weight: number } | undefined;
  for (const e of plan.events) {
    if (!e.actors.includes(person.id) || tick < e.prepare) continue;
    const caught = records.find(
      (r) => r.eventId === e.id && r.verdict === "caught",
    );
    const end = caught?.tick ?? e.end;
    if (tick >= end + MOTION_SETTLE) continue;
    const entering = smooth(
      (tick - e.prepare) / Math.max(1, e.start - e.prepare),
    );
    const weight = entering * (1 - smooth((tick - end) / MOTION_SETTLE));
    if (!latest || e.prepare > latest.event.prepare)
      latest = { event: e, weight };
  }
  return latest;
}
export function candidatePose(
  plan: Plan,
  view: ActorView,
  tick: number,
  records: readonly RecordEntry[] = [],
): MotionPose {
  const profile = candidateProfile(plan, view.person);
  const t = tick / TICK_RATE;
  const phase = profile.phase;
  const behavior = normalBehavior(plan, view.person, tick);
  const env = gestureEnvelope(behavior.actionPhase);
  const active = physicalEvent(plan, view.person, tick, records);
  const eventWeight = active?.weight ?? 0;
  const g = env * (1 - eventWeight);
  const f = profile.tempo;
  const write =
    (0.55 + 0.45 * Math.sin(t * 0.77 * f + phase)) * (1 - eventWeight);
  const stroke = Math.sin(t * 8.3 * f + phase) * 0.64 * write;
  const p: MotionPose = {
    leanX: profile.restingLean + Math.sin(t * 0.72 * f + phase) * 0.35,
    leanY: Math.sin(t * 1.35 * f + phase) * 0.24,
    headAngle: Math.sin(t * 0.52 * f + phase) * 0.014,
    headY: Math.sin(t * 1.14 * f + phase) * 0.15,
    shoulders: 0,
    leftX: profile.handed === -1 ? stroke : Math.sin(t * 0.55 + phase) * 0.14,
    leftY: profile.handed === -1 ? stroke * 0.4 : 0,
    rightX: profile.handed === 1 ? stroke : 0,
    rightY: profile.handed === 1 ? stroke * 0.4 : 0,
    elbowLeftX: 0,
    elbowLeftY: 0,
    elbowRightX: 0,
    elbowRightY: 0,
    stride: 0,
    walkBob: 0,
    event: active?.event,
    eventWeight,
    gesture: env,
  };
  switch (behavior.action) {
    case "thinking":
      p.rightX -= 3 * g;
      p.rightY -= 17 * g;
      p.elbowRightY -= 8 * g;
      p.headAngle += 0.035 * g;
      break;
    case "clock":
      p.headY -= 2.1 * g;
      p.headAngle -= 0.065 * g;
      p.leftY -= 4 * g;
      break;
    case "stretch":
      p.leanY -= 2.4 * g;
      p.shoulders = 2.2 * g;
      p.leftX -= 3 * g;
      p.rightX += 3 * g;
      p.elbowLeftX -= 2 * g;
      p.elbowRightX += 2 * g;
      break;
    case "pickPen":
      p.leanX += 6 * g;
      p.leanY += 3 * g;
      p.rightX += 7 * g;
      p.rightY += 8 * g;
      break;
    case "stationery":
      p.leftX -= 2 * g;
      p.rightX += 2 * g;
      p.rightY += Math.sin(t * f) * 1.4 * g;
      break;
    case "turn":
      p.headAngle += Math.sin(phase) * 0.1 * g;
      p.leanX += Math.sin(phase) * 2 * g;
      break;
    case "returnPen": {
      const dir = view.person.col < 3 ? 1 : -1;
      p.leanX += dir * 3 * g;
      if (dir > 0) {
        p.rightX += 16 * g;
        p.rightY -= 3 * g;
        p.elbowRightX += 6 * g;
      } else {
        p.leftX -= 16 * g;
        p.leftY -= 3 * g;
        p.elbowLeftX -= 6 * g;
      }
      break;
    }
    case "bag":
      p.leanX -= 3 * g;
      p.leanY += 2 * g;
      p.leftY += 5 * g;
      break;
    case "glance":
      p.headAngle += 0.06 * g;
      p.headY -= g;
      break;
  }
  if (view.scene >= 4) {
    // 公共区保持同一张站姿底片，步态由腿部网格和重心连续变化。
    if (view.action === "walking") {
      const gait = t * 5.4 * f + phase;
      const k = walkingProgress(plan, view, tick);
      const amount = smooth(Math.min(k, 1 - k) / 0.2);
      p.stride = Math.sin(gait) * 2.7 * amount;
      p.walkBob = Math.cos(gait * 2) * 0.35 * amount;
      p.leanX += Math.sin(gait) * 0.5 * amount;
      p.leftY += Math.sin(gait) * 1.5 * amount;
      p.rightY -= Math.sin(gait) * 1.5 * amount;
    } else if (view.action === "washing") {
      p.headY += 1.1;
      p.leanY += 1.3;
      p.leftX += Math.sin(t * 3.4 * f + phase) * 0.8;
      p.rightX -= Math.sin(t * 3.4 * f + phase) * 0.8;
      p.leftY -= 2;
      p.rightY -= 2;
    }
  }
  const e = active?.event;
  if (e) {
    const w = eventWeight;
    if (e.kind === "peeking") {
      const dir = e.variant === 0 ? 1 : -1;
      p.leanX += dir * 26 * w;
      p.headAngle += dir * 0.09 * w;
      p.headY += 1.5 * w;
      p.leftX -= dir * 9 * w;
      p.rightX -= dir * 9 * w;
      p.rightX += Math.sin(t * 8.1 * f + phase) * 0.6 * w;
    } else if (e.kind === "device") {
      const dir = e.variant === 0 ? 1 : -1;
      p.leanY += 1.4 * w;
      p.headY += 1.2 * w;
      p.leftX += dir * 3 * w;
      p.rightX += dir * 3 * w;
      p.leftY += 2 * w;
      p.rightY += 2 * w;
    } else if (
      e.kind === "notes" ||
      (e.kind === "restroom" && e.variant === 0)
    ) {
      p.headY += 1.3 * w;
      p.leanY += w;
      p.leftY += 1.5 * w;
      p.rightY += 1.5 * w;
    } else if (e.kind === "passing" || e.kind === "restroom") {
      const other = plan.people[e.actors.find((id) => id !== view.person.id)!];
      const dir =
        e.kind === "passing"
          ? other?.col > view.person.col
            ? 1
            : -1
          : e.actors[0] === view.person.id
            ? 1
            : -1;
      p.leanX += dir * (e.kind === "passing" ? 11 : 3) * w;
      if (dir > 0) {
        p.rightX += 22 * w;
        p.rightY -= 3 * w;
        p.elbowRightX += 8 * w;
        p.elbowRightY -= 4 * w;
      } else {
        p.leftX -= 22 * w;
        p.leftY -= 3 * w;
        p.elbowLeftX -= 8 * w;
        p.elbowLeftY -= 4 * w;
      }
    }
  }
  return p;
}
