# Userscript Self-Healing Manager — V0.1 开发预览源码

**构建状态（2026-10-08）：Alpha.3 是最近已核实完整 Windows CI 成功、三包生成且解压版 EXE 启动的预览版本；Alpha.5 源码已更新但最新 GitHub Actions 仍排队，未通过独立构建。所有版本均未完成 Windows 10 + 真实 Tampermonkey 的 Stable 验收。**

本仓库源码用于开发和测试 Windows 油猴脚本诊断工具。长期完整需求、架构和 Superpowers 实施计划位于 [GitHub 主仓库](https://github.com/devin930906/userscript-self-healing-manager)。

## Windows Alpha 预览版：已验证版本与正在构建的版本
**现在可以下载 Alpha.3 预览包**：打开 [最后已验证的 Windows CI #37771109973](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37771109973)，在 Artifacts 下载 `usshm-windows-three-editions-preview`。**Alpha.5 尚未有经核实通过的 Windows 安装包**；可在 [Windows 构建列表](https://github.com/devin930906/userscript-self-healing-manager/actions/workflows/windows-build.yml) 查到与当前提交一致且成功的运行后下载。
**说明：仅为未签名 Alpha 预览；Windows CI 成功打包不等于在 Windows 10 真实用户桌面启动和真实 Tampermonkey 环境验收通过。**

## 最简下载并使用（不需要自己编译）
1. 打开 [Alpha Windows Builds](https://github.com/devin930906/userscript-self-healing-manager/actions/workflows/windows-build.yml?query=branch%3Afeat%2Fv01-continuation)。
2. 目前选 Alpha.3 已完成的绿色运行 #37771109973 下载；**只有当 Alpha.5 自己的流水线变成绿色 Success，才选择 Alpha.5 工件**。在运行页面底部 Artifacts 下载 `usshm-windows-three-editions-preview`（可能需要 GitHub 登录）。
3. **先解压 GitHub 的外层 Artifacts ZIP**，即可得到 Setup.exe、单文件 Portable.exe 和完整程序 ZIP（还带 SHA256SUMS.txt）。
4. 常规安装：双击 Setup.exe；便携 EXE：放在有读写权限的文件夹后双击；完整 ZIP：先解压为完整程序文件夹，再打开主 EXE。不要只从 ZIP 内直接双击 EXE。
5. **Alpha 版未签名**。验证工件来自本仓库 GitHub Actions 并核对 SHA-256；如 Windows SmartScreen 阻止，应仔细评估来源风险，**不需要关闭系统安全防护**。
6. 启动后先导入自己的测试用 `.user.js` 并运行静态诊断；选择 Chrome 并检查 CDP。Alpha.3 可人工输入替代选择器，预览并审核保存受管副本；**Alpha.5 通过自身 CI 验证后**还可以让程序根据当前网页的稳定 DOM 属性建议替代候选。原文件保持不变。
## 目前可以做什么

- Windows 桌面 UI（Electron + React，中文深色界面；等待 Windows 实机验收）。
- 手动选择或拖入 `.user.js` 文件，或选择包含脚本的文件夹，批量静态分析。
- TypeScript AST 定位 `querySelector`、`querySelectorAll`、`getElementById`、`getElementsByClassName`、`getElementsByName`、`closest`、`matches` 等表达式。
- 记录源行、函数名、备选 locator；动态字符串表达式显示“需要运行时确认”，不会执行源码。
- SQLite 本地脚本索引；每份脚本独立报错；JSON/Markdown 离线报告。
- 用户主动指定 Chrome 可执行路径，用 `--remote-debugging-port=9223`、`--remote-debugging-address=127.0.0.1` 启动；通过 CDP 本机端口 `/json/version` 和 `/json/list` 验证握手。当前 UI **需要人工授权发起 DOM 检查，尚未进行网页业务功能验收**。
- 独立命令行脚本诊断入口（可在有 Node.js 24、npm 安装依赖的系统使用）。
- **DOM 候选修复（Alpha.5 新增）**：用户先选择 Chrome 页面与已扫描脚本，执行只读核验；仅在旧静态定位器零匹配时点击“生成候选定位器”，程序通过受限 DOMSnapshot 的安全属性推选候选，随后再次确认候选在当前网页仅匹配一个元素。用户点击采用候选，再生成预览、明确批准，才会创建受管副本和原件备份。**仅候选和 DOM 匹配，不等于已证明脚本功能正确。**

**尚未实现：** DOM iframe/shadow-root 多上下文故障归因、完全自动且可信的语义修复、真实网页 V3/V4 Tampermonkey 功能验收、GUI 一键回滚、AI Provider、健康监控。现有 Alpha.5 候选仅支持当前 document 中的 `document.querySelector` / `document.getElementById` 静态调用，且需人工确认；候选和只读 DOM 检测还会核对脚本的 `@match` / `@include` 及排除规则，不允许跨站误判。界面中不得把“静态解析完成”称作“脚本已经修复”。

## Windows 10/11 x64：构建三个格式

1. **如果要自行构建**，在 Windows 安装 Node.js 24 LTS 和 npm，克隆/解压完整源码。**普通用户可以直接下载 GitHub Actions 已构建的 EXE，无需安装 Node.js。**
2. 双击项目根目录的 `build-windows.cmd`。脚本执行 `npm install`（GitHub Actions 使用 `npm ci`）、`npm test`、`npm run build`、`npm run dist:win`，并将完整 `win-unpacked` 目录另外打成 ZIP。
3. 构建和测试全部通过时，`release/` 文件夹应包含：

```text
Userscript-Self-Healing-Manager-Setup-0.1.0-alpha.5-win-x64.exe
Userscript-Self-Healing-Manager-Portable-0.1.0-alpha.5-win-x64.exe
Userscript-Self-Healing-Manager-0.1.0-alpha.5-win-x64.zip
SHA256SUMS.txt
```

**上述三种预览包已由 GitHub Windows 构建流水线生成，但目前仍缺少 Windows 10/11 真实桌面程序启动、用户指定便携版 Chrome 以及修复/回滚的端到端验收。** 不得标记为 Stable。不要把未经实测的 Preview 版本发布为 Stable。

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

- Windows 三包已在 GitHub Actions 的 Windows Server 2025 runner 编译，并且 ZIP 解压版主 EXE 已能创建 Data/registry.sqlite；但尚未完成 Windows 10 实机及便携 Chrome 测试。
- 本地沙箱与 Windows CI 环境不同；以 Windows CI 的真实 npm ci、TypeScript、Electron 构建、三形式产物与启动记录为准，仍需 Win10 GUI 端到端实测。
- 原有 Task 1 的 `package-lock.json` 已不匹配新增依赖；已提交完整依赖锁文件（Alpha.5，包含 repair-workflow 工作区），Windows CI 使用 `npm ci`。
- Chrome 136+ 在默认数据资料目录可能忽略远程调试标志。程序默认不擅自添加 `--user-data-dir`；不成功时报告握手失败，允许用户自主使用兼容 Chrome 配置。
- 未做任何用户账号登录、绕过反自动化机制、对真实网站执行破坏性动作、擅自写入 Tampermonkey 扩展存储。
- 此预览不会修改用户现有 `.user.js` 源文件。试验补丁引擎只生成受控副本，使用前需要独立安全审查。

- Windows 打包 startup smoke 已改为**强制门禁**，无法创建 Data/registry.sqlite 即视为当前 CI 失败；测试结果以该 commit 的最新运行记录为准。
