import { BALANCE, DIFFICULTIES, seconds } from "./config.js";
import type { CheatKind, GameConfig } from "./config.js";
import { Random } from "./random.js";
import type { Person, Plan, PlannedEvent, Visit } from "./types.js";

const overlap = (a: number, b: number, c: number, d: number) => a < d && c < b;
type Reservation = { ids: number[]; start: number; end: number };
class ScheduleConflict extends Error {
  override name = "ScheduleConflict";
}

export function createPeople(): Person[] {
  const rng = new Random("gamex-stable-students-v1");
  const names = [
    "林",
    "陈",
    "周",
    "许",
    "苏",
    "沈",
    "陆",
    "何",
    "方",
    "程",
    "叶",
    "夏",
  ];
  const shirts = [
    "#668b9a",
    "#d7a46a",
    "#b37c77",
    "#7d9c82",
    "#9383a8",
    "#e2d4ad",
    "#7584ab",
    "#bd8a61",
  ];
  return Array.from({ length: 48 }, (_, id) => ({
    id,
    name: `${names[id % 12]}同学`,
    room: Math.floor(id / 12),
    seat: (id % 12) + 1,
    row: Math.floor((id % 12) / 4),
    col: id % 4,
    gender: id % 3 === 0 || id % 5 === 0 ? "female" : "male",
    skin: rng.pick(["#efc2a1", "#dba481", "#bd8866", "#f2cfb4"]),
    shirt: rng.pick(shirts),
    hair: rng.pick(["#3d3633", "#4c3b30", "#303638"]),
    hairstyle: rng.int(0, 3),
  }));
}

export function buildPlan(config: GameConfig): Plan {
  // 首次完整保留原随机流；只有明确的贪心预约死路才确定性重排，不缩短任何窗口。
  for (let attempt = 0; ; attempt++) {
    try {
      return buildPlanAttempt(config, attempt);
    } catch (error) {
      if (!(error instanceof ScheduleConflict) || config.ruleVersion !== "1.1.0" || attempt >= 11)
        throw error;
    }
  }
}

