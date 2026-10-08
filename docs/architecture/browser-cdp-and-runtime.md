# CDP 浏览器接入与真实运行时规范

**USS-CDP-001｜v0.1.0-draft｜2026-10-08｜Windows 10/11 x64 目标｜设计待确认**

## 1. 核心原则
产品直接使用 Chrome DevTools Protocol（CDP）。**不需要额外安装 chrome-devtools-mcp 才能获取 DOM**。MCP 是面向智能代理的封装接口，对本机程序而言只会多出依赖、序列化、工具权限和调试层；后期“对外提供诊断服务”才评估 MCP adapter。

CDP 是一个遥控/诊断协议，不保证用户脚本经理执行语义；一个正确的“页面 DOM 查询”≠ Tampermonkey 里脚本可成功注入并调用全部 `GM_*`。

## 2. Chrome 自定义配置
`BrowserProfile` 字段：
- `id`、`displayName`、`executablePath`、`binaryKind`（real-chrome | portable-launcher | chrome-for-testing | unknown）
- `browserFamily`（chrome 默认；未来 chromium）、`detectedVersion`、`remotePort`（默认 9223）、`remoteAddress`（固定 127.0.0.1）
- `launchMode`（launch-managed | attach-existing）、`dataDirectoryMode`（none | user-explicit-isolated）
- `profileArguments`、`environmentOverrides`（白名单）、`managerPreference`（Tampermonkey/Violentmonkey/unknown）
- `lastHandshakeAt`、`lastHandshakeResult`、`pathHash`、`isDefault`。

导入路径时，验证文件存在、执行权限、实际 PE 类型/签名（可以缺省显示 unknown，不强制阻断未经签名的自编便携版）、能否传递参数、launcher 是否创建真正 chrome child process；路径带空格和中文必须安全传递。UI 必须显示真实 exe 路径和已创建 PID，且用户可重选。

## 3. 默认启动契约
调用操作系统原生 spawn/Process API，并传递**独立参数数组**（不拼接 shell string）：
```text
<user-selected-chrome.exe>
  --remote-debugging-port=9223
  --remote-debugging-address=127.0.0.1
```
关键要求：
- **默认不自动加入 `--user-data-dir`。**
- 不使用 `shell: true`，不直接调用 cmd/powershell 解析用户路径，不将路径和附加参数做字符串拼接。
- 9223 是默认建议值而不是“可以不管冲突”；UI 必须允许显式更改，不能自动改用其他端口并假装是 9223。
- 如果用户选择的是便携版 launcher，必须验证它会传递参数到真正 chrome。部分 launcher 可能忽略参数、转交已运行实例或使用自己的 profile 管理。
- Chrome 已经运行时，二次启动请求可能被转交现有进程，调试参数未生效；对“只会生成子进程”的假设必须测试，不能以子进程存在判定 CDP 已开启。
- 从 Chrome 136 开始，正式版调试默认数据目录的行为被限制。**portable 本身不是官方豁免类别**。默认模式失败时显示 `PROFILE_DEBUGGING_RESTRICTED_OR_UNAVAILABLE`（归因不明确时是 unavailable）；选项 A 由用户自行选择 Chrome for Testing；选项 B 用户明确允许程序创建**隔离测试资料目录**后才添加对应启动参数。A/B 均非静默退路。
- 已连接的 Chrome 是用户的个人生产 profile 时，首次请求测试必须明确提示潜在的账户操作、调试端口风险。

## 4. 会话状态机
```text
IDLE → PATH_VALIDATED → START_REQUESTED → PROCESS_OBSERVED
     → DISCOVERY_ATTEMPTED → HANDSHAKE_VERIFIED → ATTACHED → READY
     ↘ FAILED (包含 errorCode、证据、重试资格)
READY → DISCONNECTED → RECONNECTING → READY | FAILED
READY → STOPPING → STOPPED
```
状态不能跳过 HANDSHAKE_VERIFIED；每次重连刷新 target/session 上下文；断开连接需清理 listener 与待处理 request；仅终止**本程序确实启动并拥有的进程**，不得擅自杀掉同端口的外部 Chrome。

## 5. CDP 握手细则
1. 启动前检查 `127.0.0.1:9223` 是否占用；若已存在，明确选择“连接已存在浏览器”或“换端口”，不能强制抢占。
2. 启动预期浏览器并记录生成的 PID/时间/路径；监控退出码和可能的子进程关系。
3. 请求 `http://127.0.0.1:9223/json/version`，要求可解析的 `Browser`、`Protocol-Version`、`webSocketDebuggerUrl`；检查 URL 的主机/端口和实际 CDP 能力。
4. 建立 browser websocket 并进行浏览器域能力调用，连接 page target，验证 sessionId；避免误连前一个程序留下的调试端口。
5. 若无法可靠确定 PID/归属，标记 `identity_uncertain`；**禁止自动进行网页交互、写补丁和健康批量任务**，除非用户选择明确的 attach-existing 风险流程。
6. 握手成功后列出 target 的 URL/title/type；target 切换时原测试上下文失效，强制重新绑定。
7. 所有 CDP 请求具有限时、相关 requestId、取消控制、退避重试、session-bound 事件订阅；断线重连后旧 nodeId/objectId 不得复用。

