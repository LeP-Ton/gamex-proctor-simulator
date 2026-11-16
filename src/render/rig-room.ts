import * as THREE from "three";

export interface RigRoom {
  scene: THREE.Scene;
  door: THREE.Group;
}

type Materials = Record<string, THREE.Material>;
type Placement = {
  x: number;
  y: number;
  z: number;
  sx?: number;
  sy?: number;
  sz?: number;
  rx?: number;
  ry?: number;
  rz?: number;
};

const SEAT_X = [-2.7, -0.9, 0.9, 2.7];
const SEAT_Z = [-1.8, 0.5, 2.8];
const DOOR_WIDTH = 1.1;
const DOOR_ANGLE = Math.PI * 0.55;
const cube = new THREE.BoxGeometry(1, 1, 1);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 10);
const plane = new THREE.PlaneGeometry(1, 1);
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const scale = new THREE.Vector3();
const euler = new THREE.Euler();

let cachedMaterials: Materials | undefined;
const geometryCache = new Map<string, THREE.BufferGeometry>();
const numberMaterials = new Map<number, THREE.Material>();

function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function texture(
  width: number,
  height: number,
  paint: (context: CanvasRenderingContext2D) => void,
): THREE.Texture {
  // 几何约束测试在 Node 中仍可建场景；浏览器才生成表面纹理。
  if (typeof document === "undefined") {
    const fallback = new THREE.DataTexture(
      new Uint8Array([185, 181, 167, 255]),
      1,
      1,
    );
    fallback.colorSpace = THREE.SRGBColorSpace;
    fallback.needsUpdate = true;
    return fallback;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建房间表面纹理");
  paint(context);
  const result = new THREE.CanvasTexture(canvas);
  result.colorSpace = THREE.SRGBColorSpace;
  result.anisotropy = 4;
  return result;
}

function noise(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  amount: number,
): void {
  const rand = randomSource(seed);
  const pixels = context.getImageData(0, 0, width, height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const variation = (rand() - 0.5) * amount;
    pixels.data[i] += variation;
    pixels.data[i + 1] += variation;
    pixels.data[i + 2] += variation;
  }
  context.putImageData(pixels, 0, 0);
}

function materials(): Materials {
  if (cachedMaterials) return cachedMaterials;
  const wood = texture(512, 512, (context) => {
    const rand = randomSource(731);
    context.fillStyle = "#a58d68";
    context.fillRect(0, 0, 512, 512);
    for (let row = 0; row < 260; row++) {
      const y = row * 2;
      context.strokeStyle = `rgba(${rand() > 0.3 ? "68,49,30" : "222,204,160"},${0.025 + rand() * 0.065})`;
      context.lineWidth = 0.4 + rand() * 1.1;
      context.beginPath();
      context.moveTo(0, y);
      for (let x = 0; x <= 512; x += 12)
        context.lineTo(
          x,
          y + Math.sin(x * 0.019 + row * 0.073) * (1.5 + rand() * 2.5),
        );
      context.stroke();
    }
    for (let i = 0; i < 90; i++) {
      const x = rand() * 512,
        y = rand() * 512;
      context.strokeStyle = "rgba(221,215,192,.12)";
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + rand() * 45, y + rand() * 4);
      context.stroke();
    }
    noise(context, 512, 512, 732, 8);
  });
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  const tile = texture(512, 512, (context) => {
    const rand = randomSource(175);
    context.fillStyle = "#a8aca5";
    context.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 240; i++) {
      context.fillStyle = `rgba(${i % 2 ? "77,81,75" : "216,216,203"},${0.012 + rand() * 0.02})`;
      context.beginPath();
      context.ellipse(
        rand() * 512,
        rand() * 512,
        4 + rand() * 35,
        2 + rand() * 20,
        rand() * Math.PI,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    noise(context, 512, 512, 176, 13);
    context.fillStyle = "#6e746e";
    context.fillRect(0, 0, 3, 512);
    context.fillRect(0, 0, 512, 3);
    context.fillStyle = "rgba(217,217,202,.40)";
    context.fillRect(3, 3, 2, 509);
    context.fillRect(3, 3, 509, 2);
  });
  tile.wrapS = tile.wrapT = THREE.RepeatWrapping;
  tile.repeat.set(9.2, 9.5);
  const wall = texture(512, 512, (context) => {
    const rand = randomSource(908);
    context.fillStyle = "#c9cbc3";
    context.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 65; i++) {
      context.fillStyle = `rgba(96,101,94,${0.007 + rand() * 0.012})`;
      context.fillRect(
        rand() * 512,
        rand() * 512,
        2 + rand() * 8,
        25 + rand() * 150,
      );
    }
    noise(context, 512, 512, 909, 8);
  });
  const paper = texture(256, 384, (context) => {
    context.fillStyle = "#d9d8cb";
    context.fillRect(0, 0, 256, 384);
    context.fillStyle = "#55594f";
    context.font = "bold 13px sans-serif";
    context.textAlign = "center";
    context.fillText("考 试 答 题 纸", 128, 25);
    context.fillStyle = "#8d9187";
    context.fillRect(20, 39, 216, 1);
    for (let y = 56; y < 365; y += 15) {
      context.fillStyle = y % 3 ? "#b3b6aa" : "#a9ada1";
      context.fillRect(22, y, 210 - (y % 7) * 8, 1);
    }
    noise(context, 256, 384, 515, 4);
  });
  const shadowBytes = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 4;
      const r = ((x - 63.5) / 63.5) ** 2 + ((y - 63.5) / 63.5) ** 2;
      shadowBytes[i] = shadowBytes[i + 1] = shadowBytes[i + 2] = 22;
      shadowBytes[i + 3] = Math.round(
        Math.max(0, Math.exp(-r * 3.6) - 0.025) * 255,
      );
    }
  const contact = new THREE.DataTexture(shadowBytes, 128, 128);
  contact.needsUpdate = true;
  const stone = tile.clone();
  stone.repeat.set(4, 1);
  const tiles = tile.clone();
  tiles.repeat.set(22, 5);
  cachedMaterials = {
    wood: new THREE.MeshStandardMaterial({
      color: 0xd7c7a5,
      map: wood,
      roughness: 0.72,
      metalness: 0.02,
    }),
    woodEdge: new THREE.MeshStandardMaterial({
      color: 0x685a43,
      roughness: 0.84,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: 0x777d79,
      roughness: 0.54,
      metalness: 0.54,
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x353936,
      roughness: 0.95,
    }),
    paper: new THREE.MeshStandardMaterial({
      color: 0xe8e6d7,
      map: paper,
      roughness: 0.96,
    }),
    pencil: new THREE.MeshStandardMaterial({ color: 0x6c7365, roughness: 0.8 }),
    floor: new THREE.MeshStandardMaterial({
      color: 0xbbc0b7,
      map: tile,
      roughness: 0.74,
      metalness: 0.03,
    }),
    wall: new THREE.MeshStandardMaterial({
      color: 0xdbddd3,
      map: wall,
      roughness: 0.98,
    }),
    lowerWall: new THREE.MeshStandardMaterial({
      color: 0x9aa69b,
      map: wall,
      roughness: 0.94,
    }),
    baseboard: new THREE.MeshStandardMaterial({
      color: 0x646c64,
      roughness: 0.86,
    }),
    frame: new THREE.MeshStandardMaterial({
      color: 0x878f87,
      roughness: 0.64,
      metalness: 0.35,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xb5c7c0,
      roughness: 0.36,
      metalness: 0,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    exterior: new THREE.MeshBasicMaterial({ color: 0xadb6aa }),
    contact: new THREE.MeshBasicMaterial({
      map: contact,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      side: THREE.DoubleSide,
    }),
    ceramic: new THREE.MeshStandardMaterial({
      color: 0xc8cfc4,
      roughness: 0.3,
      metalness: 0.01,
      side: THREE.DoubleSide,
    }),
    stone: new THREE.MeshStandardMaterial({
      color: 0xbabdb0,
      map: stone,
      roughness: 0.62,
    }),
    tiles: new THREE.MeshStandardMaterial({
      color: 0xc7cfc6,
      map: tiles,
      roughness: 0.7,
    }),
    chrome: new THREE.MeshStandardMaterial({
      color: 0xb7c1b9,
      roughness: 0.22,
      metalness: 0.85,
    }),
    mirror: new THREE.MeshStandardMaterial({
      color: 0xb4c3bd,
      roughness: 0.2,
      metalness: 0.48,
    }),
    notice: new THREE.MeshStandardMaterial({
      color: 0x717d74,
      roughness: 0.98,
    }),
    door: new THREE.MeshStandardMaterial({
      color: 0x857862,
      map: wood,
      roughness: 0.79,
    }),
  };
  return cachedMaterials;
}

function slab(
  width: number,
  depth: number,
  height: number,
  radius: number,
): THREE.BufferGeometry {
  const key = `slab-${width}-${depth}-${height}-${radius}`;
  let result = geometryCache.get(key);
  if (result) return result;
  const bevel = Math.min(0.003, height / 4);
  const x = -width / 2 + bevel,
    z = -depth / 2 + bevel;
  const w = width - bevel * 2,
    d = depth - bevel * 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, z);
  shape.lineTo(x + w - radius, z);
  shape.quadraticCurveTo(x + w, z, x + w, z + radius);
  shape.lineTo(x + w, z + d - radius);
  shape.quadraticCurveTo(x + w, z + d, x + w - radius, z + d);
  shape.lineTo(x + radius, z + d);
  shape.quadraticCurveTo(x, z + d, x, z + d - radius);
  shape.lineTo(x, z + radius);
  shape.quadraticCurveTo(x, z, x + radius, z);
  result = new THREE.ExtrudeGeometry(shape, {
    depth: height - 2 * bevel,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    steps: 1,
    curveSegments: 3,
  });
  result.rotateX(-Math.PI / 2);
  result.center();
  geometryCache.set(key, result);
  return result;
}

