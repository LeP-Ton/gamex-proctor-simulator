import { actorViews, seatPosition } from "../engine/world.js";
import { CAMERAS, TICK_RATE } from "../engine/config.js";
import type { ActorView, Plan } from "../engine/types.js";

export const WORLD_W = 600;
export const WORLD_H = 350;
export type Shape =
  | {
      kind: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      radius?: number;
    }
  | { kind: "ellipse"; x: number; y: number; rx: number; ry: number }
  | { kind: "poly"; points: number[] }
  | { kind: "line"; points: number[] }
  | {
      kind: "text";
      x: number;
      y: number;
      text: string;
      size: number;
      align?: CanvasTextAlign;
    };
export interface DrawOp {
  shape: Shape;
  fill?: string;
  stroke?: string;
  width?: number;
  actorId?: number;
  blocks?: boolean;
  alpha?: number;
}
type Sink = (
  shape: Shape,
  fill?: string,
  stroke?: string,
  actorId?: number,
  blocks?: boolean,
  width?: number,
) => void;
const baseCache = new Map<number, DrawOp[]>();
export function background(scene: number): DrawOp[] {
  const existing = baseCache.get(scene);
  if (existing) return existing;
  const ops: DrawOp[] = [];
  const add: Sink = (
    shape,
    fill,
    stroke,
    actorId,
    blocks = true,
    width = 1.5,
  ) => ops.push({ shape, fill, stroke, actorId, blocks, width });
  add(
    { kind: "rect", x: 0, y: 0, w: 600, h: 350 },
    scene < 4 ? "#e7e1d3" : "#dce6df",
  );
  if (scene < 4) {
    add(
      { kind: "poly", points: [0, 55, 600, 55, 600, 350, 0, 350] },
      ["#e1d8c6", "#d7dcd8", "#e7d8c7", "#e0d9df"][scene],
    );
    for (let y = 65; y < 351; y += 38)
      add(
        { kind: "line", points: [0, y, 600, y] },
        undefined,
        "#938b781c",
        undefined,
        false,
        1,
      );
    for (let x = -140; x < 750; x += 85)
      add(
        { kind: "line", points: [x, 55, x + 70, 350] },
        undefined,
        "#938b781a",
        undefined,
        false,
        1,
      );
    add({ kind: "rect", x: 0, y: 0, w: 600, h: 58 }, CAMERAS[scene].color);
    add({ kind: "rect", x: 0, y: 56, w: 600, h: 5 }, "#86938a");
    add(
      { kind: "rect", x: 199, y: 7, w: 211, h: 44, radius: 3 },
      "#667d6e",
      "#b29a75",
      undefined,
      true,
      4,
    );
    add(
      {
        kind: "text",
        x: 305,
        y: 25,
        text: "沉 着 思 考   诚 信 应 考",
        size: 11,
        align: "center",
      },
      "#d9e2d5",
      undefined,
      undefined,
      false,
    );
    add(
      { kind: "line", points: [225, 36, 385, 36] },
      undefined,
      "#a9bca3",
      undefined,
      false,
      1,
    );
    for (let i = 0; i < 2; i++) {
      const x = 20 + i * 76;
      add(
        { kind: "rect", x, y: 5, w: 62, h: 43 },
        "#cce1db",
        "#8caa9e",
        undefined,
        true,
        3,
      );
      add(
        { kind: "poly", points: [x + 4, 8, x + 30, 8, x + 4, 40] },
        "#ebf0de",
      );
      add(
        { kind: "line", points: [x + 31, 6, x + 31, 48] },
        undefined,
        "#8caa9e",
        undefined,
        true,
        2,
      );
    }
    add({ kind: "rect", x: 542, y: 4, w: 39, h: 53 }, "#b8aa8f", "#948b76");
    add({ kind: "rect", x: 550, y: 9, w: 23, h: 17 }, "#cedbd3");
    add({ kind: "ellipse", x: 548, y: 36, rx: 2, ry: 2 }, "#807860");
    add(
      { kind: "ellipse", x: 468, y: 25, rx: 18, ry: 18 },
      "#f2efe2",
      "#879288",
      undefined,
      true,
      2,
    );
    add(
      { kind: "line", points: [468, 13, 468, 25, 478, 29] },
      undefined,
      "#5e6c65",
      undefined,
      true,
      2,
    );
    add(
      {
        kind: "text",
        x: 300,
        y: 334,
        text: [
          "第一考场 · 科学楼",
          "第二考场 · 明德楼",
          "第三考场 · 启智楼",
          "第四考场 · 致远楼",
        ][scene],
        size: 10,
        align: "center",
      },
      "#8d887a",
      undefined,
      undefined,
      false,
    );
    add({ kind: "rect", x: 10, y: 288, w: 17, h: 23, radius: 2 }, "#b68f6f");
    add({ kind: "ellipse", x: 18, y: 281, rx: 17, ry: 20 }, "#7a9b77");
    add({ kind: "ellipse", x: 24, y: 267, rx: 9, ry: 16 }, "#89a57b");
  } else {
    add(
      { kind: "rect", x: 0, y: 65, w: 600, h: 285 },
      scene === 4 ? "#d3dfda" : "#e0d9d5",
    );
    for (let x = 0; x < 600; x += 40)
      add(
        { kind: "line", points: [x, 65, x, 350] },
        undefined,
        "#9db3aa55",
        undefined,
        false,
        1,
      );
    for (let y = 65; y < 350; y += 40)
      add(
        { kind: "line", points: [0, y, 600, y] },
        undefined,
        "#9db3aa55",
        undefined,
        false,
        1,
      );
    add({ kind: "rect", x: 0, y: 0, w: 600, h: 67 }, CAMERAS[scene].color);
    add(
      { kind: "rect", x: 75, y: 10, w: 468, h: 40, radius: 3 },
      "#a8c1bb",
      "#8fa7a1",
      undefined,
      true,
      3,
    );
    add(
      { kind: "poly", points: [95, 12, 156, 12, 118, 48, 95, 48] },
      "#c8dcd5",
    );
    add(
      { kind: "poly", points: [360, 12, 450, 12, 412, 48, 322, 48] },
      "#c0d5cf",
    );
    // 镜头只有入口及公共洗手区，封闭隔间位于画面之外。
    add({ kind: "rect", x: 0, y: 65, w: 39, h: 182 }, "#a5b8af");
    add(
      { kind: "text", x: 21, y: 117, text: "入", size: 14, align: "center" },
      "#edf1e6",
      undefined,
      undefined,
      false,
    );
    add(
      { kind: "text", x: 21, y: 138, text: "口", size: 14, align: "center" },
      "#edf1e6",
      undefined,
      undefined,
      false,
    );
    add(
      { kind: "rect", x: 55, y: 88, w: 515, h: 41, radius: 4 },
      "#a9bab1",
      "#92a99b",
    );
    for (let i = 0; i < 4; i++) {
      const x = 110 + i * 125;
      add(
        { kind: "rect", x: x - 30, y: 94, w: 60, h: 25, radius: 10 },
        "#eff1e7",
        "#8fa99d",
      );
      add({ kind: "ellipse", x, y: 106, rx: 21, ry: 7 }, "#d0ddd4");
      add(
        { kind: "line", points: [x, 94, x, 86, x + 9, 86] },
        undefined,
        "#78958b",
        undefined,
        true,
        4,
      );
    }
    add(
      { kind: "rect", x: 60, y: 151, w: 505, h: 30, radius: 4 },
      "#d6ddd0",
      "#a4b5aa",
    );
    add(
      {
        kind: "text",
        x: 310,
        y: 172,
        text: "保 持 安 静   ·   文 明 候 场",
        size: 11,
        align: "center",
      },
      "#7f9284",
      undefined,
      undefined,
      false,
    );
    add(
      { kind: "rect", x: 545, y: 278, w: 26, h: 32, radius: 4 },
      "#9ab0a1",
      "#83988b",
    );
    add(
      { kind: "line", points: [550, 278, 566, 278] },
      undefined,
      "#e3e9da",
      undefined,
      false,
      3,
    );
    add(
      {
        kind: "text",
        x: 300,
        y: 332,
        text: "公共区域监控 · 不拍摄隔间内部",
        size: 11,
        align: "center",
      },
      "#7f8f85",
      undefined,
      undefined,
      false,
    );
  }
  baseCache.set(scene, ops);
  return ops;
}

