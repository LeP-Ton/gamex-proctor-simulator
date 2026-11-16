# 三版本分支与独立 Pages

- 需求 ID：REQ-20261116130906；延续双版本独立发布，保留原 ID 和目录。
- 来源：用户要求将会话-54 照片版也独立分支并部署。
- 时间：2026-11-16，Asia/Shanghai。
- 状态：技术交付完成。三版独立 Pages、选择页、来源与资源、真实交互、整局保存和跨版隔离均已验收；用户人工体验待反馈。
- 本分支：`codex/photo`；公开源仓库 `LeP-Ton/gamex-proctor-simulator`。
- 权威总入口：[main 分支需求记录](https://github.com/LeP-Ton/gamex-proctor-simulator/blob/main/.agentdocs/workflow/REQ-20261116130906-%E5%8F%8C%E7%89%88%E6%9C%AC%E5%88%86%E6%94%AF%E5%8F%91%E5%B8%83/README.md)。

## 目标与验收

插画版 `codex/illustrated`、照片版 `codex/photo`、3D 版 `codex/realistic` 分支独立保留，各自在独立仓库发布 Pages；选择页提供三个入口。照片版从会话-54 的 `motion-4` / rule `1.0.0` 恢复，保持游戏与画面；三个同源站点存档隔离，照片版不得改写另两版数据。既有插画和 3D 部署本阶段不变。

## 当前结论

- 照片基线：`f258a19fba00ecc4dc62f39664a559698d20580b`。它与实现提交 `0fe2b1f1c7ef788f21982f5c8273dd4a9e0ee3a2` 的源码、资源、测试及构建配置一致，仅归档文档不同。
- 照片版独立保存键：`gamex-proctor-photo-v1`；不自动迁移原 `gamex-proctor-v1`。原记录继续保留在 3D 站的兼容复盘中。
- 站点：https://lep-ton.github.io/gamex-proctor-photo/ 。源实现 `20baa50d35e29883efbb46ae49776a46f30efd84`；镜像 `9ce392218cc1aed65be59709e456ccebcdf86e7b`；[任务 43830718492](https://github.com/LeP-Ton/gamex-proctor-photo/actions/runs/43830718492) 的 37 项核心、构建与部署通过。原版 14 组本地浏览器及补充 20 组实际指针、完整模拟考试与只读复盘通过；三站正式联验通过：26 个运行文件正文匹配冻结包、三份来源 SHA/tree 精确、同源三键原文不互改；照片版另有 20 组线上真实鼠标举报、完整模拟局、只读复盘与历史读档。

## 阶段记录

- [照片版独立发布](20261116161718-照片版独立发布.md)：恢复基线、部署隔离、验证与最终发布定位；聊天会话-91 起。

- 统一选择页正式浏览器验收通过：7 个公开文件正文一致、三种视口、9 条旧书签 query/hash 保留；[打开三版入口](https://lep-ton.github.io/gamex-proctor-simulator/)。