function furniture(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placement: Placement,
  blocker = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(placement.x, placement.y, placement.z);
  mesh.scale.set(placement.sx ?? 1, placement.sy ?? 1, placement.sz ?? 1);
  mesh.rotation.set(placement.rx ?? 0, placement.ry ?? 0, placement.rz ?? 0);
  mesh.castShadow = blocker;
  mesh.receiveShadow = true;
  mesh.userData.blocker = blocker;
  parent.add(mesh);
  return mesh;
}

class Batches {
  private groups = new Map<
    string,
    {
      geometry: THREE.BufferGeometry;
      material: THREE.Material;
      placements: Placement[];
    }
  >();
  add(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    placement: Placement,
  ): void {
    const key = `${geometry.uuid}:${material.uuid}`;
    if (!this.groups.has(key))
      this.groups.set(key, { geometry, material, placements: [] });
    this.groups.get(key)!.placements.push(placement);
  }
  flush(scene: THREE.Scene): void {
    for (const { geometry, material, placements } of this.groups.values()) {
      const mesh = new THREE.InstancedMesh(
        geometry,
        material,
        placements.length,
      );
      placements.forEach((item, index) => {
        position.set(item.x, item.y, item.z);
        scale.set(item.sx ?? 1, item.sy ?? 1, item.sz ?? 1);
        euler.set(item.rx ?? 0, item.ry ?? 0, item.rz ?? 0);
        rotation.setFromEuler(euler);
        mesh.setMatrixAt(index, matrix.compose(position, rotation, scale));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.blocker = true;
      scene.add(mesh);
    }
  }
}

function contactShadow(
  scene: THREE.Scene,
  x: number,
  z: number,
  width: number,
  depth: number,
): void {
  furniture(
    scene,
    plane,
    materials().contact,
    { x, y: 0.007, z, sx: width, sy: depth, rx: -Math.PI / 2 },
    false,
  );
}

function addEnvelope(scene: THREE.Scene, publicArea: boolean): void {
  const m = materials();
  const box = (
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ) => furniture(scene, cube, material, { x, y, z, sx: w, sy: h, sz: d });
  box(m.floor, 0, -0.045, 0.05, 9.2, 0.09, 9.5).name = "房间地面";
  box(publicArea ? m.tiles : m.lowerWall, 0, 0.59, -4.72, 9.28, 1.18, 0.12);
  box(m.wall, 0, 2.22, -4.72, 9.28, 2.08, 0.12);
  box(m.baseboard, 0, 0.065, -4.63, 9.2, 0.13, 0.045);
  // 相机位于室内，墙面和顶面填满镜头，避免从室外看剖开的房间。
  box(m.wall, 0, 1.61, 4.84, 9.3, 3.22, 0.12);
  box(m.wall, 0, 3.3, 0.05, 9.3, 0.12, 9.6);
  const leftLength = 9.5;
  const leftCenter = 0.05;
  if (publicArea) {
    // 公共区左右入口是真正的门洞，路人不能穿过窗玻璃或墙体。
    box(m.tiles, -4.62, 0.5, -2.1, 0.12, 1, 5.2);
    box(m.tiles, -4.62, 0.5, 3.25, 0.12, 1, 3.1);
    box(m.wall, -4.62, 2.62, 1.1, 0.12, 1.28, 1.2);
  } else box(m.lowerWall, -4.62, 0.5, leftCenter, 0.12, 1.0, leftLength);
  box(m.wall, -4.62, 2.98, leftCenter, 0.12, 0.56, leftLength);
  box(m.baseboard, -4.53, 0.065, leftCenter, 0.045, 0.13, leftLength);
  for (const z of [-4.48, -2.5, -0.37, 1.76, 4.35])
    box(m.wall, -4.62, 1.85, z, 0.12, 1.7, 0.31);
  for (const z of [-3.48, -1.42, ...(publicArea ? [3.17] : [0.7, 3.17])]) {
    box(m.frame, -4.51, 1.035, z, 0.17, 0.09, 1.77);
    box(m.frame, -4.51, 2.65, z, 0.12, 0.065, 1.77);
    for (const edge of [-0.86, 0, 0.86])
      box(m.frame, -4.51, 1.85, z + edge, 0.08, 1.6, 0.045);
    box(m.frame, -4.51, 1.9, z, 0.075, 0.04, 1.72);
    const glass = furniture(
      scene,
      plane,
      m.glass,
      { x: -4.535, y: 1.84, z, sx: 1.7, sy: 1.55, ry: Math.PI / 2 },
      false,
    );
    glass.receiveShadow = false;
    const exterior = furniture(
      scene,
      plane,
      m.exterior,
      { x: -4.83, y: 1.9, z, sx: 1.85, sy: 1.8, ry: Math.PI / 2 },
      false,
    );
    exterior.receiveShadow = false;
  }
  // 右后墙留出真正的门洞；走廊只在门打开时通过洞口可见。
  box(m.wall, 4.62, 1.61, -4.45, 0.12, 3.22, 0.5);
  box(m.wall, 4.62, 2.73, -3.6, 0.12, 0.98, 1.2);
  box(m.wall, 4.62, 1.61, -2.78, 0.12, 3.22, 0.45);
  if (publicArea) {
    box(m.wall, 4.62, 1.61, -1.0, 0.12, 3.22, 3.0);
    box(m.wall, 4.62, 1.61, 3.25, 0.12, 3.22, 3.1);
    box(m.wall, 4.62, 2.65, 1.1, 0.12, 1.15, 1.2);
  } else {
    box(m.lowerWall, 4.62, 0.59, 1.125, 0.12, 1.18, 7.35);
    box(m.wall, 4.62, 2.2, 1.125, 0.12, 2.04, 7.35);
  }
  box(m.floor, 5.45, -0.045, -3.55, 1.65, 0.09, 2.55);
  box(m.lowerWall, 6.3, 0.59, -3.55, 0.12, 1.18, 2.55);
  box(m.wall, 6.3, 1.98, -3.55, 0.12, 1.6, 2.55);
  box(m.wall, 5.44, 1.4, -4.82, 1.83, 2.8, 0.1);
  box(m.wall, 5.44, 1.4, -2.8, 1.83, 2.8, 0.12);
}

function addDoor(scene: THREE.Scene): THREE.Group {
  const m = materials();
  const frame = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ) => furniture(scene, cube, m.woodEdge, { x, y, z, sx: w, sy: h, sz: d });
  frame(4.58, 1.08, -4.18, 0.18, 2.16, 0.075);
  frame(4.58, 1.08, -3.02, 0.18, 2.16, 0.075);
  frame(4.58, 2.17, -3.6, 0.18, 0.095, 1.23);
  frame(4.58, 0.012, -3.6, 0.24, 0.025, 1.15);
  const pivot = new THREE.Group();
  pivot.name = "门铰链";
  pivot.position.set(4.6, 0, -4.15);
  pivot.userData.blocker = true;
  furniture(pivot, cube, m.door, {
    x: 0,
    y: 1.045,
    z: DOOR_WIDTH / 2,
    sx: 0.052,
    sy: 2.09,
    sz: DOOR_WIDTH,
  });
  for (const y of [0.32, 1.74])
    furniture(pivot, cylinder, m.metal, {
      x: 0,
      y,
      z: 0.015,
      sx: 0.018,
      sy: 0.08,
      sz: 0.018,
    });
  furniture(pivot, cylinder, m.chrome, {
    x: -0.048,
    y: 0.99,
    z: 0.93,
    sx: 0.022,
    sy: 0.035,
    sz: 0.022,
    rz: Math.PI / 2,
  });
  furniture(pivot, cylinder, m.chrome, {
    x: -0.072,
    y: 0.99,
    z: 0.89,
    sx: 0.011,
    sy: 0.14,
    sz: 0.011,
    rx: Math.PI / 2,
  });
  scene.add(pivot);
  return pivot;
}

function seatNumber(index: number): THREE.Material {
  let material = numberMaterials.get(index);
  if (material) return material;
  const map = texture(128, 64, (context) => {
    context.fillStyle = "#bebaa6";
    context.fillRect(0, 0, 128, 64);
    context.fillStyle = "#555d51";
    context.font = "32px sans-serif";
    context.textAlign = "center";
    context.fillText(String(index).padStart(2, "0"), 64, 45);
  });
  material = new THREE.MeshStandardMaterial({ map, roughness: 0.95 });
  numberMaterials.set(index, material);
  return material;
}

function addDesks(scene: THREE.Scene): void {
  const m = materials();
  const batches = new Batches();
  const top = slab(0.9, 0.62, 0.045, 0.026);
  const seat = slab(0.45, 0.41, 0.028, 0.045);
  const back = slab(0.44, 0.37, 0.028, 0.045);
  let seatIndex = 0;
  for (const seatZ of SEAT_Z)
    for (const x of SEAT_X) {
      const deskZ = seatZ + 0.36,
        chairZ = seatZ - 0.34;
      batches.add(top, m.wood, { x, y: 0.76, z: deskZ });
      batches.add(cube, m.woodEdge, {
        x,
        y: 0.718,
        z: deskZ + 0.27,
        sx: 0.85,
        sy: 0.05,
        sz: 0.025,
      });
      batches.add(cube, m.metal, {
        x,
        y: 0.52,
        z: deskZ + 0.035,
        sx: 0.73,
        sy: 0.018,
        sz: 0.4,
      });
      for (const dx of [-0.365, 0.365]) {
        for (const dz of [-0.235, 0.235]) {
          batches.add(cylinder, m.metal, {
            x: x + dx,
            y: 0.36,
            z: deskZ + dz,
            sx: 0.017,
            sy: 0.72,
            sz: 0.017,
          });
          batches.add(cylinder, m.rubber, {
            x: x + dx,
            y: 0.023,
            z: deskZ + dz,
            sx: 0.021,
            sy: 0.046,
            sz: 0.021,
          });
        }
        batches.add(cube, m.metal, {
          x: x + dx,
          y: 0.19,
          z: deskZ,
          sx: 0.023,
          sy: 0.025,
          sz: 0.49,
        });
      }
      batches.add(cube, m.metal, {
        x,
        y: 0.23,
        z: deskZ + 0.235,
        sx: 0.75,
        sy: 0.024,
        sz: 0.022,
      });
      batches.add(seat, m.wood, { x, y: 0.47, z: chairZ });
      batches.add(back, m.wood, {
        x,
        y: 0.736,
        z: seatZ - 0.6,
        rx: Math.PI / 2 - 0.075,
      });
      for (const dx of [-0.175, 0.175]) {
        for (const dz of [-0.16, 0.15]) {
          batches.add(cylinder, m.metal, {
            x: x + dx,
            y: 0.23,
            z: chairZ + dz,
            sx: 0.013,
            sy: 0.46,
            sz: 0.013,
          });
          batches.add(cylinder, m.rubber, {
            x: x + dx,
            y: 0.019,
            z: chairZ + dz,
            sx: 0.018,
            sy: 0.038,
            sz: 0.018,
          });
        }
        batches.add(cylinder, m.metal, {
          x: x + dx,
          y: 0.63,
          z: seatZ - 0.575,
          sx: 0.011,
          sy: 0.57,
          sz: 0.011,
          rx: -0.075,
        });
        batches.add(cube, m.metal, {
          x: x + dx,
          y: 0.17,
          z: chairZ,
          sx: 0.017,
          sy: 0.018,
          sz: 0.34,
        });
      }
      const lean = ((seatIndex % 3) - 1) * 0.035;
      batches.add(cube, m.paper, {
        x: x - 0.08,
        y: 0.784,
        z: deskZ - 0.035,
        sx: 0.22,
        sy: 0.0018,
        sz: 0.31,
        ry: lean,
      });
      batches.add(cube, m.paper, {
        x: x + 0.14,
        y: 0.7835,
        z: deskZ + 0.025,
        sx: 0.18,
        sy: 0.0013,
        sz: 0.27,
        ry: -0.06 + lean,
      });
      batches.add(cylinder, m.pencil, {
        x: x + 0.27,
        y: 0.788,
        z: deskZ - 0.01,
        sx: 0.003,
        sy: 0.155,
        sz: 0.003,
        rz: Math.PI / 2,
        ry: 0.18,
      });
      furniture(scene, plane, seatNumber(++seatIndex), {
        x: x + 0.33,
        y: 0.784,
        z: deskZ + 0.245,
        sx: 0.095,
        sy: 0.0475,
        rx: -Math.PI / 2,
      });
      contactShadow(scene, x + 0.06, deskZ + 0.04, 1.25, 0.98);
      contactShadow(scene, x, chairZ, 0.73, 0.7);
    }
  batches.flush(scene);
}

function sign(
  scene: THREE.Scene,
  words: string[],
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
): void {
  const map = texture(768, 192, (context) => {
    context.fillStyle = "#c9cbbd";
    context.fillRect(0, 0, 768, 192);
    context.fillStyle = "#535f54";
    context.font = "30px sans-serif";
    context.textAlign = "center";
    words.forEach((word, index) =>
      context.fillText(word, 384, 72 + index * 57),
    );
    noise(context, 768, 192, 626, 3);
  });
  const material = new THREE.MeshStandardMaterial({ map, roughness: 0.96 });
  furniture(scene, plane, material, { x, y, z, sx: width, sy: height });
}

function addClassroomDetails(scene: THREE.Scene, sceneId: number): void {
  const m = materials();
  furniture(scene, cube, m.woodEdge, {
    x: 0,
    y: 2.03,
    z: -4.6,
    sx: 3.1,
    sy: 0.98,
    sz: 0.065,
  });
  furniture(scene, cube, m.notice, {
    x: 0,
    y: 2.03,
    z: -4.555,
    sx: 2.98,
    sy: 0.86,
    sz: 0.025,
  });
  for (let i = 0; i < 5; i++)
    furniture(scene, cube, m.paper, {
      x: -1.08 + i * 0.42,
      y: 2.05 + (i % 2) * 0.07,
      z: -4.532,
      sx: 0.26,
      sy: 0.36,
      sz: 0.0015,
      rz: ((i % 3) - 1) * 0.025,
    });
  sign(
    scene,
    [`第 ${sceneId + 1} 考场`, "诚信应考　保持安静"],
    0,
    2.91,
    -4.637,
    2.5,
    0.36,
  );
  const face = new THREE.MeshStandardMaterial({
    color: 0xd0d1c5,
    roughness: 0.8,
  });
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.22, 36), face);
  clock.position.set(3.16, 2.48, -4.56);
  clock.userData.blocker = true;
  scene.add(clock);
  furniture(scene, new THREE.TorusGeometry(0.221, 0.014, 8, 36), m.frame, {
    x: 3.16,
    y: 2.48,
    z: -4.55,
  });
  furniture(scene, cube, m.rubber, {
    x: 3.11,
    y: 2.48,
    z: -4.535,
    sx: 0.1,
    sy: 0.014,
    sz: 0.008,
  });
  furniture(scene, cube, m.rubber, {
    x: 3.16,
    y: 2.55,
    z: -4.534,
    sx: 0.012,
    sy: 0.14,
    sz: 0.008,
  });
}

