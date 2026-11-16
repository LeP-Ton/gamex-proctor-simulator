import * as THREE from "three";
import type { Plan, RecordEntry, ActorView } from "../engine/types.js";
import type { DrawOp } from "./geometry.js";
import { registerRigGeometry } from "./geometry.js";
import { rigGeometry } from "./rig-geometry.js";
import { rigActors, rigCamera, projectRig, rigDoorOpen } from "./rig-world.js";
import type { RigActorState } from "./rig-world.js";
import { createRigPerson, rigPeopleReady } from "./rig-people.js";
import type { RigPerson } from "./rig-people.js";
import { createRigRoom, updateRigDoor } from "./rig-room.js";
import type { RigRoom } from "./rig-room.js";

interface Props {
  group: THREE.Group;
  phone: THREE.Group;
  paper: THREE.Group;
  pen: THREE.Mesh;
}
interface RigWorld {
  plan: Plan;
  rooms: RigRoom[];
  people: Map<number, RigPerson>;
  props: Map<number, Props>;
  states: RigActorState[];
  signature: string;
  geometry: Map<number, ReturnType<typeof rigGeometry>>;
}
const worlds = new Map<Plan, RigWorld>();
const cameras = Array.from({ length: 6 }, (_, scene) => rigCamera(scene));
const vector = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
let renderer: THREE.WebGLRenderer | undefined;
let contextLost = false;