## 6. DOM 与网页结构采集
支持（具体协议字段以运行浏览器 `/json/protocol` 为准）：
- `DOM.getDocument({depth:-1,pierce:true})`：尽可能读取 DOM 结构（受协议、frame、权限和具体目标限制）。
- `DOMSnapshot.captureSnapshot({computedStyles:[...]})`：结构、布局、被允许的 computed styles、frame/template/shadow 信息；这是**采样快照，不是未来状态，也不是服务端内部完整网页代码**。
- `Runtime.evaluate`：在严格选定的 ExecutionContext 执行有限白名单检查，如匹配数量、role/name、可见、矩形/焦点、特征指纹。**不允许执行来自网页的命令字符串**。
- `Page` + `Target` + `Runtime.executionContextCreated`：辨识 SPA 导航、frame、进程切换、新 context 与主页面隔离 context。
- `Log` / `Runtime.exceptionThrown` / `consoleAPICalled`：捕获页面错误，但**异常归因默认为 unknown**，除非可确定是目标脚本。
- `DOM.childNodeInserted/Removed` / `MutationObserver`：辅助定位异步加载，避免无限监听。
- `Page.captureScreenshot`：用户显式同意后可记录，默认隐私模式禁用或做严格裁剪。
- 不默认监听请求体、Response、Headers，不自动开启 Network 事件，也不持久化 Cookie。

Frame/shadow 规则：保留 `targetId/frameId/executionContextId/documentVersion` 等维度；记录 iframe 跨域失败类型；检查 closed shadow root 时必须承认无法覆盖而不伪称完整。DOM node IDs 短期有效，不可作为跨页面永久 locator。

## 7. 页面状态与抗误报
站点的同一 URL 可对应登录页、聊天页、弹框、编辑器禁用等多个状态，定义 `SiteState` 指纹，包括 URL pattern、必备 landmark、可选 CSS/role 特征、登录条件、用户已授权的页面状态。只有 state 确认后才跑相关断言。
- 单次 0 匹配不等于选择器永久失效，需容纳可配置等待时间（默认建议 5 秒，最多 15 秒）与必要的页面稳定条件。
- 在可能出现 A/B 测试或布局响应式差异时，必须采集 viewport/locale/theme/feature state 并隔离历史对比。
- 导航开始、路由变化、标签切换和 iframe 更换会取消旧的断言。
- 不允许为了获得页面状态而自动登录、解决验证码或绕过服务限制。

## 8. Userscript 实际运行与脚本经理
定义 `ValidationAdapter`：
1. `static-only`：AST/metadata/L0，完全不执行。
2. `cdp-dom-only`：只检查 DOM 与 selector，不表示 `.user.js` 正在运行。
3. `cdp-sandbox-injection`：用户明确允许在测试页中注入低风险脚本片段；无法完整模拟 `GM_*`、`@run-at` 或独立的扩展 world，结果最高 V2。
4. `manager-observed`：实际安装 Tampermonkey/Violentmonkey 的 Chrome 中，使用用户审核过的 companion/probe 产生脚本级可归因 evidence，可达到 V4；应检查 extension 本身的权限和 manager 设置。
5. `manual-verification`：没有可用 probe 时提示清晰的人工步骤并记录手动证明，不与自动 V4 混淆。

**设计依赖**：`GM_getValue`、`GM_setValue`、`GM_registerMenuCommand`、`GM_xmlhttpRequest`、`unsafeWindow`、`@run-at document-start` 等通过正式 manager adapter 对照验证；无法在 CDP 页面默认 world 简单假造。

## 9. 性能与并发策略
一个 BrowserProfile 默认一次允许 1 个动态用户脚本诊断，以避免变动状态相互污染；静态工作池按 CPU 和文件数量调度，优先空闲 CPU。采样预算：单 DOMSnapshot 限制大小，超限则记录 truncated 并做子树采样，不能记录“完整快照”；所有 listeners、timer、object group、CDP sessions 按 job 严格释放。

## 10. 安全机制
端口仅 127.0.0.1，启动日志不输出 DevTools WebSocket URL；确保 renderer 不能任意拿到 WebSocket endpoint 或凭证；任何对外服务必须单独认证和审计。定期检测调试端口是否被意外暴露到非本地地址；使用者确认才保留长期调试会话。

## 11. 错误码与对应 UX
| 错误 | UI 提示 | 下一步 |
|---|---|---|
| BROWSER_PATH_INVALID | 执行文件不存在或无法打开 | 重新选择真实 chrome.exe |
| PORT_BUSY | 9223 已被其他进程占用 | 检查现有连接/明确改端口 |
| CDP_HANDSHAKE_FAILED | 端口存在，但不是受支持的 CDP endpoint | 查看版本/日志/用户决定切换 |
| DEBUGGING_SWITCH_NOT_APPLIED | Chrome 启动，但没有 CDP | 检查 launcher、已有进程、Chrome 136+ 限制 |
| PROFILE_RESTRICTED | 强证据显示所选 profile 不允许此方式调试 | 选择 Chrome for Testing 或经授权隔离目录 |
| SESSION_LOST | 目标标签或连接已断开 | 重新绑定 target，已执行动作不能盲重试 |
| FRAME_UNAVAILABLE | 目标 iframe 或 context 不可访问 | 指定作用域/标记受阻 |
| EXTENSION_RUNTIME_UNVERIFIED | 只知道页面状态，不知道脚本经理是否执行成功 | 安装/配置验证 bridge 或人工测试 |

## 12. 官方参考与待复核
- Chrome 136 远程调试政策：https://developer.chrome.com/blog/remote-debugging-port/
- Chrome DevTools Protocol：https://chromedevtools.github.io/devtools-protocol/
- DOM domain：https://chromedevtools.github.io/devtools-protocol/tot/DOM/
- DOMSnapshot：https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/
- Runtime：https://chromedevtools.github.io/devtools-protocol/tot/Runtime/
- Tampermonkey 文档：https://www.tampermonkey.net/documentation.php
- Chrome userscripts API：https://developer.chrome.com/docs/extensions/reference/api/userScripts

**需二次核查：** 用户指定的便携 Chrome 155 的 launcher's 参数转发、真正 profile 目录和能否成功握手，必须在目标 Windows 机器实测；上述文档不能代替该实测。
