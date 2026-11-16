export interface PhotoMesh {
  /** 每个顶点在原始裁剪帧中的归一化坐标。 */
  uv: readonly number[];
  /** 与 uv 一一对应的最终世界坐标。 */
  xy: readonly number[];
  triangles: readonly number[];
}

export interface MeshPoint {
  x: number;
  y: number;
}
export interface MeshUV {
  u: number;
  v: number;
}

/** 连续限制局部照片应变，避免手部拉伸使不透明三角翻面或突然折叠。 */
export function limitMeshStrain(
  base: readonly number[],
  target: readonly number[],
  triangles: readonly number[],
  limit = 0.82,
): number[] {
  let maximum = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i] * 2,
      b = triangles[i + 1] * 2,
      c = triangles[i + 2] * 2;
    const bx = base[b] - base[a],
      by = base[b + 1] - base[a + 1],
      cx = base[c] - base[a],
      cy = base[c + 1] - base[a + 1];
    const determinant = bx * cy - cx * by;
    if (Math.abs(determinant) < 1e-10) continue;
    const ux = target[b] - base[b] - (target[a] - base[a]);
    const uy = target[b + 1] - base[b + 1] - (target[a + 1] - base[a + 1]);
    const vx = target[c] - base[c] - (target[a] - base[a]);
    const vy = target[c + 1] - base[c + 1] - (target[a + 1] - base[a + 1]);
    const d00 = (ux * cy - vx * by) / determinant,
      d01 = (vx * bx - ux * cx) / determinant;
    const d10 = (uy * cy - vy * by) / determinant,
      d11 = (vy * bx - uy * cx) / determinant;
    maximum = Math.max(maximum, Math.hypot(d00, d01, d10, d11));
  }
  // 范数上界随目标连续变化；不在阈值处切换到另一姿势，也不修改头肩基准。
  const strength = maximum > limit ? limit / maximum : 1;
  return base.map((value, i) => value + (target[i] - value) * strength);
}

// 前臂沿真实照片的肘部到手掌收紧，中央胸口不属于桌前图层。
export const ARM_POLYGONS: readonly (readonly number[])[] = [
  [0.02, 0.36, 0.13, 0.31, 0.47, 0.47, 0.43, 0.56, 0.22, 0.53, 0.07, 0.46],
  [0.98, 0.36, 0.87, 0.31, 0.53, 0.47, 0.57, 0.56, 0.78, 0.53, 0.93, 0.46],
];

function polygonContains(
  points: readonly number[],
  x: number,
  y: number,
): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
    const ax = points[j],
      ay = points[j + 1];
    const bx = points[i],
      by = points[i + 1];
    const edge = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (
      Math.abs(edge) < 1e-10 &&
      x >= Math.min(ax, bx) &&
      x <= Math.max(ax, bx) &&
      y >= Math.min(ay, by) &&
      y <= Math.max(ay, by)
    )
      return true;
    if (by > y !== ay > y && x < ((ax - bx) * (y - by)) / (ay - by) + bx)
      inside = !inside;
  }
  return inside;
}

export function inArmRegion(u: number, v: number): boolean {
  return ARM_POLYGONS.some((polygon) => polygonContains(polygon, u, v));
}

function weights(
  data: readonly number[],
  a: number,
  b: number,
  c: number,
  x: number,
  y: number,
): readonly [number, number, number] | undefined {
  const ax = data[a * 2],
    ay = data[a * 2 + 1];
  const bx = data[b * 2],
    by = data[b * 2 + 1];
  const cx = data[c * 2],
    cy = data[c * 2 + 1];
  const determinant = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) return;
  const wa = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / determinant;
  const wb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / determinant;
  const wc = 1 - wa - wb;
  // 仅抵消共享三角边上的浮点舍入；不扩张图片的真实透明度命中范围。
  if (wa < -1e-8 || wb < -1e-8 || wc < -1e-8) return;
  return [wa, wb, wc];
}

function mapPoint(
  mesh: PhotoMesh,
  source: readonly number[],
  target: readonly number[],
  x: number,
  y: number,
): MeshPoint | undefined {
  // 与实际贴图的三角形顺序相反，重叠时选最后绘制的可见表面。
  for (let i = mesh.triangles.length - 3; i >= 0; i -= 3) {
    const a = mesh.triangles[i],
      b = mesh.triangles[i + 1],
      c = mesh.triangles[i + 2];
    const w = weights(source, a, b, c, x, y);
    if (!w) continue;
    return {
      x: target[a * 2] * w[0] + target[b * 2] * w[1] + target[c * 2] * w[2],
      y:
        target[a * 2 + 1] * w[0] +
        target[b * 2 + 1] * w[1] +
        target[c * 2 + 1] * w[2],
    };
  }
}

export function meshPoint(
  mesh: PhotoMesh,
  u: number,
  v: number,
): MeshPoint | undefined {
  return mapPoint(mesh, mesh.uv, mesh.xy, u, v);
}

export function meshUV(
  mesh: PhotoMesh,
  x: number,
  y: number,
): MeshUV | undefined {
  const point = mapPoint(mesh, mesh.xy, mesh.uv, x, y);
  return point
    ? {
        u: Math.max(0, Math.min(1, point.x)),
        v: Math.max(0, Math.min(1, point.y)),
      }
    : undefined;
}

export function meshBounds(mesh: PhotoMesh): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (let i = 0; i < mesh.xy.length; i += 2) {
    left = Math.min(left, mesh.xy[i]);
    right = Math.max(right, mesh.xy[i]);
    top = Math.min(top, mesh.xy[i + 1]);
    bottom = Math.max(bottom, mesh.xy[i + 1]);
  }
  return Number.isFinite(left + top + right + bottom)
    ? { x: left, y: top, w: right - left, h: bottom - top }
    : { x: 0, y: 0, w: 0, h: 0 };
}
