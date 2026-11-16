import type { ImageShape } from "./geometry.js";
import { ARM_POLYGONS, meshBounds } from "./photo-mesh.js";
import type { PhotoMesh } from "./photo-mesh.js";
import { PHOTO_ASSETS, photoFrame } from "./photo-assets.js";
import type { PhotoAssetId, PhotoFrame } from "./photo-assets.js";

interface MeshShape extends ImageShape {
  mesh?: PhotoMesh;
  part?: "arms";
  appearance?: { hue: number; saturation: number; brightness: number };
}
export interface MeshFrame {
  image: HTMLCanvasElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}
interface Tile {
  shape: MeshShape;
  mesh: PhotoMesh;
  bounds: { x: number; y: number; w: number; h: number };
  x: number;
  y: number;
  w: number;
  h: number;
}

const PADDING = 2;
let gpuCanvas: HTMLCanvasElement | undefined;
let fallbackCanvas: HTMLCanvasElement | undefined;
let gpuFailed = false;
interface GPUState {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  textures: WeakMap<HTMLImageElement, WebGLTexture>;
  maximum: number;
}
let gpu: GPUState | undefined;

const vertexSource = `
attribute vec2 aPosition;
attribute vec2 aTexture;
attribute vec2 aUV;
attribute vec3 aAppearance;
attribute float aArms;
varying vec2 vTexture;
varying vec2 vUV;
varying vec3 vAppearance;
varying float vArms;
void main(){
  gl_Position=vec4(aPosition,0.0,1.0);
  vTexture=aTexture; vUV=aUV; vAppearance=aAppearance; vArms=aArms;
}`;

// 此处的多边形来自同一纯数据常量，GPU 与 Node 拾取不维护两套轮廓。
const polygonShader = ARM_POLYGONS.map((points, index) => {
  const edges: string[] = [];
  for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
    const ax = points[j],
      ay = points[j + 1],
      bx = points[i],
      by = points[i + 1];
    edges.push(
      `if((${by.toFixed(8)}>p.y)!=(${ay.toFixed(8)}>p.y)){if(p.x<(${ax.toFixed(8)}-${bx.toFixed(8)})*(p.y-${by.toFixed(8)})/(${ay.toFixed(8)}-${by.toFixed(8)})+${bx.toFixed(8)})inside=!inside;}`,
    );
  }
  return `bool arm${index}(vec2 p){bool inside=false;${edges.join("")}return inside;}`;
}).join("\n");
const fragmentSource = `
precision mediump float;
uniform sampler2D uImage;
varying vec2 vTexture;
varying vec2 vUV;
varying vec3 vAppearance;
varying float vArms;
${polygonShader}
vec3 clothing(vec3 c){
  float high=max(max(c.r,c.g),c.b);
  bool skin=c.r>0.25&&c.r>c.g*1.03&&c.g>c.b*1.04&&c.r-c.b>0.07;
  if(vUV.y<=0.18||vUV.y>=0.58||high<0.18||skin)return c;
  float angle=radians(vAppearance.x);
  float y=dot(c,vec3(0.299,0.587,0.114));
  float i=dot(c,vec3(0.596,-0.274,-0.322));
  float q=dot(c,vec3(0.211,-0.523,0.312));
  float ii=i*cos(angle)-q*sin(angle), qq=i*sin(angle)+q*cos(angle);
  vec3 rotated=vec3(y+0.956*ii+0.621*qq,y-0.272*ii-0.647*qq,y-1.106*ii+1.703*qq);
  return clamp(mix(vec3(y),rotated,vAppearance.y)*vAppearance.z,0.0,1.0);
}
void main(){
  if(vArms>0.5&&!arm0(vUV)&&!arm1(vUV))discard;
  vec4 color=texture2D(uImage,vTexture);
  gl_FragColor=vec4(clothing(color.rgb),color.a);
}`;

function shader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const result = gl.createShader(type);
  if (!result) throw new Error("无法创建照片网格着色器");
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(result);
    gl.deleteShader(result);
    throw new Error(message ?? "照片网格着色器编译失败");
  }
  return result;
}