export const rigRendererReady = () => !!renderer && !contextLost;
/** 六个机位共用一个 GPU 上下文，避免多画布争用和上下文数量上限。 */
export function initializeRigRenderer() {
  if (renderer) {
    if (contextLost) throw new Error("监控画面图形上下文暂不可用");
    return;
  }
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    window.dispatchEvent(new Event("proctor-graphics-lost"));
  });
  renderer.domElement.addEventListener("webglcontextrestored", () => {
    contextLost = false;
  });
}
function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  id: number,
) {
  const result = new THREE.Mesh(geometry, material);
  result.userData.actorId = id;
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}
function propsFor(id: number): Props {
  const group = new THREE.Group(),
    phone = new THREE.Group(),
    paper = new THREE.Group();
  const casing = mesh(
    new THREE.BoxGeometry(0.098, 0.015, 0.17),
    new THREE.MeshStandardMaterial({ color: 0x15191c, roughness: 0.38 }),
    id,
  );
  const screen = mesh(
    new THREE.PlaneGeometry(0.084, 0.145),
    new THREE.MeshStandardMaterial({
      color: 0x8ac7ca,
      emissive: 0x44898f,
      emissiveIntensity: 0.65,
      roughness: 0.24,
    }),
    id,
  );
  screen.rotation.x = -Math.PI / 2;
  screen.position.y = 0.009;
  phone.add(casing, screen);
  // 两块折面连成一张实际立体纸，背面也能看到，接收者不产生浮空副本。
  const yellow = new THREE.MeshStandardMaterial({
    color: 0xe4cb86,
    roughness: 0.98,
    side: THREE.DoubleSide,
  });
  for (const side of [-1, 1]) {
    const half = mesh(new THREE.PlaneGeometry(0.115, 0.17), yellow, id);
    half.rotation.set(-Math.PI / 2, 0, side * 0.065);
    half.position.set(side * 0.057, 0.006, 0);
    paper.add(half);
  }
  const pen = mesh(
    new THREE.CylinderGeometry(0.004, 0.004, 0.115, 7),
    new THREE.MeshStandardMaterial({ color: 0x344d64, roughness: 0.5 }),
    id,
  );
  pen.rotation.z = Math.PI / 2;
  group.add(phone, paper, pen);
  group.visible = false;
  return { group, phone, paper, pen };
}
function worldFor(plan: Plan): RigWorld {
  let world = worlds.get(plan);
  if (world) return world;
  if (!rigPeopleReady()) throw new Error("人物素材尚未完成载入");
  // 复盘可创建另一份世界；最多保留三份以免反复查看历史累积 GPU 材质。
  if (worlds.size >= 3) {
    const [oldPlan, old] = worlds.entries().next().value!;
    for (const person of old.people.values()) person.dispose();
    // 房间与模板几何是共享缓存，只释放独立人物材质，不能销毁另一个世界仍在用的资源。
    for (const props of old.props.values())
      props.group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            material.dispose();
        }
      });
    for (const room of old.rooms)
      room.scene.traverse((object) => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
        if (
          object instanceof THREE.DirectionalLight ||
          object instanceof THREE.SpotLight
        )
          object.shadow.dispose();
      });
    renderer?.renderLists.dispose();
    worlds.delete(oldPlan);
  }
  const rooms = Array.from({ length: 6 }, (_, scene) => createRigRoom(scene));
  world = {
    plan,
    rooms,
    people: new Map(),
    props: new Map(),
    states: [],
    signature: "",
    geometry: new Map(),
  };
  for (const person of plan.people) {
    const model = createRigPerson(person, plan.config.seed),
      props = propsFor(person.id);
    rooms[person.room].scene.add(model.root, props.group);
    world.people.set(person.id, model);
    world.props.set(person.id, props);
  }
  worlds.set(plan, world);
  return world;
}
function palm(person: RigPerson, right = true) {
  return (
    right ? person.markers.rightPalm : person.markers.leftPalm
  ).getWorldPosition(new THREE.Vector3());
}
function updateProps(world: RigWorld, state: RigActorState, tick: number) {
  const props = world.props.get(state.id)!,
    person = world.people.get(state.id)!;
  props.group.visible = false;
  props.phone.visible = props.paper.visible = props.pen.visible = false;
  if (!state.eventActive || !state.event) return;
  const event = state.event;
  props.group.visible = true;
  const room = world.rooms[state.scene].scene;
  if (props.group.parent !== room) room.add(props.group);
  let at = palm(person);
  if (
    event.kind === "passing" ||
    (event.kind === "restroom" && event.variant === 1)
  ) {
    if (event.actors[0] !== state.id) {
      props.group.visible = false;
      return;
    }
    const otherState = world.states.find(
      (other) => other.id === event.actors[1],
    );
    const other = otherState && world.people.get(otherState.id);
    if (other) {
      const a =
        event.kind === "passing" && otherState!.x > state.x
          ? palm(person, false)
          : palm(person);
      const b =
        event.kind === "passing" && otherState!.x < state.x
          ? palm(other, false)
          : palm(other);
      const phase = Math.max(
        0,
        Math.min(1, (tick - event.start) / (event.end - event.start)),
      );
      // 材料在双方真实手掌之间移动，道具和人物共享深度，不能穿透桌面。
      at = a.lerp(b, 0.15 + phase * 0.7);
    }
  }
  props.group.position.copy(at);
  props.group.position.y += 0.018;
  props.group.rotation.set(0, state.heading, 0);
  if (event.kind === "device") props.phone.visible = true;
  else if (event.kind === "peeking") {
    props.pen.visible = true;
    props.group.position.y += 0.008;
  } else props.paper.visible = true;
}
function prepare(
  plan: Plan,
  tick: number,
  caught: ReadonlySet<string>,
  records: readonly RecordEntry[],
) {
  const world = worldFor(plan),
    signature = `${tick}/${caught.size}/${records.length}`;
  if (world.signature === signature) return world;
  world.states = rigActors(plan, tick, caught, records);
  const doorAngles = world.rooms.map((room, scene) => {
    const openness = rigDoorOpen(plan, tick, scene);
    updateRigDoor(room, openness);
    room.scene.updateMatrixWorld(true);
    return openness;
  });
  for (const person of world.people.values()) person.root.visible = false;
  for (const props of world.props.values()) props.group.visible = false;
  for (const state of world.states) {
    const person = world.people.get(state.id)!,
      scene = world.rooms[state.scene].scene;
    if (person.root.parent !== scene) scene.add(person.root);
    person.root.visible = true;
    const handle = world.rooms[state.scene].door.localToWorld(
      new THREE.Vector3(-0.072, 0.99, 0.89),
    );
    person.update(
      {
        ...state,
        doorHandle: { x: handle.x, y: handle.y, z: handle.z },
        doorOpen: doorAngles[state.scene],
      },
      tick,
    );
  }
  for (let scene = 0; scene < 6; scene++) {
    world.rooms[scene].scene.updateMatrixWorld(true);
  }
  for (const state of world.states) updateProps(world, state, tick);
  for (const room of world.rooms) room.scene.updateMatrixWorld(true);
  world.signature = signature;
  world.geometry.clear();
  return world;
}
function rayPick(world: RigWorld, scene: number, x: number, y: number) {
  raycaster.setFromCamera(
    new THREE.Vector2(x / 300 - 1, 1 - y / 175),
    cameras[scene],
  );
  const surfaces: THREE.Object3D[] = [];
  world.rooms[scene].scene.traverseVisible((object) => {
    if (
      object instanceof THREE.Mesh &&
      (object.userData.actorId !== undefined || object.userData.blocker)
    )
      surfaces.push(object);
  });
  const first = raycaster.intersectObjects(surfaces, false)[0];
  return first?.object.userData.actorId ?? null;
}
export function rigRenderGeometry(
  plan: Plan,
  tick: number,
  scene: number,
  caught: ReadonlySet<string>,
  records: readonly RecordEntry[],
) {
  if (!rigPeopleReady()) return rigGeometry(plan, tick, scene, caught, records);
  const world = prepare(plan, tick, caught, records),
    saved = world.geometry.get(scene);
  if (saved) return saved;
  const ops: DrawOp[] = [
    {
      shape: { kind: "rect", x: 0, y: 0, w: 600, h: 350 },
      blocks: false,
      // 成功后的重复输入使用原可见姿态，不能让可变 Set 把旧道具轮廓一起收掉。
      rigContext: {
        plan,
        tick,
        scene,
        caught: new Set(caught),
        records: [...records],
      },
    },
  ];
  const actors: ActorView[] = [];
  for (const state of world.states.filter((state) => state.scene === scene)) {
    const person = world.people.get(state.id)!;
    const point = person.head.getWorldPosition(vector);
    const head = projectRig(scene, point.x, point.y, point.z);
    const ground = projectRig(scene, state.x, 0, state.z);
    const width = projectRig(scene, state.x + 0.27, 1, state.z).scale * 0.54;
    ops.push({
      shape: {
        kind: "rig-person",
        x: head.x - width / 2,
        y: head.y - width * 0.25,
        w: width,
        h: Math.max(width, ground.y - head.y),
        head,
        role: "person",
      },
      actorId: state.id,
    });
    actors.push({
      person: state.person,
      scene,
      x: head.x,
      y: head.y + width * 0.6,
      action: state.action,
      actionPhase: state.actionPhase,
      event: state.event,
      phase: state.event
        ? tick < state.event.start
          ? "prepare"
          : "active"
        : undefined,
    });
  }
  const result = { ops, actors, backgroundCount: 0 };
  world.geometry.set(scene, result);
  return result;
}
export function renderRigCamera(
  ctx: CanvasRenderingContext2D,
  plan: Plan,
  tick: number,
  scene: number,
  caught: ReadonlySet<string>,
  records: readonly RecordEntry[],
  pixelScale: number,
) {
  initializeRigRenderer();
  const world = prepare(plan, tick, caught, records);
  const scale = Math.max(0.5, Math.min(2, pixelScale));
  const width = Math.round(600 * scale),
    height = Math.round(350 * scale);
  if (
    renderer!.domElement.width !== width ||
    renderer!.domElement.height !== height
  )
    renderer!.setSize(width, height, false);
  renderer!.render(world.rooms[scene].scene, cameras[scene]);
  ctx.drawImage(renderer!.domElement, 0, 0, 600, 350);
  return rigRenderGeometry(plan, tick, scene, caught, records);
}
export function rigDiagnostics(
  plan: Plan,
  tick: number,
  scene: number,
  caught: ReadonlySet<string>,
  records: readonly RecordEntry[],
) {
  const world = prepare(plan, tick, caught, records);
  const position = (object: THREE.Object3D) => {
    const point = object.getWorldPosition(new THREE.Vector3());
    return { x: point.x, y: point.y, z: point.z };
  };
  return world.states
    .filter((state) => state.scene === scene)
    .map((state) => {
      const person = world.people.get(state.id)!,
        head = position(person.head);
      return {
        ...state,
        head,
        leftFoot: position(person.markers.leftFoot),
        rightFoot: position(person.markers.rightFoot),
        rootHeading: person.root.rotation.y,
        projections: { head: projectRig(scene, head.x, head.y, head.z) },
      };
    });
}
registerRigGeometry(rigRenderGeometry, (context, x, y) =>
  rayPick(
    prepare(context.plan, context.tick, context.caught, context.records),
    context.scene,
    x,
    y,
  ),
);
