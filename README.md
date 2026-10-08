# Userscript Self-Healing Manager — V0.1 开发预览源码

**当前构建状态：源码预览，不是已验证的 Windows 正式发行版。**

本仓库源码用于开发和测试 Windows 油猴脚本诊断工具。长期完整需求、架构和 Superpowers 实施计划位于 [GitHub 主仓库](https://github.com/devin930906/userscript-self-healing-manager)。

## 目前可以做什么

- Windows 桌面 UI（Electron + React，中文深色界面；等待 Windows 实机验收）。
- 手动选择或拖入 `.user.js` 文件，或选择包含脚本的文件夹，批量静态分析。
- TypeScript AST 定位 `querySelector`、`querySelectorAll`、`getElementById`、`getElementsByClassName`、`getElementsByName`、`closest`、`matches` 等表达式。
- 记录源行、函数名、备选 locator；动态字符串表达式显示“需要运行时确认”，不会执行源码。
- SQLite 本地脚本索引；每份脚本独立报错；JSON/Markdown 离线报告。
- 用户主动指定 Chrome 可执行路径，用 `--remote-debugging-port=9223`、`--remote-debugging-address=127.0.0.1` 启动；通过 CDP 本机端口 `/json/version` 和 `/json/list` 验证握手。当前 UI **尚未自动进行 DOM 快照和网页功能验收**。
- 独立命令行脚本诊断入口（可在有 Node.js 24、npm 安装依赖的系统使用）。
- 试验性 **literal-only** 选择器补丁核心：仅接受人工指定的新旧 selector，必须显式批准、验证源码哈希后写入独立受管副本并保留原件备份。**此能力仅为受测试的库接口，未连接 GUI，不能根据网页自动生成候选。**

**尚未实现：** DOM 动态故障归因、自动候选补丁生成与 GUI 应用、真实网站回归/V4 Tampermonkey 探针、GUI 一键备份回滚、AI Provider、健康监控。界面中不得把“静态解析完成”称作“脚本已经修复”。

## Windows 10/11 x64：构建三个格式

1. 在 Windows 电脑安装 Node.js 24 LTS（包含 npm），克隆或解压这份完整源码。
2. 双击项目根目录的 `build-windows.cmd`。脚本执行 `npm install`、`npm test`、`npm run build`、`npm run dist:win`，并将完整 `win-unpacked` 目录另外打成 ZIP。
3. 构建和测试全部通过时，`release/` 文件夹应包含：

```text
Userscript-Self-Healing-Manager-Setup-0.1.0-alpha.2-win-x64.exe
Userscript-Self-Healing-Manager-Portable-0.1.0-alpha.2-win-x64.exe
Userscript-Self-Healing-Manager-0.1.0-alpha.2-win-x64.zip
SHA256SUMS.txt
```

**这些只是输出命名规范；目前没有实际生成并验证上述三个 Windows 二进制文件。** 首次打包仍需 Windows 测试、Electron 安装、签名状态和数据目录迁移确认。不要把未经实测的 Preview 版本发布为 Stable。

### Windows 数据目录

- **Setup.exe**：持久资料在用户 AppData 下的应用用户数据目录，不放到安装目录。
- **Portable.exe**：以外部 EXE 的真实路径为准，在旁边创建 `Data/`；不可写时提示错误，不默默写 AppData。
- **完整 ZIP**：完整解压后运行 EXE，在解压应用目录旁创建 `Data/`，不要只从压缩包内部双击 EXE。

ZIP 打包脚本会添加内部 `.usshm-portable` 标记，程序据此识别 ZIP 解压版。临时解包文件和操作系统自身缓存不等于持久用户数据。

## 开发者运行与测试

```powershell
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

命令行静态诊断：

```powershell
node --experimental-strip-types scripts/diagnose.ts --output report.json "D:\\YourScripts"
```

`--markdown` 可以输出 Markdown。命令行不会执行任何被读取的 `.user.js` 源码。导入路径默认不跟随符号链接，单份文件上限 512 KiB。

## 已知开发限制

- Windows EXE 需要在 Windows 实际构建和验收；本源码包**不是安装包**。
- 当前本地沙箱只有 Node.js 22/系统 TypeScript 5.8，无法下载 Electron/React/esbuild/npm 依赖；因此本地执行过的是 Node 原生测试与 TypeScript 语法转译，而非 Windows Electron E2E。
- 原有 Task 1 的 `package-lock.json` 已不匹配新增依赖；本预览使用 `npm install` 重新生成锁文件，稳定发布前必须提交完整锁文件并使用 `npm ci`。
- Chrome 136+ 在默认数据资料目录可能忽略远程调试标志。程序默认不擅自添加 `--user-data-dir`；不成功时报告握手失败，允许用户自主使用兼容 Chrome 配置。
- 未做任何用户账号登录、绕过反自动化机制、对真实网站执行破坏性动作、擅自写入 Tampermonkey 扩展存储。
- 此预览不会修改用户现有 `.user.js` 源文件。试验补丁引擎只生成受控副本，使用前需要独立安全审查。

- Full Windows build is only valid after real Windows CI smoke tests; local Node tests are not that proof.
