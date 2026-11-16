# 双版本分支发布 · 写实分支

- 需求：REQ-20261116130906；来源为用户会话-55 前要求拆分两版分支并发布 Pages。
- 当前分支：`codex/realistic`；基线 `f258a19fba00ecc4dc62f39664a559698d20580b`。
- 当前范围：源码分支独立维护，镜像到 `LeP-Ton/gamex-proctor-realistic` 单独测试、构建和部署 Pages；不再由 main 联合构建两版。原联合适配保留为历史记录。
- 写实原存档键保留，既有记录可继续读取；插画版另设独立存档键。后续三维返修见原游戏需求，独立发布本身不改变玩法。
- 权威入口：[main 发布记录](https://github.com/LeP-Ton/gamex-proctor-simulator/blob/main/.agentdocs/workflow/REQ-20261116130906-双版本分支发布/README.md)。
- 当前状态：插画任务 `43811806502` 和写实任务 `43812180658` 已分别独立上线并完成实际浏览器验证，之后才开始 `rig-5` 优化；三维最终结果见[三维返修阶段](../REQ-20261113124409-监考模拟器/20261116134618-三维人物与场景返修.md)。权威发布状态由 main 入口维护。
- [写实独立站](https://lep-ton.github.io/gamex-proctor-realistic/)；[插画独立站](https://lep-ton.github.io/gamex-proctor-illustrated/)。两个仓库各自维护 Pages 环境、产物和部署任务。
- 阶段记录：[写实分支部署适配](20261116130906-写实分支部署适配.md)。
