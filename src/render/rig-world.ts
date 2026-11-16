import { PerspectiveCamera, Vector3 } from "three";
import { TICK_RATE, seconds } from "../engine/config.js";
import type { NormalAction } from "../engine/config.js";
import { hash } from "../engine/random.js";
import { normalBehavior } from "../engine/world.js";
import type {
  Person,
  Plan,
  PlannedEvent,
  RecordEntry,
  Visit,
} from "../engine/types.js";

export const RIG_STAND_TIME = seconds(0.8);
export const RIG_SETTLE_TIME = seconds(0.9);
export const RIG_WALK_CYCLE_METRES = 2.6;
const DOOR_OPEN_TIME = seconds(0.9);
const DOOR_REACH_TIME = seconds(0.3);
const DOOR_CROSS_TIME = seconds(1.3);
const QUEUE_HEADWAY = seconds(0.75);
const CROSSING_DISTANCE = 1.4;
const HALL_TIME = seconds(1);
const ROOM_X = [-2.7, -0.9, 0.9, 2.7];
const ROOM_Z = [-1.8, 0.5, 2.8];
const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const angleDelta = (a: number, b: number) =>
  Math.atan2(Math.sin(b - a), Math.cos(b - a));
const mixAngle = (a: number, b: number, t: number) => a + angleDelta(a, b) * t;

interface FloorPoint {
  x: number;
  z: number;
}
interface Route {
  points: readonly FloorPoint[];
  distances: readonly number[];
  length: number;
}
export type RigJourneyPhase =
  | "seated"
  | "standing-up"
  | "room-out"
  | "opening-door"
  | "crossing-out"
  | "public-in"
  | "public-stay"
  | "public-out"
  | "crossing-in"
  | "room-in"
  | "sitting-down";
export interface RigActorState {
  id: number;
  person: Person;
  scene: number;
  x: number;
  y: number;
  z: number;
  /** 人物正面朝 +Z 时为零，绕 +Y 旋转；由行走路径切线决定。 */
  heading: number;
  /** 0 为坐姿，1 为站姿；起身和落座有完整连续过渡。 */
  stand: number;
  walkDistance: number;
  /** 连续弧度相位；每 2.6 米是模型原生步行动画的一个完整周期。 */
  walkPhase: number;
  walkCycle: number;
  walkSpeed: number;
  action: NormalAction;
  normalAction: NormalAction;
  actionPhase: number;
  event?: PlannedEvent;
  eventWeight: number;
  eventActive: boolean;
  journeyPhase: RigJourneyPhase;
  doorReach: number;
  visit?: Visit;
}

export function rigSeat(person: Person): FloorPoint {
  return { x: ROOM_X[person.col], z: ROOM_Z[person.row] };
}

function length(a: FloorPoint, b: FloorPoint) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}
function between(a: FloorPoint, b: FloorPoint, t: number): FloorPoint {
  return { x: mix(a.x, b.x, t), z: mix(a.z, b.z, t) };
}

