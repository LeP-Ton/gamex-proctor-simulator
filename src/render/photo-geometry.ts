// 冻结第三版照片几何；旧局复盘保留当时实际动作、观察条件与命中像素。
import {
  sceneGeometry as legacyGeometry,
  background as legacyBackground,
} from "./legacy-geometry.js";
import { sceneGeometry as monitorGeometry } from "./monitor-geometry.js";
import { actorViews, seatPosition } from "../engine/world.js";
import { TICK_RATE } from "../engine/config.js";
import { hash } from "../engine/random.js";
import type { ActorView, Person, Plan } from "../engine/types.js";
import { containsPhoto, photoFrame, photoHead } from "./photo-assets.js";
import type { PhotoAssetId } from "./photo-assets.js";

export const WORLD_W = 600;
export const WORLD_H = 350;
export type ImageShape = {
  kind: "image";
  asset: PhotoAssetId;
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
  flipX?: boolean;
  role?: "person";
  head?: { x: number; y: number };
  // 裁剪只限制实际显示的肢体片段，命中使用同一裁剪和透明掩码。
  clip?: [number, number, number, number];
};
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
    }
  | ImageShape;
export interface DrawOp {
  shape: Shape;
  fill?: string;
  stroke?: string;
  width?: number;
  actorId?: number;
  blocks?: boolean;
  alpha?: number;
  gradient?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    stops: [number, string][];
  };
}

// 投影只影响观察条件；事件计划及人物迁移仍使用引擎原始坐标。
export function projectPoint(scene: number, x: number, y: number) {
  const depth = Math.max(0, Math.min(1, y / WORLD_H));
  const scale = 0.62 + depth * 0.38;
  const side = scene % 2 === 0 ? 1 : -1;
  return {
    x: 300 + (x - 300) * scale + side * 14 * (1 - depth),
    y: 20 + y * 0.92,
    scale,
  };
}
const baseCache = new Map<number, DrawOp[]>();
export function background(scene: number): DrawOp[] {
  let ops = baseCache.get(scene);
  if (!ops) {
    ops = [
      {
        shape: {
          kind: "image",
          asset: scene < 4 ? "classroom" : "public",
          frame: scene < 4 ? scene : scene - 4,
          x: 0,
          y: 0,
          w: WORLD_W,
          h: WORLD_H,
        },
      },
    ];
    baseCache.set(scene, ops);
  }
  return ops;
}