function sinkCounter(): THREE.BufferGeometry {
  const key = "公共区台面";
  const prior = geometryCache.get(key);
  if (prior) return prior;
  const shape = new THREE.Shape();
  shape.moveTo(-3.9, -0.4);
  shape.lineTo(3.9, -0.4);
  shape.lineTo(3.9, 0.4);
  shape.lineTo(-3.9, 0.4);
  shape.closePath();
  for (const x of SEAT_X) {
    const hole = new THREE.Path();
    hole.absarc(x, -0.08, 0.249, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.055,
    bevelEnabled: false,
    curveSegments: 24,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -0.0275, 0);
  geometryCache.set(key, geometry);
  return geometry;
}

function addPublicArea(scene: THREE.Scene, sceneId: number): void {
  const m = materials();
  const batches = new Batches();
  furniture(scene, sinkCounter(), m.stone, { x: 0, y: 0.82, z: -3.65 });
  furniture(scene, cube, m.tiles, {
    x: 0,
    y: 0.39,
    z: -3.98,
    sx: 7.75,
    sy: 0.78,
    sz: 0.06,
  });
  for (const x of [-3.8, 0, 3.8])
    furniture(scene, cube, m.tiles, {
      x,
      y: 0.39,
      z: -3.65,
      sx: 0.08,
      sy: 0.78,
      sz: 0.72,
    });
  const bowlKey = "洗手盆";
  if (!geometryCache.has(bowlKey))
    geometryCache.set(
      bowlKey,
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.028, -0.15),
          new THREE.Vector2(0.09, -0.14),
          new THREE.Vector2(0.16, -0.115),
          new THREE.Vector2(0.22, -0.065),
          new THREE.Vector2(0.25, -0.005),
          new THREE.Vector2(0.274, 0.013),
          new THREE.Vector2(0.28, 0.005),
          new THREE.Vector2(0.273, -0.018),
        ],
        32,
      ),
    );
  const faucetKey = "水龙头";
  if (!geometryCache.has(faucetKey))
    geometryCache.set(
      faucetKey,
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0.17, 0),
          new THREE.Vector3(0, 0.21, 0.04),
          new THREE.Vector3(0, 0.205, 0.14),
          new THREE.Vector3(0, 0.175, 0.18),
        ]),
        14,
        0.011,
        8,
        false,
      ),
    );
  for (const x of SEAT_X) {
    batches.add(geometryCache.get(bowlKey)!, m.ceramic, {
      x,
      y: 0.848,
      z: -3.57,
    });
    batches.add(cylinder, m.rubber, {
      x,
      y: 0.701,
      z: -3.57,
      sx: 0.027,
      sy: 0.008,
      sz: 0.027,
    });
    batches.add(geometryCache.get(faucetKey)!, m.chrome, {
      x,
      y: 0.85,
      z: -3.91,
    });
    batches.add(cube, m.frame, {
      x,
      y: 1.68,
      z: -4.57,
      sx: 1.43,
      sy: 0.93,
      sz: 0.045,
    });
    batches.add(cube, m.mirror, {
      x,
      y: 1.68,
      z: -4.538,
      sx: 1.36,
      sy: 0.86,
      sz: 0.015,
    });
    batches.add(cylinder, m.chrome, {
      x,
      y: 0.46,
      z: -3.81,
      sx: 0.024,
      sy: 0.59,
      sz: 0.024,
    });
  }
  furniture(scene, slab(0.5, 1.75, 0.035, 0.025), m.wood, {
    x: -4.12,
    y: 0.46,
    z: 0.25,
  });
  for (const z of [-0.4, 0.9])
    furniture(scene, cube, m.metal, {
      x: -4.12,
      y: 0.23,
      z,
      sx: 0.36,
      sy: 0.46,
      sz: 0.035,
    });
  contactShadow(scene, -4.1, 0.25, 0.8, 2.1);
  furniture(
    scene,
    new THREE.CylinderGeometry(0.19, 0.16, 0.47, 16),
    m.baseboard,
    { x: 4.1, y: 0.235, z: -1.75 },
  );
  contactShadow(scene, 4.1, -1.75, 0.65, 0.65);
  sign(
    scene,
    [sceneId === 4 ? "男生公共洗手区" : "女生公共洗手区", "监控仅覆盖公共区域"],
    0,
    2.75,
    -4.637,
    3.25,
    0.42,
  );
  batches.flush(scene);
}

