# 三版本分支与独立 Pages

- 需求 ID：REQ-20261116130906；延续双版本独立发布，保留原 ID 和目录。
- 来源：用户要求将会话-54 照片版也独立分支并部署。
- 时间：2026-11-16，Asia/Shanghai。
- 状态：照片分支恢复完成，正在测试与发布。
- 本分支：`codex/photo`；公开源仓库 `LeP-Ton/gamex-proctor-simulator`。
- 权威总入口：[main 分支需求记录](https://github.com/LeP-Ton/gamex-proctor-simulator/blob/main/.agentdocs/workflow/REQ-20261116130906-%E5%8F%8C%E7%89%88%E6%9C%AC%E5%88%86%E6%94%AF%E5%8F%91%E5%B8%83/README.md)。

## 目标与验收

插画版 `codex/illustrated`、照片版 `codex/photo`、3D 版 `codex/realistic` 分支独立保留，各自在独立仓库发布 Pages；选择页提供三个入口。照片版从会话-54 的 `motion-4` / rule `1.0.0` 恢复，保持游戏与画面；三个同源站点存档隔离，照片版不得改写另两版数据。既有插画和 3D 部署本阶段不变。

## 当前结论

- 照片基线：`f258a19fba00ecc4dc62f39664a559698d20580b`。它与实现提交 `0fe2b1f1c7ef788f21982f5c8273dd4a9e0ee3a2` 的源码、资源、测试及构建配置一致，仅归档文档不同。
- 照片版独立保存键：`gamex-proctor-photo-v1`；不自动迁移原 `gamex-proctor-v1`。原记录继续保留在 3D 站的兼容复盘中。
- 站点：https://lep-ton.github.io/gamex-proctor-photo/ 。云端和真实浏览器验收尚待完成，不以构建通过代替上线验收。

## 阶段记录

- [照片版独立发布](20261116161718-照片版独立发布.md)：恢复基线、部署隔离、验证与最终发布定位；聊天会话-91 起。
