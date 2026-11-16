# 项目长期约定

- 项目：GameX《监考模拟器》，中文桌面浏览器单机观察游戏。沟通、文档和新增注释使用中文，需求入口为 `.agentdocs/index.md`。
- 权威源码仓库为 `LeP-Ton/gamex-proctor-simulator`。`codex/illustrated` 维护插画首版，`codex/realistic` 维护写实版；日常写实开发默认后者，修改前检查分支和已有差异。
- `main` 仅维护版本选择页、旧地址跳转和发布辅助工具。main 保留的游戏源码属于历史快照，不直接发布；具体实现和限制以版本分支的 AGENTS/README 为准。
- 两个独立公开部署仓库为 `LeP-Ton/gamex-proctor-illustrated` 的 `codex/illustrated`、`LeP-Ton/gamex-proctor-realistic` 的 `codex/realistic`。各自测试、构建、上传并部署，不能请求 main 联合构建或互相覆盖。
- main 的 `.github/workflows/pages.yml` 只运行选择页测试、`scripts/build-pages.mjs --output dist` 和本仓库 Pages 部署，不检出游戏分支，不安装游戏依赖。
- main 验证命令为 `npm run test:pages`、`npm run build:pages -- --output dist`，仅需 Node。旧 `tests/pages-browser.mjs` 是历史组合站点验收脚本，不适用于当前选择页，不再列为 main 命令。
- `sites/` 管选择页；产物仅含根 HTML/CSS/favicon、独立站点清单及两个旧子路径跳转。构建先暂存，完整检查后替换输出；失败保留前产物，拒绝覆盖源目录或通过路径别名越界。
- 游戏更新先进入相应权威版本分支并验证，再用 `scripts/sync-independent-pages.mjs <illustrated|realistic> <完整源码SHA>` 同步单一镜像。脚本限制两个公开仓库、非强制推进 ref、拒绝未知远端 HEAD，不存储或输出凭据。
- 同步状态默认位于忽略的 `artifacts/independent-pages/`。首次移交须复制已核实的两个 state 文件；状态缺失或远端另有变更时先核实 Git 历史，不能自动接管未知提交。
- main 的 `manifest.json` 只映射独立部署仓库、源分支和 URL；当前已发布完整源 SHA 以每站 `deployment.json` 为准，不在选择页固化或虚构更新后的提交。
- 旧根目录 `?v=...` / `?debug=...` 和 `/realistic/` 跳独立写实站，`/illustrated/` 跳独立插画站，均保留查询和片段。
- 两站同属 `lep-ton.github.io` 的同一 origin，路径不隔离 localStorage。插画保存键 `gamex-proctor-illustrated-v1`，写实保留 `gamex-proctor-v1`，不能混写或让旧界面解析新版局。
- 游戏共用 TypeScript、原生 DOM、Vite；`src/engine/` 管固定步长、调度、计分和复盘，`src/render/` 管实际绘制拾取，`src/main.ts` 管界面输入，`src/storage.ts` 管本地成绩。游戏命令在对应版本分支执行。
- 计分使用整数固定步长，事件区间开始包含、结束不包含；复盘按保存计划和真实输入重建，禁止修改原局。规则、视觉、布局、辅助条件分别隔离成绩，旧播放器应冻结保留。
- 实际代码变更须维护所属需求 README 和阶段记录；构建、自动化、人工视觉与用户体验验收分别记录。
- `.npmrc` 和锁文件使用公开 npm 地址。GitHub 远程名为 `github`，与原 Sites 私有源仓库分离，不扩大原 Sites 访问范围。
