import { fitWorld, sceneGeometry, WORLD_H, WORLD_W } from "./geometry.js";
import type { DrawOp, ImageShape } from "./geometry.js";
import type { Game } from "../engine/game.js";
import { VISUAL_VERSION } from "../engine/config.js";
import { PHOTO_ASSETS, photoFrame } from "./photo-assets.js";
import type { PhotoAssetId } from "./photo-assets.js";
import { prepareMeshFrames } from "./mesh-renderer.js";
import type { MeshFrame } from "./mesh-renderer.js";
import { meshBounds } from "./photo-mesh.js";
import { loadRigPeople, rigPeopleReady } from "./rig-people.js";
import {
  initializeRigRenderer,
  rigRendererReady,
  renderRigCamera,
} from "./rig-renderer.js";

const photoImages = new Map<PhotoAssetId, HTMLImageElement>();
const photoLoads = new Map<PhotoAssetId, Promise<void>>();
let loadingPhotos: Promise<void> | undefined;
export const photoAssetsReady = (version = VISUAL_VERSION) =>
  (Object.keys(PHOTO_ASSETS) as PhotoAssetId[])
    .filter((id) => version !== "photo-3" || id !== "peopleC")
    .every((id) => photoImages.has(id)) &&
  (version !== "rig-5" || (rigPeopleReady() && rigRendererReady()));
export function loadPhotoAssets(): Promise<void> {
  if (photoAssetsReady()) return Promise.resolve();
  if (loadingPhotos) return loadingPhotos;
  loadingPhotos = Promise.all([
    loadRigPeople().then(() => initializeRigRenderer()),
    ...(Object.keys(PHOTO_ASSETS) as PhotoAssetId[]).map(async (id) => {
      if (photoImages.has(id)) return;
      const pending = photoLoads.get(id);
      if (pending) return pending;
      const image = new Image();
      image.src = `${import.meta.env.BASE_URL}${PHOTO_ASSETS[id].url}`;
      const decoding = image
        .decode()
        .then(() => {
          photoImages.set(id, image);
        })
        .finally(() => {
          photoLoads.delete(id);
        });
      photoLoads.set(id, decoding);
      return decoding;
    }),
  ])
    .then(() => undefined)
    .catch((error: unknown) => {
      // 保留已解码图片，只重试失败项；考试在全部素材完成前保持未开始。
      loadingPhotos = undefined;
      throw error;
    });
  return loadingPhotos;
}

const roomFrames = new WeakMap<
  HTMLCanvasElement,
  { key: string; image: HTMLCanvasElement }
>();
const rigFrames = new WeakMap<
  HTMLCanvasElement,
  {
    game: Game;
    tick: number;
    records: number;
    caught: number;
    width: number;
    height: number;
    hover: number | null;
    review: number | null;
    ops: DrawOp[];
  }
>();
let sensorTexture: HTMLCanvasElement | undefined;

function sensorFinish(ctx: CanvasRenderingContext2D, photographic = false) {
  if (!sensorTexture) {
    sensorTexture = document.createElement("canvas");
    sensorTexture.width = sensorTexture.height = 96;
    const grain = sensorTexture.getContext("2d")!;
    const pixels = grain.createImageData(96, 96);
    let seed = 6147;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const n = seed >>> 24;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = n;
      pixels.data[i + 3] = 255;
    }
    grain.putImageData(pixels, 0, 0);
  }
  // 轻微固定传感器颗粒与边缘照度下降；不模糊手部和计分物品。
  ctx.save();
  ctx.globalAlpha = photographic ? 0.014 : 0.035;
  ctx.fillStyle = ctx.createPattern(sensorTexture, "repeat")!;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.globalAlpha = 1;
  const edge = ctx.createRadialGradient(300, 165, 150, 300, 165, 390);
  edge.addColorStop(0, "#14201900");
  edge.addColorStop(1, photographic ? "#11161919" : "#12201933");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.restore();
}

