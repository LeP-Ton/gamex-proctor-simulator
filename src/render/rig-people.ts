import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { TICK_RATE } from "../engine/config.js";
import { hash } from "../engine/random.js";
import type { Person } from "../engine/types.js";
import type { RigActorState } from "./rig-world.js";

export const RIG_WALK_SPEED = 1.3;
export const RIG_WALK_DURATION = 2;
export const RIG_SIT_TIME = 3;
const IDS = ["maya", "sam"] as const;
type ModelId = (typeof IDS)[number];
type ClipId = "Idle_Standing" | "Walk_Relaxed" | "Sit_Stand";
const CLIPS: ClipId[] = ["Idle_Standing", "Walk_Relaxed", "Sit_Stand"];
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
const wrap = (n: number, period: number) => ((n % period) + period) % period;

interface RigTemplate {
  gltf: GLTF;
  height: number;
  floor: number;
  fabricLuminance: Map<THREE.Material, number>;
}
const templates = new Map<ModelId, RigTemplate>();
let loading: Promise<void> | undefined;
export const rigPeopleReady = () => templates.size === IDS.length;

const isFabric = (name: string) =>
  /original top|full-length top|original bottom|tailored trousers/.test(name);
function fabricLuminance(material: THREE.MeshStandardMaterial) {
  const color = material.color;
  if (!material.map?.image)
    return Math.max(
      0.005,
      color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722,
    );
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const context = canvas.getContext("2d")!;
  context.drawImage(material.map.image as CanvasImageSource, 0, 0, 16, 16);
  const pixels = context.getImageData(0, 0, 16, 16).data;
  const linear = (value: number) => {
    const n = value / 255;
    return material.map!.colorSpace === THREE.SRGBColorSpace
      ? n <= 0.04045
        ? n / 12.92
        : ((n + 0.055) / 1.055) ** 2.4
      : n;
  };
  let sum = 0,
    count = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i + 3] > 127) {
      sum +=
        linear(pixels[i]) * color.r * 0.2126 +
        linear(pixels[i + 1]) * color.g * 0.7152 +
        linear(pixels[i + 2]) * color.b * 0.0722;
      count++;
    }
  return Math.max(0.005, count ? sum / count : 0.1);
}

/** 完整解码两个人物后才发布可用状态，加载失败可由界面主动重试。 */
export function loadRigPeople(): Promise<void> {
  if (rigPeopleReady()) return Promise.resolve();
  if (loading) return loading;
  loading = Promise.all(
    IDS.map(async (id) => {
      const gltf = await new GLTFLoader().loadAsync(
        `${import.meta.env.BASE_URL}assets/rig-5/${id}.glb`,
      );
      for (const name of CLIPS) {
        if (!gltf.animations.some((clip) => clip.name === name))
          throw new Error(`人物 ${id} 缺少动作 ${name}`);
      }
      if (
        !gltf.scene.getObjectByName("head") ||
        !gltf.scene.getObjectByName("hand_r")
      )
        throw new Error(`人物 ${id} 缺少完整骨架`);
      const mixer = new THREE.AnimationMixer(gltf.scene);
      mixer
        .clipAction(
          gltf.animations.find((clip) => clip.name === "Idle_Standing")!,
        )
        .play();
      mixer.setTime(0);
      gltf.scene.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(gltf.scene, true);
      const fabrics = new Map<THREE.Material, number>();
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          if (
            material instanceof THREE.MeshStandardMaterial &&
            isFabric(material.name) &&
            !fabrics.has(material)
          )
            fabrics.set(material, fabricLuminance(material));
        }
      });
      const value = {
        gltf,
        height: bounds.max.y - bounds.min.y,
        floor: bounds.min.y,
        fabricLuminance: fabrics,
      };
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
      return [id, value] as const;
    }),
  )
    .then((values) => {
      for (const [id, value] of values) templates.set(id, value);
    })
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

