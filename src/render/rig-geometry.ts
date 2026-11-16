import { rigActors, projectRig, rigSeat } from "./rig-world.js";
import type { Plan, RecordEntry, ActorView } from "../engine/types.js";
import type { DrawOp } from "./geometry.js";

/** 纯数据约束测试的投影描述；浏览器会以真实蒙皮模型和深度射线替换拾取。 */
export function rigGeometry(
  plan: Plan,
  tick: number,
  scene: number,
  caught: ReadonlySet<string> = new Set(),
  records: readonly RecordEntry[] = [],
) {
  const ops: DrawOp[] = [
    {
      shape: { kind: "rect", x: 0, y: 0, w: 600, h: 350 },
      blocks: false,
      rigContext: { plan, tick, scene, caught, records },
    },
  ];
  if (scene < 4)
    for (const person of plan.people.filter((p) => p.room === scene)) {
      const seat = rigSeat(person);
      const points = [
        [-0.45, -0.31],
        [0.45, -0.31],
        [0.45, 0.31],
        [-0.45, 0.31],
      ].flatMap(([x, z]) => {
        const p = projectRig(scene, seat.x + x, 0.76, seat.z + 0.36 + z);
        return [p.x, p.y];
      });
      ops.push({ shape: { kind: "poly", points }, fill: "#a38b64" });
    }
  const actors: ActorView[] = [];
  for (const state of rigActors(plan, tick, caught, records).filter(
    (a) => a.scene === scene,
  )) {
    const head = projectRig(
      scene,
      state.x,
      1.22 + state.stand * 0.43,
      state.z - (1 - state.stand) * 0.34,
    );
    const feet = projectRig(scene, state.x, 0, state.z);
    const side = projectRig(scene, state.x + 0.25, 1.1, state.z);
    const w = Math.max(8, Math.abs(side.x - head.x) * 2);
    ops.push({
      shape: {
        kind: "rig-person",
        x: head.x - w / 2,
        y: head.y - w * 0.24,
        w,
        h: Math.max(12, feet.y - head.y),
        head,
        role: "person",
      },
      actorId: state.person.id,
    });
    actors.push({
      person: state.person,
      scene,
      x: head.x,
      y: head.y + 15,
      action: state.action,
      actionPhase: 0,
      event: state.event,
      phase: state.event
        ? tick < state.event.start
          ? "prepare"
          : "active"
        : undefined,
    });
  }
  return { ops, actors, backgroundCount: 0 };
}