/** 先把走廊折线圆角化，再按累计弧长采样；转弯不会瞬间横移或旋转九十度。 */
function route(nodes: readonly FloorPoint[], radius = 0.24): Route {
  const points: FloorPoint[] = [{ ...nodes[0] }];
  for (let i = 1; i < nodes.length - 1; i++) {
    const previous = nodes[i - 1],
      current = nodes[i],
      next = nodes[i + 1];
    const incoming = length(previous, current),
      outgoing = length(current, next);
    if (incoming < 1e-6 || outgoing < 1e-6) continue;
    const turn = Math.min(radius, incoming * 0.35, outgoing * 0.35);
    const enter = between(current, previous, turn / incoming);
    const exit = between(current, next, turn / outgoing);
    points.push(enter);
    for (let sample = 1; sample <= 12; sample++) {
      const t = sample / 12,
        n = 1 - t;
      points.push({
        x: n * n * enter.x + 2 * n * t * current.x + t * t * exit.x,
        z: n * n * enter.z + 2 * n * t * current.z + t * t * exit.z,
      });
    }
  }
  points.push({ ...nodes.at(-1)! });
  const distances = [0];
  for (let i = 1; i < points.length; i++)
    distances.push(distances[i - 1] + length(points[i - 1], points[i]));
  return { points, distances, length: distances.at(-1)! };
}
function reverseRoute(value: Route): Route {
  const points = [...value.points].reverse();
  const distances = value.distances.map(
    (_, i) => value.length - value.distances[value.distances.length - 1 - i],
  );
  return { points, distances, length: value.length };
}
function routePoint(value: Route, metres: number): FloorPoint {
  const distance = clamp(metres, 0, value.length);
  let low = 1,
    high = value.distances.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (value.distances[middle] < distance) low = middle + 1;
    else high = middle;
  }
  const previous = Math.max(0, low - 1);
  const span = value.distances[low] - value.distances[previous];
  return between(
    value.points[previous],
    value.points[low],
    span > 0 ? (distance - value.distances[previous]) / span : 0,
  );
}
function routeHeading(value: Route, metres: number) {
  const a = routePoint(value, metres - 0.12),
    b = routePoint(value, metres + 0.12);
  return Math.atan2(b.x - a.x, b.z - a.z);
}

const routeSplits = new WeakMap<Route, Map<number, readonly [Route, Route]>>();
function splitRoute(value: Route, metres: number): readonly [Route, Route] {
  let cached = routeSplits.get(value);
  if (!cached) {
    cached = new Map();
    routeSplits.set(value, cached);
  }
  const distance = clamp(metres, 0, value.length);
  let parts = cached.get(distance);
  if (!parts) {
    const cut = routePoint(value, distance);
    const build = (points: readonly FloorPoint[]): Route => {
      const distances = [0];
      for (let i = 1; i < points.length; i++)
        distances.push(distances[i - 1] + length(points[i - 1], points[i]));
      return { points, distances, length: distances.at(-1)! };
    };
    parts = [
      build([
        ...value.points.filter((_, i) => value.distances[i] < distance),
        cut,
      ]),
      build([
        cut,
        ...value.points.filter((_, i) => value.distances[i] > distance),
      ]),
    ];
    cached.set(distance, parts);
  }
  return parts;
}

/** 加减速只占短暂的起止阶段，中段匀速；脚步相位来自路程而非墙钟。 */
function progress(value: Route, tick: number, start: number, end: number) {
  const duration = Math.max(0.05, (end - start) / TICK_RATE);
  const t = clamp((tick - start) / TICK_RATE, 0, duration);
  const ramp = Math.min(0.28, duration / 4),
    speed = value.length / (duration - ramp);
  let distance: number, velocity: number;
  if (t < ramp) {
    distance = (speed * t * t) / (2 * ramp);
    velocity = (speed * t) / ramp;
  } else if (t > duration - ramp) {
    const remaining = duration - t;
    distance = value.length - (speed * remaining * remaining) / (2 * ramp);
    velocity = (speed * remaining) / ramp;
  } else {
    distance = speed * (t - ramp / 2);
    velocity = speed;
  }
  return {
    ...routePoint(value, distance),
    heading: routeHeading(value, distance),
    distance,
    speed: velocity,
  };
}

const roomRoutes = new WeakMap<
  Plan,
  Map<number, { outward: Route; inward: Route; split: number }>
>();
function roomRoute(plan: Plan, person: Person) {
  let saved = roomRoutes.get(plan);
  if (!saved) {
    saved = new Map();
    roomRoutes.set(plan, saved);
  }
  let value = saved.get(person.id);
  if (!value) {
    const seat = rigSeat(person);
    const outward = route([
      seat,
      { x: seat.x + 0.72, z: seat.z - 0.18 },
      { x: seat.x + 0.72, z: seat.z - 0.85 },
      { x: 4, z: seat.z - 0.85 },
      { x: 4, z: -3.6 },
      { x: 4.25, z: -3.6 },
    ]);
    const split =
      outward.distances[
        outward.points.findIndex(
          (point) =>
            point.x >= 3.7 && Math.abs(point.z - (seat.z - 0.85)) < 1e-6,
        )
      ];
    value = { outward, inward: reverseRoute(outward), split };
    saved.set(person.id, value);
  }
  return value;
}