function getGPU(): GPUState | undefined {
  if (gpuFailed) return;
  if (gpu && !gpu.gl.isContextLost()) return gpu;
  if (!gpuCanvas) {
    gpuCanvas = document.createElement("canvas");
    gpuCanvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      gpu = undefined;
      gpuFailed = true;
    });
    gpuCanvas.addEventListener("webglcontextrestored", () => {
      gpu = undefined;
      gpuFailed = false;
    });
  }
  const gl = gpuCanvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl || gl.isContextLost()) {
    gpuFailed = true;
    return;
  }
  const vertex = shader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  if (!program || !buffer) throw new Error("照片网格缓冲初始化失败");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? "照片网格程序链接失败");
  gpu = {
    gl,
    program,
    buffer,
    textures: new WeakMap(),
    maximum: Math.min(
      2048,
      gl.getParameter(gl.MAX_TEXTURE_SIZE),
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    ),
  };
  return gpu;
}

function appearance(shape: MeshShape): readonly [number, number, number] {
  const a = shape.appearance;
  return [
    Math.max(-20, Math.min(20, a?.hue ?? 0)),
    Math.max(0.75, Math.min(1.25, a?.saturation ?? 1)),
    Math.max(0.8, Math.min(1.2, a?.brightness ?? 1)),
  ];
}

function layout(
  shapes: readonly MeshShape[],
  images: ReadonlyMap<PhotoAssetId, HTMLImageElement>,
  pixelScale: number,
  maximum: number,
): { tiles: Tile[]; width: number; height: number } {
  const candidates = shapes.flatMap((shape) => {
    if (!shape.mesh || !images.has(shape.asset)) return [];
    const bounds = meshBounds(shape.mesh);
    if (bounds.w <= 0 || bounds.h <= 0) return [];
    return [{ shape, mesh: shape.mesh, bounds }];
  });
  for (let attempt = 0; attempt < 6; attempt++) {
    const tiles: Tile[] = candidates.map((item) => {
      const scale =
        Math.min(
          Math.max(0.5, pixelScale),
          320 / Math.max(item.bounds.w, item.bounds.h),
        ) *
        0.75 ** attempt;
      return {
        ...item,
        x: 0,
        y: 0,
        w: Math.max(1, Math.ceil(item.bounds.w * scale)),
        h: Math.max(1, Math.ceil(item.bounds.h * scale)),
      };
    });
    const area = tiles.reduce(
      (sum, tile) => sum + (tile.w + PADDING * 2) * (tile.h + PADDING * 2),
      0,
    );
    let width = Math.min(
      maximum,
      Math.max(256, 2 ** Math.ceil(Math.log2(Math.max(1, Math.sqrt(area))))),
    );
    width = Math.max(width, ...tiles.map((tile) => tile.w + PADDING * 2));
    let x = 0,
      y = 0,
      row = 0;
    for (const tile of tiles) {
      if (x + tile.w + PADDING * 2 > width) {
        x = 0;
        y += row;
        row = 0;
      }
      tile.x = x + PADDING;
      tile.y = y + PADDING;
      x += tile.w + PADDING * 2;
      row = Math.max(row, tile.h + PADDING * 2);
    }
    const height = Math.max(1, y + row);
    if (width <= maximum && height <= maximum) return { tiles, width, height };
  }
  throw new Error("照片网格图集超出可用画布尺寸");
}

function texture(state: GPUState, image: HTMLImageElement): WebGLTexture {
  const { gl } = state;
  const saved = state.textures.get(image);
  if (saved) return saved;
  const result = gl.createTexture();
  if (!result) throw new Error("无法分配照片纹理");
  gl.bindTexture(gl.TEXTURE_2D, result);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  state.textures.set(image, result);
  return result;
}

function resultFrames(
  tiles: readonly Tile[],
  image: HTMLCanvasElement,
): Map<ImageShape, MeshFrame> {
  return new Map(
    tiles.map((tile) => [
      tile.shape,
      { image, sx: tile.x, sy: tile.y, sw: tile.w, sh: tile.h },
    ]),
  );
}

