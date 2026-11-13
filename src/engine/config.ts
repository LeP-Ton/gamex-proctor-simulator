export const RULE_VERSION = "1.0.0";
export const TICK_RATE = 20;
export const msToTicks = (ms: number) => Math.round((ms * TICK_RATE) / 1000);
export const seconds = (s: number) => Math.round(s * TICK_RATE);
export type Difficulty = "beginner" | "standard" | "pressure";
export const DIFFICULTIES = {
  beginner: {
    name: "入门",
    subtitle: "从容观察，建立节奏",
    window: [6, 8],
    concurrency: 1,
    count: 30,
  },
  standard: {
    name: "常规",
    subtitle: "保持专注，兼顾六屏",
    window: [4, 6],
    concurrency: 2,
    count: 48,
  },
  pressure: {
    name: "高压",
    subtitle: "多路并发，考验判断",
    window: [3, 5],
    concurrency: 3,
    count: 66,
  },
} as const;
export const BALANCE = {
  duration: seconds(360),
  prepare: [seconds(1.7), seconds(3.2)],
  score: { correct: 100, false: -150, missed: -100 },
  combo: [
    { at: 10, multiplier: 1.5 },
    { at: 5, multiplier: 1.2 },
  ],
  falseCooldown: seconds(1),
  repeatProtection: seconds(0.5),
  actorRecovery: seconds(6),
  travel: seconds(4),
  visitLead: seconds(6),
  visitTail: seconds(4),
  preparationBudget: 3,
  opening: seconds(10),
  endingRecovery: seconds(12),
  groupJitter: seconds(0.6),
  pressureRanges: [
    [0.24, 0.42],
    [0.55, 0.72],
    [0.88, 1],
  ],
  normalVisitSpacing: [seconds(10), seconds(16)],
  normalVisitLength: [seconds(18), seconds(24)],
  normalVisitMargin: seconds(2),
} as const;
export const PRESET_SEEDS = [
  { id: "morning-01", name: "清晨的考场", note: "一切看似井然有序" },
  { id: "rainy-window", name: "雨天的窗边", note: "把目光留在细节里" },
  { id: "quiet-corridor", name: "安静的走廊", note: "安静不代表没有动静" },
  { id: "afternoon-03", name: "午后考试", note: "别被普通的小动作干扰" },
  { id: "last-bell", name: "铃响之前", note: "最后一刻也要保持专注" },
];
export const CAMERAS = [
  { name: "考场 A", area: "教学楼 1F · 101", code: "CAM 01", color: "#c7d6c1" },
  { name: "考场 B", area: "教学楼 1F · 102", code: "CAM 02", color: "#c7d3de" },
  { name: "考场 C", area: "教学楼 2F · 201", code: "CAM 03", color: "#dacbc2" },
  { name: "考场 D", area: "教学楼 2F · 202", code: "CAM 04", color: "#d3cddf" },
  {
    name: "男厕公共区",
    area: "教学楼 1F · 洗手区",
    code: "CAM 05",
    color: "#c3d6d7",
  },
  {
    name: "女厕公共区",
    area: "教学楼 2F · 洗手区",
    code: "CAM 06",
    color: "#dccdd0",
  },
] as const;
export const CHEATS = {
  device: {
    name: "违规电子设备",
    feature: "黑色设备、亮屏与点按动作；两种姿势分别在桌边和身前操作。",
  },
  notes: {
    name: "查看夹带材料",
    feature: "展开的黄色折页或窄条便签，带有密集横线；正式试卷为白色。",
  },
  peeking: {
    name: "窥看邻座答卷",
    feature: "明显侧身探向邻桌，视线落在邻桌答卷，同时在自己的纸上抄写。",
  },
  passing: {
    name: "传递违规材料",
    feature:
      "两人的手臂伸向一起，黄色折页在两人之间移动。普通蓝色笔的归还允许。",
  },
  restroom: {
    name: "公共区违规",
    feature: "在公共洗手区打开黄色资料查看，或与同伴公开交换黄色折页。",
  },
} as const;
export type CheatKind = keyof typeof CHEATS;
export const NORMAL_LABELS = {
  writing: "正常书写",
  thinking: "思考题目",
  clock: "看时钟",
  stretch: "伸展身体",
  pickPen: "捡拾掉落的笔",
  stationery: "整理文具",
  turn: "正常转头",
  returnPen: "归还蓝色文具",
  washing: "洗手",
  waiting: "在公共区等候",
  bag: "整理随身物品",
  glance: "观察周围后继续答题",
  walking: "正常进出公共区",
};
export type NormalAction = keyof typeof NORMAL_LABELS;
export const NORMAL_BEHAVIOR: {
  actions: NormalAction[];
  cycleSeconds: [number, number];
  activeFraction: number;
  publicWalk: number;
} = {
  actions: [
    "writing",
    "writing",
    "thinking",
    "clock",
    "stretch",
    "pickPen",
    "stationery",
    "turn",
    "returnPen",
    "glance",
  ],
  cycleSeconds: [5, 10],
  activeFraction: 0.56,
  publicWalk: seconds(1.5),
};
export interface GameConfig {
  seed: string;
  difficulty: Difficulty;
  duration: number;
  ruleVersion: string;
  layout: "desktop" | "practice";
  debug: boolean;
  tutorial: boolean;
}
export const makeConfig = (
  seed = PRESET_SEEDS[0].id,
  difficulty: Difficulty = "standard",
): GameConfig => ({
  seed,
  difficulty,
  duration: BALANCE.duration,
  ruleVersion: RULE_VERSION,
  layout: "desktop",
  debug: false,
  tutorial: false,
});
