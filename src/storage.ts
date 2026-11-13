import type { Difficulty } from "./engine/config.js";
import type { RunRecord } from "./engine/types.js";
export interface Settings {
  difficulty: Difficulty;
  seed: string;
  sound: boolean;
  volume: number;
}
export interface SavedData {
  settings: Settings;
  recent: RunRecord[];
  best: Record<string, number>;
}
export const SAVE_KEY = "gamex-proctor-v1";
const defaults = (): SavedData => ({
  settings: {
    difficulty: "standard",
    seed: "morning-01",
    sound: true,
    volume: 0.25,
  },
  recent: [],
  best: {},
});
export const conditionKey = (r: RunRecord) =>
  [
    r.config.seed,
    r.config.difficulty,
    r.config.duration,
    r.config.ruleVersion,
    r.config.layout,
    r.config.debug ? "debug" : "normal",
    r.config.tutorial ? "tutorial" : "exam",
  ].join("|");
export class LocalStore {
  data: SavedData = defaults();
  available = true;
  constructor(
    private storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  ) {
    try {
      const raw = storage?.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          const s = parsed.settings ?? {};
          this.data = {
            settings: {
              difficulty: ["beginner", "standard", "pressure"].includes(
                s.difficulty,
              )
                ? s.difficulty
                : "standard",
              seed:
                typeof s.seed === "string" ? s.seed.slice(0, 60) : "morning-01",
              sound: typeof s.sound === "boolean" ? s.sound : true,
              volume:
                typeof s.volume === "number" && Number.isFinite(s.volume)
                  ? Math.max(0, Math.min(1, s.volume))
                  : 0.25,
            },
            recent: Array.isArray(parsed.recent)
              ? parsed.recent
                  .filter(
                    (r: RunRecord) =>
                      r?.plan?.events &&
                      r?.config &&
                      r?.score &&
                      Array.isArray(r.inputs),
                  )
                  .slice(0, 10)
              : [],
            best:
              parsed.best && typeof parsed.best === "object" ? parsed.best : {},
          };
        }
      }
    } catch {
      this.available = false;
    }
    if (!storage) this.available = false;
  }
  persist() {
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      this.available = false;
    }
  }
  saveRun(run: RunRecord): boolean {
    if (run.config.tutorial) return false;
    const key = conditionKey(run);
    const previous = this.data.best[key];
    const isBest = previous === undefined || run.score.total > previous;
    if (isBest) this.data.best[key] = run.score.total;
    this.data.recent = [
      run,
      ...this.data.recent.filter((r) => r.id !== run.id),
    ].slice(0, 10);
    this.persist();
    return isBest;
  }
}