function renderGPU(
  state: GPUState,
  packed: ReturnType<typeof layout>,
  images: ReadonlyMap<PhotoAssetId, HTMLImageElement>,
): Map<ImageShape, MeshFrame> {
  const { gl } = state;
  const canvas = gpuCanvas!;
  if (canvas.width !== packed.width) canvas.width = packed.width;
  if (canvas.height !== packed.height) canvas.height = packed.height;
  gl.viewport(0, 0, packed.width, packed.height);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(state.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
  const attributes = [
    ["aPosition", 2],
    ["aTexture", 2],
    ["aUV", 2],
    ["aAppearance", 3],
    ["aArms", 1],
  ] as const;
  let offset = 0;
  for (const [name, size] of attributes) {
    const location = gl.getAttribLocation(state.program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 40, offset * 4);
    offset += size;
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(gl.getUniformLocation(state.program, "uImage"), 0);
  const groups = new Map<PhotoAssetId, Tile[]>();
  for (const tile of packed.tiles) {
    const group = groups.get(tile.shape.asset) ?? [];
    group.push(tile);
    groups.set(tile.shape.asset, group);
  }
  for (const [asset, tiles] of groups) {
    const values: number[] = [];
    const source = PHOTO_ASSETS[asset];
    for (const tile of tiles) {
      const { mesh, bounds, shape } = tile;
      const frame = photoFrame(shape);
      const tone = appearance(shape);
      for (const vertex of mesh.triangles) {
        const u = mesh.uv[vertex * 2],
          v = mesh.uv[vertex * 2 + 1];
        const x =
          tile.x + ((mesh.xy[vertex * 2] - bounds.x) / bounds.w) * tile.w;
        const y =
          tile.y + ((mesh.xy[vertex * 2 + 1] - bounds.y) / bounds.h) * tile.h;
        values.push(
          (x / packed.width) * 2 - 1,
          1 - (y / packed.height) * 2,
          (frame.x + u * frame.w) / source.width,
          (frame.y + v * frame.h) / source.height,
          u,
          v,
          ...tone,
          shape.part === "arms" ? 1 : 0,
        );
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, texture(state, images.get(asset)!));
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, values.length / 10);
  }
  gl.flush();
  if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR)
    throw new Error("照片网格绘制不可用");
  return resultFrames(packed.tiles, canvas);
}

const tintedFrames = new WeakMap<
  HTMLImageElement,
  Map<string, HTMLCanvasElement>
>();
function tintedFrame(
  image: HTMLImageElement,
  frame: PhotoFrame,
  shape: MeshShape,
): HTMLCanvasElement | undefined {
  const [hue, saturation, brightness] = appearance(shape);
  if (hue === 0 && saturation === 1 && brightness === 1) return;
  let cache = tintedFrames.get(image);
  if (!cache) {
    cache = new Map();
    tintedFrames.set(image, cache);
  }
  const key = `${shape.frame}:${hue.toFixed(3)}:${saturation.toFixed(4)}:${brightness.toFixed(4)}`;
  const saved = cache.get(key);
  if (saved) return saved;
  const canvas = document.createElement("canvas");
  canvas.width = frame.w;
  canvas.height = frame.h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    image,
    frame.x,
    frame.y,
    frame.w,
    frame.h,
    0,
    0,
    frame.w,
    frame.h,
  );
  const pixels = ctx.getImageData(0, 0, frame.w, frame.h);
  const data = pixels.data;
  const cosine = Math.cos((hue * Math.PI) / 180),
    sine = Math.sin((hue * Math.PI) / 180);
  for (let y = Math.ceil(frame.h * 0.18); y < frame.h * 0.58; y++)
    for (let x = 0; x < frame.w; x++) {
      const index = (y * frame.w + x) * 4;
      const r = data[index] / 255,
        g = data[index + 1] / 255,
        b = data[index + 2] / 255;
      const skin = r > 0.25 && r > g * 1.03 && g > b * 1.04 && r - b > 0.07;
      if (Math.max(r, g, b) < 0.18 || skin) continue;
      const luminance = r * 0.299 + g * 0.587 + b * 0.114;
      const i = r * 0.596 - g * 0.274 - b * 0.322;
      const q = r * 0.211 - g * 0.523 + b * 0.312;
      const ii = i * cosine - q * sine,
        qq = i * sine + q * cosine;
      const rotated = [
        luminance + 0.956 * ii + 0.621 * qq,
        luminance - 0.272 * ii - 0.647 * qq,
        luminance - 1.106 * ii + 1.703 * qq,
      ];
      for (let c = 0; c < 3; c++)
        data[index + c] = Math.max(
          0,
          Math.min(
            255,
            (luminance + (rotated[c] - luminance) * saturation) *
              brightness *
              255,
          ),
        );
    }
  ctx.putImageData(pixels, 0, 0);
  if (cache.size >= 96) cache.delete(cache.keys().next().value!);
  cache.set(key, canvas);
  return canvas;
}

