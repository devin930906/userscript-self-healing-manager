# Userscript Self-Healing Manager — V0.1 Native 开发中

**项目状态（2026-10-09）**：当前代码已实现离线脚本分析、人工授权的 Chrome CDP DOM 检查、自动候选定位器建议、受控修改副本与历史恢复；尚未达到“全自动自愈 + Tampermonkey 真实功能回归 + Windows 10 实机”的最终验收要求，故 **尚不发布 Stable**。

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
- **异步请求竞争保护（开发分支）**：批量诊断、单脚本 DOM 核验与批量候选使用互不干扰的请求代号；切换目标、脚本或扫描时，旧请求的结果、错误与结束回调不会覆盖新版任务的状态。
- **同时操作与多开安全保护（开发分支）**：新扫描开始期间立即暂停旧扫描授权，失败则恢复最近成功快照；同脚本并发修复批准具有互斥写入锁；Electron 的单实例锁防止两个主进程同时写同一个 SQLite/受管修订目录。真实 Windows CI 已覆盖第二次启动自动退出、第一实例保持工作。**这只防护同一桌面应用实例内的写入，并不替代跨设备的文件同步锁。**
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

- **受管修订与恢复统一互斥（2026-10-09）**：同一脚本的补丁批准与受管历史恢复共享单一脚本级写锁。恢复不能插入补丁归档与激活过程；操作冲突时明确拒绝，不覆盖原 `.user.js`，受管历史 SHA-256 继续保留。
- **Chrome 页面重载证据失效保护（2026-10-09）**：通过只读 `Page.getFrameTree` 校验顶层 Frame ID 与 Loader ID。无法确认 Loader ID 时拒绝使用 DOM 证据；即使网址未变化，页面重新加载后也会拒绝过期候选。25 份/批分页诊断携带哈希化的文档身份指纹，跨批次不混合不同生命周期的 DOM 结果。
- **本轮自动验证（2026-10-09）**：Windows Development CI [#37888753132](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37888753132) 完成 **225/225 tests PASS、TypeScript、Electron build、真实 GUI/SQLite smoke、Chrome CDP + 合成行为冒烟测试 PASS**。**这仍然不等于真实 Tampermonkey GM_* / V3 / V4 功能通过，也不构成最终 Stable 的发行验收。**

- **Shadow DOM 只读上下文识别（本轮新增）**：Chrome CDP `DOMSnapshot.captureSnapshot` 仅返回有限数量的节点统计，识别作者的 open/closed Shadow Tree 节点并忽略普通浏览器自身的 user-agent Shadow DOM；单脚本 UI、60 秒巡检和批量诊断会将不可信的顶层 `document` 缺失判定降级为「需复核」。`@noframes` 只限制 iframe 运行，不代表可以排除顶层 ShadowRoot。该能力**仅识别上下文风险，不进入 ShadowRoot 执行定位器，也不代表自动修复 Shadow DOM 内脚本**。

- **V0–V4 验证等级防误报（开发分支）**：JSON 静态报告升级为 `schemaVersion: 2`，逐脚本明确 `V0–V4` 状态。仅 AST 解析通过最高为 V0；真实只读 CDP 定位器检查符合强制计数条件时最高为 V1。V2 仍为 `blocked`，V3、V4 在尚无安全功能契约和真实 Tampermonkey 验证前为 `not-configured`；界面批量诊断也会显示对应等级。没有证明脚本已经运行或恢复业务功能。

- **批量诊断暂停／继续（开发分支新增）**：在每批 25 份脚本的只读检查之间可点击「暂停后续检查」或「继续检查」，暂停不会截断已发出的 CDP 请求。取消会解除等待并终止未来批次；切换网页或重扫立即撤销旧请求令牌。快速「继续→再次暂停」已加入竞争回归，仍按页面 Frame/Loader 与扫描版本保护结果。该功能不代表后台常驻任务队列、跨重启恢复或业务功能修复。

- **批量 DOM 结果脱敏导出（开发分支）**：完成每批诊断结果的 JSON／Markdown 导出，包含逐脚本状态、检查计数和证据分级。**仅 Electron 主进程**可缓存可信 CDP 诊断批次；预加载与 UI 只传 `scanId`、`targetId` 和格式，不能提交自行编造的 `report` 或 V0–V4 等级。严格核对 25 项分页顺序、Frame/Loader 文档身份指纹与脚本身份；新的扫描及失败批次会撤销对应证据，保存对话框返回后再核对单调证据版本，拒绝已过期结果。导出报告只保留网页 origin 与文件名，过滤 URL 查询/哈希、私有目录、原始 DOM 文字、异常原文和内部 CDP 文档指纹；不把 V1 DOM 匹配夸大为 V3/V4 功能验证。已另行实现脱敏 SQLite 诊断历史及有限站点计数趋势；尚未实现跨重启自动恢复、持续后台监控或真实脚本功能证明。

- **命名只读 DOM 合约（2026-10-09）**：针对当前授权站点与已扫描的静态定位器，支持双次采样验证“至少一个匹配”或“恰好一个匹配”；有页面重新加载则拒绝过期证据。若 iframe、ShadowRoot 可能隐藏顶层定位器或该上下文证据不可用，零匹配只标「需复核」。此合约最高仅为 **V1**，不是 V3 业务功能通过。
- **Chrome CSS/盒模型只读检查（2026-10-09）**：选定静态定位器后可查看是否可能可见、隐藏、缺失或多重匹配，以及 pointer-events 的只读状态。由可信 Electron main 验证当前脚本来源、站点范围与 Chrome Frame/Loader，再使用 DOM/CSS CDP 指令，不执行网页 JavaScript、不触发点击、滚动或表单。元素“可能可见”**并非 V2 可交互性通过**。
- **本地诊断历史与站点趋势（2026-10-09）**：新增独立的 `Data/diagnosis-journal.sqlite`，仅保存网站 origin、批次计数、状态和 V0/V1 记录。程序重启自动将未完成任务标记中断，不假装自动继续。历史界面支持同一站点最近两个完整、相同脚本数量的批次对比，显示 DOM 缺失数量变化或“不可比较”，不等于网站变更或自愈成功。

- **CDP 定位器证据防伪造／过载保护（2026-10-09）**：`DOM.querySelectorAll` 读取现在对每条 WebSocket JSON 回复实施字节预算、对每个定位器最多接受 10,000 个有效唯一正整数节点 ID，拒绝负数、浮点数、重复 ID、伪造的节点列表及重复文档根响应。CDP 证据不可信时直接失败，不把假数据升级为 V1。
- **只读 CSS 检查的嵌套 DOM 防误报（2026-10-09）**：当顶层元素缺失，Electron 主进程额外取得有限 DOMSnapshot 并再次核对 Frame/Loader 身份；若存在 iframe、作者 ShadowRoot，或快照失败/身份不符，就显示 `unknown` 而不是断言 `missing`。无 DOM 修改、无任意 JS 执行、无 V2/V3/V4 声称。真实 Windows Chrome ShadowRoot fixture 已加入自动回归。
- **最新已验证开发 CI（2026-10-09）**：[Windows Development CI #37904827283](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37904827283)：**316/316 tests、TypeScript、Electron build、Windows GUI+SQLite smoke、真实 Chrome CDP + ShadowRoot 测试 PASS**；[Node contracts #37904827267](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37904827267) PASS。仍不是最终 Stable，未制作中途安装包。

- **Chrome CDP 发现入口限制（2026-10-09）**：`/json/version` 和 `/json/list` 改为有字节预算的流式 JSON 读取（分别 64 KiB 与 1,000,000 bytes），最多接受 256 个页面条目，并限制浏览器标识、标签页 ID 与 URL 长度；畸形或过大的本机调试端点不会直接进入 DOM 检查。TDD RED [#37905313665](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37905313665)，GREEN [Windows CI #37905377547](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37905377547)：**317/317 tests，TypeScript、Electron/Windows GUI/SQLite、真实 Chrome CDP smoke PASS**，无中途安装包。

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
- 当前开发版不会修改用户现有 `.user.js` 源文件。试验补丁引擎只生成受控副本，使用前需要独立安全审查。

- Windows 打包 startup smoke 已改为**强制门禁**，无法创建 Data/registry.sqlite 即视为当前 CI 失败；测试结果以该 commit 的最新运行记录为准。
