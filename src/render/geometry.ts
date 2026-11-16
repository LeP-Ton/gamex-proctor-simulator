import {
  sceneGeometry as legacyGeometry,
  background as legacyBackground,
} from "./legacy-geometry.js";
import { sceneGeometry as monitorGeometry } from "./monitor-geometry.js";
import { sceneGeometry as photoGeometry } from "./photo-geometry.js";
import { sceneGeometry as motionGeometry } from "./motion-4-geometry.js";
import { rigGeometry } from "./rig-geometry.js";
import { actorViews, seatPosition } from "../engine/world.js";
import { TICK_RATE, VISUAL_VERSION } from "../engine/config.js";
import {
  candidatePose,
  publicVisualView,
  candidateProfile,
  physicalEvent,
  smooth,
} from "./candidate-motion.js";
import {
  meshBounds,
  meshPoint,
  meshUV,
  inArmRegion,
  limitMeshStrain,
} from "./photo-mesh.js";
import type { PhotoMesh } from "./photo-mesh.js";
import type { ActorView, Person, Plan, RecordEntry } from "../engine/types.js";
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
  mesh?: PhotoMesh;
  part?: "arms";
  appearance?: { hue: number; saturation: number; brightness: number };
  // 裁剪只限制实际显示的肢体片段，命中使用同一裁剪和透明掩码。
  clip?: [number, number, number, number];
};
export type Shape =
  | {
      kind: "rig-person";
      x: number;
      y: number;
      w: number;
      h: number;
      head: { x: number; y: number };
      role: "person";
    }
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
  rigContext?: {
    plan: Plan;
    tick: number;
    scene: number;
    caught: ReadonlySet<string>;
    records: readonly RecordEntry[];
  };
}

type GeometryResult = {
  ops: DrawOp[];
  actors: ActorView[];
  backgroundCount: number;
};
type RigGeometryProvider = (
  plan: Plan,
  tick: number,
  scene: number,
  caught: ReadonlySet<string>,
  records: readonly RecordEntry[],
) => GeometryResult;
type RigPickProvider = (
  context: NonNullable<DrawOp["rigContext"]>,
  x: number,
  y: number,
) => number | null;
let rigGeometryProvider: RigGeometryProvider | undefined;
let rigPickProvider: RigPickProvider | undefined;
/** 浏览器注册真实三维骨骼投影和网格射线；引擎测试不依赖 DOM 或 GPU。 */
export function registerRigGeometry(
  geometry: RigGeometryProvider,
  picker: RigPickProvider,
) {
  rigGeometryProvider = geometry;
  rigPickProvider = picker;
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
const GRID_U = [0, 0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88, 1];
const GRID_V = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.59, 0.72, 0.86, 1];
const TRIANGLES: number[] = [];
for (let row = 0; row < GRID_V.length - 1; row++)
  for (let col = 0; col < GRID_U.length - 1; col++) {
    const a = row * GRID_U.length + col,
      b = a + 1,
      c = a + GRID_U.length,
      d = c + 1;
    TRIANGLES.push(a, c, b, b, c, d);
  }
