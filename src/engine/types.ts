import type { CheatKind, GameConfig, NormalAction } from "./config.js";

export interface Person {
  id: number;
  name: string;
  room: number;
  seat: number;
  row: number;
  col: number;
  gender: "male" | "female";
  skin: string;
  shirt: string;
  hair: string;
  hairstyle: number;
}
export interface PlannedEvent {
  id: string;
  kind: CheatKind;
  scene: number;
  actors: number[];
  relatedId?: number;
  variant: number;
  prepare: number;
  start: number;
  end: number;
}
export interface Visit {
  actorId: number;
  scene: number;
  slot: number;
  depart: number;
  arrive: number;
  exit: number;
  returned: number;
  eventId?: string;
}
export interface Plan {
  config: GameConfig;
  people: Person[];
  events: PlannedEvent[];
  visits: Visit[];
}
export type Verdict = "caught" | "missed" | "false";
export interface ReportInput {
  tick: number;
  scene: number;
  actorId: number | null;
  x: number;
  y: number;
}
export interface RecordEntry extends ReportInput {
  id: string;
  verdict: Verdict;
  eventId?: string;
  reason: string;
  delta: number;
}
export interface Score {
  total: number;
  caught: number;
  missed: number;
  false: number;
  combo: number;
  maxCombo: number;
}
export interface Feedback {
  tick: number;
  scene: number;
  actorId: number | null;
  x: number;
  y: number;
  kind: "caught" | "false";
  delta: number;
}
export interface ActorView {
  person: Person;
  scene: number;
  x: number;
  y: number;
  slot?: number;
  action: NormalAction;
  actionPhase: number;
  event?: PlannedEvent;
  phase?: "prepare" | "active";
}
export interface PauseEntry {
  tick: number;
  durationMs: number;
  reason: string;
}
export interface RunRecord {
  id: string;
  date: string;
  config: GameConfig;
  score: Score;
  eventCount: number;
  inputs: ReportInput[];
  pauses: PauseEntry[];
  plan: Plan;
}
