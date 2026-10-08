# Userscript Self-Healing Manager — V0.1 Native 开发中

**项目状态（2026-10-08）**：当前代码已实现离线脚本分析、人工授权的 Chrome CDP DOM 检查、自动候选定位器建议、受控修改副本与历史恢复；尚未达到“全自动自愈 + Tampermonkey 真实功能回归 + Windows 10 实机”的最终验收要求，故 **尚不发布 Stable**。

**执行原则**：用户已授权连续开发，不需要逐任务确认或阶段性预览安装包。开发分支推送仅运行 **Development CI（测试、TypeScript、Electron 编译）**；Windows 三种安装包的构建工作流仅保留手动触发，避免每个开发提交生成预览安装包。直到 Release Gates 满足前，**不自动合并 main、发布 Release 或生成供用户验收的中途预览包**。

- [Native 开发分支](https://github.com/devin930906/userscript-self-healing-manager/tree/feat/v01-continuation)
- [开发 PR #2](https://github.com/devin930906/userscript-self-healing-manager/pull/2)
- [本轮执行/质量证据](docs/development/native-continuation-2026-10-08.md)
- [Superpowers 总体实施计划](docs/superpowers/plans/2026-10-08-phase-1-offline-desktop-implementation.md)
- [Windows 三格式发行合同](docs/distribution/windows-three-editions.md)

## 目前可以做什么

- Windows 桌面 UI（Electron + React，中文深色界面；等待 Windows 实机验收）。
- 手动选择或拖入 `.user.js` 文件，或选择包含脚本的文件夹，批量静态分析。
- TypeScript AST 定位 `querySelector`、`querySelectorAll`、`getElementById`、`getElementsByClassName`、`getElementsByName`、`closest`、`matches` 等表达式。
- 记录源行、函数名、备选 locator；动态字符串表达式显示“需要运行时确认”，不会执行源码。
- SQLite 本地脚本索引；每份脚本独立报错；JSON/Markdown 离线报告。
- 用户主动指定 Chrome 可执行路径，用 `--remote-debugging-port=9223`、`--remote-debugging-address=127.0.0.1` 启动；通过 CDP 本机端口 `/json/version` 和 `/json/list` 验证握手。当前 UI **需要人工授权发起 DOM 检查，尚未进行网页业务功能验收**。
- 独立命令行脚本诊断入口（可在有 Node.js 24、npm 安装依赖的系统使用）。
- **可选只读页面巡检（开发分支新增）**：对选定脚本和 CDP 页面手动点击“启动每分钟只读巡检”，前台程序运行期间大约每分钟检查文档定位器；脚本或页面切换时停止，不运行源代码、不自动保存补丁，匹配节点不等于脚本功能通过。
- **iframe 与 `@noframes` 诊断保护（开发分支）**：从真实 Chrome 的只读 FrameTree 获取有界子 Frame 数量，不读取子网页 URL。一般 userscript 的顶层 DOM 缺失在存在 iframe 时改标「需要复核」，避免虚假的故障或范围外结论；对明文声明 `@noframes` 的脚本仍可作出顶层诊断。**尚未提供 iframe/ShadowRoot 内自动定位与修复**。
- **真实 Electron GUI 自动启动门禁（开发分支）**：Windows Development CI 除单测、TypeScript 与 Electron 编译之外，还会在一次性 Data 目录实际启动 Electron，核实 `registry.sqlite` 和 React renderer 均加载成功；不制作任何中途安装包。这不是指定 Windows 10 实机或三种发行包验收。
- **跨扫描版本隔离与授权过期保护（开发分支）**：每次成功静态扫描具有独立随机 `scanId`；批量 CDP、逐脚本定位器检查、候选、补丁预览、受管历史、导出和回滚必须绑定原扫描，异步跨页返回还会重新校验扫描版本。修复预览只能在创建它的扫描中经批准应用一次；重新扫描会同时撤销未用批准和底层暂存提案，避免旧扫描错操作新脚本及长期堆积预览。这不等于自动判断 Tampermonkey 脚本已恢复功能。
- **同网页批量只读诊断（开发分支）**：选择已导入脚本和 Chrome CDP 网页后，点击「批量网页诊断（只读）」，按 25 份一批自动处理当前所有已扫描脚本；显示进度、支持取消剩余批次，并逐脚本区分 `DOM 有匹配 / 选择器缺失 / 范围外 / 需复核 / 跳过 / 失败`。每份脚本独立失败，网页导航或身份不一致时拒绝继续使用证据。受限于每份脚本最多 50 个定位器、只检查顶层 document，仍非 Tampermonkey 行为验收。
- **安全匹配规则（开发分支）**：`@match/@include/@exclude/@exclude-match` 使用受限、线性时间通配符匹配，不把脚本来源的任意 glob 编译成高风险正则；超长或不受支持的主机模式 fail closed。
- **受管脚本安全导出（开发分支）**：成功保存修订后或打开受管历史后，可点击「安全导出 .user.js」，通过系统原生保存对话框把经过 SHA-256 归档验证的 `current.user.js` 导出为新文件；不覆盖已有输出、不覆盖原始脚本，不自动写入 Tampermonkey。支持 Windows 符号链接与外部改动拒绝策略；真实扩展内运行验证尚未完成。
- **候选参数类型校验与修复扩展（开发分支）**：对 `getElementById`、`getElementsByName`、`getElementsByClassName` 建议原始参数（ID、name、空格分隔的 class），而不是容易导致错误的 CSS 选择器；受管字节补丁支持以上方法。当前 GUI 会根据所选方法显示正确的输入提示；候选须唯一匹配且经过当前页面的真实 CDP 复核。
- **桌面端连续修复哈希保护（开发分支）**：修复了 GUI 在第二次补丁时误把活动受管副本的 `baseHash` 和原始文件哈希比较而拒绝合法累积修订的问题；原始扫描哈希单独验证。先前生成而已经过期的修复预览会拒绝应用，避免覆盖刚批准的修订。
- **防伪造元数据头（开发分支）**：仅在脚本开头的注释前缀识别 `==UserScript==`，拒绝 JavaScript 正文中的伪装元数据；元数据区内部空行仍能正确读取后续 `@match` 规则。
- **连续累积修复多个选择器（开发分支）**：第二次及后续人工批准的补丁基于已验证归档的最新受管 `current.user.js`，保留之前修复，不会重新从原始源文件覆盖历史；原件/每次修订独立 SHA-256 归档，可手动恢复。受管文件被外部修改或原件哈希变更时拒绝继续。
- **自定义便携 Chrome 路径记忆（开发分支）**：用户通过系统对话框选择 Chrome EXE 后，安全保存到本地 Data 设置，软件重启后自动回填路径（**不是**自动运行浏览器）；EXE 丢失、配置损坏、符号链接及无法执行的文件均受保护。
- **一键批量生成修复候选（开发分支）**：基于当前选定页面对最多前 50 个静态定位器查找缺失项；按每次最多 8 处生成 DOM 唯一匹配的修复候选，支持“继续下一组修复候选”直至覆盖剩余候选。遇到切换页面、脚本或证据数量变化会丢弃失效结果。候选不会自动执行脚本或写入补丁，须再进入预览与明确批准流程。
- **损坏脚本编码识别（开发分支）**：遇无效 UTF-8 源文件直接标记解析错误，避免把不可安全解释的脚本误判为正常静态解析成功。
- **自动化合成脚本行为回归（仅 CI）**：Windows GitHub Actions 会启动隔离 Chrome 和本地 `127.0.0.1` 测试网页，实际执行本项目自带的合成测试脚本，核验修复前失败、仅修复一处仍失败、连续修复两处后生效、恢复原版再次失败的完整效果闭环。该执行模块只在 `scripts/` 测试工具中使用，**不会运行用户脚本，也没有向 Electron 正式界面暴露 JavaScript/CDP Runtime.evaluate 执行入口**。此回归不是 Tampermonkey 插件、GM_* 或用户真实网站的功能认证。
- **DOM 候选修复（Alpha.5 新增）**：用户先选择 Chrome 页面与已扫描脚本，执行只读核验；仅在旧静态定位器零匹配时点击“生成候选定位器”，程序通过受限 DOMSnapshot 的安全属性推选候选，随后再次确认候选在当前网页仅匹配一个元素。用户点击采用候选，再生成预览、明确批准，才会创建受管副本和原件备份。**仅候选和 DOM 匹配，不等于已证明脚本功能正确。**

**尚未实现：** Tampermonkey 真正注入/GM_* 与 V3/V4 功能回归、DOM iframe/shadow-root 多上下文故障归因、完全自动且可信的语义修复、真实网页 V3/V4 Tampermonkey 功能验收、AI Provider、持久后台健康监控与 Windows 10 真实设备端到端验收。当前开发分支的候选定位器仅支持当前 document 中的 `document.querySelector`、`document.getElementById`、`document.getElementsByName` 和 `document.getElementsByClassName` 静态调用，且需人工确认；候选和只读 DOM 检测还会核对脚本的 `@match` / `@include` 及排除规则，不允许跨站误判。界面中不得把“静态解析完成”称作“脚本已经修复”。

## Windows 10/11 x64：构建三个格式

1. **仅用于开发者在 Windows 自行构建或最终发行验证**：安装 Node.js 24 LTS 和 npm，克隆/解压完整源码。正式发布后，最终用户无需单独安装 Node.js。
2. 双击项目根目录的 `build-windows.cmd`。脚本执行 `npm install`（GitHub Actions 使用 `npm ci`）、`npm test`、`npm run build`、`npm run dist:win`，并将完整 `win-unpacked` 目录另外打成 ZIP。
3. 构建和测试全部通过时，`release/` 文件夹应包含：

```text
Userscript-Self-Healing-Manager-Setup-0.1.0-alpha.5-win-x64.exe
Userscript-Self-Healing-Manager-Portable-0.1.0-alpha.5-win-x64.exe
Userscript-Self-Healing-Manager-0.1.0-alpha.5-win-x64.zip
SHA256SUMS.txt
```

**三种发行目标在历史 CI 中均曾通过打包及启动冒烟验证，但本轮持续开发阶段不会逐提交构建预览安装包。** 只有最终 Release Gate 满足后才开始准备正式交付。

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
- Chrome 136+ 可能忽略默认资料目录的远程调试开关。程序默认**不**添加 `--user-data-dir`；只有用户主动点击“启动隔离调试 Chrome”后，才会使用本软件 Data/Chrome-CDP-Profile 的独立资料目录。不会复制原来的登录信息或 Tampermonkey 扩展，需用户自行配置隔离环境。
- 未做任何用户账号登录、绕过反自动化机制、对真实网站执行破坏性动作、擅自写入 Tampermonkey 扩展存储。
- 此预览不会修改用户现有 `.user.js` 源文件。试验补丁引擎只生成受控副本，使用前需要独立安全审查。

- Windows 打包 startup smoke 已改为**强制门禁**，无法创建 Data/registry.sqlite 即视为当前 CI 失败；测试结果以该 commit 的最新运行记录为准。