const handUV = (shape: ImageShape, right: boolean) => ({
  u: shape.asset === "peopleC" ? (right ? 0.59 : 0.41) : right ? 0.65 : 0.35,
  v: shape.asset === "peopleC" ? 0.55 : 0.5,
});
function handPoint(shape: ImageShape, right: boolean) {
  const point = handUV(shape, right);
  return shape.mesh
    ? meshPoint(shape.mesh, point.u, point.v)!
    : { x: shape.x + shape.w * point.u, y: shape.y + shape.h * point.v };
}
function body(
  view: ActorView,
  tick: number,
  plan: Plan,
  records: readonly RecordEntry[],
): ImageShape {
  const seated = view.scene < 4;
  const profile = candidateProfile(plan, view.person),
    pose = candidatePose(plan, view, tick, records);
  const frame = seated ? profile.frame : profile.standingFrame,
    asset = profile.asset;
  const source = photoFrame({ asset, frame });
  const p = projectPoint(view.scene, view.x, view.y);
  const height = (seated ? 89 : 101) * p.scale * profile.height;
  const width = ((height * source.w) / source.h) * profile.width;
  const top = p.y + (seated ? 57 : 55) * 0.92 - height;
  const hu = (source.headX ?? source.w / 2) / source.w,
    hv = (source.headY ?? source.h * 0.1) / source.h;
  const uv: number[] = [],
    xy: number[] = [],
    baseXY: number[] = [];
  const lhand = asset === "peopleC" ? 0.41 : 0.35,
    rhand = 1 - lhand;
  const wristY = asset === "peopleC" ? 0.55 : 0.5;
  const influence = (
    u: number,
    v: number,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
  ) => Math.exp(-(((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2));
  for (const v of GRID_V)
    for (const u of GRID_U) {
      uv.push(u, v);
      let x = (u - 0.5) * width,
        y = v * height;
      const upper = 1 - smooth((v - 0.4) / 0.29);
      x += pose.leanX * p.scale * upper;
      y += (pose.leanY * upper + pose.walkBob) * p.scale;
      const hw = 1 - smooth((v - 0.14) / 0.11);
      const hx = (hu - 0.5) * width,
        hy = hv * height;
      const dx = (u - hu) * width,
        dy = (v - hv) * height;
      const angle = pose.headAngle * hw,
        co = Math.cos(angle),
        si = Math.sin(angle);
      x +=
        (dx * co - dy * si - dx) * hw +
        (u - hu) * width * (profile.headScale - 1) * hw;
      y += (dx * si + dy * co - dy) * hw + pose.headY * p.scale * hw;
      const shoulder = Math.exp(-(((v - 0.25) / 0.13) ** 2));
      x += (u < 0.5 ? -1 : 1) * pose.shoulders * shoulder * p.scale;
      const armBaseX = x,
        armBaseY = y;
      const arms = [
        [lhand, wristY, pose.leftX, pose.leftY, 0.14, 0.12],
        [rhand, wristY, pose.rightX, pose.rightY, 0.14, 0.12],
        [0.1, 0.39, pose.elbowLeftX, pose.elbowLeftY, 0.13, 0.12],
        [0.9, 0.39, pose.elbowRightX, pose.elbowRightY, 0.13, 0.12],
      ];
      for (const [cx, cy, mx, my, rx, ry] of arms) {
        const w = influence(u, v, cx, cy, rx, ry);
        x += mx * p.scale * w;
        y += my * p.scale * w;
      }
      const armDX = x - armBaseX,
        armDY = y - armBaseY;
      if (!seated && v > 0.6) {
        const legs = smooth((v - 0.6) / 0.3),
          side = u < 0.5 ? -1 : 1;
        x += pose.stride * 0.3 * legs * side * p.scale;
        y += pose.stride * legs * side * p.scale;
      }
      baseXY.push(p.x + x - armDX, top + y - armDY);
      xy.push(p.x + x, top + y);
    }
  const mesh = {
    uv,
    xy: limitMeshStrain(baseXY, xy, TRIANGLES),
    triangles: TRIANGLES,
  };
  const bounds = meshBounds(mesh);
  const shape: ImageShape = {
    kind: "image",
    asset,
    frame,
    ...bounds,
    mesh,
    role: "person",
    appearance: {
      hue: profile.hue,
      saturation: profile.saturation,
      brightness: profile.brightness,
    },
  };
  shape.head = meshPoint(mesh, hu, hv);
  return shape;
}
function forearms(ops: DrawOp[], shape: ImageShape, view: ActorView) {
  // 桌前只复用同一网格中的真实前臂轮廓，不再贴回整块胸口衣料。
  ops.push({
    shape: { ...shape, role: undefined, head: undefined, part: "arms" },
    actorId: view.person.id,
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
        [0, "#e8cd65"],
        [0.48, "#efda87"],
        [0.52, "#bda35c"],
        [0.55, "#e8cf77"],
        [1, "#d2b763"],
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
  shapes: ReadonlyMap<number, ImageShape>,
) {
  const { person, event, phase, scene } = view,
    id = person.id,
    shape = shapes.get(id);
  if (!shape) return;
  const left = handPoint(shape, false),
    right = handPoint(shape, true);
  const hands = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  const scale = projectPoint(scene, view.x, view.y).scale;
  if (phase === "active" && event) {
    if (event.kind === "device")
      phone(
        ops,
        id,
        hands.x + (event.variant ? -2 : 2),
        hands.y + 1,
        event.variant === 1,
        scale,
      );
    else if (
      event.kind === "notes" ||
      (event.kind === "restroom" && event.variant === 0)
    )
      material(
        ops,
        id,
        hands.x + (event.variant ? -3 : 3),
        hands.y + 1,
        event.variant ? -1 : 1,
        scale,
      );
    else if (event.kind === "passing" || event.kind === "restroom") {
      if (event.actors[0] !== id) return;
      const other = shapes.get(event.actors[1]);
      if (!other) return;
      const otherHead = other.head!;
      const head = shape.head!;
      const from = handPoint(shape, otherHead.x > head.x),
        to = handPoint(other, head.x > otherHead.x);
      const progress = smooth(
        (tick - event.start) / Math.max(1, event.end - event.start),
      );
      material(
        ops,
        progress < 0.5 ? id : event.actors[1],
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress - 2 * Math.sin(progress * Math.PI),
        1,
        scale,
      );
    } else if (event.kind === "peeking") {
      const hand = right;
      ops.push({
        shape: {
          kind: "line",
          points: [hand.x - 1, hand.y + 1, hand.x + 4, hand.y - 3],
        },
        stroke: "#30383a",
        width: 1.0,
        actorId: id,
      });
    }
  } else if (scene < 4) {
    const hand = person.col < 3 ? right : left;
    const returning = view.action === "returnPen";
    if (view.action === "writing" || returning)
      ops.push({
        shape: {
          kind: "line",
          points: [hand.x - 1, hand.y + 1, hand.x + 4, hand.y - 2],
        },
        stroke: returning ? "#3f6d83" : "#394044",
        width: returning ? 1.9 : 0.8,
        actorId: id,
      });
  }
}

export function sceneGeometry(
  plan: Plan,
  tick: number,
  scene: number,
  caught: ReadonlySet<string> = new Set(),
  records: readonly RecordEntry[] = [],
): { ops: DrawOp[]; actors: ActorView[]; backgroundCount: number } {
  if (plan.config.visualVersion === "rig-5")
    return (rigGeometryProvider ?? rigGeometry)(
      plan,
      tick,
      scene,
      caught,
      records,
    );
  if (plan.config.visualVersion === "motion-4")
    return motionGeometry(plan, tick, scene, caught, records);
  if (plan.config.visualVersion === "photo-3")
    return photoGeometry(plan, tick, scene, caught);
  if (plan.config.visualVersion === "cctv-2")
    return monitorGeometry(plan, tick, scene, caught);
  if (plan.config.visualVersion !== VISUAL_VERSION)
    return {
      ...legacyGeometry(plan, tick, scene, caught),
      backgroundCount: legacyBackground(scene).length,
    };
  const backdrop = background(scene),
    ops: DrawOp[] = [...backdrop];
  const sourceActors = actorViews(plan, tick, caught).filter(
    (a) => a.scene === scene,
  );
  const actors = sourceActors.map((original) => {
    const a = publicVisualView(plan, original, tick);
    const physical = physicalEvent(plan, a.person, tick, records),
      e = physical?.event;
    if (
      scene < 4 ||
      !e ||
      e.kind !== "restroom" ||
      e.variant !== 1 ||
      e.actors.length < 2
    )
      return a;
    const otherSource = sourceActors.find(
      (b) => b.person.id !== a.person.id && e.actors.includes(b.person.id),
    );
    const other = otherSource
      ? publicVisualView(plan, otherSource, tick)
      : undefined;
    return other
      ? { ...a, x: a.x + (other.x - a.x) * 0.25 * physical!.weight }
      : a;
  });
  const shapes = new Map(
    actors.map((a) => [a.person.id, body(a, tick, plan, records)]),
  );
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
      const shape = actor ? shapes.get(person.id) : undefined;
      if (shape) ops.push({ shape, actorId: person.id });
      desk(ops, scene, person);
      if (shape && actor) {
        forearms(ops, shape, actor);
      }
      // 物品位于本排桌面和双方手前；不能在传到邻座时被后画桌面吞掉。
      if (person.col === 3)
        for (const rowActor of actors.filter(
          (a) => a.person.row === person.row,
        ))
          actions(ops, rowActor, tick, shapes);
    }
  } else {
    for (const actor of [...actors].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const p = projectPoint(scene, actor.x, actor.y),
        shape = shapes.get(actor.person.id)!;
      shadow(ops, p.x, p.y + 54, 14, 4);
      ops.push({ shape, actorId: actor.person.id });
    }
    for (const actor of actors) actions(ops, actor, tick, shapes);
  }
  return {
    ops,
    actors: actors.map((a) => ({ ...a, ...projectPoint(scene, a.x, a.y) })),
    backgroundCount: backdrop.length,
  };
}

export function contains(op: DrawOp, x: number, y: number): boolean {
  const s = op.shape;
  if (s.kind === "rig-person")
    return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
  if (s.kind === "image") {
    if (s.mesh) {
      const uv = meshUV(s.mesh, x, y);
      if (!uv || (s.part === "arms" && !inArmRegion(uv.u, uv.v))) return false;
      return containsPhoto(
        { ...s, x: 0, y: 0, w: 1, h: 1, flipX: false },
        uv.u,
        uv.v,
      );
    }
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
  if (x < 0 || y < 0 || x > WORLD_W || y > WORLD_H) return null;
  const context = ops[0]?.rigContext;
  if (context && rigPickProvider) return rigPickProvider(context, x, y);
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
