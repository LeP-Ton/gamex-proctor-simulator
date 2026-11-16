# 项目长期约定

- 项目：GameX《监考模拟器》，中文桌面浏览器单机观察游戏。
- 技术栈：TypeScript、Three.js、Canvas 2D、原生 DOM、Vite；素材随包发布，无远程模型或推理服务依赖。
- 沟通、文档和新增注释使用中文。需求记录入口为 `.agentdocs/index.md`。
- `src/engine/` 负责种子随机、调度、世界状态、固定步长、举报及复盘；不依赖 DOM。
- `src/render/rig-*` 负责三维行程、完整蒙皮人体、立体房间与深度射线拾取；旧版几何冻结，仅用于复盘。隐藏事件状态不得改变正常悬停。
- `src/ui/` 与 `src/main.ts` 负责界面及输入；`src/storage.ts` 管理本地成绩。
- `npm run dev` 启动，`npm run build` 类型检查与生产构建，`npm test` 运行核心约束测试。
- 计分时钟为整数固定步长；有效区间为开始包含、结束不包含。计分事件安排与装饰行为随机流独立。
- 复盘必须从实际种子和输入日志重建，禁止修改原局；正式界面不泄露目标或倒计时。
- 参数与规则版本集中在 `src/engine/config.ts`。规则变更须更新版本，避免混排成绩。
- 实际代码变更须维护对应需求 README 和阶段记录，不在本文件堆积阶段进度。
- 本分支为 `codex/realistic` 写实版；`codex/illustrated` 保留插画首版。两版分别镜像到 `LeP-Ton/gamex-proctor-realistic`、`LeP-Ton/gamex-proctor-illustrated` 独立测试、构建和部署 Pages；main 只维护选择入口和权威发布记录。禁止再请求 main 联合构建两版。
- `.npmrc` 和锁文件使用公开 npm 源，避免把本机内网镜像写入外部构建所需的下载地址。
- 当前 `rig-5` 使用 `public/assets/rig-5/` 的 CC0 普通人物、骨骼动画与三维桌椅；模型来源、处理和 SHA 在同目录。素材和图形上下文准备完成才允许开局；加载失败可重试，丢失上下文会暂停并等待恢复。
- 视觉条件由 `visualVersion` 隔离成绩，不纳入计分事件随机流；经典版及 V2 记录分别使用冻结的 `legacy-geometry.ts`、`monitor-geometry.ts` 复盘。素材裁剪与掩码由可选离线脚本生成，不应手改生成数据。
- `rig-world.ts` 按绝对 tick 重建路线、开门和朝向，`rig-people.ts` 按路程及只读举报记录取样完整骨骼。每次恢复骨骼基准再采样，不能累积上帧姿态。`rig-renderer.ts` 六路共用一个 WebGL 上下文；浏览器拾取实际蒙皮三角和家具深度，Node 的纯投影描述仅用于引擎约束测试。
- `motion-4-geometry.ts`、`photo-geometry.ts`、`monitor-geometry.ts`、`legacy-geometry.ts` 冻结各代复盘。旧照片加载和网格模块保留，不得为新画面修改它们所依赖的原迁移和行为语义。
- 新规则 `1.1.0` 提供完整14秒迁移与公共区进出预算；仅专用调度冲突可按种子确定性重排，其他异常必须抛出。旧 `1.0.0` 调度保留原结果，并以黄金摘要回归。
- `npm run test:browser` 验证完整交互和五代复盘；`npm run test:motion` 采集实际 Canvas 动态录像与脚骨诊断；`npm run test:rig` 执行两者。生成证据写到 `artifacts/rig-5/`，不能用静态截图代替步态验收。

- 写实版保留 `gamex-proctor-v1` 存档键，以延续原入口历史；插画版使用独立键，不应互相读取或复制新版局到旧播放器。