// 共用过道保持相同节奏，行间时长承担座位距离差；后人不会在门前追上慢走的前人。
function roomProgress(
  value: Route,
  split: number,
  tick: number,
  start: number,
  end: number,
  returning = false,
) {
  const [first, second] = splitRoute(value, split);
  const common = returning ? first : second;
  const commonTicks = seconds(common.length / 1.25 + 0.28);
  const other = returning ? second : first;
  // 门后礼让占用余量时，整段均匀加快，避免把全部赶路压力压到最后的行间短段。
  if (end - start < commonTicks + seconds(other.length / 1.8 + 0.28))
    return progress(value, tick, start, end);
  const middle = returning ? start + commonTicks : end - commonTicks;
  if (tick < middle) return progress(first, tick, start, middle);
  const p = progress(second, tick, middle, end);
  return { ...p, distance: first.length + p.distance };
}

function publicAction(visit: Visit): NormalAction {
  if (visit.eventId) return "waiting";
  const choice = hash(`${visit.actorId}/visit`) % 4;
  return choice === 0 ? "bag" : choice === 1 ? "waiting" : "washing";
}
function publicRoute(visit: Visit) {
  const target = {
    x: ROOM_X[visit.slot],
    z: publicAction(visit) === "washing" ? -2.8 : 0.5,
  };
  const side = target.x < 0 ? -1 : 1;
  const outward = route([
    { x: side * 7.8, z: 1.1 },
    { x: side * 3.85, z: 1.1 },
    ...(visit.eventId ? [{ x: side * 3.85, z: 1.8 }] : []),
    publicAction(visit) === "washing"
      ? { x: target.x, z: 1.1 }
      : { x: target.x + side * 0.6, z: target.z },
    target,
  ]);
  return { target, incoming: outward, outgoing: reverseRoute(outward) };
}
const publicRoutes = new WeakMap<
  Plan,
  Map<Visit, ReturnType<typeof publicRoute>>
>();
function visitRoute(plan: Plan, visit: Visit) {
  let saved = publicRoutes.get(plan);
  if (!saved) {
    saved = new Map();
    publicRoutes.set(plan, saved);
  }
  let value = saved.get(visit);
  if (!value) {
    value = publicRoute(visit);
    saved.set(visit, value);
  }
  return value;
}
function originalDoorTimes(visit: Visit) {
  const leaveEnd = visit.arrive - HALL_TIME;
  const leaveCross = leaveEnd - DOOR_CROSS_TIME;
  const leaveOpen = leaveCross - DOOR_OPEN_TIME;
  const returnCross = visit.exit + HALL_TIME;
  return {
    leaveEnd,
    leaveCross,
    leaveOpen,
    returnCross,
    returnOpen: returnCross - DOOR_OPEN_TIME,
    returnWalk: returnCross + DOOR_CROSS_TIME,
    following: false,
  };
}
type DoorTiming = ReturnType<typeof originalDoorTimes>;
const doorQueues = new WeakMap<Plan, Map<Visit, DoorTiming>>();
function doorTimes(plan: Plan, visit: Visit): DoorTiming {
  let saved = doorQueues.get(plan);
  if (!saved) {
    saved = new Map(
      plan.visits.map((candidate) => [candidate, originalDoorTimes(candidate)]),
    );
    for (let room = 0; room < 4; room++) {
      const sameRoom = plan.visits.filter(
        (candidate) => plan.people[candidate.actorId].room === room,
      );
      const outward = [...sameRoom].sort(
        (a, b) =>
          a.arrive - b.arrive ||
          plan.people[a.actorId].row - plan.people[b.actorId].row ||
          roomRoute(plan, plan.people[a.actorId]).outward.length -
            roomRoute(plan, plan.people[b.actorId]).outward.length ||
          a.actorId - b.actorId,
      );
      for (let i = outward.length - 2; i >= 0; i--) {
        const time = saved.get(outward[i])!,
          next = saved.get(outward[i + 1])!;
        time.leaveEnd = Math.min(time.leaveEnd, next.leaveEnd - QUEUE_HEADWAY);
        time.leaveCross = time.leaveEnd - DOOR_CROSS_TIME;
        time.leaveOpen = time.leaveCross - DOOR_OPEN_TIME;
      }
      for (let i = 1; i < outward.length; i++) {
        const time = saved.get(outward[i])!,
          previous = saved.get(outward[i - 1])!;
        time.following =
          time.leaveCross - previous.leaveCross <
          DOOR_CROSS_TIME + DOOR_OPEN_TIME;
      }
      const inward = [...sameRoom].sort(
        (a, b) => a.exit - b.exit || a.actorId - b.actorId,
      );
      for (let i = 0; i < inward.length; i++) {
        const time = saved.get(inward[i])!,
          previous = i > 0 ? saved.get(inward[i - 1])! : undefined;
        if (previous)
          time.returnCross = Math.max(
            time.returnCross,
            previous.returnCross + QUEUE_HEADWAY,
          );
        // 门洞是双向共享资源；回程在走廊等待，不能与正在开门或出门的人对穿。
        for (const leaving of outward) {
          const reserved = saved.get(leaving)!;
          if (
            time.returnCross < reserved.leaveEnd + seconds(0.4) &&
            reserved.leaveOpen - seconds(0.4) <
              time.returnCross + DOOR_CROSS_TIME
          )
            time.returnCross = reserved.leaveEnd + seconds(0.4);
        }
        time.returnOpen = time.returnCross - DOOR_OPEN_TIME;
        time.returnWalk = time.returnCross + DOOR_CROSS_TIME;
      }
    }
    doorQueues.set(plan, saved);
  }
  return saved.get(visit)!;
}
const publicQueues = new WeakMap<
  Plan,
  Map<Visit, { arrive: number; exit: number }>
