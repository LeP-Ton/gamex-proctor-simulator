import {
  sceneGeometry as legacyGeometry,
  background as legacyBackground,
} from "./legacy-geometry.js";
import { actorViews, seatPosition } from "../engine/world.js";
import { TICK_RATE, VISUAL_VERSION } from "../engine/config.js";
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
  | {
      kind: "ellipse";
      x: number;
      y: number;
      rx: number;
      ry: number;
      role?: "head";
    }
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
export function projectPoint(scene: number, x: number, y: number) {
  const depth = Math.max(0, Math.min(1, y / WORLD_H));
  const scale = 0.82 + depth * 0.18;
  const side = scene % 2 === 0 ? 1 : -1;
  return {
    x: 300 + (x - 300) * scale + side * 14 * (1 - depth),
    y: 20 + y * 0.92,
    scale,
  };
}

function projectOp(scene: number, op: DrawOp): DrawOp {
  const s = op.shape;
  const xy = (x: number, y: number) => projectPoint(scene, x, y);
  const points = (data: number[]) =>
    data.flatMap((v, i) =>
      i % 2 ? [] : [xy(v, data[i + 1]).x, xy(v, data[i + 1]).y],
    );
  if (s.kind === "rect")
    return {
      ...op,
      shape: {
        kind: "poly",
        points: points([
          s.x,
          s.y,
          s.x + s.w,
          s.y,
          s.x + s.w,
          s.y + s.h,
          s.x,
          s.y + s.h,
        ]),
      },
    };
  if (s.kind === "line" || s.kind === "poly")
    return { ...op, shape: { ...s, points: points(s.points) } };
  const p = xy(s.x, s.y);
  if (s.kind === "ellipse")
    return {
      ...op,
      shape: { ...s, x: p.x, y: p.y, rx: s.rx * p.scale, ry: s.ry * 0.92 },
    };
  return { ...op, shape: { ...s, x: p.x, y: p.y, size: s.size * p.scale } };
}

