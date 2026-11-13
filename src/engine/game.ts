import { BALANCE, NORMAL_LABELS } from "./config.js";
import { activeEvent, actorViews } from "./world.js";
import type {
  Feedback,
  Plan,
  RecordEntry,
  ReportInput,
  Score,
} from "./types.js";

export class Game {
  tick = 0;
  readonly score: Score = {
    total: 0,
    caught: 0,
    missed: 0,
    false: 0,
    combo: 0,
    maxCombo: 0,
  };
  readonly caught = new Set<string>();
  readonly missed = new Set<string>();
  readonly inputs: ReportInput[] = [];
  readonly records: RecordEntry[] = [];
  readonly cooldown = Array<number>(6).fill(0);
  readonly protectedUntil = new Map<number, number>();
  feedback: Feedback[] = [];
  constructor(readonly plan: Plan) {}
  get ended() {
    return this.tick >= this.plan.config.duration;
  }
  get multiplier() {
    return BALANCE.combo.find((b) => this.score.combo >= b.at)?.multiplier ?? 1;
  }
  step() {
    if (this.ended) return;
    this.tick++;
    // 先处理边界，再绘制：结束时刻画面与判定一起离开有效阶段。
    for (const event of this.plan.events) {
      if (
        event.end <= this.tick &&
        !this.caught.has(event.id) &&
        !this.missed.has(event.id)
      ) {
        this.missed.add(event.id);
        this.score.missed++;
        this.score.total += BALANCE.score.missed;
        this.score.combo = 0;
        this.records.push({
          id: `R-${this.records.length}`,
          tick: event.end,
          scene: event.scene,
          actorId: event.actors[0],
          x: 0,
          y: 0,
          verdict: "missed",
          eventId: event.id,
          reason: "完整违规动作窗口内未收到有效举报。",
          delta: BALANCE.score.missed,
        });
      }
    }
    this.feedback = this.feedback.filter((f) => this.tick - f.tick < 22);
  }
  advanceTo(tick: number) {
    while (this.tick < Math.min(tick, this.plan.config.duration)) this.step();
  }
  report(
    scene: number,
    actorId: number | null,
    x = 0,
    y = 0,
  ): RecordEntry | undefined {
    if (this.ended || scene < 0 || scene > 5) return;
    const input = { tick: this.tick, scene, actorId, x, y };
    this.inputs.push(input);
    if (
      this.tick < this.cooldown[scene] ||
      (actorId !== null && this.tick < (this.protectedUntil.get(actorId) ?? 0))
    )
      return;
    const event =
      actorId === null
        ? undefined
        : activeEvent(this.plan, scene, actorId, this.tick, this.caught);
    let entry: RecordEntry;
    if (event) {
      this.caught.add(event.id);
      this.score.caught++;
      this.score.combo++;
      this.score.maxCombo = Math.max(this.score.maxCombo, this.score.combo);
      const delta = BALANCE.score.correct * this.multiplier;
      this.score.total += delta;
      event.actors.forEach((id) =>
        this.protectedUntil.set(id, this.tick + BALANCE.repeatProtection),
      );
      entry = {
        ...input,
        id: `R-${this.records.length}`,
        verdict: "caught",
        eventId: event.id,
        reason: "点中明确违规动作，已按事件计分。",
        delta,
      };
    } else {
      const view =
        actorId === null
          ? undefined
          : actorViews(this.plan, this.tick, this.caught).find(
              (a) => a.person.id === actorId && a.scene === scene,
            );
      const previous = this.plan.events.find(
        (e) =>
          e.scene === scene &&
          actorId !== null &&
          e.actors.includes(actorId) &&
          e.end <= this.tick &&
          this.tick - e.end < 40,
      );
      const reason =
        view?.phase === "prepare"
          ? "举报过早：此时只有准备动作，尚未出现明确违规物品或行为。"
          : previous
            ? "举报过晚：违规动作已经结束，此时应按当前可见行为判断。"
            : view
              ? `当时是${NORMAL_LABELS[view.action]}，没有明确违规。`
              : "点击了空白、家具或被遮挡区域，没有命中可见违规目标。";
      this.score.false++;
      this.score.combo = 0;
      this.score.total += BALANCE.score.false;
      this.cooldown[scene] = this.tick + BALANCE.falseCooldown;
      entry = {
        ...input,
        id: `R-${this.records.length}`,
        verdict: "false",
        reason,
        delta: BALANCE.score.false,
      };
    }
    this.records.push(entry);
    this.feedback.push({
      ...input,
      kind: entry.verdict as "caught" | "false",
      delta: entry.delta,
    });
    return entry;
  }
}

export function replayAt(
  plan: Plan,
  inputs: readonly ReportInput[],
  tick: number,
): Game {
  const game = new Game(plan);
  for (const input of inputs) {
    if (input.tick > tick) break;
    game.advanceTo(input.tick);
    game.report(input.scene, input.actorId, input.x, input.y);
  }
  game.advanceTo(tick);
  return game;
}
export const accuracy = (score: Score) =>
  score.caught + score.false === 0
    ? null
    : score.caught / (score.caught + score.false);
export const detectionRate = (score: Score, count: number) =>
  count === 0 ? null : score.caught / count;
