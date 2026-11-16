import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// 从项目根目录读取实际随构建发布的 GLB，避免只检查编辑器中的临时模型。
const root = new URL(
  `file://${process.cwd().replace(/ /g, "%20")}/public/assets/rig-5/`,
);
const provenance = JSON.parse(
  await readFile(new URL("provenance.json", root), "utf8"),
);
for (const model of provenance.models) {
  test(`${model.id} 发布素材有完整蒙皮、独立脚骨动画和可核对来源，不依赖外部解码器`, async () => {
    const bytes = await readFile(new URL(model.file, root));
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.length, model.bytes);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      model.sha256,
    );
    const jsonLength = bytes.readUInt32LE(12);
    const data = JSON.parse(
      bytes.subarray(20, 20 + jsonLength).toString("utf8"),
    );
    assert.match(data.asset.copyright, /CC0/i);
    assert.equal(provenance.license, "CC0-1.0");
    assert.ok(data.skins.length > 0);
    assert.ok(
      data.skins.every(
        (skin: { joints: number[] }) => skin.joints.length === 56,
      ),
    );
    assert.deepEqual(
      data.animations.map((clip: { name: string }) => clip.name).sort(),
      ["Idle_Standing", "Sit_Stand", "Walk_Relaxed"],
    );
    assert.ok(
      !data.extensionsRequired?.some((name: string) =>
        /draco|meshopt/i.test(name),
      ),
    );
    assert.ok(
      data.meshes.every(
        (mesh: { primitives: { attributes: Record<string, number> }[] }) =>
          mesh.primitives.every(
            (p) =>
              p.attributes.JOINTS_0 !== undefined &&
              p.attributes.WEIGHTS_0 !== undefined,
          ),
      ),
    );
    const walk = data.animations.find(
      (clip: { name: string }) => clip.name === "Walk_Relaxed",
    );
    for (const name of ["foot_l", "foot_r", "calf_l", "calf_r"]) {
      const channel = walk.channels.find(
        (channel: { target: { node: number; path: string } }) =>
          data.nodes[channel.target.node].name === name &&
          channel.target.path === "rotation",
      );
      assert.ok(channel, `缺少 ${name} 独立骨骼轨道`);
      const accessor = data.accessors[walk.samplers[channel.sampler].output];
      // 优化后的线性关键帧可以很少；直接验证关节旋转，不能按帧数臆测是否有动作。
      const view = data.bufferViews[accessor.bufferView];
      const offset =
        20 +
        jsonLength +
        8 +
        (view.byteOffset ?? 0) +
        (accessor.byteOffset ?? 0);
      const stride = view.byteStride ?? 16;
      const rotation = (index: number) =>
        Array.from({ length: 4 }, (_, component) =>
          bytes.readFloatLE(offset + index * stride + component * 4),
        );
      const first = rotation(0);
      let maximum = 0;
      for (let i = 1; i < accessor.count; i++) {
        const current = rotation(i);
        const dot = Math.abs(
          current.reduce(
            (sum, value, component) => sum + value * first[component],
            0,
          ),
        );
        maximum = Math.max(maximum, 2 * Math.acos(Math.min(1, dot)));
      }
      assert.ok(maximum > 0.001, `${name} 骨骼没有实际旋转`);
    }
  });
}