export interface RigProfile {
  model: ModelId;
  height: number;
  width: number;
  depth: number;
  phase: number;
  headWidth: number;
  headDepth: number;
  top: string;
  bottom: string;
}
const TOPS = [
  "#b8b6ad",
  "#647d8e",
  "#8b6262",
  "#7b856a",
  "#777086",
  "#9b8066",
  "#596269",
  "#5c7872",
];
const BOTTOMS = ["#3d4755", "#4b4945", "#66625e", "#393d47", "#474b40"];
export function rigProfile(person: Person, seed: string): RigProfile {
  const random = (key: string) =>
    (hash(`${seed}/${person.id}/rig-5/${key}`) % 10001) / 10000;
  return {
    model: person.gender === "female" ? "maya" : "sam",
    height:
      person.gender === "female"
        ? 1.65 + random("height") * 0.13
        : 1.71 + random("height") * 0.14,
    width: 0.92 + random("width") * 0.16,
    depth: 0.94 + random("depth") * 0.12,
    phase: random("phase") * Math.PI * 2,
    headWidth: 0.94 + random("head-width") * 0.12,
    headDepth: 0.96 + random("head-depth") * 0.08,
    top: TOPS[
      (person.seat -
        1 +
        person.room * 3 +
        (hash(`${seed}/wardrobe`) % TOPS.length)) %
        TOPS.length
    ],
    bottom:
      BOTTOMS[Math.floor(random("bottom") * BOTTOMS.length) % BOTTOMS.length],
  };
}

interface Arm {
  upper: THREE.Bone;
  lower: THREE.Bone;
  hand: THREE.Bone;
  side: number;
}
export interface RigPersonState extends RigActorState {
  doorHandle?: { x: number; y: number; z: number };
  doorOpen?: number;
}
export interface RigPerson {
  root: THREE.Group;
  meshes: THREE.Mesh[];
  head: THREE.Object3D;
  headBone: THREE.Bone;
  leftHand: THREE.Bone;
  rightHand: THREE.Bone;
  markers: {
    head: THREE.Object3D;
    leftPalm: THREE.Object3D;
    rightPalm: THREE.Object3D;
    leftFoot: THREE.Bone;
    rightFoot: THREE.Bone;
  };
  profile: RigProfile;
  update(state: RigPersonState, tick: number): void;
  dispose(): void;
}

/** 只旋转骨骼，蒙皮连续覆盖关节；不拆分手臂、不叠加人物照片。 */
function rotate(bone: THREE.Bone, x: number, y: number, z: number) {
  bone.quaternion.multiply(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)),
  );
}

function marker(
  parent: THREE.Object3D,
  name: string,
  x: number,
  y: number,
  z: number,
) {
  const value = new THREE.Object3D();
  value.name = name;
  value.position.set(x, y, z);
  parent.add(value);
  return value;
}

/** 把世界空间的转向换算回父骨骼空间，避免人物转身后肘腕方向翻转。 */
function aim(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3) {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  const delta = new THREE.Quaternion().setFromUnitVectors(
    from.normalize(),
    to.normalize(),
  );
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion
    .copy(parent.invert().multiply(delta).multiply(world))
    .normalize();
  bone.updateWorldMatrix(false, true);
}

/** 两节手臂解析 IK：肘部向外、目标受臂长约束，伸手不会拉长或断开肢体。 */
function armIK(
  root: THREE.Group,
  arm: Arm,
  localTarget: THREE.Vector3,
  weight: number,
) {
  if (weight <= 0.0001) return;
  root.updateWorldMatrix(true, true);
  const a = arm.upper.getWorldPosition(new THREE.Vector3());
  const b = arm.lower.getWorldPosition(new THREE.Vector3());
  const c = arm.hand.getWorldPosition(new THREE.Vector3());
  // 桌面和门把使用场景米制坐标，不能随某个考生的身高缩放而漂离家具。
  const target = c
    .clone()
    .lerp(
      root.localToWorld(localTarget.clone().divide(root.scale)),
      clamp(weight),
    );
  const first = a.distanceTo(b),
    second = b.distanceTo(c);
  const direction = target.clone().sub(a);
  const distance = clamp(
    direction.length(),
    Math.abs(first - second) + 0.005,
    (first + second) * 0.985,
  );
  direction.normalize();
  target.copy(a).addScaledVector(direction, distance);
  const pole = root
    .localToWorld(
      new THREE.Vector3(arm.side * 0.65, localTarget.y - 0.12, 0.03).divide(
        root.scale,
      ),
    )
    .sub(a);
  pole.addScaledVector(direction, -pole.dot(direction));
  if (pole.lengthSq() < 1e-8) pole.set(arm.side, 0, 0);
  pole.normalize();
  const along =
    (first * first - second * second + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, first * first - along * along));
  const elbow = a
    .clone()
    .addScaledVector(direction, along)
    .addScaledVector(pole, height);
  aim(arm.upper, b.clone().sub(a), elbow.sub(a));
  const elbowNow = arm.lower.getWorldPosition(new THREE.Vector3());
  aim(
    arm.lower,
    arm.hand.getWorldPosition(new THREE.Vector3()).sub(elbowNow),
    target.sub(elbowNow),
  );
}

