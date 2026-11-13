import { fitWorld, sceneGeometry, WORLD_H, WORLD_W } from "./geometry.js";
import type { DrawOp } from "./geometry.js";
import type { Game } from "../engine/game.js";

export function drawOps(ctx: CanvasRenderingContext2D, ops: readonly DrawOp[]) {
  for (const op of ops) {
    const s = op.shape;
    ctx.globalAlpha = op.alpha ?? 1;
    ctx.fillStyle = op.fill ?? "transparent";
    ctx.strokeStyle = op.stroke ?? "transparent";
    ctx.lineWidth = op.width ?? 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
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
  const { ops, actors } = sceneGeometry(
    game.plan,
    game.tick,
    scene,
    game.caught,
  );
  drawOps(ctx, ops);
  const highlight = reviewId ?? hoverId;
  if (highlight !== null) {
    const a = actors.find((v) => v.person.id === highlight);
    if (a) {
      ctx.strokeStyle = reviewId !== null ? "#eabf59" : "#fff6df";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.ellipse(a.x, a.y + 5, 25, 34, 0, 0, Math.PI * 2);
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
  return ops;
}