function identity(person: Person) {
  const variation =
    hash(`${person.id}/${person.shirt}/${person.hairstyle}`) % 4;
  return {
    asset: (variation >= 2 ? "peopleB" : "people") as PhotoAssetId,
    column: (person.gender === "female" ? 2 : 0) + (variation % 2),
  };
}
function picture(
  asset: PhotoAssetId,
  frame: number,
  x: number,
  y: number,
  w: number,
  h: number,
  actorId?: number,
): DrawOp {
  return { shape: { kind: "image", asset, frame, x, y, w, h }, actorId };
}
function shadow(ops: DrawOp[], x: number, y: number, rx: number, ry: number) {
  // 两层柔和接触阴影取代描边，透明阴影不参加拾取。
  ops.push({
    shape: { kind: "ellipse", x: x + 3, y, rx, ry },
    fill: "#252a2810",
    blocks: false,
  });
  ops.push({
    shape: { kind: "ellipse", x: x + 1, y: y - 1, rx: rx * 0.7, ry: ry * 0.6 },
    fill: "#21262117",
    blocks: false,
  });
}
function desk(ops: DrawOp[], scene: number, person: Person) {
  const pos = seatPosition(person),
    p = projectPoint(scene, pos.x, pos.y);
  const w = 98 * p.scale,
    h = 62 * p.scale;
  const box = { x: p.x - w / 2, y: p.y + 12 * 0.92, w, h };
  ops.push(picture("furniture", scene % 2, box.x, box.y, w, h));
  // 真实桌牌只用于定位，不提供事件状态信息。
  ops.push({
    shape: {
      kind: "text",
      x: p.x + w * 0.35,
      y: box.y + h * 0.4,
      text: String(person.seat).padStart(2, "0"),
      size: 2.8,
    },
    fill: "#50504a",
    blocks: false,
  });
}
function body(view: ActorView, tick: number): ImageShape {
  const { person, event, phase, scene, action } = view;
  const seated = scene < 4;
  const active = phase === "active";
  const t = tick / TICK_RATE;
  const { asset, column } = identity(person);
  let row = seated ? 0 : 3;
  let offset = 0;
  let down = 0;
  let flipX = false;
  if (seated && !active) {
    if (action === "stretch") row = 2;
    if (action === "pickPen" || action === "bag") {
      row = 1;
      offset = 5;
      down = 4;
    }
    if (action === "turn" || action === "glance" || phase === "prepare") {
      offset = Math.sin(t * 1.2 + person.id) * 3;
    }
    if (action === "clock") offset = -3;
  }
  if (active && event?.kind === "peeking") {
    row = 1;
    flipX = event.variant === 1;
    offset = flipX ? -26 : 26;
  }
  const frame = row * 4 + column;
  const source = photoFrame({ asset, frame });
  const p = projectPoint(scene, view.x + offset, view.y + down);
  const height = (seated ? (row === 2 ? 108 : 89) : 101) * p.scale;
  const width = (height * source.w) / source.h;
  const breathe = Math.sin(t * 1.6 + person.id * 2.1) * 0.25;
  const shape: ImageShape = {
    kind: "image",
    asset,
    frame,
    x: p.x - width / 2,
    y: p.y + (seated ? 57 : 55) * 0.92 - height + breathe,
    w: width,
    h: height,
    flipX,
    role: "person",
  };
  shape.head = photoHead(shape);
  return shape;
}
function forearms(
  ops: DrawOp[],
  shape: ImageShape,
  view: ActorView,
  tick: number,
) {
  const stretch = shape.frame >= 8 && shape.frame < 12;
  if (stretch) return;
  const n =
    view.action === "writing" && !view.event
      ? Math.sin(tick / 3 + view.person.id) * 0.35
      : 0;
  // 照片前臂在桌面前绘制；身体下半部仍被真实桌面遮挡。
  for (const clip of [
    [0, 0.28, 0.44, 0.29],
    [0.56, 0.28, 0.44, 0.29],
  ] as [number, number, number, number][]) {
    ops.push({
      shape: {
        ...shape,
        x: shape.x + n,
        role: undefined,
        head: undefined,
        clip,
      },
      actorId: view.person.id,
    });
  }
}
function clothTone(color: string, amount: number) {
  const value = parseInt(color.slice(1), 16);
  const toward = amount > 0 ? 255 : 0;
  const channels = [value >> 16, (value >> 8) & 255, value & 255].map((c) =>
    Math.round(c + (toward - c) * Math.abs(amount)),
  );
  return `rgb(${channels.join(",")})`;
}
function arm(
  ops: DrawOp[],
  id: number,
  from: [number, number],
  to: [number, number],
  cloth: string,
) {
  const [ax, ay] = from,
    [bx, by] = to;
  const mx = ax + (bx - ax) * 0.52,
    my = ay + (by - ay) * 0.5;
  ops.push({
    shape: { kind: "line", points: [ax, ay, mx, my] },
    stroke: cloth,
    width: 7,
    actorId: id,
    gradient: {
      x0: ax,
      y0: ay - 4,
      x1: ax,
      y1: ay + 4,
      stops: [
        [0, clothTone(cloth, 0.22)],
        [0.3, cloth],
        [1, clothTone(cloth, -0.28)],
      ],
    },
  });
  ops.push({
    shape: { kind: "line", points: [mx, my, bx, by] },
    stroke: "#b99b83",
    width: 4.8,
    actorId: id,
    gradient: {
      x0: mx,
      y0: my - 3,
      x1: mx,
      y1: my + 3,
      stops: [
        [0, "#c8b29a"],
        [0.5, "#b49a82"],
        [1, "#776b5d"],
      ],
    },
  });
  ops.push({
    shape: { kind: "ellipse", x: bx, y: by, rx: 3.5, ry: 2.2 },
    fill: "#b9a089",
    actorId: id,
    gradient: {
      x0: bx,
      y0: by - 2,
      x1: bx,
      y1: by + 2,
      stops: [
        [0, "#d5bca1"],
        [1, "#8e7e6c"],
      ],
    },
  });
}
function scaleProp(
  ops: DrawOp[],
  start: number,
  x: number,
  y: number,
  scale: number,
) {
  for (let i = start; i < ops.length; i++) {
    const op = ops[i],
      shape = op.shape;
    if (shape.kind === "poly" || shape.kind === "line") {
      op.shape = {
        ...shape,
        points: shape.points.map(
          (v, n) => (n % 2 ? y : x) + (v - (n % 2 ? y : x)) * scale,
        ),
      };
    } else if (shape.kind === "rect") {
      op.shape = {
        ...shape,
        x: x + (shape.x - x) * scale,
        y: y + (shape.y - y) * scale,
        w: shape.w * scale,
        h: shape.h * scale,
        radius: (shape.radius ?? 0) * scale,
      };
    }
    if (op.width) op.width *= scale;
    if (op.gradient) {
      const g = op.gradient;
      op.gradient = {
        ...g,
        x0: x + (g.x0 - x) * scale,
        y0: y + (g.y0 - y) * scale,
        x1: x + (g.x1 - x) * scale,
        y1: y + (g.y1 - y) * scale,
      };
    }
  }
}
function material(
  ops: DrawOp[],
  id: number,
  x: number,
  y: number,
  angle = 1,
  scale = 1,
) {
  const start = ops.length;
  const points = [x - 11, y - 7, x + 10, y - 5, x + 11, y + 7, x - 9, y + 8];
  ops.push({
    shape: {
      kind: "poly",
      points: points.map((n, i) => (i % 2 ? n + 0.8 : n + 0.7)),
    },
    fill: "#242b2827",
    blocks: false,
  });
  ops.push({
    shape: { kind: "poly", points },
    fill: "#f1ca61",
    actorId: id,
    gradient: {
      x0: x - 10,
      y0: y - 7,
      x1: x + 10,
      y1: y + 8,
      stops: [
        [0, "#ddc885"],
        [0.48, "#e6d49b"],
        [0.52, "#b9a36d"],
        [0.55, "#e0cb90"],
        [1, "#c8b17c"],
      ],
    },
  });
  for (let r = 0; r < 4; r++)
    ops.push({
      shape: {
        kind: "line",
        points: [x - 7, y - 3 + r * 2.2, x + 6, y - 2.5 + r * 2.1],
      },
      stroke: "#69634580",
      width: 0.6,
      actorId: id,
    });
  ops.push({
    shape: { kind: "line", points: [x + angle, y - 5, x + angle + 1, y + 6] },
    stroke: "#88794d85",
    width: 0.6,
    actorId: id,
  });
  scaleProp(ops, start, x, y, scale);
}
function phone(
  ops: DrawOp[],
  id: number,
  x: number,
  y: number,
  horizontal: boolean,
  scale = 1,
) {
  const start = ops.length;
  const w = horizontal ? 18 : 11,
    h = horizontal ? 12 : 19;
  ops.push({
    shape: {
      kind: "rect",
      x: x - w / 2 + 1,
      y: y - h / 2 + 1,
      w,
      h,
      radius: 1.5,
    },
    fill: "#15221b35",
    blocks: false,
  });
  ops.push({
    shape: { kind: "rect", x: x - w / 2, y: y - h / 2, w, h, radius: 1.5 },
    fill: "#293235",
    actorId: id,
    gradient: {
      x0: x - w / 2,
      y0: y - h / 2,
      x1: x + w / 2,
      y1: y + h / 2,
      stops: [
        [0, "#737977"],
        [0.15, "#222b2e"],
        [1, "#131c1e"],
      ],
    },
  });
  ops.push({
    shape: {
      kind: "rect",
      x: x - w / 2 + 1.2,
      y: y - h / 2 + 1.8,
      w: w - 2.4,
      h: h - 4,
      radius: 0.6,
    },
    fill: "#62c9d2",
    actorId: id,
    gradient: {
      x0: x,
      y0: y - h / 2,
      x1: x + w / 2,
      y1: y + h / 2,
      stops: [
        [0, "#9fced4"],
        [0.45, "#78adb5"],
        [1, "#416b75"],
      ],
    },
  });
  for (let n = 0; n < 3; n++)
    ops.push({
      shape: {
        kind: "line",
        points: [
          x - w / 2 + 3,
          y - h / 2 + 4 + n * 2.4,
          x + w / 2 - 3,
          y - h / 2 + 4 + n * 2.4,
        ],
      },
      stroke: "#e1eded65",
      width: 0.6,
      actorId: id,
    });
  scaleProp(ops, start, x, y, scale);
}
function actions(
  ops: DrawOp[],
  view: ActorView,
  tick: number,
  actors: ActorView[],
) {
  const { person, event, phase, scene } = view;
  const p = projectPoint(scene, view.x, view.y),
    id = person.id;
  const t = tick / TICK_RATE;
  const appearance = identity(person);
  const outfit = (
    appearance.asset === "peopleB"
      ? ["#b8b9b1", "#606653", "#997d77", "#c3c2b6"]
      : ["#3e4959", "#8c9291", "#a69c84", "#697582"]
  )[appearance.column];
  const active = phase === "active";
  if (active && event) {
    if (event.kind === "device") {
      const dx = p.x + (event.variant ? -13 : 13),
        dy = p.y + 14;
      arm(ops, id, [p.x + 15, p.y - 5], [dx + 4, dy + 1], outfit);
      phone(ops, id, dx, dy, event.variant === 1, p.scale);
    } else if (event.kind === "notes") {
      const x = p.x + (event.variant ? -12 : 12),
        y = p.y + 18;
      arm(ops, id, [p.x - 15, p.y - 3], [x - 6, y + 1], outfit);
      material(ops, id, x, y, event.variant ? -1 : 1, p.scale);
    } else if (event.kind === "passing") {
      const other = actors.find(
        (a) => a.person.id !== id && event.actors.includes(a.person.id),
      );
      if (!other) return;
      const q = projectPoint(scene, other.x, other.y);
      const x = (p.x + q.x) / 2 + Math.sin(t * 2) * 1.5,
        y = p.y + 12;
      arm(
        ops,
        id,
        [p.x + (q.x > p.x ? 17 : -17), p.y - 4],
        [x + (q.x > p.x ? -6 : 6), y + 2],
        outfit,
      );
      material(ops, id, x, y, 1, p.scale);
    } else if (event.kind === "peeking") {
      // 身体照片实际向邻卷探身；写字手仍落在自己的卷面上。
      const dir = event.variant === 0 ? 1 : -1;
      arm(
        ops,
        id,
        [p.x + dir * 30, p.y - 3],
        [p.x + dir * 8, p.y + 20],
        outfit,
      );
      ops.push({
        shape: {
          kind: "line",
          points: [p.x + dir * 8, p.y + 20, p.x + dir * 13, p.y + 17],
        },
        stroke: "#303b3e",
        width: 1.1,
        actorId: id,
      });
    } else if (event.kind === "restroom") {
      let x = p.x,
        y = p.y + 5;
      if (event.variant && event.actors.length > 1) {
        const other = actors.find(
          (a) => a.person.id !== id && event.actors.includes(a.person.id),
        );
        if (other) {
          const q = projectPoint(scene, other.x, other.y);
          x = (p.x + q.x) / 2;
          y = p.y + 4;
          arm(
            ops,
            id,
            [p.x + (q.x > p.x ? 12 : -12), p.y - 13],
            [x + (q.x > p.x ? -6 : 6), y + 1],
            outfit,
          );
        }
      }
      material(ops, id, x, y, 1, p.scale);
    }
  } else if (view.action === "returnPen" && scene < 4) {
    const dir = person.col < 3 ? 1 : -1;
    const x = p.x + dir * 38,
      y = p.y + 10;
    arm(ops, id, [p.x + dir * 16, p.y - 5], [x, y], outfit);
    ops.push({
      shape: { kind: "line", points: [x - 5, y, x + 7, y - 1] },
      stroke: "#3f6d83",
      width: 2,
      actorId: id,
    });
    ops.push({
      shape: { kind: "line", points: [x - 5, y - 0.4, x + 4, y - 1.3] },
      stroke: "#a6bfc4",
      width: 0.6,
      actorId: id,
    });
  } else if (view.action === "thinking" && scene < 4) {
    arm(ops, id, [p.x + 17, p.y - 6], [p.x + 9, p.y - 18], outfit);
  } else if (view.action === "clock" && scene < 4) {
    arm(ops, id, [p.x - 15, p.y - 5], [p.x - 8, p.y + 4], outfit);
  } else if (view.action === "washing" && scene >= 4) {
    const dy = p.y - 5;
    for (const dx of [-7, 7])
      arm(ops, id, [p.x + dx * 1.6, p.y - 16], [p.x + dx, dy], outfit);
    ops.push({
      shape: { kind: "line", points: [p.x - 3, dy, p.x + 4, dy + 1] },
      stroke: "#b7cbc857",
      width: 1.1,
      blocks: false,
    });
  }
}