>();
function publicTimes(plan: Plan, visit: Visit) {
  let saved = publicQueues.get(plan);
  if (!saved) {
    saved = new Map(
      plan.visits.map((candidate) => [
        candidate,
        { arrive: candidate.arrive, exit: candidate.exit },
      ]),
    );
    for (const direction of ["arrive", "exit"] as const) {
      const groups = new Map<string, Visit[]>();
      for (const candidate of plan.visits) {
        const key = `${candidate.scene}/${candidate[direction]}/${candidate.slot < 2 ? -1 : 1}`;
        const group = groups.get(key) ?? [];
        group.push(candidate);
        groups.set(key, group);
      }
      for (const group of groups.values()) {
        group.sort(
          (a, b) =>
            Math.abs(ROOM_X[b.slot]) - Math.abs(ROOM_X[a.slot]) ||
            a.actorId - b.actorId,
        );
        group.forEach((candidate, i) => {
          saved!.get(candidate)![direction] +=
            direction === "arrive"
              ? i * QUEUE_HEADWAY
              : -(group.length - 1 - i) * QUEUE_HEADWAY;
        });
      }
    }
    publicQueues.set(plan, saved);
  }
  return saved.get(visit)!;
}
function eventPose(
  plan: Plan,
  person: Person,
  scene: number,
  tick: number,
  caught: ReadonlySet<string>,
  records: readonly RecordEntry[],
) {
  let event: PlannedEvent | undefined,
    eventWeight = 0,
    eventActive = false;
  for (const candidate of plan.events) {
    if (
      candidate.scene !== scene ||
      !candidate.actors.includes(person.id) ||
      tick < candidate.prepare
    )
      continue;
    const capture = records.find(
      (record) =>
        record.eventId === candidate.id && record.verdict === "caught",
    );
    if (caught.has(candidate.id) && !capture) continue;
    const end = capture?.tick ?? candidate.end;
    if (
      tick >= end + RIG_SETTLE_TIME ||
      (event && event.prepare > candidate.prepare)
    )
      continue;
    event = candidate;
    eventWeight =
      smooth(
        (tick - candidate.prepare) /
          Math.max(1, candidate.start - candidate.prepare),
      ) *
      (1 - smooth((tick - end) / RIG_SETTLE_TIME));
    eventActive =
      candidate.start <= tick &&
      tick < candidate.end &&
      !caught.has(candidate.id);
  }
  return { event, eventWeight, eventActive };
}
function stationaryHeading(visit: Visit, event?: PlannedEvent) {
  if (publicAction(visit) === "washing") return Math.PI;
  if (event?.variant === 1 && event.actors.length > 1)
    return event.actors[0] === visit.actorId ? Math.PI / 2 : -Math.PI / 2;
  return 0;
}
function walkFields(distance: number, speed: number) {
  const walkCycle = distance / RIG_WALK_CYCLE_METRES;
  return {
    walkDistance: distance,
    walkSpeed: speed,
    walkCycle,
    walkPhase: walkCycle * Math.PI * 2,
  };
}

