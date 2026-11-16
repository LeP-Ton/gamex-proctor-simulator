import { makeConfig as currentConfig } from "../src/engine/config.js";
import type { GameConfig } from "../src/engine/config.js";

// 既有照片网格约束作为冻结回归保留，新规则和三维场景另有 rig-* 验收。
export const VISUAL_VERSION = "motion-4";
export const makeConfig = (
  ...args: Parameters<typeof currentConfig>
): GameConfig => ({
  ...currentConfig(...args),
  ruleVersion: "1.0.0",
  visualVersion: VISUAL_VERSION,
});