/** 沿前臂保留原来的手掌翻转，只做有限腕部屈伸，让手指自然朝向纸面。 */
function wrist(
  root: THREE.Group,
  hand: THREE.Bone,
  localDirection: THREE.Vector3,
  weight: number,
) {
  if (weight <= 0.0001) return;
  const orientation = hand.getWorldQuaternion(new THREE.Quaternion());
  const current = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
  const desired = localDirection.clone().transformDirection(root.matrixWorld);
  const delta = new THREE.Quaternion().setFromUnitVectors(current, desired);
  const angle = delta.angleTo(new THREE.Quaternion());
  const limited = new THREE.Quaternion().slerp(
    delta,
    clamp(weight) * Math.min(1, 1.2 / Math.max(angle, 0.0001)),
  );
  const parent = hand
    .parent!.getWorldQuaternion(new THREE.Quaternion())
    .invert();
  hand.quaternion
    .copy(parent.multiply(limited).multiply(orientation))
    .normalize();
  hand.updateWorldMatrix(false, true);
}

export function createRigPerson(person: Person, seed: string): RigPerson {
  const profile = rigProfile(person, seed),
    template = templates.get(profile.model);
  if (!template) throw new Error("人物骨骼素材尚未完成载入");
  const model = clone(template.gltf.scene);
  const root = new THREE.Group();
  root.name = `考生-${person.id}`;
  root.userData.actorId = person.id;
  root.add(model);
  const scalar = profile.height / template.height;
  root.scale.set(scalar * profile.width, scalar, scalar * profile.depth);
  const bones = new Map<string, THREE.Bone>();
  const meshes: THREE.Mesh[] = [];
  const materials: THREE.Material[] = [];
  const skeletons = new Set<THREE.Skeleton>();
  model.traverse((object) => {
    if (object instanceof THREE.Bone) bones.set(object.name, object);
    if (!(object instanceof THREE.Mesh)) return;
    object.userData.actorId = person.id;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
    const owned = (
      Array.isArray(object.material) ? object.material : [object.material]
    ).map((source) => {
      const material = source.clone();
      if (material instanceof THREE.MeshStandardMaterial) {
        const name = material.name;
        // 衣料改色与光泽变化保持稳定；皮肤、脸部和头发仍使用原始连续纹理。
        if (isFabric(name)) {
          const tint = new THREE.Color(
            /original top|full-length top/.test(name)
              ? profile.top
              : profile.bottom,
          );
          const reference = template.fabricLuminance.get(source) ?? 0.1;
          material.color.set("#ffffff");
          material.metalness = 0;
          material.roughness = 0.84;
          if (material instanceof THREE.MeshPhysicalMaterial)
            material.sheen = 0.08;
          // 共用同一着色程序，只换衣物 uniform；移除底片原色并保留纹理明暗和法线。
          material.customProgramCacheKey = () => "rig-fabric-luminance-v1";
          material.onBeforeCompile = (shader) => {
            shader.uniforms.rigFabricTint = { value: tint };
            shader.uniforms.rigFabricReference = { value: reference };
            shader.fragmentShader = shader.fragmentShader
              .replace(
                "#include <common>",
                "#include <common>\nuniform vec3 rigFabricTint;\nuniform float rigFabricReference;",
              )
              .replace(
                "#include <map_fragment>",
                `#include <map_fragment>
                float fabricShade = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) / rigFabricReference;
                diffuseColor.rgb = rigFabricTint * clamp(fabricShade, 0.55, 1.45);`,
              );
          };
        }
      }
      materials.push(material);
      return material;
    });
    object.material = Array.isArray(object.material) ? owned : owned[0];
    if (object instanceof THREE.SkinnedMesh) {
      skeletons.add(object.skeleton);
      // 覆盖坐、站、伸手的保守包围球；最终举报仍按实际蒙皮三角形相交。
      object.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(0, 0.9, 0),
        1.6,
      );
      object.boundingBox = new THREE.Box3(
        new THREE.Vector3(-1.6, -0.7, -1.6),
        new THREE.Vector3(1.6, 2.5, 1.6),
      );
    }
    meshes.push(object);
  });
  const bone = (name: string) => {
    const value = bones.get(name);
    if (!value) throw new Error(`人物缺少骨骼 ${name}`);
    return value;
  };
  const headBone = bone("head"),
    spine = bone("spine_03"),
    waist = bone("spine_01"),
    pelvis = bone("pelvis");
  const left: Arm = {
    upper: bone("upperarm_l"),
    lower: bone("lowerarm_l"),
    hand: bone("hand_l"),
    side: 1,
  };
  const right: Arm = {
    upper: bone("upperarm_r"),
    lower: bone("lowerarm_r"),
    hand: bone("hand_r"),
    side: -1,
  };
  const head = marker(headBone, "头部可见锚点", 0, 0.115, 0.035);
  const leftPalm = marker(left.hand, "左掌锚点", 0, 0.045, 0);
  const rightPalm = marker(right.hand, "右掌锚点", 0, 0.045, 0);
  const mixer = new THREE.AnimationMixer(model);
  const actions = Object.fromEntries(
    CLIPS.map((name) => [
      name,
      mixer.clipAction(
        template.gltf.animations.find((clip) => clip.name === name)!,
      ),
    ]),
  ) as Record<ClipId, THREE.AnimationAction>;
  const bindTransforms = [...bones.values()].map((value) => ({
    value,
    position: value.position.clone(),
    quaternion: value.quaternion.clone(),
    scale: value.scale.clone(),
  }));

  function sample(name: ClipId, time: number, weight: number) {
    if (weight <= 0) return;
    const action = actions[name];
    action.reset().setEffectiveWeight(weight).play();
    action.time = time;
  }
  const update = (state: RigPersonState, tick: number) => {
    const stand = clamp(state.stand),
      t = tick / TICK_RATE,
      phase = profile.phase;
    root.position.set(state.x, state.y - template.floor * scalar, state.z);
    root.rotation.set(0, state.heading, 0);
    // 每次从绝对时间和路程重建，不累加上一帧姿势；暂停、拖动复盘与倒序定位一致。
    mixer.stopAllAction();
    // 显式恢复全部分量，不依赖某个导出动作是否刚好包含常量缩放/位移轨道。
    for (const bind of bindTransforms) {
      bind.value.position.copy(bind.position);
      bind.value.quaternion.copy(bind.quaternion);
      bind.value.scale.copy(bind.scale);
    }
    const standingBlend = smooth((stand - 0.9) / 0.1);
    const moving = smooth(state.walkSpeed / 0.26) * standingBlend;
    sample(
      "Sit_Stand",
      Math.min(5.999, RIG_SIT_TIME + stand * RIG_SIT_TIME),
      1 - standingBlend,
    );
    sample("Idle_Standing", wrap(t + phase, 6), standingBlend * (1 - moving));
    sample(
      "Walk_Relaxed",
      wrap(state.walkDistance / RIG_WALK_SPEED + phase, RIG_WALK_DURATION),
      moving,
    );
    mixer.update(0);
    const sitting = 1 - stand;
    const envelope =
      smooth(state.actionPhase / 0.18) *
      (1 - smooth((state.actionPhase - 0.75) / 0.25));
    const eventWeight = clamp(state.eventWeight);
    const ordinary = envelope * (1 - eventWeight);
    const action = state.normalAction ?? state.action;
    const rightTarget = new THREE.Vector3(-0.12, 0.795, 0.13);
    const leftTarget = new THREE.Vector3(0.15, 0.795, 0.08);
    const leftDirection = new THREE.Vector3(0, 0, 1),
      rightDirection = new THREE.Vector3(0, 0, 1);
    let rightWeight = sitting,
      leftWeight = sitting;
    // 向桌面轻俯身，同时保留完整肩颈、脊柱和呼吸，不单独平移头或四肢。
    rotate(waist, 0.18 * sitting + Math.sin(t * 1.1 + phase) * 0.006, 0, 0);
    rotate(headBone, 0.12 * sitting, Math.sin(t * 0.39 + phase) * 0.018, 0);
    const writing = Math.sin(t * 7.4 + phase) * 0.008 * (1 - eventWeight);
    rightTarget.x += writing;
    rightTarget.z += Math.sin(t * 5.3 + phase) * 0.006 * (1 - eventWeight);
    if (action === "thinking") {
      rightTarget
        .set(-0.08, 1.05, -0.1)
        .lerp(new THREE.Vector3(-0.12, 0.795, 0.13), 1 - ordinary);
      rotate(headBone, 0, 0.06 * ordinary, 0.05 * ordinary);
    } else if (action === "clock" || action === "glance") {
      rotate(headBone, -0.3 * ordinary, 0.1 * ordinary, 0);
    } else if (action === "stretch") {
      rotate(waist, -0.23 * ordinary, 0, 0);
      leftTarget.lerp(new THREE.Vector3(0.43, 1.15, -0.18), ordinary);
      rightTarget.lerp(new THREE.Vector3(-0.43, 1.15, -0.18), ordinary);
    } else if (action === "pickPen") {
      rotate(waist, 0.22 * ordinary, 0, 0.25 * ordinary);
      rightTarget.lerp(new THREE.Vector3(-0.38, 0.29, 0.05), ordinary);
    } else if (action === "turn") {
      rotate(headBone, 0, Math.sin(phase) * 0.4 * ordinary, 0);
      rotate(spine, 0, Math.sin(phase) * 0.12 * ordinary, 0);
    } else if (action === "returnPen") {
      const direction = person.col < 3 ? 1 : -1;
      (direction > 0 ? leftTarget : rightTarget).lerp(
        new THREE.Vector3(direction * 0.64, 0.77, 0.12),
        ordinary,
      );
      (direction > 0 ? leftDirection : rightDirection).set(direction, 0, 0.15);
      rotate(waist, 0, 0, -direction * 0.16 * ordinary);
    } else if (action === "bag") {
      leftTarget.lerp(new THREE.Vector3(0.34, 0.37, -0.17), ordinary);
      rotate(waist, 0.1 * ordinary, 0, -0.1 * ordinary);
    } else if (action === "washing" && stand > 0.9) {
      leftTarget.set(0.09, 0.99, 0.38);
      rightTarget.set(-0.09, 0.99, 0.38 + Math.sin(t * 3 + phase) * 0.015);
      leftWeight = rightWeight = 1;
      rotate(waist, 0.12, 0, 0);
      rotate(headBone, 0.2, 0, 0);
    }
    const event = state.event;
    if (event) {
      if (event.kind === "peeking") {
        const direction = event.variant === 0 ? 1 : -1;
        rotate(pelvis, 0, 0, -direction * 0.08 * eventWeight);
        rotate(
          waist,
          0.03 * eventWeight,
          direction * 0.1 * eventWeight,
          -direction * 0.27 * eventWeight,
        );
        rotate(
          spine,
          0,
          direction * 0.15 * eventWeight,
          -direction * 0.08 * eventWeight,
        );
        rotate(headBone, 0.08 * eventWeight, direction * 0.45 * eventWeight, 0);
      } else if (event.kind === "passing") {
        const other =
          event.actors.find((id) => id !== person.id) ?? person.id + 1;
        const direction = other > person.id ? 1 : -1;
        rotate(
          waist,
          0,
          direction * 0.1 * eventWeight,
          -direction * 0.35 * eventWeight,
        );
        rotate(spine, 0, 0, -direction * 0.14 * eventWeight);
        (direction > 0 ? leftTarget : rightTarget).lerp(
          new THREE.Vector3(direction * 0.85, 0.79, 0.11),
          eventWeight,
        );
        (direction > 0 ? leftDirection : rightDirection).set(
          direction,
          0,
          0.15,
        );
        rotate(headBone, 0, direction * 0.4 * eventWeight, 0);
      } else if (event.kind === "restroom" && event.variant === 1) {
        rightTarget.lerp(new THREE.Vector3(-0.12, 1.03, 0.47), eventWeight);
        rightWeight = Math.max(rightWeight, eventWeight);
        rotate(headBone, 0.13 * eventWeight, 0, 0);
      } else {
        const targetY = stand > 0.9 ? 0.98 : 0.8;
        rightTarget.lerp(new THREE.Vector3(-0.07, targetY, 0.22), eventWeight);
        leftTarget.lerp(new THREE.Vector3(0.07, targetY, 0.22), eventWeight);
        leftWeight = Math.max(leftWeight, eventWeight);
        rightWeight = Math.max(rightWeight, eventWeight);
        rotate(headBone, 0.15 * eventWeight, 0, 0);
      }
    }
    let doorGrip = 0,
      doorGoal: THREE.Vector3 | undefined;
    const localMetres = (point: THREE.Vector3) =>
      root.worldToLocal(point.clone()).multiply(root.scale);
    if (state.doorReach > 0) {
      doorGrip =
        clamp(state.doorReach) *
        (1 - smooth(((state.doorOpen ?? 0) - 0.12) / 0.23));
      if (doorGrip > 0) {
        root.updateWorldMatrix(true, true);
        const palmLength = rightPalm
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(right.hand.getWorldPosition(new THREE.Vector3()));
        if (state.doorHandle) {
          doorGoal = new THREE.Vector3(
            state.doorHandle.x,
            state.doorHandle.y,
            state.doorHandle.z,
          );
          rightTarget.copy(localMetres(doorGoal));
        } else rightTarget.set(-0.34, 0.99, 0.278);
        // IK 控制的是腕骨，掌心还沿手指方向延伸；不能把腕骨直接压到把手上。
        rightTarget.z -= palmLength;
        rightWeight = doorGrip;
      }
    }
    headBone.scale.x *= profile.headWidth;
    headBone.scale.z *= profile.headDepth;
    root.updateWorldMatrix(true, true);
    armIK(root, left, leftTarget, leftWeight);
    armIK(root, right, rightTarget, rightWeight);
    const freeGesture = ["thinking", "stretch", "pickPen", "bag"].includes(
      action,
    )
      ? ordinary
      : 0;
    wrist(root, left.hand, leftDirection, leftWeight * (1 - freeGesture));
    wrist(root, right.hand, rightDirection, rightWeight * (1 - freeGesture));
    if (doorGoal && doorGrip > 0.75) {
      root.updateWorldMatrix(true, true);
      const contact = smooth((doorGrip - 0.75) / 0.25);
      const handOrientation = right.hand.getWorldQuaternion(
        new THREE.Quaternion(),
      );
      const error = doorGoal
        .clone()
        .sub(rightPalm.getWorldPosition(new THREE.Vector3()));
      const wristTarget = right.hand
        .getWorldPosition(new THREE.Vector3())
        .addScaledVector(error, contact);
      // 握住时约束真实掌锚点；保持手掌世界朝向，避免最后几毫米校正扭转手腕。
      armIK(root, right, localMetres(wristTarget), 1);
      const parent = right.hand
        .parent!.getWorldQuaternion(new THREE.Quaternion())
        .invert();
      right.hand.quaternion.copy(parent.multiply(handOrientation)).normalize();
    }
    root.updateWorldMatrix(true, true);
  };
  return {
    root,
    meshes,
    head,
    headBone,
    leftHand: left.hand,
    rightHand: right.hand,
    markers: {
      head,
      leftPalm,
      rightPalm,
      leftFoot: bone("foot_l"),
      rightFoot: bone("foot_r"),
    },
    profile,
    update,
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      for (const material of materials) material.dispose();
      for (const skeleton of skeletons) skeleton.dispose();
      root.removeFromParent();
    },
  };
}
