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
- **隔离安全交互测试（仅 CI，非正式 V2 通过）**：新增固定 `127.0.0.1:<port>/fixture` 网页的真 Chrome CDP 按钮点击验证，检查本地合成按钮的实际事件副作用；严格限制目标 URL、脚本执行上下文及 CDP 指令，绝不向生产 Electron 开放鼠标点击接口，不操作真实用户网页，也不能证明任何用户油猴脚本在 V2/V3/V4 已通过。正式界面继续保持 `V2=blocked`。
- **自动化合成脚本行为回归（仅 CI）**：Windows GitHub Actions 会启动隔离 Chrome 和本地 `127.0.0.1` 测试网页，实际执行本项目自带的合成测试脚本，核验修复前失败、仅修复一处仍失败、连续修复两处后生效、恢复原版再次失败的完整效果闭环。该执行模块只在 `scripts/` 测试工具中使用，**不会运行用户脚本，也没有向 Electron 正式界面暴露 JavaScript/CDP Runtime.evaluate 执行入口**。此回归不是 Tampermonkey 插件、GM_* 或用户真实网站的功能认证。
- **DOM 候选修复（Alpha.5 新增）**：用户先选择 Chrome 页面与已扫描脚本，执行只读核验；仅在旧静态定位器零匹配时点击“生成候选定位器”，程序通过受限 DOMSnapshot 的安全属性推选候选，随后再次确认候选在当前网页仅匹配一个元素。用户点击采用候选，再生成预览、明确批准，才会创建受管副本和原件备份。**仅候选和 DOM 匹配，不等于已证明脚本功能正确。**

- **可选受管修订 V1 安全保存／自动回滚（2026-10-09）**：用户单独批准后，可选择「保存并自动 V1 复核，失败恢复上一修订」；由可信 Electron 主进程读取暂存补丁的真实前一版 SHA-256 和改动选择器，保存到受管 Data 后对 Chrome 当前页面进行两次只读 DOM 采样。只有 V1 证据严格成立才保留活动修订；失败、证据不明或 Chrome 断开时自动尝试恢复上一个 SHA-256 归档。自动恢复前还须检查活动文件仍是本次修订，另一份合法新修订或外部编辑存在时返回 `rollback-blocked`，绝不覆盖。原始 `.user.js` 不会修改，**V1 通过并不证明油猴脚本真实执行、业务功能 V3 或 Tampermonkey GM_* V4**。
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