export function background(scene: number): DrawOp[] {
  const existing = baseCache.get(scene);
  if (existing) return existing;
  const raw: DrawOp[] = [];
  const add: Sink = (shape, fill, stroke, actorId, blocks = true, width = 1) =>
    raw.push({ shape, fill, stroke, actorId, blocks, width });
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    stroke?: string,
  ) => add({ kind: "rect", x, y, w, h }, fill, stroke);
  const line = (points: number[], stroke: string, width = 1) =>
    add({ kind: "line", points }, undefined, stroke, undefined, false, width);
  const text = (
    x: number,
    y: number,
    value: string,
    size = 7,
    color = "#62685f",
  ) =>
    add(
      { kind: "text", x, y, text: value, size },
      color,
      undefined,
      undefined,
      false,
    );
  const poly = (points: number[], fill: string, stroke?: string) =>
    add({ kind: "poly", points }, fill, stroke);
  const tile =
    scene < 4
      ? ["#b6b9ac", "#adb5b1", "#c0bdb0", "#b4b6b5"][scene]
      : scene === 4
        ? "#aab9b4"
        : "#b8b8b1";
  rect(-40, -24, 680, 410, tile);
  // 地面拼缝和轻微色差使用固定纹理，不消费事件随机流。
  for (let row = 0; row < 9; row++)
    for (let col = 0; col < 12; col++) {
      const x = col * 55 - 25,
        y = row * 43 + 48;
      const n = (row * 73 + col * 37 + scene * 19) % 17;
      rect(
        x + 1,
        y + 1,
        53,
        41,
        n < 5 ? "#e3e5d118" : n > 12 ? "#333e3810" : "#adb7ad09",
      );
      line([x, y, x + 55, y], "#666f6555", 0.65);
      line([x, y, x, y + 43], "#727d7055", 0.65);
      line([x + 1, y + 1, x + 54, y + 1], "#f4f0dc25", 0.7);
    }
  // 后墙、侧墙、踢脚线与顶部梁构成固定高机位的空间参照。
  rect(-20, -15, 640, 79, scene === 1 ? "#bfc8c4" : "#c9ccc0");
  rect(-20, 48, 640, 16, "#969e90");
  rect(-20, 61, 640, 4, "#636e60");
  rect(-20, -15, 640, 9, "#808b7e");
  poly([-10, 0, 30, 7, 30, 68, -10, 350], "#a8b0a1");
  line([30, 7, 30, 65, -10, 350], "#657465", 1.4);
  for (let y = 0; y < 60; y += 4)
    line([32, y, 600, y + 0.3], y % 8 ? "#edf0db0a" : "#606b5d0a", 0.7);
  // 顶部线槽、角落消防器材和室内设备采用真实尺度。
  line([34, 3, 580, 3, 580, 52], "#818b7c", 2.5);
  rect(566, 15, 20, 32, "#b0b8aa", "#74836f");
  rect(570, 20, 12, 9, "#737f70");
  if (scene < 4) {
    // 后墙是公告栏和储物区，学生朝向镜头所在的教室前方。
    rect(139, 8, 185, 32, "#737f72", "#596653");
    rect(143, 11, 177, 26, "#919c87");
    for (let i = 0; i < 5; i++) {
      const x = 150 + i * 32;
      rect(x, 14, 23, 18, i % 2 ? "#cccfb8" : "#d9dbcb", "#adb5a1");
      for (let j = 0; j < 4; j++)
        line(
          [x + 3, 18 + j * 3, x + 19 - (j % 2) * 3, 18 + j * 3],
          "#848f7d",
          0.55,
        );
    }
    text(200, 49, "考 生 须 知", 7, "#535f4c");
    rect(502, 1, 43, 59, "#8a9585", "#616f5b");
    rect(507, 6, 32, 28, "#687b72", "#a4b3a4");
    poly([509, 7, 526, 7, 509, 31], "#cbd2bc30");
    line([510, 37, 535, 37], "#6d7c68", 1);
    rect(503, 55, 44, 6, "#596955");
    rect(507, 39, 3, 4, "#cfceba");
    rect(475, 44, 9, 16, "#6a6254", "#555a4b");
    rect(477, 40, 5, 5, "#6e5c48");
    // 侧窗带金属框和窗帘；日光斑只作用于环境，不覆盖关键动作。
    for (let i = 0; i < 2; i++) {
      const y = 77 + i * 101;
      poly([-10, y + 6, 25, y, 25, y + 72, -10, y + 84], "#b6c9c3", "#687e72");
      poly([-7, y + 10, 9, y + 6, 9, y + 75, -7, y + 80], "#d2dfd633");
      line([9, y + 4, 9, y + 77], "#6e8578", 2);
      line([-9, y + 43, 25, y + 36], "#6e8578", 2);
      poly([26, y, 33, y + 3, 33, y + 70, 26, y + 73], "#939e8d");
      for (let k = 0; k < 3; k++)
        line([27 + k * 2, y + 4, 27 + k * 2, y + 68], "#707e6c66", 0.6);
    }
    for (let i = 0; i < 3; i++)
      poly(
        [
          35,
          91 + i * 77,
          98,
          93 + i * 77,
          176,
          115 + i * 77,
          108,
          120 + i * 77,
        ],
        "#e6ead91a",
      );
    rect(356, 12, 65, 31, "#b4bca9", "#929d87");
    for (let i = 0; i < 8; i++)
      line([361, 16 + i * 3, 415, 16 + i * 3], "#818f78", 1.1);
    rect(387, 41, 3, 14, "#959f8c");
    add(
      { kind: "ellipse", x: 453, y: 23, rx: 12, ry: 12 },
      "#d6dacb",
      "#687462",
      undefined,
      true,
      1.2,
    );
    line([453, 15, 453, 23, 461, 25], "#4b5847", 1.2);
    // 前方讲台进入画面边缘，增强从教室前角向后俯拍的空间关系。
    poly([199, 337, 374, 337, 395, 362, 183, 362], "#8e8c78", "#666d5a");
    rect(242, 340, 49, 12, "#bebfa9", "#929f8b");
    line([249, 344, 284, 344], "#7d8d75", 0.9);
    rect(559, 287, 18, 25, "#7b8975", "#566650");
    rect(562, 283, 12, 5, "#65765f");
    text(549, 327, ["101", "102", "201", "202"][scene], 8, "#606f57");
  } else {
    // 镜头仅拍入口和公共洗手区；隔间完全在机位之外。
    rect(54, 4, 504, 46, "#718780", "#516b60");
    rect(59, 8, 494, 37, "#9db4ae");
    for (let i = 0; i < 4; i++) {
      const x = 110 + i * 125;
      line([x - 59, 9, x - 59, 44], "#687f74", 1.1);
      poly([x - 45, 11, x - 10, 11, x - 43, 42, x - 59, 42], "#dae3d433");
    }
    poly([51, 87, 565, 87, 577, 104, 43, 104], "#d0d3c6", "#8c9c8d");
    rect(44, 105, 532, 24, "#9da99a", "#778a78");
    line([47, 126, 572, 126], "#556e5b", 2);
    for (let i = 0; i < 4; i++) {
      const x = 110 + i * 125;
      add({ kind: "ellipse", x, y: 104, rx: 31, ry: 12 }, "#d9dfd1", "#869e8c");
      add({ kind: "ellipse", x, y: 105, rx: 24, ry: 8 }, "#b5c7bb", "#9aae9d");
      add({ kind: "ellipse", x: x + 2, y: 109, rx: 3, ry: 1.5 }, "#6c8270");
      line([x, 97, x, 87, x + 8, 87], "#6b8275", 4);
      line([x - 1, 96, x - 1, 87, x + 7, 87], "#d8dfd0", 1.3);
      rect(x + 37, 84, 9, 17, "#bdc9b6", "#758d77");
      rect(x + 39, 82, 5, 4, "#667f6c");
    }
    for (let x = 50; x < 580; x += 43) line([x, 64, x, 84], "#849c8955", 0.7);
    rect(-10, 64, 44, 206, "#627d6d", "#4f6c5c");
    rect(-7, 74, 34, 156, "#708c7a");
    rect(24, 147, 3, 20, "#b3c3b1");
    rect(3, 92, 15, 12, "#b8ccb5");
    text(4, 101, "出口", 6, "#4f6d50");
    rect(469, 47, 36, 12, "#9cb18e", "#7c9571");
    text(474, 56, "保持整洁", 6, "#4f6e48");
    rect(558, 190, 22, 34, "#b2beab", "#839a7e");
    rect(562, 198, 14, 4, "#697f65");
    rect(547, 290, 28, 30, "#7f9481", "#607b65");
    add(
      { kind: "ellipse", x: 561, y: 291, rx: 14, ry: 4 },
      "#829686",
      "#57765c",
    );
    add({ kind: "ellipse", x: 561, y: 291, rx: 10, ry: 2.5 }, "#49664e");
    text(344, 334, "公共洗手区 / 隔间区域不入镜", 7, "#667d61");
  }
  const ops: DrawOp[] = [
    {
      shape: { kind: "rect", x: 0, y: 0, w: WORLD_W, h: WORLD_H },
      fill: "#667164",
      blocks: true,
    },
    ...raw.map((op) => projectOp(scene, op)),
  ];
  baseCache.set(scene, ops);
  return ops;
}

