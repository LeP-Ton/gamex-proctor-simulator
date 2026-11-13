import { NORMAL_BEHAVIOR, seconds } from "./config.js";
import type { NormalAction } from "./config.js";
import { hash } from "./random.js";
import type { ActorView, Person, Plan, PlannedEvent, Visit } from "./types.js";

export const seatPosition = (person: Person) => ({
  x: 88 + person.col * 130 + person.row * 4,
  y: 112 + person.row * 77,
});
export const publicPosition = (slot: number) => ({
  x: 110 + slot * 125,
  y: 218 + (slot % 2) * 8,
});

export function normalBehavior(
  plan: Plan,
  person: Person,
  tick: number,
): { action: NormalAction; actionPhase: number } {
  const [min, max] = NORMAL_BEHAVIOR.cycleSeconds;
  const cycle = seconds(
    min + (hash(`${plan.config.seed}/period/${person.id}`) % (max - min + 1)),
  );
  const offset = hash(`${plan.config.seed}/offset/${person.id}`) % cycle;
  const local = tick + offset;
  const n = Math.floor(local / cycle);
  const phase = (local % cycle) / cycle;
  const actions = NORMAL_BEHAVIOR.actions;
  const selected =
    actions[
      hash(`${plan.config.seed}/normal/${person.id}/${n}`) % actions.length
    ];
  return {
    action: phase > NORMAL_BEHAVIOR.activeFraction ? "writing" : selected,
    actionPhase: phase / NORMAL_BEHAVIOR.activeFraction,
  };
}

export function visitAt(
  plan: Plan,
  actorId: number,
  tick: number,
): Visit | undefined {
  return plan.visits.find(
    (v) => v.actorId === actorId && v.depart <= tick && tick < v.returned,
  );
}
export function personScene(plan: Plan, person: Person, tick: number): number {
  const visit = visitAt(plan, person.id, tick);
  if (!visit) return person.room;
  return visit.arrive <= tick && tick < visit.exit ? visit.scene : -1;
}
export function actorViews(
  plan: Plan,
  tick: number,
  caught: ReadonlySet<string> = new Set(),
): ActorView[] {
  return plan.people.flatMap((person) => {
    const visit = visitAt(plan, person.id, tick);
    const scene = personScene(plan, person, tick);
    if (scene < 0) return [];
    const event = plan.events.find(
      (e) =>
        e.scene === scene &&
        !caught.has(e.id) &&
        e.actors.includes(person.id) &&
        e.prepare <= tick &&
        tick < e.end,
    );
    const { action: normal, actionPhase } = normalBehavior(plan, person, tick);
    let position = seatPosition(person);
    let action = normal;
    if (visit) {
      const normalPublic: NormalAction =
        hash(`${person.id}/visit`) % 4 === 0
          ? "bag"
          : hash(`${person.id}/visit`) % 4 === 1
            ? "waiting"
            : "washing";
      position = {
        ...publicPosition(visit.slot),
        y:
          !visit.eventId && normalPublic === "washing"
            ? 141
            : publicPosition(visit.slot).y,
      };
      const walkingIn = tick - visit.arrive < NORMAL_BEHAVIOR.publicWalk;
      const walkingOut = visit.exit - tick < NORMAL_BEHAVIOR.publicWalk;
      const k = walkingIn
        ? (tick - visit.arrive) / NORMAL_BEHAVIOR.publicWalk
        : walkingOut
          ? (visit.exit - tick) / NORMAL_BEHAVIOR.publicWalk
          : 1;
      position = {
        x: 43 + (position.x - 43) * k,
        y: 283 + (position.y - 283) * k,
      };
      action =
        walkingIn || walkingOut
          ? "walking"
          : visit.eventId
            ? "waiting"
            : normalPublic;
    }
    return [
      {
        person,
        scene,
        ...position,
        slot: visit?.slot,
        action,
        actionPhase,
        event,
        phase: event ? (tick < event.start ? "prepare" : "active") : undefined,
      },
    ];
  });
}
export function activeEvent(
  plan: Plan,
  scene: number,
  actorId: number,
  tick: number,
  caught: ReadonlySet<string>,
): PlannedEvent | undefined {
  const person = plan.people[actorId];
  if (!person || personScene(plan, person, tick) !== scene) return undefined;
  return plan.events.find(
    (e) =>
      e.scene === scene &&
      e.actors.includes(actorId) &&
      e.start <= tick &&
      tick < e.end &&
      !caught.has(e.id),
  );
}