function buildPlanAttempt(config: GameConfig, attempt: number): Plan {
  const people = createPeople();
  const retry = attempt === 0 ? "" : `|schedule-retry-${attempt}`;
  const rng = new Random(
    `${config.seed}|events|${config.difficulty}|${config.duration}|${config.ruleVersion}${retry}`,
  );
  const rules = DIFFICULTIES[config.difficulty];
  const events: PlannedEvent[] = [];
  const visits: Visit[] = [];
  const reservations: Reservation[] = [];
  const homePassages: { room: number; start: number; end: number }[] = [];
  const publicPassages: { scene: number; side: number; start: number; end: number }[] = [];
  // 新版完整走门路线需要真实行走时间；旧规则保留原预约与随机结果。
  const rig = config.ruleVersion === "1.1.0";
  const travel = rig ? seconds(14) : BALANCE.travel;
  const visitLead = rig ? seconds(10) : BALANCE.visitLead;
  const visitTail = rig ? seconds(7) : BALANCE.visitTail;
  const normalLength = rig
    ? [seconds(44), seconds(50)]
    : BALANCE.normalVisitLength;
  // 每一组预先拥有固定的时间区间；举报不会使后续机会增加或提前。
  const count = config.tutorial ? 8 : rules.count;
  const opening = rig
    ? seconds(28)
    : config.tutorial
      ? seconds(4)
      : BALANCE.opening;
  const ending = rig ? seconds(28) : BALANCE.endingRecovery;
  const groups: number[] = [];
  for (let remaining = count; remaining > 0; ) {
    const progress = (count - remaining) / count;
    const pressure = BALANCE.pressureRanges.some(
      ([from, to]) => progress > from && progress < to,
    );
    const n = Math.min(remaining, pressure ? rules.concurrency : 1);
    groups.push(n);
    remaining -= n;
  }
  const kinds: CheatKind[] = [
    "device",
    "notes",
    "peeking",
    "passing",
    "restroom",
  ];
  const deck: CheatKind[] = [];
  while (deck.length < count) deck.push(...rng.shuffle(kinds));
  const groupSpace = (config.duration - opening - ending) / groups.length;
  let eventIndex = 0;
  const free = (ids: number[], start: number, end: number) =>
    !reservations.some(
      (r) =>
        ids.some((id) => r.ids.includes(id)) &&
        overlap(start, end, r.start, r.end),
    );
  // 最长右过道约4.84秒，另含开门、跨门与镜头外连接；不能把排队代价挤成返程急跑。
  const passageTime = seconds(8.5), headway = seconds(0.75);
  const homeFree = (ids: number[], arrive: number, exit: number) => {
    if (!rig) return true;
    const rooms = ids.map((id) => people[id].room);
    if (new Set(rooms).size !== rooms.length) return false;
    return !homePassages.some((reserved) => rooms.includes(reserved.room) &&
      (overlap(arrive - passageTime, arrive, reserved.start, reserved.end) ||
       overlap(exit, exit + passageTime, reserved.start, reserved.end)));
  };
  const reserveHome = (id: number, arrive: number, exit: number) => {
    if (!rig) return;
    homePassages.push({ room: people[id].room, start: arrive - passageTime, end: arrive },
      { room: people[id].room, start: exit, end: exit + passageTime });
  };
  const publicRanges = (arrive: number, exit: number, slots: number[]) => [-1, 1].flatMap((side) => {
    const count = slots.filter((slot) => (slot < 2 ? -1 : 1) === side).length;
    return count ? [{ side, start: arrive, end: arrive + count * headway },
      { side, start: exit - count * headway, end: exit }] : [];
  });
  const publicFree = (scene: number, arrive: number, exit: number, slots: number[]) => !rig ||
    publicRanges(arrive, exit, slots).every((range) => !publicPassages.some((reserved) =>
      reserved.scene === scene && reserved.side === range.side && overlap(range.start, range.end, reserved.start, reserved.end)));
  const reservePublic = (scene: number, arrive: number, exit: number, slots: number[]) => {
    if (rig) publicPassages.push(...publicRanges(arrive, exit, slots).map((range) => ({ scene, ...range })));
  };
  const availableSlots = (
    scene: number,
    depart: number,
    returned: number,
    n: number,
  ): number[] | null => {
    for (let first = 0; first + n <= 4; first++) {
      const slots = Array.from({ length: n }, (_, i) => first + i);
      if (
        publicFree(scene, depart + travel, returned - travel, slots) && !visits.some(
          (v) =>
            v.scene === scene &&
            slots.includes(v.slot) &&
            overlap(depart + travel, returned - travel, v.arrive, v.exit),
        )
      )
        return slots;
    }
    return null;
  };
  for (let group = 0; group < groups.length; group++) {
    const groupScenes: number[] = [];
    for (let member = 0; member < groups[group]; member++) {
      const kind = deck[eventIndex];
      const variant = rng.int(0, 1);
      const start = Math.round(
        opening + group * groupSpace + rng.int(0, BALANCE.groupJitter),
      );
      const end =
        start + rng.int(seconds(rules.window[0]), seconds(rules.window[1]));
      const prepare = start - rng.int(BALANCE.prepare[0], BALANCE.prepare[1]);
      const possibleScenes = rng
        .shuffle(kind === "restroom" ? [4, 5] : [0, 1, 2, 3])
        .filter((s) => !groupScenes.includes(s));
      let selected: PlannedEvent | undefined;
      for (const scene of possibleScenes) {
        // 明确阶段按机位独占；准备允许发生在不同人物身上，仍受全局预算约束。
        if (
          events.some(
            (e) => e.scene === scene && overlap(start, end, e.start, e.end),
          )
        )
          continue;
        const candidates = rng.shuffle(
          people.filter((p) =>
            scene < 4
              ? p.room === scene
              : p.gender === (scene === 4 ? "male" : "female"),
          ),
        );
        for (const actor of candidates) {
          let actors = [actor.id];
          let relatedId: number | undefined;
          const from =
            kind === "restroom"
              ? start - visitLead - travel
              : prepare - BALANCE.actorRecovery;
          const to =
            end +
            (kind === "restroom" ? visitTail + travel : BALANCE.actorRecovery);
          if (kind === "passing" || kind === "peeking") {
            const other = people.find(
              (p) =>
                p.room === scene &&
                p.row === actor.row &&
                p.col === actor.col + (variant === 0 ? 1 : -1),
            );
            if (!other) continue;
            if (kind === "passing") actors.push(other.id);
            else relatedId = other.id;
          }
          if (kind === "restroom" && variant === 1) {
            const other = candidates.find(
              (p) =>
                p.id !== actor.id &&
                // 新行程要检查从离座到回座的整段预约，不能只选短窗口空闲的同伴。
                free(
                  [p.id],
                  rig ? from : start - seconds(10),
                  rig ? to : end + seconds(8),
                ) && homeFree([actor.id, p.id], from + travel, end + visitTail),
            );
            if (!other) continue;
            actors.push(other.id);
          }
          const reservedIds =
            relatedId === undefined ? actors : [...actors, relatedId];
          if (!free(reservedIds, from, to)) continue;
          if (kind === "restroom" && !homeFree(actors, from + travel, end + visitTail)) continue;
          const slots =
            kind === "restroom"
              ? availableSlots(scene, from, to, actors.length)
              : [];
          if (!slots) continue;
          selected = {
            id: `EV-${String(eventIndex + 1).padStart(3, "0")}`,
            kind,
            scene,
            actors,
            relatedId,
            variant,
            prepare,
            start,
            end,
          };
          reservations.push({ ids: reservedIds, start: from, end: to });
          if (kind === "restroom") {
            actors.forEach((id, i) =>
              visits.push({
                actorId: id,
                scene,
                slot: slots[i],
                depart: from,
                arrive: from + travel,
                exit: end + visitTail,
                returned: to,
                eventId: selected!.id,
              }),
            );
            for (const id of actors) reserveHome(id, from + travel, end + visitTail);
            reservePublic(scene, from + travel, end + visitTail, slots);
          }
          break;
        }
        if (selected) {
          groupScenes.push(scene);
          events.push(selected);
          break;
        }
      }
      if (!selected)
        throw new ScheduleConflict(
          `事件调度失败：${config.seed} / ${config.difficulty} / ${eventIndex} / ${kind}`,
        );
      eventIndex++;
    }
  }
  // 进出公共区本身不是异常。普通来访使用独立随机流并避开所有人物预约。
  const normal = new Random(`${config.seed}|normal-visits`);
  for (let scene = 4; scene < 6; scene++) {
    for (
      let t = seconds(1);
      t < config.duration - (rig ? normalLength[0] : seconds(20));
      t += normal.int(
        BALANCE.normalVisitSpacing[0],
        BALANCE.normalVisitSpacing[1],
      )
    ) {
      const depart = t;
      const returned = Math.min(
        config.duration,
        t + normal.int(normalLength[0], normalLength[1]),
      );
      const actor = normal
        .shuffle(
          people.filter((p) => p.gender === (scene === 4 ? "male" : "female")),
        )
        .find((p) =>
          free(
            [p.id],
            depart - BALANCE.normalVisitMargin,
            returned + BALANCE.normalVisitMargin,
          ) && homeFree([p.id], depart + travel, returned - travel),
        );
      const slots = availableSlots(scene, depart, returned, 1);
      if (!actor || !slots) continue;
      visits.push({
        actorId: actor.id,
        scene,
        slot: slots[0],
        depart,
        arrive: depart + travel,
        exit: returned - travel,
        returned,
      });
      reserveHome(actor.id, depart + travel, returned - travel);
      reservePublic(scene, depart + travel, returned - travel, slots);
      reservations.push({
        ids: [actor.id],
        start: depart - BALANCE.normalVisitMargin,
        end: returned + BALANCE.normalVisitMargin,
      });
    }
  }
  return {
    config: { ...config },
    people,
    events: events.sort(
      (a, b) => a.start - b.start || a.id.localeCompare(b.id),
    ),
    visits,
  };
}