function renderFallback(
  packed: ReturnType<typeof layout>,
  images: ReadonlyMap<PhotoAssetId, HTMLImageElement>,
): Map<ImageShape, MeshFrame> {
  fallbackCanvas ??= document.createElement("canvas");
  if (fallbackCanvas.width !== packed.width)
    fallbackCanvas.width = packed.width;
  if (fallbackCanvas.height !== packed.height)
    fallbackCanvas.height = packed.height;
  const ctx = fallbackCanvas.getContext("2d")!;
  ctx.clearRect(0, 0, packed.width, packed.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  for (const tile of packed.tiles) {
    const { mesh, bounds, shape } = tile;
    const frame = photoFrame(shape),
      image = images.get(shape.asset)!;
    const tinted = tintedFrame(image, frame, shape);
    for (let n = 0; n < mesh.triangles.length; n += 3) {
      const indices = mesh.triangles.slice(n, n + 3);
      const uv = indices.map((i) => [
        mesh.uv[i * 2] * frame.w,
        mesh.uv[i * 2 + 1] * frame.h,
      ]);
      const xy = indices.map((i) => [
        tile.x + ((mesh.xy[i * 2] - bounds.x) / bounds.w) * tile.w,
        tile.y + ((mesh.xy[i * 2 + 1] - bounds.y) / bounds.h) * tile.h,
      ]);
      const [u0, v0] = uv[0],
        [u1, v1] = uv[1],
        [u2, v2] = uv[2];
      const determinant = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
      if (Math.abs(determinant) < 1e-8) continue;
      const a =
        ((xy[1][0] - xy[0][0]) * (v2 - v0) -
          (xy[2][0] - xy[0][0]) * (v1 - v0)) /
        determinant;
      const c =
        ((xy[2][0] - xy[0][0]) * (u1 - u0) -
          (xy[1][0] - xy[0][0]) * (u2 - u0)) /
        determinant;
      const b =
        ((xy[1][1] - xy[0][1]) * (v2 - v0) -
          (xy[2][1] - xy[0][1]) * (v1 - v0)) /
        determinant;
      const d =
        ((xy[2][1] - xy[0][1]) * (u1 - u0) -
          (xy[1][1] - xy[0][1]) * (u2 - u0)) /
        determinant;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(xy[0][0], xy[0][1]);
      ctx.lineTo(xy[1][0], xy[1][1]);
      ctx.lineTo(xy[2][0], xy[2][1]);
      ctx.closePath();
      ctx.clip();
      ctx.transform(
        a,
        b,
        c,
        d,
        xy[0][0] - a * u0 - c * v0,
        xy[0][1] - b * u0 - d * v0,
      );
      if (shape.part === "arms") {
        ctx.beginPath();
        for (const polygon of ARM_POLYGONS) {
          ctx.moveTo(polygon[0] * frame.w, polygon[1] * frame.h);
          for (let i = 2; i < polygon.length; i += 2)
            ctx.lineTo(polygon[i] * frame.w, polygon[i + 1] * frame.h);
          ctx.closePath();
        }
        ctx.clip();
      }
      if (tinted) ctx.drawImage(tinted, 0, 0);
      else
        ctx.drawImage(
          image,
          frame.x,
          frame.y,
          frame.w,
          frame.h,
          0,
          0,
          frame.w,
          frame.h,
        );
      ctx.restore();
    }
  }
  return resultFrames(packed.tiles, fallbackCanvas);
}

/** 返回图集应在准备下一机位前消费，避免六路各持有一个 WebGL 上下文。 */
export function prepareMeshFrames(
  shapes: readonly ImageShape[],
  images: ReadonlyMap<PhotoAssetId, HTMLImageElement>,
  pixelScale: number,
): Map<ImageShape, MeshFrame> {
  if (!shapes.some((shape) => (shape as MeshShape).mesh)) return new Map();
  try {
    const state = getGPU();
    if (state)
      return renderGPU(
        state,
        layout(shapes, images, pixelScale, state.maximum),
        images,
      );
  } catch {
    // 上下文丢失或驱动不支持时，当前同一帧直接转 Canvas，人物不会变成空白。
    gpuFailed = true;
    gpu = undefined;
  }
  return renderFallback(layout(shapes, images, pixelScale, 2048), images);
}
