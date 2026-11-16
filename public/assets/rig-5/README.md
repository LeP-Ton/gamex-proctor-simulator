# 完整骨骼人物素材

`maya.glb` 与 `sam.glb` 来自原作者 Innerscene 的普通成年人物动作集合，作者基于 MakeHuman / MPFB 的 CC0 身体、皮肤与骨架素材制作服装和原创动作，按 **CC0-1.0** 公开。不是监控录像或真人身份资料。原始 GLB 内嵌作者及 CC0 声明；来源页、原始与正式文件 SHA256、处理参数均见 [provenance.json](provenance.json)。运行时只读本站文件，无模型服务或网络推理。

三维运行库 Three.js 使用 MIT 许可，随站点保留其[许可正文](THREE-LICENSE.txt)。这不改变项目本身的许可范围。

- [Maya 原作者页面](https://www.innerscene.com/tools/library/3d-parts/locomotion-collection-maya-3d-person-animated-1499b2fd)：马尾、上衣与长裤。
- [Sam 原作者页面](https://www.innerscene.com/tools/library/3d-parts/locomotion-collection-sam-3d-person-animated-dc23800f)：短发、圆领上衣与长裤。
- [CC0 完整许可](https://creativecommons.org/publicdomain/zero/1.0/)、[MakeHuman 图形素材许可说明](https://www.makehumancommunity.org/about/license.html)。

## 运行数据

| 文件 | 字节 | 三角形 | 骨骼 | 保留动作 |
| --- | ---: | ---: | ---: | --- |
| maya.glb | 1,776,456 | 14,178 | 56 | Idle_Standing、Walk_Relaxed、Sit_Stand |
| sam.glb | 2,128,932 | 13,928 | 56 | Idle_Standing、Walk_Relaxed、Sit_Stand |

同一完整蒙皮和骨架连续用于坐姿、书写、站起、转向、迈步、伸手和离场；不使用不同照片的头、身体或四肢拼贴。上衣和裤子保留原始拓扑，以免肩颈接缝在减面后穿透皮肤。仅去除未使用的手机、牙齿和细发根，其他网格进行受误差约束的减面；保留真实皮肤、眼睛、服装、头发与鞋的纹理。颜色纹理最大 1024、法线最大 512，压为内嵌 WebP，不需要 Draco 或 Meshopt 运行解码器。

衣物运行时共用着色程序，将原布料颜色转换为保留纹理亮度的中性基准，再使用稳定的八种中性衣色；差异通过 uniform 传入，不为每个人物编译独立程序。只处理衣料，不改变脸、皮肤或头发。角色释放时仅释放自身材质、克隆骨架与骨骼纹理，共享模型几何和图片继续由素材缓存持有。

人物采用米制、Y 向上、正面朝 +Z。原始站姿可见高度约 Maya 1.669m、Sam 1.777m，游戏按稳定人物参数归一到约 1.65—1.85m。衣色、体宽、头型、身高差异按种子与人物 ID 固定，皮肤与脸部不做颜色覆盖。

`Idle_Standing` 为 6 秒；`Walk_Relaxed` 为 2 秒原地步行，原作者标定移动等效速度 1.3m/s。游戏以累计路程驱动采样时间，每 2.6m 经过整个片段，转身由实际路线方向决定。`Sit_Stand` 为 6 秒：0 秒站立、3 秒坐下、6 秒回到站立；游戏用 `3 + stand × 3` 连续取样，逆向用于落座。

脚步锚点为地面原点，坐姿臀部在原点后方约 0.34m、离地约 0.575m；家具与人物应使用同一 3D 世界，不能把臀部误当作脚步原点。骨骼名称为 `pelvis`、`spine_01`—`spine_03`、`head`、`upperarm_l/r`、`lowerarm_l/r`、`hand_l/r`、`thigh_l/r`、`calf_l/r`、`foot_l/r` 与 `ball_l/r`。

## 可选离线重建

正常游戏安装和构建不需要离线工具。重新处理时在单独目录安装固定工具版本，先下载 `provenance.json` 指定的两个原始 GLB，再运行：

```sh
npm install --prefix /tmp/proctor-rig-tools --registry=https://registry.npmjs.org \
  @gltf-transform/core@4.5.1 @gltf-transform/functions@4.5.1 \
  @gltf-transform/extensions@4.5.1 meshoptimizer@1.3.0 sharp@0.35.5
node scripts/prepare-rig-assets.mjs \
  --maya /原始素材/locomotion-collection-maya-3d-person-animated.glb \
  --sam /原始素材/locomotion-collection-sam-3d-person-animated.glb \
  --output public/assets/rig-5 --tools /tmp/proctor-rig-tools
```

脚本核实原始 SHA256 后才处理，不在运行时下载素材。升级素材或处理参数后须重新核对骨架、动作、肩颈轮廓、步态和游戏实际拾取，不得仅以文件变小为验收结论。
