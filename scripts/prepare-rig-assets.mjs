import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

// 可选离线工具；正常安装、游戏构建和运行不需要这些处理依赖。
const flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!["--maya", "--sam", "--output", "--tools"].includes(process.argv[i]) || !process.argv[i + 1])
    throw new Error("参数为 --maya 原始GLB --sam 原始GLB --output 输出目录 [--tools 离线工具目录]");
  flags.set(process.argv[i], process.argv[i + 1]);
}
for (const flag of ["--maya", "--sam", "--output"]) if (!flags.has(flag)) throw new Error(`缺少 ${flag}`);
const tools = path.resolve(flags.get("--tools") ?? process.cwd());
const require = createRequire(path.join(tools, "package.json"));
const dependency = async (name) => {
  const value = await import(pathToFileURL(require.resolve(name)).href);
  return value.default ?? value;
};
const { NodeIO } = await dependency("@gltf-transform/core");
const { ALL_EXTENSIONS } = await dependency("@gltf-transform/extensions");
const { dedup, prune, weld, simplifyPrimitive, resample, textureCompress } = await dependency("@gltf-transform/functions");
const { MeshoptSimplifier } = await dependency("meshoptimizer");
const sharp = await dependency("sharp");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const output = path.resolve(flags.get("--output"));
await mkdir(output, { recursive: true });
const sources = {
  maya: {
    page: "https://www.innerscene.com/tools/library/3d-parts/locomotion-collection-maya-3d-person-animated-1499b2fd",
    download: "https://files.innerscene.com/library/locomotion-collection-maya-3d-person-animated-1499b2fd/565cfb8a45b8a67a79c4/locomotion-collection-maya-3d-person-animated.glb",
    sourceSha256: "fabac991096e806f87ac71013865d4e4fac38d041dd64337c0173859b8249b15",
  },
  sam: {
    page: "https://www.innerscene.com/tools/library/3d-parts/locomotion-collection-sam-3d-person-animated-dc23800f",
    download: "https://files.innerscene.com/library/locomotion-collection-sam-3d-person-animated-dc23800f/735aec6a564c1def48e8/locomotion-collection-sam-3d-person-animated.glb",
    sourceSha256: "b29700eeba1607d879f85f0a93a58ad458d5397ec509226826b0868b2ce40777",
  },
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const models = [];
for (const id of ["maya", "sam"]) {
  const sourceBytes = await readFile(path.resolve(flags.get(`--${id}`)));
  if (sha256(sourceBytes) !== sources[id].sourceSha256) throw new Error(`${id} 原始素材不符，不能沿用已核实的来源记录`);
  const document = await io.readBinary(sourceBytes), root = document.getRoot();
  const removed = [];
  for (const node of root.listNodes()) {
    if (node.getMesh() && /^(Phone|teeth_base|Hairline \| fine scalp roots)$/.test(node.getName())) {
      removed.push(node.getName()); node.dispose();
    }
  }
  for (const animation of root.listAnimations())
    if (!["Idle_Standing", "Walk_Relaxed", "Sit_Stand"].includes(animation.getName())) animation.dispose();
  await document.transform(prune(), dedup(), weld());
  // 衣物完整保留，避免减面改变肩颈与皮肤相交处的拓扑。
  for (const mesh of root.listMeshes()) if (!/casualsuit/.test(mesh.getName()))
    for (const primitive of mesh.listPrimitives())
      simplifyPrimitive(primitive, { simplifier: MeshoptSimplifier, ratio: 0.10, error: 0.006, lockBorder: true });
  await document.transform(resample(), prune(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512], slots: /normalTexture/, quality: 92 }),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], slots: /^(?!normalTexture).*$/, quality: 88 }),
    dedup(), prune());
  const bytes = await io.writeBinary(document);
  await writeFile(path.join(output, `${id}.glb`), bytes);
  const meshes = root.listMeshes().map((mesh) => ({
    name: mesh.getName(),
    triangles: mesh.listPrimitives().reduce((sum, primitive) =>
      sum + (primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION").getCount()) / 3, 0),
  }));
  const model = {
    id, ...sources[id], sourceBytes: sourceBytes.length, file: `${id}.glb`, bytes: bytes.length, sha256: sha256(bytes),
    removed, meshes, triangles: meshes.reduce((sum, mesh) => sum + mesh.triangles, 0),
    bones: root.listSkins()[0].listJoints().map((bone) => bone.getName()),
    animations: root.listAnimations().map((animation) => ({ name: animation.getName(), channels: animation.listChannels().length })),
    extensions: root.listExtensionsUsed().map((extension) => extension.extensionName),
  };
  models.push(model);
  console.log(`${id}：${bytes.length} 字节，${model.triangles} 个三角形，${model.bones.length} 根骨骼`);
}
await writeFile(path.join(output, "provenance.json"), JSON.stringify({
  license: "CC0-1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  author: "Innerscene Corp，基于 MakeHuman / MPFB 的 CC0 图形素材及作者原创动作",
  sourceCopyright: "Authored by Innerscene Corp (innerscene.com). Public domain: dedicated under CC0 1.0 Universal, https://creativecommons.org/publicdomain/zero/1.0/. Free to use, modify and redistribute for any purpose, with no credit required.",
  versions: { "@gltf-transform/core": "4.5.1", "@gltf-transform/functions": "4.5.1", "@gltf-transform/extensions": "4.5.1", meshoptimizer: "1.3.0", sharp: "0.35.5" },
  processing: { simplifyRatio: 0.10, simplifyError: 0.006, lockBorder: true, keepClothingTopology: true, colorTextureMax: 1024, normalTextureMax: 512, format: "WebP", runtimeCompressionDecoder: false },
  models,
}, null, 2) + "\n");
