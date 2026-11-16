# GameX · 监考模拟器

在「考场视频巡查系统」中同时观察六路画面，发现明确违规后直接点击人物或物品。单局固定六分钟，挑战同种子下的最高成绩。

项目提供独立维护的插画首版和写实新版。下述连贯人物与照片素材说明对应 `codex/realistic`；插画首版保留原有画面和可玩流程。

写实新版使用连贯动作监控画面：20 种本地照片底片，加上每位考生固定的体态、衣色和动作节奏差异。人物以同一张底片连续变形，连接头肩、肘腕、书写、肩背舒展与步态，避免直接切换姿势照片和几何长臂。桌前层与实际拾取共用同一网格和透明轮廓。

图片均为 AI 生成原创素材，运行时不调用 AI 或远程素材服务。首次进入会等待约 4.5MB 本地素材解码，失败可重试。新开局使用 `motion-4`；三代旧记录继续按原画面复盘，四种视觉条件的最佳成绩分别保存，计分机会保持不变。

## GitHub Pages 双版本发布

本次双版本分支和本地检查已完成，主发布编排尚未提交，最终云端部署与线上访问待验证。以下为固定发布入口：

| 版本 | Pages 入口 | 独立源码分支 |
| --- | --- | --- |
| 版本选择页 | [选择两个可玩版本](https://lep-ton.github.io/gamex-proctor-simulator/) | `main` 负责组装与发布 |
| 插画首版 | [打开插画版](https://lep-ton.github.io/gamex-proctor-simulator/illustrated/) | [codex/illustrated](https://github.com/LeP-Ton/gamex-proctor-simulator/tree/codex/illustrated) |
| 写实新版 | [打开写实版](https://lep-ton.github.io/gamex-proctor-simulator/realistic/) | [codex/realistic](https://github.com/LeP-Ton/gamex-proctor-simulator/tree/codex/realistic) |

两个游戏分支已在[公开仓库](https://github.com/LeP-Ton/gamex-proctor-simulator)创建。插画版基于首版运行源码，增加独立保存键和部署适配；写实版保留当前连贯动作实现。本次不修改两版玩法和平衡参数。

Pages 由 main 的 `.github/workflows/pages.yml` 统一发布：先把两个分支锁定为完整 SHA，分别安装依赖、测试和构建，再由 `scripts/build-pages.mjs` 生成一份包含两个子目录和选择页的 `dist/`。任何一版失败均不部署，避免两次发布互相覆盖。`manifest.json` 可核对每版的分支、源提交、入口与保存键。

版本分支更新通过薄工作流请求 `workflow_dispatch main`，部署始终在 main 上执行。根目录的旧 `?v=...` 或 `?debug=...` 书签进入写实版并保留查询参数与片段；普通根首页显示两个版本供选择。

两个地址同源，但存档键不同：插画版为 `gamex-proctor-illustrated-v1`，写实版继续使用 `gamex-proctor-v1`，保留当前已有记录。两个版本的设置和成绩不混写。

双版本方案、基线与验收见 [REQ-20261116130906](.agentdocs/workflow/REQ-20261116130906-双版本分支发布/README.md)。此前单写实版的发布记录仍保留在[连贯动作阶段](.agentdocs/workflow/REQ-20261113124409-监考模拟器/20261116104702-连贯动作返修.md)，不能把此前部署结果当作本次双版本已上线。

## 本地启动与分支

需要 Node.js 20.19+。进入项目根目录后，在已保存改动的工作区选择要开发的版本；日常写实开发默认使用 `codex/realistic`：

```sh
git switch codex/realistic
npm ci
npm run dev
```

开发或试玩插画首版时切换分支，再安装该分支锁定的依赖：

```sh
git switch codex/illustrated
npm ci
npm run dev
```

两版均支持：

```sh
npm run build       # 类型检查并生成该版本的 dist/
npm run preview     # 预览该版本构建
npm test            # 运行该版本自己的核心测试
npm run test:browser   # 该版本的完整浏览器流程与两种尺寸检查
npm run test:realtime  # 不快进的真实六分钟正式考试
```

写实版另有 `npm run test:motion`，用于实际 Canvas 录像、动作边界和帧间隔检查。浏览器测试使用本机 Chrome 的隔离临时配置；也可通过 `PROCTOR_BROWSER_PATH` 指定浏览器。没有 Chrome 时先执行 `npx playwright install chromium`。

发布维护在 main 上进行：

```sh
git switch main
npm run test:pages          # 只需 Node，验证组合产物与兼容入口
npm run test:pages-browser  # 需先组装 dist/，检查双版交互与同源存档隔离
```

`npm run build:pages -- --illustrated-dist ... --realistic-dist ... --output dist --illustrated-sha ... --realistic-sha ...` 接收两版已构建目录及各自完整 SHA。云端工作流自动准备这些来源；main 的普通 `npm run build` 仅构建保留的应用快照，不代表双版本组合发布。

## 操作与规则

- 左键直接点击人物身体或可见违规物品举报；空白点击也算误报。
- 点击机位右上角或按 `1`—`6` 放大。其他五路保留可点击缩略图；`Esc` 返回六屏。
- `空格` 或「暂停」遮住所有画面并停止模拟；切出标签页、窗口失焦或长时间运行中断也会安全暂停，需主动继续。
- 明确违规包括：亮屏电子设备、黄色夹带折页、明显探身窥卷并抄写、传递黄色材料、公共洗手区查看或交换黄色材料。
- 正常书写、思考、看钟、伸展、捡笔、整理文具、普通转头、归还蓝色笔、离场、洗手和等候均允许。准备阶段不能举报。
- 正确 +100，误报 −150，漏查 −100。第 5 次连续正确起 ×1.2，第 10 次起 ×1.5；倍率只作用于正确得分。
- 成功立即结束该事件，提供 0.5 秒重复输入保护；误报仅使当前机位冷却 1 秒。

默认三档难度：入门 30 件、6—8 秒、最多 1 件并发；常规 48 件、4—6 秒、最多 2 件并发；高压 66 件、3—5 秒、最多 3 件并发。六屏桌面是主要观察条件；小于 1000px 的布局单独标记为窄屏练习。

结算展示成绩指标和按时间排列的已抓到、漏查、误报记录。点击记录可以播放、拖动真实片段；复盘为只读。可使用同种子重赛或生成新种子。

## 工程结构

```text
src/
├── engine/
│   ├── config.ts       # 平衡参数、动作模板、规则版本及难度
│   ├── random.ts       # 种子随机数与稳定哈希
│   ├── schedule.ts     # 固定事件时间表、参与者预约、公共区行程与约束校验
│   ├── world.ts        # 普通行为、人物唯一位置与当前可见动作
│   ├── game.ts         # 20Hz 固定步长、计分、输入日志与只读重放
│   ├── tutorial.ts     # 2→4→6 路渐进教学
│   └── types.ts        # 世界、事件、成绩及记录结构
├── render/
│   ├── geometry.ts    # 统一绘制列表、遮挡、拾取和坐标变换
│   ├── canvas.ts      # Canvas 绘制、等比例缩放与局部反馈
│   ├── candidate-motion.ts # 稳定外观、连续动作曲线与真实举报后的回正
│   ├── photo-mesh.ts / mesh-renderer.ts # 可逆网格、GPU 图集与 Canvas 降级
│   ├── photo-geometry.ts # V3 照片冻结画面，仅用于旧局复盘
│   ├── photo-assets.ts # 照片裁剪帧、真实透明掩码与头部锚点（生成数据）
│   ├── monitor-geometry.ts # V2 监控冻结画面，仅用于旧局复盘
│   └── legacy-geometry.ts # 首版冻结画面，仅用于旧局复盘
├── ui/                # 图标与反馈音
├── main.ts            # 界面、输入、暂停、教学、设置及复盘播放器
├── storage.ts         # 本地设置、同条件最佳及最近十局
└── style.css
tests/                 # 引擎测试与生产包浏览器验收脚本
public/assets/photo-3/ # 原照片素材、来源说明与生成提示词
public/assets/motion-4/ # 新人物素材、裁剪边界与原始生成提示词
scripts/               # 可选离线素材准备工具；正常运行和构建无需 Python
```

引擎使用整数 tick（每秒 20 次），渲染约 30fps，避免不同画面各自计时。所有计分事件在开局时生成，提前抓到不会增加后续事件。动作有效区间为 `[start, end)`。计分、正常行为及普通来访使用独立随机来源，观察、悬停、放大和重放不消耗计分随机数。

绘制与拾取使用同一批几何和照片帧；连续动作从实际网格逆映射回源照片，按逆绘制顺序拾取；桌面、人物和前景可真实遮挡。照片使用实际 alpha 透明掩码，桌腿镂空和人物透明边缘不可命中。画面等比例缩放，输入使用同一变换，兼容设备像素比（DPR）。成功后旧物品轮廓只用于短暂忽略重复输入，不会成为新的得分目标。

复盘从本局保存的事件计划和实际输入日志重建整个世界，而非播放通用示意动画。本地成绩按种子、难度、时长、规则版本、布局和辅助标记隔离。隐私模式或存储配额不可用时，游戏继续运行，记录退回内存保存。

## 开发调试

显式访问 `/?debug=1` 会显示辅助调试标记及时间定位、固定动作变体、模拟冻结工具。此模式的成绩与正式成绩隔离。正式入口默认不显示目标、倒计时、嫌疑度或机位报警。开发服务器和显式辅助模式提供 `window.__proctor`，用于可重复验收；普通生产入口不提供该接口。

## 验证与边界

实际结果见 [TESTING.md](TESTING.md)。已知边界：桌面单机、原创照片素材与程序动作合成、浏览器本地存储；人物仍为二维照片与网格合成，基础面孔数量有限，大角度动作和局部肢体可能保留合成痕迹。没有服务器排行榜、跨设备同步、视频导出或完整无视觉辅助操作。后续计划见 [TODO.md](TODO.md)。

需求入口：[游戏实现 REQ-20261113124409](.agentdocs/workflow/REQ-20261113124409-监考模拟器/README.md)；[双版本分支发布 REQ-20261116130906](.agentdocs/workflow/REQ-20261116130906-双版本分支发布/README.md)。