- **Chrome 启动真正 CDP 握手（2026-10-09）**：程序在启动前探测 localhost 调试端口是否已被占用，不会将其他正在运行的浏览器误作新启动的实例。只有 Chrome 进程成功启动、`/json/version` 与 `/json/list` 可读取、Browser WebSocket 路径合法且真实返回只读 `Browser.getVersion` CDP 命令（与 HTTP Browser 身份一致），启动界面才显示握手已验证；最长等待 15 秒，提前退出、端口占用、版本不匹配、调试未就绪均明确失败。GUI 文案同步修正，真实 Chrome CI 覆盖 CDP 应答与已有端口拒绝。TDD RED [#37906278078](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37906278078)、[#37907033294](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37907033294)，最新 GREEN [Windows CI #37907262155](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37907262155) **324/324 PASS**；[Node contracts #37907262101](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37907262101) PASS。**本机 Windows10 + 指定便携 Chrome155 仍未验证，也未制作中途安装包。**

- **SiteAdapter 版本化兼容层核心（2026-10-09）**：新增 `packages/candidate-engine/src/site-adapter.ts`，严格解析本地版本化站点作用域、语义角色、页面状态、顶层／嵌套上下文、受限静态 CSS 策略、基数断言及回归测试用例；只返回定义级候选，不自动执行页面脚本或宣称 V2/V3/V4。新增共享角色升级影响分析：列出被变更角色影响的固定版本依赖脚本及其必跑回归用例，删除被引用角色时明确阻断自动启用。`suggestAdapterScopedRepairs` 只有在作用域／上下文获准后才调用现有两阶段 DOM 建议引擎，并将候选严格限制在本地角色定义的选择器内。未接入完整 GUI 编辑／加载、未运行真正 SiteAdapter 功能合约；FR-033/034 仍属于**部分完成**。TDD RED [#37908035768](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37908035768)、[#37908611305](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37908611305)，GREEN [Windows CI #37908657021](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37908657021) **332/332 tests PASS**；[Node Contracts #37908657118](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37908657118) SUCCESS。没有生成预览安装包。

- **SiteAdapter 桌面管理／可信本地导入（2026-10-09）**：Electron 主进程新增独立的 SiteAdapter 原生 JSON 文件选择器，预览、单独批准、取消预览、已存规则列表的固定 IPC；preload 不向 renderer 公开文件读取/写入或任意规则内容注入。新增 `site-adapter-library.ts`，对导入 JSON 做 64 KiB 限流、非 symlink 普通文件检查、UTF-8/Schema 解析、原文件 SHA-256 再验证和不可覆盖的 `Data/site-adapters/{siteId}.json` 持久保存；取消预览立即释放主进程临时令牌，最多暂存十个。GUI 只显示已解析站点、版本、角色数、页面状态和源文件摘要，**不自动加载到 userscript、不会升级站点规则，也不宣称 GM_* 或 V3/V4 已验证**。已有 siteId 不允许绕过依赖影响审查而覆盖。TDD RED [#37909418536](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37909418536)、[#37909620308](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37909620308)、[#37910164611](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37910164611)，GREEN [Windows CI #37910328861](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37910328861) **342/342 PASS**、[Node Contracts #37910328893](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37910328893) SUCCESS。不制作中途预览安装包。

- **SiteAdapter 已保存角色的真实只读 DOM 核验（2026-10-09）**：原先 SiteAdapter 只可导入、保存、展示和做内存级候选约束。本轮新增 `packages/test-runner/src/site-adapter-role.ts`，通过用户主动授权、已保存的 siteId/roleId、指定 CDP 页面及**手动声明但未验证**的页面状态，对允许的顶层非 Shadow DOM 的 CSS fallback 执行两次有界 CDP DOM 检查。前后核验 Frame/Loader，采样不一致、多条后备策略同时命中、未知作用域/iframe/ShadowRoot、不可靠证据均阻断 V1 匹配判定；绝不升级至 V2/V3/V4，也不写原始用户脚本。对应 Electron 主进程固定 IPC、preload 与 GUI 选择控件均已接通；`site-adapter-library.ts` 通过严格验证的 siteId 返回角色与状态元数据，防止 renderer 提供任意文件路径或规则正文。真实 Windows Chrome 受控 fixture 直接验证角色匹配和 ShadowRoot 防误判。TDD RED [#37911119660](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37911119660)、[#37911333463](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37911333463)，GREEN [Windows CI #37911811189](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37911811189) **349/349 PASS**；[Node Contracts #37911811075](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37911811075) SUCCESS。尚未验证 Tampermonkey/GM_*，没有中途安装包。

- **SiteAdapter 检查版本锁定与文件描述符安全读取（2026-10-09）**：在用户导入规则、浏览角色并启动真实 CDP 核验之间，其他程序可能修改 `Data/site-adapters` 内的 JSON；此前 `getForInspection` 只按 siteId 重读最新版，存在审查版本与实际执行版本不一致的风险。当前桌面 preload/UI/main 改为强制传递界面上该规则的 **SHA-256**，主进程重读并验证哈希，若文件变化或用户未提供有效哈希立即拒绝，不接受在不同内容上继续核验。规则源文件读取改为打开单个文件描述符，在支持平台使用 `O_NOFOLLOW`，读取前后核对 `fstat/lstat` 身份、大小、修改时间，按 64 KiB 预算有界读取，避免路径二次打开导致的竞态与无限制读入。测试从 349 增至 **352/352 PASS**；TDD RED [#37912627498](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37912627498)，GREEN [Windows Development CI #37912842330](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37912842330)、[Node Contracts #37912842249](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37912842249)。这只增强本地规则完整性，不代表 Tampermonkey V3/V4 已通过。

- **SiteAdapter 动态 DOM 节点替换防误判（2026-10-09）**：此前两次 V1 DOM 采样只比较 CSS 定位器匹配数量，两个不同节点也可能先后命中 1 次而被误认为稳定匹配。新增 opt-in CDP `DOM.describeNode` 只读身份探测，只有 SiteAdapter 语义角色 V1 验收会启用；检查获得的 `backendNodeId` 通过**进程内随机密钥 HMAC-SHA256** 转为 64 位十六进制指纹，只返回指纹、绝不暴露后台原始 ID 或 DOM 文本。两次采样必须**数量及指纹相同**，否则返回 `needs-review`，绝不暗示 V2/V3/V4 业务/扩展验证通过；摘要无效、节点更换同计数、CDP 拒绝 `DOM.describeNode` 均 fail closed。真实 Windows Chrome 隔离 fixture 已使用新探测路径。TDD RED [#37913723198](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37913723198)，GREEN [Windows CI #37914295063](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37914295063) **357/357 PASS**、[Node Contracts #37914295046](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37914295046) SUCCESS。依旧不制作中途安装包。

- **SiteAdapter 升级范围／回归契约防漏报 + 多节点 V1 防误判（2026-10-09）**：以前 `assessSiteAdapterUpgrade` 只比较角色定位器/关联状态，`urlPatterns` 或 `validationCases` 单独改变时可能报告 `unchanged`，漏列仍锁定旧版的依赖脚本。现新增 `changedScope`、作用域新增/删除明细、`changedValidationCases`、验证用例新增/删除明细，忽略数组排序差异；任何作用域/用例变化会将所有锁定旧版本的依赖脚本列为受影响对象并收集其回归项，删除仍被使用的作用域返回 `blocked-scope`，删除原验证用例返回 `blocked-validation`，历史验证用例保留在回归集合，`autoActivateAllowed:false` 始终有效。另一项 V1 安全修复：先前 `matched-v1` 在角色允许多元素匹配时可能仅因两次数量相同而通过；目前 backend ID 指纹仅覆盖**唯一节点**，因此多节点数量（2+）统一标为 `needs-review`，没有逐节点身份验证前不宣称 V1 稳定。真实隔离 Chrome 测试加入两个匹配节点并验证此限制。TDD RED [作用域回归 #37915124918](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37915124918)、[多节点 #37915446163](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37915446163)；GREEN [Windows CI #37915553011](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37915553011) **362 / 362 PASS**、[Node Contracts #37915553042](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37915553042) SUCCESS。未生成安装包，仍非 V3/V4 或正式 Stable。

- **SiteAdapter 多元素角色的有界身份集合 V1 核验（2026-10-09）**：原先两个或多个 CSS 匹配节点，即便都是稳定节点，仍因缺少完整身份而保守阻断 `matched-v1`。现在 `probePageLocators` 在显式 `includeNodeFingerprints:true` 模式下，最多对**每条定位器 10 个节点、整批 100 个节点**调用只读 `DOM.describeNode`，使用进程级 HMAC-SHA256 形成去重、排序后的身份指纹集合，不返回后台节点 ID 或网页文本。SiteAdapter 两次采样必须同时匹配节点数量与完整身份集合：顺序变化不会误判替换，丢失/重复/非法身份或超出预算仍标 `needs-review`。原有单节点契约继续生效；默认通用 locator 探测不启用身份采集。真实 Windows Chrome 本机隔离网页的两个按钮现可按严格证据得到 `matched-v1`，**V3/V4 仍未配置，绝不把它算作油猴功能通过**。TDD RED [Node Contracts #37916402106](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37916402106)，修复中严格 TS 检查发现并解决可选属性错误；GREEN [Windows CI #37916711853](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37916711853) **368/368 PASS**、[Node Contracts #37916711997](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37916711997) SUCCESS。仍不生成中途安装包。

- **受限开放式 ShadowRoot 的 SiteAdapter V1 只读角色核验（2026-10-09）**：先前角色解析只允许顶层 document 的静态 CSS，`frame:'top',shadow:'open'` 总被阻断。现在针对**顶层页面、作用域明确、且 CDP 的有界 DOM 树中恰好一个可识别的开放式 ShadowRoot**，通过 `DOM.getDocument(depth:-1,pierce:true)` 发现并仅向该 open-root 的 nodeId 执行 `DOM.querySelectorAll` 和经 HMAC 处理的 `DOM.describeNode`；绝不调用 `Runtime.evaluate`、点击或油猴扩展 API。类型/树形错误、超限、多开放根或无开放根都返回未验证，不退回顶层 document；同一状态混用 document/shadow 或 iframe 不明上下文也不自动猜测。其它 closed/user-agent 根不用于查询。SiteAdapter 双采样继续强制页面主 frame+loader 稳定、唯一或多节点完整身份集合一致；找不到 shadow 元素时仍保守 `needs-review`。通用顶层 DOM 候选推荐被禁止将候选误归给 shadow-only 角色。真实 Windows Chrome fixture 对指定 `shadow:'open'` 的角色进行了正向核验。TDD RED [#37917592595](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37917592595)，GREEN [Windows CI #37918226220](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37918226220) **377/377 PASS**、[Node Contracts #37918226211](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37918226211) SUCCESS。此能力**不支持多个 open ShadowRoots、iframe 内定位、闭合式 ShadowRoot 或 V3/V4 运行时证明**；不生成中途安装包。

- **SiteAdapter 已审查语义角色限定的真实修复候选桌面流程（2026-10-09）**：此前 `suggestAdapterScopedRepairs` 只存在于 candidate-engine 单元模块，桌面不能将所选 SiteAdapter 角色绑定到真实已扫描脚本的缺失定位器。现在增加受限 `usshm:site-adapter-suggest-repair` IPC：必须显式同意，传入已存在的扫描代次、脚本/定位器索引、选定 Chrome 目标、持久规则站点/角色/用户声明状态和 UI 已展示的 **SHA-256**。Electron main 自行从已授权扫描中解析脚本，验证 `withinAuthorized`、source selector 为静态 document 作用域、userscript @match/@include 许可、规则哈希及真实 Chrome 页面身份，前后比较 frame/loader，再用真实 DOM probe + 安全节点 snapshot 从角色中允许的策略集合筛选候选；禁止任意 renderer CSS 与路径，绝不自动应用或改动原件。候选直接显示在 SiteAdapter 面板，用户主动选择后仅填入原有独立修复预览控件，后续受管副本仍独立批准。ShadowRoot 的 selector 不允许被普通顶层 DOM 候选证据误认。真实 Windows Chrome fixture 已验证唯一 SiteAdapter role 策略筛选以及 ShadowRoot 不越界。TDD RED [Node Contracts #37919247987](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37919247987)；源码 GREEN [Windows CI #37919454107](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37919454107) **378/378 PASS**、[Node Contracts #37919454109](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37919454109) SUCCESS。此为受控 DOM 候选，不代表 V2/V3/V4 或 Tampermonkey/GM_* 自动修复成功。

- **SiteAdapter 同源单 iframe 的受限 V1 只读核验（2026-10-09）**：此前 `frame:'iframe'` 已被 schema 允许，但语义角色解析及桌面角色检查只能处理顶层 document 或单一 open ShadowRoot。现在在严格条件下支持**恰好一个同源子 frame 且其内容嵌入在同进程 CDP `contentDocument` 的情况**，拒绝跨域、多 iframe、OOPIF 与无完整子文档证据的目标。使用只读 `Page.getFrameTree` 将子 frameId/loaderId 锁定在两次定位探测前后，并对主 frame/loader + 子 frame/loader 的变化统一阻断；不会向 UI 输出 iframe URL。使用 `DOM.getDocument(depth:-1,pierce:true)` 在有界 DOM 树中找到**与已验证 frameId 相同的唯一 IFRAME contentDocument**，只针对该根执行 `DOM.querySelectorAll`，并复用 HMAC-SHA256 多元素节点指纹校验。新专用 probe 已接入 Electron 主进程，SiteAdapter 的非 document 角色不会借用顶层 DOM 的自动修复候选。隔离真实 Windows Chrome fixture 新增真实同源子页面，确认为 `matched-v1`、而非 V3/V4 功能 pass；存在 iframe 时顶层 DOM 缺失或顶层 scope 不符都依旧是 `needs-review`，不冒充全页面否定证据。TDD RED [Node Contracts #37920640685](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37920640685)，GREEN [Windows CI #37921447467](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37921447467) **388/388 PASS**、[Node Contracts #37921447479](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37921447479) SUCCESS。未完成 Tampermonkey/GM_* V4、V3 业务验证、Windows10+便携 Chrome155 等 Stable 门禁。

- **只读 CSS/DOM 控件禁用属性证据（2026-10-09）**：此前 V1 可见性检查可显示 `potentially-visible`，但无法识别一个实际按钮已被 `disabled`、`aria-disabled="true"` 或 `readonly` 限制，容易被误读为可以操作。现于现有明确授权、脚本 @match 与 Frame/Loader 校验的桌面检查后，CDP 的**唯一节点**按 `DOM.getDocument → DOM.querySelectorAll → DOM.getAttributes → CSS.enable → CSS.getComputedStyleForNode → DOM.getBoxModel` 采样，仅读取/有限验证直接元素属性（上限 256 个条目、字段长度限制），输出 `disabled-attribute`、`aria-disabled`、`readonly-attribute`、`none-detected` 或 `unknown`。原始 DOM 属性值、页面私密信息均不传入 GUI；读取被拒绝、属性数组格式损坏、重复属性或预算超限时不猜测 `enabled`。renderer 同时显示 CSS 可见性与独立控件限制证据，并强调未发现属性不等于可点击。真实 Windows Chrome fixture 增加本机测试专用 disabled/aria-disabled/readonly 控件，证实 CDP 读取与界面证据契约。没有 `Runtime.evaluate`、Input 点击、脚本执行、文件写入，不把该静态信息宣称为 V2 成功：`interactionVerified:false,V2:'blocked',V3/V4:'not-configured'`。TDD RED [Node Contracts #37922233230](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37922233230)；首版修正时变量作用域错误使 Node Contracts 失败，已按失败日志修复；GREEN [Windows Development CI #37922572400](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37922572400) **393/393 PASS**、[Node Contracts #37922572430](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37922572430) SUCCESS。仍非 Stable。

- **通用 V1 `unique` 节点身份防误判（2026-10-09）**：通用 `runReadOnlyDomContract` 此前只对 `unique` 作两次计数 `1→1`，可把两个不同 DOM 节点误判为稳定。现在只在 `unique` 且匹配 1 个节点时要求两次 CDP `DOM.describeNode` 经进程内 HMAC-SHA256 产生的相同合法 64 字符身份指纹；缺失、非法、变化均 `needs-review`，不虚报 `passed`。明确区分 `exists` 是数量/存在性检查，并不保证节点连续性。Electron 主进程实际 IPC 与真实 Windows Chrome fixture 已 opt-in 指纹；V2/V3/V4 不升级。TDD RED [Node Contracts #37923341768](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37923341768)。
- **Windows 三种发行目标与 ZIP 内容校验基础设施（2026-10-09）**：构建文件过去只包含 `nsis` 与 `portable` 两个 x64 目标；按 [electron-builder v26 Windows](https://www.electron.build/v26/docs/win/) 已确认的 `zip` target 增补完整解压目录 ZIP，CLI `dist:win` 一并声明 `nsis portable zip`，不再只有两版。`scripts/windows-release-gate.mjs` 新增明确的**正式发行阶段**门禁：核对同版本 Setup.exe、Portable.exe、完整 ZIP 三文件唯一性，并审查 ZIP 资源、locales、DLL、pak、路径穿越、私有 Data/油猴脚本/疑似密钥；实际发行运行时还检查基本 EXE/ZIP 文件签名和 SHA-256，并仅在三版齐全后生成 `SHA256SUMS.txt`。本轮只运行**无产物的纯逻辑测试**，绝不执行 `dist:win` 或生成预览安装包。TDD RED [三目标 #37923833051](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37923833051)、[发行内容 #37924199271](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37924199271)；GREEN [Windows Development CI #37924341040](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37924341040) **404/404 PASS**、[Node Contracts #37924340999](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37924340999) SUCCESS。**这还不是三包真实构建、签名、解压启动、Windows10/11 的发行验收，更不是 Stable。**

- **受管脚本/存档固定句柄读取加固（2026-10-09）**：原始脚本、已修复 `current.user.js`、不可变存档与补丁写入校验此前多处使用 `lstat(path)` 后直接 `readFile(path)`，留有路径被外部程序替换的竞态窗口。新增跨平台 `readPinnedRegularFile`：验证普通文件和大小（不超过 512 KiB）、在受控只读文件句柄上获取 stats，再次确认目标与用户审查时的文件身份一致，并在读取后检查句柄及路径状态；支持平台时开启 `O_NOFOLLOW`，超限/符号链接/路径切换统一拒绝。该功能已接入 `repair-workflow` 的 propose/apply、`history` 的 archive/current 读取和 `patch-engine` 的源文件/受管档案校验。新增正常读取、符号链接、同大小被替换、硬链接替换、目录和大小上限等 5 组测试。Windows CI 揭示 Node 在 Windows 的 inode 可能为 0 或非安全整数，因此 Windows 专用模式依据受控文件句柄 + 创建/修改时间、文件模式、大小和前后路径检查，不声称原生 Win32 文件 ID 强保证，仍属于后续 RG-06 安全审计重点。TDD RED [Node Contracts #37925179695](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37925179695)，两次 Windows 兼容回归失败已保留记录，最终源码 GREEN [Windows Development CI #37926018537](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37926018537) **409/409 PASS**、[Node Contracts #37926018531](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37926018531) SUCCESS。未生成中途安装包，仍未通过完整 Stable 门禁。

- **用户脚本导出同样采用固定句柄读取（2026-10-09）**：审计发现 `packages/repair-workflow/src/export.ts` 的已验证受管版本导出此前仍有 `lstat(currentPath) → readFile(currentPath)` 路径替换窗口。现已连接 `readPinnedRegularFile(currentPath,{maxBytes:512*1024,expected:info})`，保持已授权用户选择目的地、目录脱离 managed root、验证 current 必须与历史 hash 匹配、目标 `wx` 独占创建及不覆盖原始文件的全部约束。新增导出路径安全接线合同，RED [Node Contracts #37926579380](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37926579380)；GREEN [Windows CI #37926649977](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37926649977) **410/410 PASS**、[Node Contracts #37926649973](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37926649973) SUCCESS。仍不等于实际 Tampermonkey/V4 或 Stable 通过。

- **修复导出目录判断中的特殊名称绕过（2026-10-09）**：`exportManagedCurrent` 原先把所有以 `..` 开头的相对路径都认为已离开 managed Data 根；目录 `Data/..not-parent` 却仍在 Data 内，可绕过不准导出的规则。现在严格区分完整父目录段 `..`、`../`（Windows 的 `..\\`）与以双点开头的普通目录名，对原始目标路径和 realpath 解析后的父目录都执行同一段级边界判断。测试先行 [Node Contracts RED #37927482273](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37927482273)：旧代码 412 项中该测试失败；GREEN [Windows CI #37927639333](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37927639333) **412/412 PASS**。真正位于 Data 外部的 `..valid-destination` 目录仍可导出，原文件仍不覆盖。
- **为已有 JavaScript 语法错误的脚本拒绝伪修复预览（2026-10-09）**：`proposeLiteralPatch` 原来直接利用 TypeScript 容错 AST 寻找 `querySelector()`，即使源码有 `const broken = ;` 等语法错误，仍可能生成误导性定位器补丁。现只对完整、可解析的 JS 脚本继续最小字面量替换；解析诊断存在任何语法错误时 fail closed，原始 bytes 不修改。合法 userscript header、箭头函数保持兼容。TDD RED [Node Contracts #37928000566](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37928000566)；GREEN [Windows Development CI #37928143122](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37928143122) **414/414 PASS**、[Node Contracts #37928143293](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37928143293) SUCCESS。上述均为开发级源码与隔离 Chrome 自动化验收，不等于真正 GM_*/V4 或三形式正式发行验收。

- **修复批准写盘阶段不再信任自洽哈希的补丁草稿（2026-10-09）**：过去 `applyManagedPatch` 仅验证 `baseHash` 与调用方提供的 `proposedSource → proposedHash` 一致；调用方可以重新计算 SHA-256，将任意 JavaScript 或元数据变更伪装为已批准的定位器补丁。现在最终受管 revision 写入前，从固定句柄读取的原始字节重新运行 `proposeLiteralPatch`，要求 AST 中恰好一个已批准的字面量定位器 `sourceRange`、同一旧/新定位器、完全一致的修复后源代码与 SHA-256。非法源码范围、非定位器改动、附带脚本执行代码均拒绝，拒绝发生在创建受管目录/存档之前。仍支持 UTF-8 BOM 与显式选定的重复 selector 调用。TDD RED [Node Contracts #37929051558](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37929051558)（417 项中 2 项如预期失败），GREEN [Windows CI #37929208294](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37929208294) **417/417 PASS**。没有绕过用户批准，也不运行任何 JS。
- **Windows ZIP 正式发行库存路径校验收紧（2026-10-09）**：发行校验器 `scripts/windows-release-gate.mjs` 现在在未打包条件下的纯合约测试中，拒绝 NTFS 附加数据流 `app.asar:evil`、Windows 保留设备名 `CON/NUL/AUX/COM9/LPT1`、尾随点/空格以及意外混入 ZIP 的 Setup/Portable 安装程序。本轮同时修正之前正则中 `${PREFIX}` 不能动态插值的缺口。TDD RED [Node Contracts #37929538487](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37929538487)，GREEN [Windows Development CI #37929682472](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37929682472) **418/418 PASS**、[Node Contracts #37929682452](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37929682452) SUCCESS。**此门禁仍只是正式成品的名称/目录/隐私逻辑验证**，未生成 Setup EXE、Portable EXE 或完整 ZIP，未开展真实安装/运行和 Tampermonkey/GM_* 验收，不能宣布 Stable。

- **最终补丁写入的备份类型运行时白名单（2026-10-09）**：`applyManagedPatch` 的 `baseRevisionKind` 虽静态标记为 `'original'|'revision'`，运行时此前未再次验证。恶意或受损内部调用仍可传入 `../` 或其它路径串参与备份文件名，构成目录逃逸风险。现已在任何目录创建、文件读取及受管 revision 写入前，严格执行运行时白名单校验，非法值统一拒绝。新真实文件系统回归证明旧代码有漏洞，TDD RED [Node Contracts #37930260901](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37930260901)，GREEN [Windows Development CI #37930376389](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37930376389) **419/419 PASS**、[Node Contracts #37930376278](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37930376278) SUCCESS。这仍属于内部受管路径安全加固，不能证明 V2/V3/V4、Tampermonkey 或最终 Stable 发行。

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