export function drawOps(
  ctx: CanvasRenderingContext2D,
  ops: readonly DrawOp[],
  meshes?: ReadonlyMap<ImageShape, MeshFrame>,
) {
  for (const op of ops) {
    const s = op.shape;
    if (s.kind === "rig-person") continue;
    ctx.globalAlpha = op.alpha ?? 1;
    ctx.fillStyle = op.fill ?? "transparent";
    ctx.strokeStyle = op.stroke ?? "transparent";
    ctx.lineWidth = op.width ?? 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (s.kind === "image") {
      if (s.mesh) {
        const frame = meshes?.get(s);
        if (frame) {
          const box = meshBounds(s.mesh);
          ctx.drawImage(
            frame.image,
            frame.sx,
            frame.sy,
            frame.sw,
            frame.sh,
            box.x,
            box.y,
            box.w,
            box.h,
          );
        }
        continue;
      }
      const image = photoImages.get(s.asset);
      if (!image) continue;
      const frame = photoFrame(s);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      if (s.clip) {
        const [x, y, w, h] = s.clip;
        ctx.beginPath();
        ctx.rect(s.x + x * s.w, s.y + y * s.h, w * s.w, h * s.h);
        ctx.clip();
      }
      if (s.flipX) {
        ctx.translate(s.x + s.w, s.y);
        ctx.scale(-1, 1);
        ctx.drawImage(
          image,
          frame.x,
          frame.y,
          frame.w,
          frame.h,
          0,
          0,
          s.w,
          s.h,
        );
      } else
        ctx.drawImage(
          image,
          frame.x,
          frame.y,
          frame.w,
          frame.h,
          s.x,
          s.y,
          s.w,
          s.h,
        );
      ctx.restore();
      continue;
    }
    if (op.gradient) {
      const g = op.gradient;
      const paint = ctx.createLinearGradient(g.x0, g.y0, g.x1, g.y1);
      for (const [offset, color] of g.stops) paint.addColorStop(offset, color);
      if (op.fill) ctx.fillStyle = paint;
      if (op.stroke) ctx.strokeStyle = paint;
    }
    if (s.kind === "text") {
      ctx.font = `${s.size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = s.align ?? "left";
      ctx.fillText(s.text, s.x, s.y);
      continue;
    }
    ctx.beginPath();
    if (s.kind === "rect") ctx.roundRect(s.x, s.y, s.w, s.h, s.radius ?? 0);
    else if (s.kind === "ellipse")
      ctx.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, Math.PI * 2);
    else {
      ctx.moveTo(s.points[0], s.points[1]);
      for (let i = 2; i < s.points.length; i += 2)
        ctx.lineTo(s.points[i], s.points[i + 1]);
      if (s.kind === "poly") ctx.closePath();
    }
    if (op.fill) ctx.fill();
    if (op.stroke) ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function renderCamera(
  canvas: HTMLCanvasElement,
  game: Game,
  scene: number,
  hoverId: number | null = null,
  reviewId: number | null = null,
): DrawOp[] {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (w === 0 || h === 0) return [];
  // 模拟只有新 tick 才改变姿态；同 tick 的 RAF、调试定位和冻结不重复跑六路 GPU。
  const previousRig = rigFrames.get(canvas);
  if (
    game.plan.config.visualVersion === "rig-5" &&
    previousRig?.game === game &&
    previousRig.tick === game.tick &&
    previousRig.records === game.records.length &&
    previousRig.caught === game.caught.size &&
    previousRig.width === w &&
    previousRig.height === h &&
    previousRig.hover === hoverId &&
    previousRig.review === reviewId
  )
    return previousRig.ops;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#253b3a";
  ctx.fillRect(0, 0, w, h);
  const fit = fitWorld(rect.width, rect.height);
  const pixelX = w / rect.width;
  const pixelY = h / rect.height;
  ctx.setTransform(
    fit.scale * pixelX,
    0,
    0,
    fit.scale * pixelY,
    fit.offsetX * pixelX,
    fit.offsetY * pixelY,
  );
  ctx.clearRect(0, 0, WORLD_W, WORLD_H);
  if (
    (game.plan.config.visualVersion === VISUAL_VERSION ||
      game.plan.config.visualVersion === "motion-4" ||
      game.plan.config.visualVersion === "photo-3") &&
    !photoAssetsReady(game.plan.config.visualVersion)
  )
    return [];
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, WORLD_W, WORLD_H);
  ctx.clip();
  const { ops, actors, backgroundCount } =
    game.plan.config.visualVersion === "rig-5"
      ? renderRigCamera(
          ctx,
          game.plan,
          game.tick,
          scene,
          game.caught,
          game.records,
          fit.scale * dpr,
        )
      : sceneGeometry(game.plan, game.tick, scene, game.caught, game.records);
  if (game.plan.config.visualVersion !== "rig-5") {
    const frameKey = `${scene}:${game.plan.config.visualVersion ?? "classic"}`;
    let room = roomFrames.get(canvas);
    if (!room || room.key !== frameKey) {
      const image = document.createElement("canvas");
      image.width = 1200;
      image.height = 700;
      const surface = image.getContext("2d")!;
      surface.scale(2, 2);
      drawOps(surface, ops.slice(0, backgroundCount));
      room = { key: frameKey, image };
      roomFrames.set(canvas, room);
    }
    ctx.drawImage(room.image, 0, 0, WORLD_W, WORLD_H);
    const images = ops.flatMap((op) =>
      op.shape.kind === "image" && op.shape.mesh ? [op.shape] : [],
    );
    const meshes = images.length
      ? prepareMeshFrames(images, photoImages, fit.scale * dpr)
      : undefined;
    drawOps(ctx, ops.slice(backgroundCount), meshes);
  }
  if (
    game.plan.config.visualVersion === VISUAL_VERSION ||
    game.plan.config.visualVersion === "motion-4" ||
    game.plan.config.visualVersion === "photo-3"
  )
    sensorFinish(ctx, true);
  else if (game.plan.config.visualVersion === "cctv-2") sensorFinish(ctx);
  const highlight = reviewId ?? hoverId;
  if (highlight !== null) {
    const a = actors.find((v) => v.person.id === highlight);
    if (a) {
      ctx.strokeStyle = reviewId !== null ? "#eabf59" : "#fff6df";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.ellipse(a.x, a.y + 5, 23, 29, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  for (const f of game.feedback.filter((f) => f.scene === scene)) {
    const age = (game.tick - f.tick) / 20;
    ctx.globalAlpha = Math.max(0, 1 - age);
    ctx.font = "bold 17px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = f.kind === "caught" ? "#143d2c" : "#842f34";
    const x = Math.max(35, Math.min(565, f.x));
    const y = Math.max(40, f.y - 34 - age * 15);
    ctx.fillText(`${f.delta > 0 ? "+" : ""}${f.delta}`, x, y);
  }
  ctx.globalAlpha = 1;
  if (game.plan.config.debug) {
    ctx.fillStyle = "#10222cce";
    ctx.fillRect(0, 0, 600, 28);
    ctx.fillStyle = "#ffe69c";
    ctx.textAlign = "left";
    ctx.font = "12px monospace";
    const events = game.plan.events.filter(
      (e) => e.scene === scene && e.prepare <= game.tick && game.tick < e.end,
    );
    ctx.fillText(
      `辅助调试 · ${events.map((e) => `${e.id} ${e.kind} ${game.tick < e.start ? "准备" : "有效"}`).join(" / ")}`,
      10,
      19,
    );
  }
  ctx.restore();
  if (game.plan.config.visualVersion === "rig-5")
    rigFrames.set(canvas, {
      game,
      tick: game.tick,
      records: game.records.length,
      caught: game.caught.size,
      width: w,
      height: h,
      hover: hoverId,
      review: reviewId,
      ops,
    });
  return ops;
}