function actorForVisit(
  plan: Plan,
  person: Person,
  visit: Visit,
  tick: number,
  caught: ReadonlySet<string>,
  records: readonly RecordEntry[],
): RigActorState | undefined {
  const room = roomRoute(plan, person),
    pub = visitRoute(plan, visit),
    times = doorTimes(plan, visit);
  const publicTime = publicTimes(plan, visit);
  const seat = rigSeat(person),
    normal = normalBehavior(plan, person, tick);
  const crossingDistance = CROSSING_DISTANCE,
    roomDistance = room.outward.length + crossingDistance;
  const base = (
    scene: number,
    action: NormalAction,
    phase: RigJourneyPhase,
  ): RigActorState => ({
    id: person.id,
    person,
    scene,
    ...seat,
    y: 0,
    heading: 0,
    stand: 1,
    ...walkFields(0, 0),
    action,
    normalAction: action,
    actionPhase: normal.actionPhase,
    ...eventPose(plan, person, scene, tick, caught, records),
    journeyPhase: phase,
    doorReach: 0,
    visit,
  });
  if (tick < visit.depart) {
    const standing = smooth(
      (tick - (visit.depart - RIG_STAND_TIME)) / RIG_STAND_TIME,
    );
    return {
      ...base(person.room, "waiting", "standing-up"),
      stand: standing,
      heading: mixAngle(
        0,
        routeHeading(room.outward, 0),
        smooth((standing - 0.3) / 0.7),
      ),
    };
  }
  if (tick < times.leaveOpen) {
    const outward = times.following
      ? splitRoute(room.outward, room.outward.length - 0.7)[0]
      : room.outward;
    const p = roomProgress(
      outward,
      room.split,
      tick,
      visit.depart,
      times.leaveOpen,
    );
    return {
      ...base(person.room, "walking", "room-out"),
      ...p,
      ...walkFields(p.distance, p.speed),
    };
  }
  if (tick < times.leaveCross) {
    if (times.following) {
      const last = splitRoute(room.outward, room.outward.length - 0.7)[1];
      const p = progress(last, tick, times.leaveOpen, times.leaveCross);
      return {
        ...base(person.room, "walking", "opening-door"),
        ...p,
        ...walkFields(room.outward.length - 0.7 + p.distance, p.speed),
      };
    }
    const elapsed = tick - times.leaveOpen;
    return {
      ...base(person.room, "waiting", "opening-door"),
      x: 4.25,
      z: -3.6,
      heading: Math.PI / 2,
      doorReach:
        smooth(elapsed / DOOR_REACH_TIME) *
        (1 - 0.45 * smooth((elapsed - seconds(0.7)) / seconds(0.2))),
      ...walkFields(room.outward.length, 0),
    };
  }
  if (tick < times.leaveEnd) {
    const cross = route([
      { x: 4.25, z: -3.6 },
      { x: 5.65, z: -3.6 },
    ]);
    const p = progress(cross, tick, times.leaveCross, times.leaveEnd);
    return {
      ...base(person.room, "walking", "crossing-out"),
      ...p,
      doorReach:
        0.55 * (1 - smooth((tick - times.leaveCross) / DOOR_CROSS_TIME)),
      ...walkFields(room.outward.length + p.distance, p.speed),
    };
  }
  if (tick < publicTime.arrive) return undefined;
  if (tick < visit.exit) {
    if (tick >= publicTime.exit) return undefined;
    const event = visit.eventId
      ? plan.events.find((candidate) => candidate.id === visit.eventId)
      : undefined;
    const pose = eventPose(plan, person, visit.scene, tick, caught, records);
    const turn = seconds(0.8),
      publicTicks = publicTime.exit - publicTime.arrive;
    const ordinaryBudget = Math.max(1, (publicTicks - seconds(1)) / 2 - turn);
    const desired = seconds(pub.incoming.length / 1.2);
    const incomingBudget = event
      ? Math.max(1, event.prepare - publicTime.arrive - turn - seconds(0.15))
      : ordinaryBudget;
    const incomingTime = Math.min(desired, incomingBudget);
    const incomingEnd = publicTime.arrive + incomingTime;
    const outgoingBudget = event
      ? Math.max(1, publicTime.exit - event.end - RIG_SETTLE_TIME - turn)
      : ordinaryBudget;
    const outgoingTime = Math.min(desired, outgoingBudget);
    const outgoingBegin = publicTime.exit - outgoingTime;
    const waitingHeading = stationaryHeading(visit, event);
    const incomingHeading = routeHeading(pub.incoming, pub.incoming.length);
    const outgoingHeading = routeHeading(pub.outgoing, 0);
    if (tick < incomingEnd) {
      const p = progress(pub.incoming, tick, publicTime.arrive, incomingEnd);
      return {
        ...base(visit.scene, "walking", "public-in"),
        ...p,
        ...walkFields(roomDistance + p.distance, p.speed),
        ...pose,
        eventWeight: 0,
      };
    }
    if (tick >= outgoingBegin) {
      const p = progress(pub.outgoing, tick, outgoingBegin, publicTime.exit);
      return {
        ...base(visit.scene, "walking", "public-out"),
        ...p,
        ...walkFields(roomDistance + pub.incoming.length + p.distance, p.speed),
        ...pose,
        eventWeight: 0,
      };
    }
    let heading = mixAngle(
      incomingHeading,
      waitingHeading,
      smooth((tick - incomingEnd) / turn),
    );
    if (tick > outgoingBegin - turn)
      heading = mixAngle(
        waitingHeading,
        outgoingHeading,
        smooth((tick - (outgoingBegin - turn)) / turn),
      );
    return {
      ...base(visit.scene, publicAction(visit), "public-stay"),
      ...pub.target,
      heading,
      ...walkFields(roomDistance + pub.incoming.length, 0),
      ...pose,
    };
  }
  if (tick < times.returnCross) return undefined;
  const beforeReturn = roomDistance + pub.incoming.length * 2;
  if (tick < times.returnWalk) {
    const cross = route([
      { x: 5.65, z: -3.6 },
      { x: 4.25, z: -3.6 },
    ]);
    const p = progress(cross, tick, times.returnCross, times.returnWalk);
    return {
      ...base(person.room, "walking", "crossing-in"),
      ...p,
      ...walkFields(beforeReturn + p.distance, p.speed),
    };
  }
  if (tick < visit.returned) {
    const p = roomProgress(
      room.inward,
      room.inward.length - room.split,
      tick,
      times.returnWalk,
      visit.returned,
      true,
    );
    return {
      ...base(person.room, "walking", "room-in"),
      ...p,
      heading: mixAngle(
        p.heading,
        0,
        smooth((tick - (visit.returned - seconds(0.6))) / seconds(0.6)),
      ),
      ...walkFields(beforeReturn + crossingDistance + p.distance, p.speed),
    };
  }
  return {
    ...base(person.room, "waiting", "sitting-down"),
    stand: 1 - smooth((tick - visit.returned) / RIG_STAND_TIME),
    ...walkFields(beforeReturn + crossingDistance + room.inward.length, 0),
  };
}