export function sceneGeometry(
  plan: Plan,
  tick: number,
  scene: number,
  caught: ReadonlySet<string> = new Set(),
): { ops: DrawOp[]; actors: ActorView[]; backgroundCount: number } {
  if (plan.config.visualVersion === "cctv-2")
    return monitorGeometry(plan, tick, scene, caught);
  if (plan.config.visualVersion !== "photo-3")
    return {
      ...legacyGeometry(plan, tick, scene, caught),
      backgroundCount: legacyBackground(scene).length,
    };
  const backdrop = background(scene),
    ops: DrawOp[] = [...backdrop];
  const sourceActors = actorViews(plan, tick, caught).filter(
    (a) => a.scene === scene,
  );
  const actors = sourceActors.map((a) => {
    const e = a.event;
    if (
      scene < 4 ||
      !e ||
      e.kind !== "restroom" ||
      e.variant !== 1 ||
      e.actors.length < 2
    )
      return a;
    const other = sourceActors.find(
      (b) => b.person.id !== a.person.id && e.actors.includes(b.person.id),
    );
    if (!other) return a;
    // 先自然靠近再交换，避免在原有等候位之间绘制不合人体比例的长臂。
    const progress = Math.max(
      0,
      Math.min(1, (tick - e.prepare) / Math.max(1, e.start - e.prepare)),
    );
    return { ...a, x: a.x + (other.x - a.x) * 0.2 * progress };
  });
  if (scene < 4) {
    for (const person of plan.people
      .filter((p) => p.room === scene)
      .sort((a, b) => a.row - b.row || a.col - b.col)) {
      const pos = seatPosition(person),
        p = projectPoint(scene, pos.x, pos.y);
      shadow(ops, p.x, p.y + 68, 45 * p.scale, 6);
      ops.push(
        picture(
          "furniture",
          2 + (scene % 2),
          p.x - 23 * p.scale,
          p.y - 2,
          46 * p.scale,
          (62 * p.scale) / 0.9,
        ),
      );
      const actor = actors.find((a) => a.person.id === person.id);
      const shape = actor ? body(actor, tick) : undefined;
      if (shape) ops.push({ shape, actorId: person.id });
      desk(ops, scene, person);
      if (shape && actor) {
        forearms(ops, shape, actor, tick);
        actions(ops, actor, tick, actors);
      }
    }
  } else {
    for (const actor of [...actors].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const p = projectPoint(scene, actor.x, actor.y),
        shape = body(actor, tick);
      shadow(ops, p.x, p.y + 54, 14, 4);
      if (actor.action === "walking") {
        ops.push({
          shape: { ...shape, clip: [0, 0, 1, 0.72] },
          actorId: actor.person.id,
        });
        const step = Math.sin(tick / 3 + actor.person.id) * 1.4;
        ops.push({
          shape: {
            ...shape,
            role: undefined,
            head: undefined,
            y: shape.y + step,
            clip: [0, 0.72, 0.5, 0.28],
          },
          actorId: actor.person.id,
        });
        ops.push({
          shape: {
            ...shape,
            role: undefined,
            head: undefined,
            y: shape.y - step,
            clip: [0.5, 0.72, 0.5, 0.28],
          },
          actorId: actor.person.id,
        });
      } else ops.push({ shape, actorId: actor.person.id });
      actions(ops, actor, tick, actors);
    }
  }
  return {
    ops,
    actors: actors.map((a) => ({ ...a, ...projectPoint(scene, a.x, a.y) })),
    backgroundCount: backdrop.length,
  };
}

export function contains(op: DrawOp, x: number, y: number): boolean {
  const s = op.shape;
  if (s.kind === "image") {
    if (s.clip) {
      const u = (x - s.x) / s.w;
      const v = (y - s.y) / s.h;
      const [cx, cy, cw, ch] = s.clip;
      if (u < cx || u >= cx + cw || v < cy || v >= cy + ch) return false;
    }
    return containsPhoto(s, x, y);
  }
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