export function validatePlan(plan: Plan): string[] {
  const errors: string[] = [];
  const rules = DIFFICULTIES[plan.config.difficulty];
  if (plan.events.length !== (plan.config.tutorial ? 8 : rules.count))
    errors.push("计分事件总数不符");
  for (const event of plan.events) {
    if (
      event.start < 0 ||
      event.end > plan.config.duration ||
      event.end <= event.start
    )
      errors.push(`${event.id} 没有完整窗口`);
    if (
      event.end - event.start < seconds(rules.window[0]) ||
      event.end - event.start > seconds(rules.window[1])
    )
      errors.push(`${event.id} 窗口越界`);
    if (
      event.kind === "restroom" &&
      event.actors.some(
        (id) =>
          !plan.visits.some(
            (v) =>
              v.eventId === event.id &&
              v.actorId === id &&
              v.arrive <= event.prepare &&
              v.exit >= event.end,
          ),
      )
    )
      errors.push(`${event.id} 人物未到达`);
    for (const other of plan.events) {
      if (
        other === event ||
        !overlap(event.start, event.end, other.start, other.end)
      )
        continue;
      if (event.scene === other.scene) errors.push(`${event.id} 机位冲突`);
    }
  }
  const points = [
    ...new Set(plan.events.flatMap((e) => [e.prepare, e.start, e.end])),
  ];
  for (const t of points) {
    if (
      plan.events.filter((e) => e.start <= t && t < e.end).length >
      rules.concurrency
    )
      errors.push("明确阶段并发超限");
    if (
      plan.events.filter((e) => e.prepare <= t && t < e.start).length >
      BALANCE.preparationBudget
    )
      errors.push("准备预算超限");
  }
  for (const person of plan.people) {
    const visits = plan.visits.filter((v) => v.actorId === person.id);
    const participations = plan.events.filter(
      (e) => e.actors.includes(person.id) || e.relatedId === person.id,
    );
    if (
      participations.some((e, i) =>
        participations
          .slice(i + 1)
          .some((other) => overlap(e.prepare, e.end, other.prepare, other.end)),
      )
    )
      errors.push("人物同时参与冲突事件");
    if (
      visits.some((v, i) =>
        visits
          .slice(i + 1)
          .some((w) => overlap(v.depart, v.returned, w.depart, w.returned)),
      )
    )
      errors.push("人物行程冲突");
    for (const event of plan.events.filter(
      (e) =>
        e.scene < 4 &&
        (e.actors.includes(person.id) || e.relatedId === person.id),
    )) {
      if (
        visits.some((v) =>
          overlap(event.prepare, event.end, v.depart, v.returned),
        )
      )
        errors.push("考场人物缺席");
    }
  }
  for (const visit of plan.visits) {
    if (
      !(
        visit.depart < visit.arrive &&
        visit.arrive < visit.exit &&
        visit.exit < visit.returned
      )
    )
      errors.push("公共区行程顺序不正确");
    if (
      plan.people[visit.actorId].gender !==
      (visit.scene === 4 ? "male" : "female")
    )
      errors.push("公共区人物分配不符");
    if (
      plan.visits.some(
        (other) =>
          other !== visit &&
          other.scene === visit.scene &&
          other.slot === visit.slot &&
          overlap(visit.arrive, visit.exit, other.arrive, other.exit),
      )
    )
      errors.push("公共区站位冲突");
  }
  return [...new Set(errors)];
}