function desk(add: Sink, x: number, y: number, seat: number) {
  add(
    { kind: "line", points: [x - 28, y + 33, x - 29, y + 49] },
    undefined,
    "#8d8371",
    undefined,
    true,
    4,
  );
  add(
    { kind: "line", points: [x + 28, y + 33, x + 30, y + 49] },
    undefined,
    "#8d8371",
    undefined,
    true,
    4,
  );
  add(
    { kind: "rect", x: x - 39, y: y + 22, w: 78, h: 14, radius: 3 },
    "#c4a379",
    "#9e8769",
  );
  add(
    {
      kind: "poly",
      points: [x - 38, y + 15, x + 36, y + 15, x + 39, y + 26, x - 39, y + 26],
    },
    "#dec397",
    "#a89270",
  );
  add(
    { kind: "rect", x: x - 15, y: y + 14, w: 26, h: 18, radius: 1 },
    "#f6f2df",
    "#c7c5b6",
  );
  for (let i = 0; i < 3; i++)
    add(
      { kind: "line", points: [x - 10, y + 19 + i * 4, x + 6, y + 19 + i * 4] },
      undefined,
      "#a0aaa0",
      undefined,
      false,
      1,
    );
  add(
    {
      kind: "text",
      x: x + 29,
      y: y + 35,
      text: String(seat).padStart(2, "0"),
      size: 8,
      align: "center",
    },
    "#8b785c",
    undefined,
    undefined,
    false,
  );
}