/** 只为 rig-5 重建视觉行程；不改引擎位置、预约、计分时间表或已保存的旧局。 */
export function rigActors(
  plan: Plan,
  tick: number,
  caught: ReadonlySet<string> = new Set(),
  records: readonly RecordEntry[] = [],
): RigActorState[] {
  const actors: RigActorState[] = [];
  for (const person of plan.people) {
    const visit = plan.visits.find(
      (candidate) =>
        candidate.actorId === person.id &&
        candidate.depart - RIG_STAND_TIME <= tick &&
        tick < candidate.returned + RIG_STAND_TIME,
    );
    if (visit) {
      const state = actorForVisit(plan, person, visit, tick, caught, records);
      if (state) actors.push(state);
    } else {
      const normal = normalBehavior(plan, person, tick);
      actors.push({
        id: person.id,
        person,
        scene: person.room,
        ...rigSeat(person),
        y: 0,
        heading: 0,
        stand: 0,
        ...walkFields(0, 0),
        ...normal,
        normalAction: normal.action,
        ...eventPose(plan, person, person.room, tick, caught, records),
        journeyPhase: "seated",
        doorReach: 0,
      });
    }
  }
  return actors;
}
export const rigActorStates = rigActors;

function opening(tick: number, begin: number, close: number) {
  return (
    smooth(
      (tick - begin - DOOR_REACH_TIME) / (DOOR_OPEN_TIME - DOOR_REACH_TIME),
    ) *
    (1 - smooth((tick - close) / seconds(0.7)))
  );
}
export function rigDoorOpen(plan: Plan, tick: number, scene: number): number {
  if (scene >= 4) return 0;
  let open = 0;
  for (const visit of plan.visits) {
    if (plan.people[visit.actorId].room !== scene) continue;
    const times = doorTimes(plan, visit);
    open = Math.max(
      open,
      opening(tick, times.leaveOpen, times.leaveEnd + seconds(0.2)),
      opening(tick, times.returnOpen, times.returnWalk + seconds(0.2)),
    );
  }
  return open;
}
export function rigSceneState(
  plan: Plan,
  tick: number,
  scene: number,
  caught: ReadonlySet<string> = new Set(),
  records: readonly RecordEntry[] = [],
) {
  return {
    actors: rigActors(plan, tick, caught, records).filter(
      (actor) => actor.scene === scene,
    ),
    doorOpen: rigDoorOpen(plan, tick, scene),
  };
}