function surfaceTone(source: string, target: string, ratio: number): string {
  const a = Number.parseInt(source.slice(1, 7), 16);
  const b = Number.parseInt(target.slice(1, 7), 16);
  const channel = (shift: number) =>
    Math.round(
      ((a >> shift) & 255) * (1 - ratio) + ((b >> shift) & 255) * ratio,
    )
      .toString(16)
      .padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

function desk(add: Sink, x: number, y: number, seat: number) {
  // 监控机位下保留桌面的厚度、金属框架和纸面反射，避免图标式家具。
  add(
    { kind: "ellipse", x: x + 4, y: y + 43, rx: 41, ry: 7 },
    "#20241f16",
    undefined,
    undefined,
    false,
  );
  for (const dx of [-31, 29]) {
    add(
      { kind: "line", points: [x + dx, y + 29, x + dx + 2, y + 49] },
      undefined,
      "#505854",
      undefined,
      true,
      3.2,
    );
    add(
      { kind: "line", points: [x + dx + 0.8, y + 30, x + dx + 2.8, y + 47] },
      undefined,
      "#8a9189",
      undefined,
      false,
      0.8,
    );
    add(
      { kind: "line", points: [x + dx - 4, y + 49, x + dx + 7, y + 49] },
      undefined,
      "#434a46",
      undefined,
      true,
      2.5,
    );
  }
  add(
    { kind: "line", points: [x - 30, y + 39, x + 30, y + 39] },
    undefined,
    "#737b71",
    undefined,
    true,
    2,
  );
  add(
    {
      kind: "poly",
      points: [x - 39, y + 25, x + 39, y + 25, x + 38, y + 36, x - 38, y + 36],
    },
    "#8b816d",
    "#655f53",
    undefined,
    true,
    0.8,
  );
  add({ kind: "rect", x: x - 23, y: y + 30, w: 42, h: 3 }, "#5b5d52");
  add(
    {
      kind: "poly",
      points: [x - 39, y + 12, x + 35, y + 12, x + 41, y + 30, x - 40, y + 30],
    },
    "#b8ac91",
    "#817b69",
    undefined,
    true,
    1,
  );
  add(
    { kind: "line", points: [x - 37, y + 12, x + 35, y + 12] },
    undefined,
    "#ded5bd",
    undefined,
    false,
    1,
  );
  add(
    { kind: "line", points: [x - 39, y + 29, x + 40, y + 29] },
    undefined,
    "#918570",
    undefined,
    false,
    1.2,
  );
  for (let i = 0; i < 5; i++) {
    const yy = y + 15 + i * 2.8;
    add(
      {
        kind: "line",
        points: [
          x - 34,
          yy,
          x - 12,
          yy + 0.3,
          x + 13,
          yy - 0.2,
          x + 34,
          yy + 0.4,
        ],
      },
      undefined,
      i % 2 ? "#7c765d20" : "#ece3c72b",
      undefined,
      false,
      0.55,
    );
  }
  add(
    {
      kind: "poly",
      points: [x - 18, y + 13, x + 10, y + 14, x + 13, y + 29, x - 18, y + 28],
    },
    "#686d6329",
    undefined,
    undefined,
    false,
  );
  add(
    {
      kind: "poly",
      points: [x - 19, y + 12, x + 6, y + 12, x + 10, y + 28, x - 17, y + 28],
    },
    "#e8e7dc",
    "#b1b3a7",
    undefined,
    true,
    0.5,
  );
  add(
    {
      kind: "poly",
      points: [x - 8, y + 13, x + 13, y + 14, x + 14, y + 29, x - 7, y + 27],
    },
    "#efeee3",
    "#c1c3b7",
    undefined,
    true,
    0.5,
  );
  for (let i = 0; i < 4; i++) {
    add(
      {
        kind: "line",
        points: [x - 15, y + 16 + i * 2.6, x + 3, y + 16 + i * 2.6],
      },
      undefined,
      "#8c938971",
      undefined,
      false,
      0.55,
    );
    add(
      {
        kind: "line",
        points: [x - 4, y + 18 + i * 2.2, x + 10, y + 19 + i * 2.2],
      },
      undefined,
      "#727d7270",
      undefined,
      false,
      0.55,
    );
  }
  add(
    { kind: "rect", x: x + 25, y: y + 30, w: 10, h: 5, radius: 0.3 },
    "#d9d9cc",
    "#8e9388",
    undefined,
    true,
    0.5,
  );
  add(
    {
      kind: "text",
      x: x + 30,
      y: y + 34,
      text: String(seat).padStart(2, "0"),
      size: 4.7,
      align: "center",
    },
    "#59635c",
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
): { ops: DrawOp[]; actors: ActorView[]; backgroundCount: number } {
  if (plan.config.visualVersion !== VISUAL_VERSION) {
    return {
      ...legacyGeometry(plan, tick, scene, caught),
      backgroundCount: legacyBackground(scene).length,
    };
  }
  const backdrop = background(scene);
  const ops: DrawOp[] = [];
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
        { kind: "rect", x: pos.x - 22, y: pos.y - 6, w: 43, h: 34, radius: 1 },
        "#707b68",
        "#505e49",
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
  return {
    ops: [...backdrop, ...ops.map((op) => projectOp(scene, op))],
    actors: actors.map((a) => ({ ...a, ...projectPoint(scene, a.x, a.y) })),
    backgroundCount: backdrop.length,
  };
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
  const prepping = phase === "prepare";
  const id = p.id;
  const t = tick / TICK_RATE;
  const bob = Math.sin(t * 1.7 + id) * 0.35;
  const skin = surfaceTone(p.skin, "#969d92", 0.34);
  const skinShade = surfaceTone(skin, "#3f4840", 0.28);
  const cloth = surfaceTone(p.shirt, "#72796e", 0.54);
  const clothDark = surfaceTone(cloth, "#333d38", 0.34);
  const clothLight = surfaceTone(cloth, "#d5d8cc", 0.25);
  const hair = surfaceTone(p.hair, "#242c27", 0.25);
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
    lean = Math.sin(t * 1.5 + id) * 6;
  const hx = x + lean;
  const hy = y + headY + bob;
  const sx = x + lean * 0.68;
  const facing =
    active && event?.kind === "peeking"
      ? event.variant === 0
        ? 1
        : -1
      : Math.sin(t * 0.8 + id) * 0.25;
  const hand = (ax: number, ay: number) => {
    add(
      { kind: "ellipse", x: ax + 0.5, y: ay + 0.7, rx: 3.6, ry: 2.9 },
      skinShade,
      undefined,
      id,
    );
    add(
      { kind: "ellipse", x: ax, y: ay, rx: 3.1, ry: 2.5 },
      skin,
      undefined,
      id,
    );
  };
  const arm = (points: number[]) => {
    const ax = points[0],
      ay = points[1],
      bx = points.at(-2)!,
      by = points.at(-1)!;
    const mx = ax + (bx - ax) * 0.48;
    const my = ay + (by - ay) * 0.48 + (by < ay ? 1.5 : 3);
    add(
      { kind: "line", points: [ax, ay, mx, my] },
      undefined,
      clothDark,
      id,
      true,
      9,
    );
    add(
      { kind: "line", points: [ax - 0.3, ay - 0.4, mx, my - 0.4] },
      undefined,
      cloth,
      id,
      true,
      7.5,
    );
    add(
      { kind: "line", points: [ax - 1, ay - 1, mx - 1, my - 1] },
      undefined,
      clothLight,
      undefined,
      false,
      0.8,
    );
    add(
      { kind: "line", points: [mx, my, bx, by] },
      undefined,
      skinShade,
      id,
      true,
      6.1,
    );
    add(
      { kind: "line", points: [mx, my - 0.4, bx, by - 0.4] },
      undefined,
      skin,
      id,
      true,
      4.7,
    );
    hand(bx, by);
  };
  add(
    { kind: "ellipse", x: x + 3, y: y + 41, rx: drawDesk ? 23 : 18, ry: 6 },
    "#1c272431",
    undefined,
    undefined,
    false,
  );
  if (!drawDesk) {
    const stride = view.action === "walking" ? Math.sin(t * 5.5 + id) * 5 : 0;
    add(
      { kind: "line", points: [x - 7, y + 22, x - 8 - stride * 0.3, y + 43] },
      undefined,
      "#404d48",
      id,
      true,
      8,
    );
    add(
      { kind: "line", points: [x + 7, y + 22, x + 9 + stride * 0.3, y + 43] },
      undefined,
      "#4b5751",
      id,
      true,
      8,
    );
    add(
      { kind: "line", points: [x - 8, y + 25, x - 9 - stride * 0.2, y + 41] },
      undefined,
      "#81877a5c",
      undefined,
      false,
      1,
    );
    add(
      {
        kind: "ellipse",
        x: x - 9 - stride * 0.3,
        y: y + 45 + stride * 0.2,
        rx: 5.4,
        ry: 2.6,
      },
      "#2d3732",
      undefined,
      id,
    );
    add(
      {
        kind: "ellipse",
        x: x + 10 + stride * 0.3,
        y: y + 45 - stride * 0.2,
        rx: 5.4,
        ry: 2.6,
      },
      "#303934",
      undefined,
      id,
    );
  }
  add(
    {
      kind: "poly",
      points: [
        sx - 15,
        y - 3,
        sx + 14,
        y - 3,
        sx + 23,
        y + 5,
        x + 18,
        y + 30,
        x - 18,
        y + 30,
        sx - 23,
        y + 5,
      ],
    },
    clothDark,
    "#343f3838",
    id,
    true,
    0.65,
  );
  add(
    {
      kind: "poly",
      points: [
        sx - 13,
        y - 3,
        sx + 13,
        y - 3,
        sx + 20,
        y + 5,
        x + 14,
        y + 29,
        x - 15,
        y + 29,
        sx - 20,
        y + 5,
      ],
    },
    cloth,
    undefined,
    id,
  );
  add(
    {
      kind: "poly",
      points: [
        sx - 18,
        y + 1,
        sx - 10,
        y - 3,
        sx + 10,
        y - 3,
        sx + 17,
        y + 2,
        sx + 9,
        y + 4,
        sx - 9,
        y + 4,
      ],
    },
    clothLight,
    undefined,
    id,
  );
  add(
    {
      kind: "poly",
      points: [sx - 17, y + 7, sx - 8, y + 10, x - 11, y + 27, x - 16, y + 27],
    },
    clothDark,
    undefined,
    id,
  );
  add(
    { kind: "line", points: [sx + 11, y + 5, sx + 7, y + 16, x + 10, y + 26] },
    undefined,
    clothLight,
    undefined,
    false,
    0.8,
  );
  add(
    { kind: "line", points: [sx - 9, y + 10, sx - 3, y + 18, x - 6, y + 25] },
    undefined,
    clothDark,
    undefined,
    false,
    0.9,
  );
  if (id % 3 === 0) {
    add(
      { kind: "line", points: [sx + 1, y + 5, x + 1, y + 28] },
      undefined,
      "#48544a85",
      undefined,
      false,
      1,
    );
    add(
      {
        kind: "poly",
        points: [
          sx - 7,
          y - 1,
          sx,
          y + 7,
          sx + 7,
          y - 1,
          sx + 4,
          y + 9,
          sx - 3,
          y + 9,
        ],
      },
      "#c1c4b5",
      undefined,
      id,
    );
  } else {
    add(
      { kind: "line", points: [sx - 5, y + 1, sx, y + 5, sx + 5, y + 1] },
      undefined,
      clothDark,
      undefined,
      false,
      1.8,
    );
  }
  add(
    { kind: "rect", x: hx - 4, y: hy + 5, w: 8, h: 8 },
    skinShade,
    undefined,
    id,
  );
  const headPart: Sink = (
    shape,
    fill,
    stroke,
    actorId,
    blocks = true,
    width = 1.5,
  ) => {
    const scale = 0.84;
    let projected = shape;
    if (shape.kind === "ellipse")
      projected = {
        ...shape,
        x: hx + (shape.x - hx) * scale,
        y: hy + (shape.y - hy) * scale,
        rx: shape.rx * scale,
        ry: shape.ry * scale,
      };
    else if (shape.kind === "poly" || shape.kind === "line")
      projected = {
        ...shape,
        points: shape.points.map(
          (value, i) =>
            (i % 2 === 0 ? hx : hy) + (value - (i % 2 === 0 ? hx : hy)) * scale,
        ),
      };
    add(projected, fill, stroke, actorId, blocks, width * scale);
  };
  if (p.hairstyle === 3)
    headPart(
      { kind: "ellipse", x: hx + 7, y: hy + 10, rx: 4.4, ry: 10.5 },
      hair,
      undefined,
      id,
    );
  // 头顶为实际可见的椭圆，保留统一身体拾取而不另加隐形命中框。
  headPart(
    { kind: "ellipse", x: hx, y: hy, rx: 12, ry: 9.2, role: "head" },
    hair,
    "#18241e69",
    id,
    true,
    0.55,
  );
  headPart(
    {
      kind: "poly",
      points: [
        hx - 7,
        hy + 4,
        hx - 4,
        hy + 8,
        hx + facing * 4,
        hy + 10,
        hx + 7,
        hy + 6,
        hx + 7,
        hy + 3,
      ],
    },
    skin,
    undefined,
    id,
  );
  headPart(
    { kind: "ellipse", x: hx - 10.4, y: hy + 3, rx: 2.1, ry: 3.2 },
    skinShade,
    undefined,
    id,
  );
  headPart(
    { kind: "ellipse", x: hx + 10.4, y: hy + 3, rx: 2.1, ry: 3.2 },
    skin,
    undefined,
    id,
  );
  headPart(
    {
      kind: "poly",
      points: [
        hx - 10,
        hy + 1,
        hx - 9,
        hy - 6,
        hx - 2,
        hy - 9,
        hx + 7,
        hy - 7,
        hx + 10,
        hy - 2,
        hx + 7,
        hy + 5,
        hx + 3,
        hy + 4,
        hx - 1,
        hy + 5,
        hx - 7,
        hy + 3,
      ],
    },
    hair,
    undefined,
    id,
  );
  const strand = surfaceTone(hair, "#93998a", 0.17);
  for (let i = 0; i < 5; i++)
    headPart(
      {
        kind: "line",
        points: [
          hx - 7 + i * 3.1,
          hy - 5,
          hx - 5 + i * 2.6,
          hy,
          hx - 4 + i * 2.2,
          hy + 2,
        ],
      },
      undefined,
      strand,
      undefined,
      false,
      0.55,
    );
  if (p.hairstyle === 1)
    headPart(
      { kind: "line", points: [hx - 3, hy - 8, hx - 1, hy - 4, hx + 1, hy] },
      undefined,
      "#a4a39460",
      undefined,
      false,
      0.65,
    );
  if (Math.abs(facing) > 0.5)
    headPart(
      {
        kind: "poly",
        points: [
          hx + facing * 8,
          hy + 3,
          hx + facing * 13,
          hy + 6,
          hx + facing * 7,
          hy + 7,
        ],
      },
      skin,
      undefined,
      id,
    );
  drawDesk?.();
  const device = (dx: number, dy: number, horizontal = false) => {
    const w = horizontal ? 29 : 19,
      h = horizontal ? 19 : 27;
    add(
      { kind: "rect", x: dx + 1.2, y: dy + 1.2, w, h, radius: 1.8 },
      "#20282355",
      undefined,
      undefined,
      false,
    );
    add(
      { kind: "rect", x: dx, y: dy, w, h, radius: 2 },
      "#202b2e",
      "#a8b4ad",
      id,
      true,
      0.75,
    );
    add(
      { kind: "rect", x: dx + 2, y: dy + 2, w: w - 4, h: h - 5, radius: 0.6 },
      "#62c9d2",
      undefined,
      id,
    );
    add(
      { kind: "rect", x: dx + 2, y: dy + 2, w: w - 4, h: h - 5, radius: 0.6 },
      "#748c8d54",
      undefined,
      id,
    );
    add(
      {
        kind: "poly",
        points: [
          dx + 3,
          dy + 3,
          dx + w - 3,
          dy + 3,
          dx + w - 3,
          dy + 9,
          dx + 6,
          dy + 15,
        ],
      },
      "#c3d8d238",
      undefined,
      id,
    );
    for (let i = 0; i < 3; i++)
      add(
        {
          kind: "line",
          points: [dx + 4, dy + 6 + i * 4, dx + w - 4, dy + 6 + i * 4],
        },
        undefined,
        "#c9dbd0c7",
        id,
        true,
        0.8,
      );
    add(
      {
        kind: "line",
        points: [dx + w / 2 - 2, dy + h - 2, dx + w / 2 + 2, dy + h - 2],
      },
      undefined,
      "#8b9a92",
      id,
      true,
      0.65,
    );
  };
  const note = (dx: number, dy: number, folded = false) => {
    const w = folded ? 18 : 33,
      h = folded ? 30 : 24;
    add(
      {
        kind: "poly",
        points: [
          dx + 1,
          dy + 3,
          dx + w * 0.47,
          dy + 1,
          dx + w + 1,
          dy + 4,
          dx + w + 1,
          dy + h + 1,
          dx + 1,
          dy + h + 1,
        ],
      },
      "#474d3c32",
      undefined,
      undefined,
      false,
    );
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
      "#8c875f",
      id,
      true,
      0.75,
    );
    add(
      {
        kind: "poly",
        points: [
          dx + w * 0.47,
          dy,
          dx + w,
          dy + 3,
          dx + w,
          dy + h,
          dx + w * 0.47,
          dy + h - 2,
        ],
      },
      "#8f8c672e",
      undefined,
      id,
    );
    add(
      {
        kind: "line",
        points: [dx + w * 0.47, dy + 1, dx + w * 0.47, dy + h - 2],
      },
      undefined,
      "#a19562",
      id,
      true,
      0.7,
    );
    for (let i = 0; i < 5; i++)
      add(
        {
          kind: "line",
          points: [dx + 3, dy + 5 + i * 3.2, dx + w - 3, dy + 6 + i * 3.2],
        },
        undefined,
        "#65694c",
        id,
        true,
        0.8,
      );
    for (let i = 0; i < 3; i++)
      add(
        {
          kind: "line",
          points: [dx + 5 + i * 5, dy + 4, dx + 5 + i * 5, dy + 8],
        },
        undefined,
        "#555c45",
        id,
        true,
        0.6,
      );
  };
  if (active && event) {
    if (event.kind === "device") {
      const dx = x + (event.variant === 0 ? 20 : -29),
        dy = y + (event.variant === 0 ? -2 : 5);
      arm([sx - 15, y + 4, dx + 2, dy + 17]);
      arm([sx + 15, y + 4, dx + 13, dy + 14]);
      device(dx, dy, event.variant === 1);
      hand(dx + 4 + Math.sin(t * 4) * 1.2, dy + 11);
    } else if (
      event.kind === "notes" ||
      (event.kind === "restroom" && event.variant === 0)
    ) {
      const dx = x + (event.variant === 0 ? 12 : -29),
        dy = y + 2;
      arm([sx - 15, y + 4, dx + 1, dy + 17]);
      arm([sx + 15, y + 4, dx + 25, dy + 17]);
      note(dx, dy, event.variant === 1);
      hand(dx, dy + 17);
    } else if (event.kind === "peeking") {
      const neighbor = plan.people[event.relatedId!];
      const neighborPos = seatPosition(neighbor);
      arm([sx - 14, y + 5, x + 4, y + 23]);
      arm([sx + 14, y + 4, x + lean + (lean > 0 ? 13 : -13), y + 18]);
      add(
        {
          kind: "line",
          points: [x + 2, y + 21, x + 7 + Math.sin(t * 6) * 2, y + 17],
        },
        undefined,
        "#343f40",
        id,
        true,
        1.7,
      );
      // 现实监控不会显示视线辅助线；侧身探向邻卷、头向和本桌抄写共同表达违规。
      if (Math.abs(neighborPos.x - x) < 140)
        add(
          {
            kind: "line",
            points: [sx + (lean > 0 ? 15 : -15), y + 9, x + lean, y + 15],
          },
          undefined,
          clothLight,
          undefined,
          false,
          1,
        );
    } else {
      const partner = actors.find(
        (a) => event.actors.includes(a.person.id) && a.person.id !== id,
      );
      if (partner) {
        const direction = partner.x > x ? 1 : -1,
          mx = (x + partner.x) / 2;
        arm([sx + direction * 15, y + 5, mx - direction * 4, y + 7]);
        arm([sx - direction * 15, y + 5, x - direction * 16, y + 21]);
        if (id === event.actors[0]) {
          const progress = (tick - event.start) / (event.end - event.start);
          const nx = mx - 14 + Math.sin(progress * Math.PI * 2) * 8;
          note(nx, y - 3);
          hand(nx + 3, y + 18);
        }
      }
    }
  } else if (!drawDesk && view.action === "washing") {
    arm([sx - 15, y + 3, x - 3, y - 23]);
    arm([sx + 15, y + 3, x + 3, y - 23]);
    add(
      { kind: "line", points: [x - 3, y - 26, x + 2, y - 33] },
      undefined,
      "#acc6c054",
      undefined,
      false,
      1.1,
    );
    add(
      {
        kind: "ellipse",
        x: x + Math.sin(t * 4) * 2,
        y: y - 26,
        rx: 5.5,
        ry: 2.2,
      },
      "#d4dfd0b8",
      undefined,
      id,
    );
  } else if (!event && view.action === "stretch") {
    arm([sx - 15, y + 3, x - 22, y - 18]);
    arm([sx + 15, y + 3, x + 24, y - 18]);
  } else if (!event && view.action === "pickPen") {
    arm([sx + 15, y + 6, x + 28, y + 42]);
    add(
      { kind: "line", points: [x + 23, y + 42, x + 34, y + 40] },
      undefined,
      "#537eac",
      id,
      true,
      2.3,
    );
  } else if (!event && view.action === "returnPen") {
    arm([sx + 15, y + 4, x + 39, y + 2]);
    add(
      { kind: "line", points: [x + 34, y, x + 51, y - 3] },
      undefined,
      "#376a9d",
      id,
      true,
      3,
    );
    add(
      { kind: "line", points: [x + 48, y - 2.4, x + 51, y - 3] },
      undefined,
      "#c0cac0",
      id,
      true,
      1,
    );
    arm([sx - 15, y + 4, x - 13, y + 21]);
  } else if (!event && view.action === "stationery" && drawDesk) {
    arm([sx - 15, y + 4, x - 25, y + 20]);
    arm([sx + 15, y + 4, x + 24 + Math.sin(t * 3) * 2, y + 18]);
    add(
      { kind: "rect", x: x + 17, y: y + 18, w: 18, h: 6, radius: 2 },
      "#74828a",
      "#53635d",
      id,
      true,
      0.7,
    );
    add(
      { kind: "line", points: [x + 19, y + 20, x + 33, y + 20] },
      undefined,
      "#b7bcb0",
      id,
      true,
      0.7,
    );
    add(
      { kind: "rect", x: x - 28, y: y + 18, w: 9, h: 5, radius: 0.5 },
      "#dedfd3",
      "#9caa9b",
      id,
      true,
      0.5,
    );
  } else if (!event && view.action === "clock") {
    arm([sx + 15, y + 4, x + 19, y - 4]);
    arm([sx - 15, y + 4, x - 13, y + 21]);
    add(
      { kind: "rect", x: x + 16, y: y - 2, w: 6, h: 3.5, radius: 0.5 },
      "#394644",
      "#8b9991",
      id,
      true,
      0.5,
    );
  } else if (
    prepping ||
    (!event &&
      (view.action === "thinking" ||
        view.action === "glance" ||
        view.action === "turn"))
  ) {
    arm([sx + 15, y + 5, hx + 10, hy + 9]);
    arm([sx - 15, y + 4, x - 14, y + 21]);
  } else if (
    !drawDesk &&
    (view.action === "bag" || view.action === "waiting")
  ) {
    arm([sx - 15, y + 4, x - 11, y + 23]);
    arm([sx + 15, y + 4, x + 9, y + 22]);
    if (view.action === "bag") {
      add(
        { kind: "rect", x: x - 11, y: y + 15, w: 22, h: 17, radius: 2 },
        "#777a63",
        "#48564a",
        id,
        true,
        0.7,
      );
      add(
        {
          kind: "line",
          points: [x - 8, y + 15, x - 5, y + 11, x + 5, y + 11, x + 8, y + 15],
        },
        undefined,
        "#53624f",
        id,
        true,
        1.5,
      );
      add(
        { kind: "line", points: [x - 9, y + 22, x + 8, y + 22] },
        undefined,
        "#a0a18b",
        id,
        true,
        0.7,
      );
    }
  } else {
    arm([sx - 15, y + 4, x - 16, y + 22]);
    arm([sx + 15, y + 4, x + 2 + Math.sin(t * 4 + id) * 1.3, y + 22]);
    if (drawDesk)
      add(
        { kind: "line", points: [x + 1, y + 22, x + 6, y + 16] },
        undefined,
        "#374954",
        id,
        true,
        1.65,
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