export function sceneGeometry(
  plan: Plan,
  tick: number,
  scene: number,
  caught: ReadonlySet<string> = new Set(),
): { ops: DrawOp[]; actors: ActorView[] } {
  const ops = [...background(scene)];
  const add: Sink = (
    shape,
    fill,
    stroke,
    actorId,
    blocks = true,
    width = 1.5,
  ) => ops.push({ shape, fill, stroke, actorId, blocks, width });
  const actors = actorViews(plan, tick, caught).filter(
    (a) => a.scene === scene,
  );
  if (scene < 4) {
    for (const person of plan.people.filter((p) => p.room === scene)) {
      const pos = seatPosition(person);
      const a = actors.find((v) => v.person.id === person.id);
      add(
        { kind: "ellipse", x: pos.x, y: pos.y + 38, rx: 34, ry: 10 },
        "#51483a17",
        undefined,
        undefined,
        false,
      );
      add(
        { kind: "rect", x: pos.x - 22, y: pos.y - 6, w: 43, h: 34, radius: 7 },
        "#a79072",
        "#8e7d63",
      );
      if (a)
        drawActor(add, a, tick, plan, actors, () =>
          desk(add, pos.x, pos.y, person.seat),
        );
      else desk(add, pos.x, pos.y, person.seat);
    }
  } else {
    for (const actor of [...actors].sort((a, b) => a.y - b.y || a.x - b.x))
      drawActor(add, actor, tick, plan, actors);
  }
  return { ops, actors };
}