export function createRigRoom(sceneId: number): RigRoom {
  const scene = new THREE.Scene();
  scene.name = sceneId < 4 ? `立体考场${sceneId + 1}` : "公共洗手区";
  scene.background = new THREE.Color(sceneId < 4 ? 0x89948d : 0x8b9890);
  const ambient = new THREE.HemisphereLight(0xc9d5d4, 0x726c5c, 1.7);
  scene.add(ambient);
  const sunlight = new THREE.DirectionalLight(0xe2e2d2, 2.7);
  sunlight.position.set(-7, 3.5, 1.5);
  sunlight.target.position.set(1, 0, 0);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(1024, 1024);
  sunlight.shadow.camera.left = -7;
  sunlight.shadow.camera.right = 7;
  sunlight.shadow.camera.top = 7;
  sunlight.shadow.camera.bottom = -7;
  sunlight.shadow.camera.near = 0.1;
  sunlight.shadow.camera.far = 20;
  sunlight.shadow.normalBias = 0.015;
  sunlight.shadow.bias = -0.00015;
  sunlight.shadow.radius = 2.4;
  scene.add(sunlight, sunlight.target);
  addEnvelope(scene, sceneId >= 4);
  const door = addDoor(scene);
  if (sceneId < 4) {
    addDesks(scene);
    addClassroomDetails(scene, sceneId);
  } else addPublicArea(scene, sceneId);
  // 表面只提供遮挡信息，没有 actorId；不能把家具或墙地面作为人物举报。
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.blocker)
      object.userData.roomSurface = true;
  });
  return { scene, door };
}

export function updateRigDoor(room: RigRoom, openness: number): void {
  const amount = Number.isFinite(openness)
    ? THREE.MathUtils.clamp(openness, 0, 1)
    : 0;
  room.door.rotation.y = amount * DOOR_ANGLE;
}
