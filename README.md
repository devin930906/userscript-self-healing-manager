# Userscript Self-Healing Manager

> Local-first desktop software for diagnosing, repairing and validating Tampermonkey/Violentmonkey userscripts against changing web DOMs via Chrome DevTools Protocol (CDP).

**状态：设计评审阶段（2026-10-08）**。本仓库现阶段仅维护需求、架构、安全、验收与路线图文档；**尚未实现软件功能，也未声称修复、测试通过**。

## 愿景
- 自定义 Chrome/便携版浏览器程序路径，默认尝试以 `--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1` 启动并验证 CDP。
- 批量导入 `.user.js` 文件或目录；静态 AST 检查和真实网页动态验证。
- 按证据执行本地自愈；低置信度时可选接入用户自备 Base URL / API Key / 模型。
- 每次修复都有 diff、功能断言、日志、审阅、备份与回滚。
- 支持共享兼容层、健康检查、缓存和分阶段的安全自动化。

## 设计文档
1. [总体设计规范（Superpowers）](docs/superpowers/specs/2026-10-08-userscript-self-healing-manager-design.md)
2. [产品需求与可追踪矩阵](docs/requirements/product-requirements.md)
3. [CDP 浏览器接入与运行时](docs/architecture/browser-cdp-and-runtime.md)
4. [多级自愈引擎与兼容层](docs/architecture/healing-engine.md)
5. [数据契约、持久化与状态机](docs/architecture/data-contracts.md)
6. [AI 提供方、隐私与安全模型](docs/security/ai-and-threat-model.md)
7. [界面与交互规范](docs/design/ux-and-workflows.md)
8. [质量、测试与验收规范](docs/quality/test-and-acceptance.md)
9. [项目阶段、里程碑与交付路线图](docs/roadmap/master-roadmap.md)
10. [技术决策、已知风险与核验依据](docs/decisions/architecture-decisions.md)
11. [Windows 三种发行版：安装 EXE / 便携 EXE / ZIP 解压版](docs/distribution/windows-three-editions.md)

> **重要：** 自 Chrome 136 起，正式 Chrome 对默认资料目录的远程调试开关有限制。仅“便携版”不构成豁免。程序默认不擅自添加 `--user-data-dir`，连接失败必须明确提示并提供由用户选择的兼容路径。详见 CDP 文档与[Chrome 官方公告](https://developer.chrome.com/blog/remote-debugging-port/)。

## Windows 最终发行合同（必须交付三种格式）
- **EXE 安装版**：`Userscript-Self-Healing-Manager-Setup-<version>-win-x64.exe`。
- **单文件 EXE 便携版**：`Userscript-Self-Healing-Manager-Portable-<version>-win-x64.exe`，无需安装，持久数据应保存在 EXE 外部所在目录的 `Data/`（可写性验证）。
- **ZIP 完整解压版**：`Userscript-Self-Healing-Manager-<version>-win-x64.zip`，解压的是**完整 unpacked 应用目录**，不是只把单文件 Portable.exe 打进压缩包；直接打开解压后的主 EXE，数据保存在该应用文件夹的 `Data/`。
- 三者对应同一个版本号和 Git commit、功能一致，正式稳定版缺少任意一种即不得发布。现阶段**还没有生成任何发行安装包**。
- 详见 [三形式发行与数据迁移规范](docs/distribution/windows-three-editions.md)。

## 开发边界
设计规范在评审确认前，不开始产品代码、浏览器自动操控或对现有 userscript 的覆盖。技术版本、依赖授权及 Windows 10 运行支持在锁定实现版本时重新核验。

## License
尚未决定。在许可文件明确之前，请勿推断本仓库已有开源授权。