function drawActor(
  add: Sink,
  view: ActorView,
  tick: number,
  plan: Plan,
  actors: ActorView[],
  drawDesk?: () => void,
) {
  const { person: p, x, y, event, phase } = view;
  const active = phase === "active";
  const id = p.id;
  const t = tick / TICK_RATE;
  const bob = Math.sin(t * 3 + id) * 0.7;
  const prepping = phase === "prepare";
  let lean = 0;
  let headY = -11;
  if (!event && view.action === "pickPen") {
    lean = 15;
    headY = 4;
  }
  if (active && event?.kind === "peeking")
    lean = event.variant === 0 ? 28 : -28;
  if (
    prepping ||
    (!event && (view.action === "turn" || view.action === "glance"))
  )
    lean = Math.sin(t * 2 + id) * 6;
  const hx = x + lean;
  const hy = y + headY + bob;
  const arm = (points: number[]) =>
    add({ kind: "line", points }, undefined, p.skin, id, true, 8);
  const hand = (ax: number, ay: number) =>
    add(
      { kind: "ellipse", x: ax, y: ay, rx: 4.5, ry: 4 },
      p.skin,
      undefined,
      id,
    );
  add(
    { kind: "ellipse", x, y: y + 39, rx: 19, ry: 6 },
    "#43574722",
    undefined,
    undefined,
    false,
  );
  if (!drawDesk) {
    add(
      {
        kind: "line",
        points: [
          x - 7,
          y + 21,
          x - 10 + (view.action === "walking" ? Math.sin(t * 8) * 4 : 0),
          y + 42,
        ],
      },
      undefined,
      "#52626a",
      id,
      true,
      9,
    );
    add(
      { kind: "line", points: [x + 7, y + 21, x + 11, y + 42] },
      undefined,
      "#52626a",
      id,
      true,
      9,
    );
    add(
      { kind: "ellipse", x: x - 10, y: y + 43, rx: 7, ry: 3 },
      "#515552",
      undefined,
      id,
    );
    add(
      { kind: "ellipse", x: x + 11, y: y + 43, rx: 7, ry: 3 },
      "#515552",
      undefined,
      id,
    );
  }
  add(
    {
      kind: "poly",
      points: [hx - 12, y, hx + 12, y, x + 17, y + 27, x - 17, y + 27],
    },
    p.shirt,
    "#505c5838",
    id,
  );
  add(
    { kind: "line", points: [hx - 4, y + 3, hx, y + 8, hx + 4, y + 3] },
    undefined,
    "#f4e9d0bb",
    id,
    true,
    2,
  );
  add(
    { kind: "rect", x: hx - 4, y: hy + 7, w: 8, h: 8 },
    p.skin,
    undefined,
    id,
  );
  if (p.hairstyle === 3)
    add(
      { kind: "ellipse", x: hx + 12, y: hy + 5, rx: 6, ry: 12 },
      p.hair,
      undefined,
      id,
    );
  add(
    { kind: "ellipse", x: hx, y: hy, rx: 12, ry: 13.5 },
    p.skin,
    "#92766255",
    id,
  );
  add(
    {
      kind: "poly",
      points: [
        hx - 12,
        hy + 1,
        hx - 12,
        hy - 6,
        hx - 7,
        hy - 14,
        hx + 6,
        hy - 14,
        hx + 13,
        hy - 6,
        hx + 11,
        hy,
        hx + 5,
        hy - 8,
        hx - 4,
        hy - 5,
      ],
    },
    p.hair,
    undefined,
    id,
  );
  const eyeOffset =
    active && event?.kind === "peeking"
      ? event.variant === 0
        ? 5
        : -5
      : prepping || view.action === "turn"
        ? Math.sin(t + id) * 3
        : 0;
  add(
    { kind: "ellipse", x: hx - 4 + eyeOffset, y: hy + 3, rx: 1.3, ry: 1.7 },
    "#3b3b36",
    undefined,
    undefined,
    false,
  );
  add(
    { kind: "ellipse", x: hx + 4 + eyeOffset, y: hy + 3, rx: 1.3, ry: 1.7 },
    "#3b3b36",
    undefined,
    undefined,
    false,
  );
  drawDesk?.();
  const device = (dx: number, dy: number, horizontal = false) => {
    const w = horizontal ? 32 : 22;
    const h = horizontal ? 21 : 30;
    add(
      { kind: "rect", x: dx, y: dy, w, h, radius: 3 },
      "#253846",
      "#11272f",
      id,
      true,
      2,
    );
    add(
      { kind: "rect", x: dx + 3, y: dy + 3, w: w - 6, h: h - 7, radius: 1 },
      "#62c9d2",
      undefined,
      id,
    );
    add(
      { kind: "line", points: [dx + 5, dy + 7, dx + w - 5, dy + 7] },
      undefined,
      "#dbfff2",
      id,
      true,
      2,
    );
    add(
      { kind: "ellipse", x: dx + w / 2, y: dy + h - 3, rx: 1, ry: 1 },
      "#829da4",
      undefined,
      id,
    );
  };
  const note = (dx: number, dy: number, folded = false) => {
    const w = folded ? 20 : 34;
    const h = folded ? 32 : 26;
    add(
      {
        kind: "poly",
        points: [
          dx,
          dy + 2,
          dx + w * 0.47,
          dy,
          dx + w,
          dy + 3,
          dx + w,
          dy + h,
          dx + w * 0.47,
          dy + h - 2,
          dx,
          dy + h,
        ],
      },
      "#f1ca61",
      "#a98435",
      id,
      true,
      1.8,
    );
    add(
      {
        kind: "line",
        points: [dx + w * 0.47, dy + 1, dx + w * 0.47, dy + h - 2],
      },
      undefined,
      "#c2a14a",
      id,
      true,
      1,
    );
    for (let i = 0; i < 4; i++)
      add(
        {
          kind: "line",
          points: [dx + 3, dy + 6 + i * 4, dx + w - 3, dy + 6 + i * 4],
        },
        undefined,
        "#98723d",
        id,
        true,
        1.5,
      );
  };
  if (active && event) {
    if (event.kind === "device") {
      const dx = x + (event.variant === 0 ? 20 : -29);
      const dy = y + (event.variant === 0 ? -2 : 5);
      arm([hx - 12, y + 6, dx + 2, dy + 17]);
      arm([hx + 12, y + 6, dx + 13, dy + 14]);
      device(dx, dy, event.variant === 1);
      hand(dx + 4 + Math.sin(t * 6) * 2, dy + 11);
    } else if (
      event.kind === "notes" ||
      (event.kind === "restroom" && event.variant === 0)
    ) {
      const dx = x + (event.variant === 0 ? 12 : -29);
      const dy = y + 2;
      arm([hx - 12, y + 6, dx + 2, dy + 18]);
      arm([hx + 12, y + 6, dx + 25, dy + 18]);
      note(dx, dy, event.variant === 1);
      hand(dx + 1, dy + 17);
    } else if (event.kind === "peeking") {
      const neighbor = plan.people[event.relatedId!];
      const pos = seatPosition(neighbor);
      arm([hx - 12, y + 6, x + 4, y + 23]);
      arm([hx + 12, y + 5, x + lean + (lean > 0 ? 12 : -12), y + 17]);
      add(
        { kind: "line", points: [hx + eyeOffset, hy + 5, pos.x, pos.y + 21] },
        undefined,
        "#756d4e80",
        undefined,
        false,
        1.4,
      );
      add(
        {
          kind: "line",
          points: [x + 2, y + 20, x + 9 + Math.sin(t * 9) * 3, y + 16],
        },
        undefined,
        "#354b5b",
        id,
        true,
        2.5,
      );
      // 邻卷和侧身、视线、抄写同时可见，普通转头不画这组组合。
    } else {
      const partner = actors.find(
        (a) => event.actors.includes(a.person.id) && a.person.id !== id,
      );
      if (partner) {
        const direction = partner.x > x ? 1 : -1;
        const mx = (x + partner.x) / 2;
        arm([hx + direction * 10, y + 7, mx - direction * 4, y + 7]);
        arm([hx - direction * 12, y + 7, x - direction * 16, y + 20]);
        if (id === event.actors[0]) {
          const progress = (tick - event.start) / (event.end - event.start);
          const nx = mx - 14 + Math.sin(progress * Math.PI * 2) * 8;
          note(nx, y - 3);
          hand(nx + 4, y + 17);
        }
      }
    }
  } else if (!drawDesk && view.action === "washing") {
    arm([x - 12, y + 5, x - 2, y - 23]);
    arm([x + 12, y + 5, x + 3, y - 23]);
    add(
      { kind: "line", points: [x - 4, y - 25, x + 5, y - 28] },
      undefined,
      "#8fbdc5",
      undefined,
      false,
      3,
    );
    add(
      { kind: "ellipse", x: x + Math.sin(t * 5) * 3, y: y - 26, rx: 8, ry: 4 },
      "#edf4df",
      undefined,
      id,
    );
  } else if (!event && view.action === "stretch") {
    arm([hx - 12, y + 4, x - 25, y - 16]);
    arm([hx + 12, y + 4, x + 25, y - 17]);
  } else if (!event && view.action === "pickPen") {
    arm([hx + 10, y + 9, x + 29, y + 41]);
    add(
      { kind: "line", points: [x + 23, y + 42, x + 34, y + 40] },
      undefined,
      "#537eac",
      id,
      true,
      3,
    );
  } else if (!event && view.action === "returnPen") {
    arm([hx + 12, y + 5, x + 39, y + 2]);
    add(
      { kind: "line", points: [x + 34, y - 1, x + 51, y - 3] },
      undefined,
      "#376a9d",
      id,
      true,
      4,
    );
    arm([hx - 12, y + 6, x - 12, y + 20]);
  } else if (!event && view.action === "stationery" && drawDesk) {
    arm([hx - 12, y + 6, x - 25, y + 19]);
    arm([hx + 12, y + 6, x + 24 + Math.sin(t * 4) * 3, y + 18]);
    add(
      { kind: "rect", x: x + 17, y: y + 18, w: 18, h: 7, radius: 3 },
      "#748c99",
      "#536d7e",
      id,
    );
    add(
      { kind: "rect", x: x - 28, y: y + 18, w: 9, h: 5, radius: 1 },
      "#e8e6d5",
      "#aeb8a6",
      id,
    );
  } else if (!event && view.action === "clock") {
    arm([hx + 12, y + 5, x + 20, y - 4]);
    arm([hx - 12, y + 5, x - 13, y + 20]);
    add(
      { kind: "rect", x: x + 16, y: y - 2, w: 7, h: 4 },
      "#475555",
      undefined,
      id,
    );
  } else if (
    prepping ||
    (!event &&
      (view.action === "thinking" ||
        view.action === "glance" ||
        view.action === "turn"))
  ) {
    arm([hx + 12, y + 7, hx + 11, hy + 10]);
    arm([hx - 12, y + 6, x - 12, y + 21]);
  } else if (
    !drawDesk &&
    (view.action === "bag" || view.action === "waiting")
  ) {
    arm([hx - 12, y + 6, x - 11, y + 22]);
    arm([hx + 12, y + 6, x + 9, y + 21]);
    if (view.action === "bag")
      add(
        { kind: "rect", x: x - 11, y: y + 15, w: 22, h: 16, radius: 5 },
        "#a58b6c",
        undefined,
        id,
      );
  } else {
    arm([hx - 12, y + 6, x - 16, y + 22]);
    arm([hx + 12, y + 6, x + 2 + Math.sin(t * 6 + id) * 2, y + 22]);
    if (drawDesk)
      add(
        { kind: "line", points: [x + 1, y + 22, x + 6, y + 17] },
        undefined,
        "#425c75",
        id,
        true,
        2,
      );
  }
}

