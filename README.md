# GameX · 监考模拟器

在六路考场画面中观察人物和物品，发现明确违规后直接点击举报。支持教学、固定六分钟考试、三档难度、种子重赛、本地记录与真实事件复盘。

插画首版、会话54照片版和会话88的3D版分别维护、分别部署。原插画与3D站点已完成云端和线上验收；照片版恢复与第三入口本次正在发布，实际结果以[当前阶段记录](.agentdocs/workflow/REQ-20261116130906-双版本分支发布/20261116161718-照片版独立发布.md)为准。main 仅维护选择页和旧书签兼容跳转。

| 版本 | 独立试玩 | 权威源码 | 独立部署仓库 |
| --- | --- | --- | --- |
| 插画首版 | [打开插画版](https://lep-ton.github.io/gamex-proctor-illustrated/) | [codex/illustrated](https://github.com/LeP-Ton/gamex-proctor-simulator/tree/codex/illustrated) | [gamex-proctor-illustrated](https://github.com/LeP-Ton/gamex-proctor-illustrated) |
| 照片版 · 会话54 | [打开照片版](https://lep-ton.github.io/gamex-proctor-photo/) | [codex/photo](https://github.com/LeP-Ton/gamex-proctor-simulator/tree/codex/photo) | [gamex-proctor-photo](https://github.com/LeP-Ton/gamex-proctor-photo) |
| 3D版 · 会话88 | [打开3D版](https://lep-ton.github.io/gamex-proctor-realistic/) | [codex/realistic](https://github.com/LeP-Ton/gamex-proctor-simulator/tree/codex/realistic) | [gamex-proctor-realistic](https://github.com/LeP-Ton/gamex-proctor-realistic) |

[版本选择页](https://lep-ton.github.io/gamex-proctor-simulator/)保持原地址。旧根 `?v=motion-4` 恢复指向照片站；其余 `?v=...` / `?debug=...`（包括 `photo-3`、`cctv-2`、`rig-5`）继续指向3D站。`/illustrated/`、`/photo/`、`/realistic/` 分别转对应独立站，完整保留查询和片段。照片版入口发布进展见[需求记录](.agentdocs/workflow/REQ-20261116130906-双版本分支发布/README.md)。

三游戏站分别构建自己的产物，更新一版不触发其他版本。三站仍同属 `lep-ton.github.io`，因此显式隔离保存键：插画版 `gamex-proctor-illustrated-v1`，照片版 `gamex-proctor-photo-v1`，3D版保留 `gamex-proctor-v1`；原3D记录保留。

每站 `deployment.json` 标明完整权威源 SHA、源 tree 和部署仓库。查看[插画来源](https://lep-ton.github.io/gamex-proctor-illustrated/deployment.json)、[照片来源](https://lep-ton.github.io/gamex-proctor-photo/deployment.json)、[3D来源](https://lep-ton.github.io/gamex-proctor-realistic/deployment.json)；选择页不固化各站当前提交。

## 游戏开发

保存已有改动后切换对应版本，日常3D开发使用：

```sh
git switch codex/realistic
npm ci
npm run dev
```

插画版切换 `codex/illustrated`，照片版切换 `codex/photo`。各版独立运行 `npm test`、`npm run build`，完整命令、实现、素材及限制见对应分支 README/TESTING。main 的 `src/` 是历史快照，其普通 Vite 构建不代表线上游戏。

照片版以 `f258a19fba00ecc4dc62f39664a559698d20580b` 恢复会话54的 `motion-4`：照片素材、20种人物基础外观、二维网格连续变形动作；这是照片合成版本。只增加独立保存与发布适配，视觉和玩法以该历史基线为准，恢复后的验证见当前阶段记录。

3D版 `rig-5` 已独立上线：完整骨骼脚步与转向、起身走门开门返座、实际肢体与手掌、实体桌椅和统一深度阴影。53 项核心检查、15,000 组调度压力、本地完整流程和三段实际动作录像、正式站点 10 组浏览器流程通过；详见[写实分支三维返修记录](https://github.com/LeP-Ton/gamex-proctor-simulator/blob/codex/realistic/.agentdocs/workflow/REQ-20261113124409-监考模拟器/20261116134618-三维人物与场景返修.md)。

## 选择页维护

main 无需安装游戏依赖：

```sh
git switch main
npm run test:pages
npm run build:pages -- --output dist
```

`.github/workflows/pages.yml` 只测试选择页、构建根入口和兼容跳转、上传部署本仓库 Pages。`scripts/build-pages.mjs` 暂存完整产物后替换输出，失败保留前产物；不读取游戏 dist、不解析游戏分支、不触发独立游戏仓库。

源码为 `sites/index.html`、`sites/style.css` 和 `public/favicon.svg`。产物含根入口、`manifest.json`、兼容 `/illustrated/`、`/photo/` 与 `/realistic/` 跳转页。旧 `tests/pages-browser.mjs` 保留为历史组合站点验收，不再列入当前 main 命令。

## 单独更新游戏站点

先完成相应版本的开发和验证，将提交同步到权威源码分支，再从本仓库 main 执行：

```sh
node scripts/sync-independent-pages.mjs realistic <完整源码SHA>
```

插画版使用参数 `illustrated`，照片版使用 `photo`，3D版保留 `realistic`。脚本只允许这三个目标，只推进所选部署仓库的版本分支，该镜像推送触发自身测试、构建和部署；不请求原 main，不保存跨仓库 token，使用本机已登录 gh 的授权。

源码根目录默认按脚本位置解析，非敏感同步状态默认 `artifacts/independent-pages/`。保留已核实的 state 文件；远端 HEAD 不一致则停止，不重写未知历史。可用 `PROCTOR_SOURCE_DIRECTORY`、`PROCTOR_PAGES_STATE_DIRECTORY` 指定源码和忽略的状态目录。

镜像保留游戏运行文件，只适配自身工作流、README、AGENTS 和 `public/deployment.json`。照片版复用固定源码提交中的专用工作流，并在访问远端前验证照片仓库与分支部署保护；另外两版继续使用原镜像模板。源分支可只测试构建，部署受目标仓库和分支保护；镜像覆盖为独立发布模板。

## 验收与追溯

- 首次独立发布：[插画任务 43811806502](https://github.com/LeP-Ton/gamex-proctor-illustrated/actions/runs/43811806502)、[写实任务 43812180658](https://github.com/LeP-Ton/gamex-proctor-realistic/actions/runs/43812180658)，分别 16/36 项核心测试、构建部署通过。
- 两站 Chrome 验收通过：两种桌面尺寸、20 次真实举报、模拟整局结算、独立保存、来源清单；14 个响应正文与已验收本地包逐字节一致，无控制台或资源错误。
- 原双入口 main 的4项测试、云端及线上结果见[独立部署返修](.agentdocs/workflow/REQ-20261116130906-双版本分支发布/20261116134658-独立部署返修.md)。新增照片版与三入口本次验证单独记录，不能沿用原双版本验收结论。自动化检查不等于用户体验验收。

需求入口：[游戏实现 REQ-20261113124409](.agentdocs/workflow/REQ-20261113124409-监考模拟器/README.md)；[独立分支发布 REQ-20261116130906](.agentdocs/workflow/REQ-20261116130906-双版本分支发布/README.md)。原[组合发布记录](.agentdocs/workflow/REQ-20261116130906-双版本分支发布/20261116130906-双版本发布.md)保留历史证据，当前方案已被独立部署替代。
