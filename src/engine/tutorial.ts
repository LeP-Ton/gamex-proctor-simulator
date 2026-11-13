import { makeConfig, seconds } from "./config.js";
import { buildPlan } from "./schedule.js";
import type { PlannedEvent, Plan } from "./types.js";

export const TUTORIAL_STEPS = [
  {
    from: 0,
    until: 36,
    cameras: 2,
    title: "01 / 直接点击，识别物品",
    text: "先看考场 A、B。亮屏黑色设备和黄色折页属于违规；白色试卷、蓝色笔和普通小动作允许。看到明确违规后直接点人物或物品。",
  },
  {
    from: 36,
    until: 77,
    cameras: 4,
    title: "02 / 准备动作，不是证据",
    text: "现在观察四个考场。转头和托腮只是准备，也可能放弃。等违规物品真正出现再举报；随后留意两个机位同时发生的动作。",
  },
  {
    from: 77,
    until: 112,
    cameras: 6,
    title: "03 / 六路巡查，保持节奏",
    text: "全部机位上线。黄色材料传递和公共区查看资料都违规；正常离场、洗手和等候允许。放大不会暂停其他画面。",
  },
] as const;
export function buildTutorialPlan(): Plan {
  const config = {
    ...makeConfig("tutorial-v1", "standard"),
    tutorial: true,
    duration: seconds(112),
  };
  const base = buildPlan(config);
  const definitions: Array<
    [number, number, PlannedEvent["kind"], number[], number, number?]
  > = [
    [8, 0, "device", [1], 0],
    [24, 1, "notes", [14], 1],
    [44, 0, "device", [6], 1],
    [63, 1, "notes", [18], 0],
    [63, 2, "peeking", [26], 0, 27],
    [83, 3, "passing", [36, 37], 0],
    [97, 4, "restroom", [2], 0],
    [97, 5, "restroom", [15, 30], 1],
  ];
  const events = definitions.map(
    ([s, scene, kind, actors, variant, relatedId], i) => ({
      id: `TE-${i + 1}`,
      scene,
      kind,
      actors,
      variant,
      relatedId,
      prepare: seconds(s - 4),
      start: seconds(s),
      end: seconds(s + 6),
    }),
  );
  // 教学仍然使用同一个引擎与人物迁移；只替换为逐步开放的固定机会。
  const visits: Plan["visits"] = [
    {
      actorId: 7,
      scene: 4,
      slot: 3,
      depart: seconds(78),
      arrive: seconds(82),
      exit: seconds(105),
      returned: seconds(109),
    },
    {
      actorId: 3,
      scene: 5,
      slot: 3,
      depart: seconds(78),
      arrive: seconds(82),
      exit: seconds(105),
      returned: seconds(109),
    },
  ];
  for (const e of events.filter((e) => e.scene > 3))
    e.actors.forEach((id, slot) =>
      visits.push({
        actorId: id,
        scene: e.scene,
        slot,
        depart: e.start - seconds(12),
        arrive: e.start - seconds(8),
        exit: e.end + seconds(4),
        returned: e.end + seconds(8),
        eventId: e.id,
      }),
    );
  return { ...base, events, visits };
}