export function contains(op: DrawOp, x: number, y: number): boolean {
  const s = op.shape;
  if (s.kind === "text") return false;
  if (s.kind === "rect") {
    if (x < s.x || x > s.x + s.w || y < s.y || y > s.y + s.h) return false;
    const r = Math.min(s.radius ?? 0, s.w / 2, s.h / 2);
    if (!r) return true;
    const cx = Math.max(s.x + r, Math.min(s.x + s.w - r, x));
    const cy = Math.max(s.y + r, Math.min(s.y + s.h - r, y));
    return Math.hypot(x - cx, y - cy) <= r;
  }
  if (s.kind === "ellipse")
    return ((x - s.x) / s.rx) ** 2 + ((y - s.y) / s.ry) ** 2 <= 1;
  if (s.kind === "poly") {
    let inside = false;
    for (
      let i = 0, j = s.points.length - 2;
      i < s.points.length;
      j = i, i += 2
    ) {
      const xi = s.points[i],
        yi = s.points[i + 1],
        xj = s.points[j],
        yj = s.points[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  }
  const radius = (op.width ?? 1.5) / 2;
  for (let i = 0; i < s.points.length - 2; i += 2) {
    const ax = s.points[i],
      ay = s.points[i + 1],
      bx = s.points[i + 2],
      by = s.points[i + 3];
    const length = (bx - ax) ** 2 + (by - ay) ** 2;
    const t =
      length === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length),
          );
    if (Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)) <= radius)
      return true;
  }
  return false;
}
export function pick(
  ops: readonly DrawOp[],
  x: number,
  y: number,
): number | null {
  // 逆绘制顺序查找，家具和前景人物会真实遮挡后方命中区。
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    if (op.blocks !== false && contains(op, x, y)) return op.actorId ?? null;
  }
  return null;
}
export function pickWithProtection(
  ops: readonly DrawOp[],
  previous: readonly DrawOp[] | undefined,
  protectedUntil: ReadonlyMap<number, number>,
  tick: number,
  x: number,
  y: number,
): number | null {
  const visible = pick(ops, x, y);
  if (visible !== null || !previous) return visible;
  // 成功后物品会立即收起，保留旧可见轮廓只用于忽略重复输入，不作为新举报目标。
  const previousActor = pick(previous, x, y);
  return previousActor !== null &&
    tick < (protectedUntil.get(previousActor) ?? 0)
    ? previousActor
    : null;
}
export function fitWorld(width: number, height: number) {
  const scale = Math.min(width / WORLD_W, height / WORLD_H);
  return {
    scale,
    offsetX: (width - WORLD_W * scale) / 2,
    offsetY: (height - WORLD_H * scale) / 2,
  };
}
export function clientToWorld(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
) {
  const fit = fitWorld(rect.width, rect.height);
  return {
    x: (clientX - rect.left - fit.offsetX) / fit.scale,
    y: (clientY - rect.top - fit.offsetY) / fit.scale,
  };
}