const cameras = new Map<number, PerspectiveCamera>();
function cameraFor(scene: number) {
  let camera = cameras.get(scene);
  if (!camera) {
    // 室内镜头同时覆盖十二个座位与右后门；朝向后方，避免扫入前墙近面。
    const views = [
      { position: [-4.1, 3.15, 4.45], target: [-0.6, -0.5, -0.4], fov: 65 },
      { position: [-4.3, 3.15, 4.45], target: [-0.6, -0.5, -0.4], fov: 65 },
      { position: [-4.3, 3.15, 4.65], target: [-0.6, -0.5, -0.4], fov: 65 },
      { position: [-4.1, 3.15, 4.65], target: [-0.6, -0.5, -0.4], fov: 65 },
    ];
    const view =
      scene < 4
        ? views[scene]
        : { position: [0.4, 3.1, 4.5], target: [0, 0.3, 0.2], fov: 62 };
    camera = new PerspectiveCamera(view.fov, 600 / 350, 0.1, 70);
    const position = view.position;
    camera.position.set(position[0], position[1], position[2]);
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
    camera.updateMatrixWorld(true);
    cameras.set(scene, camera);
  }
  return camera;
}
/** 返回副本，浏览器改绘制视口不会污染纯数据投影或另一个机位。 */
export function rigCamera(scene: number): PerspectiveCamera {
  return cameraFor(scene).clone();
}
export function projectRig(scene: number, x: number, y: number, z: number) {
  const camera = cameraFor(scene),
    point = new Vector3(x, y, z).project(camera);
  const higher = new Vector3(x, y + 1, z).project(camera);
  return {
    x: (point.x + 1) * 300,
    y: (1 - point.y) * 175,
    scale: Math.abs(higher.y - point.y) * 175,
    depth: point.z,
    visible:
      Math.abs(point.x) <= 1 &&
      Math.abs(point.y) <= 1 &&
      Math.abs(point.z) <= 1,
  };
}
