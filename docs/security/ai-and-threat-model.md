# AI Provider 接入规范、隐私设计与安全威胁模型

**USS-SEC-001｜v0.1.0-draft｜2026-10-08｜Design Review｜安全默认拒绝原则**

## 1. 数据和脚本信任边界
系统会处理四种不同信任级别的输入：
1. 用户选择的本地 `.user.js`：**不可信可执行源**（即使来源是本人），AST 读取安全，浏览器执行需确认。
2. 网站 DOM、网页脚本、日志文本：**不可信且可能包含敏感/恶意提示词**，只能作为数据，不能作 AI 的系统指令。
3. AI 响应：**不可信候选补丁**，无直接文件/浏览器权限。
4. 浏览器 CDP 会话：可能拥有账户权限和网站数据，默认视为**高敏感操作能力**。

禁止把网站或脚本中的自然语言嵌入系统提示词当命令使用；所有操作必须由应用策略及用户审批决定。

## 2. BYO-AI 产品配置
`ProviderConfig`（用户可管理多组）：
- id/displayName/type: `openai-compatible`（首发必有）；`ollama` / `lmstudio` / 其他可作为带明确兼容检测的后期专用 adapter。
- baseURL：完整协议+host+port+可选 path，示例 `https://api.example.com/v1`、`http://127.0.0.1:1234/v1`；必须以 URL 解析和路径安全拼接为准，避免重复 `/v1/v1`。
- API Key：可为空（仅服务明确支持匿名时）；隐藏显示、更新与删除；OS-backed encrypted storage，不得存明文配置或 logs。**当便携 EXE/ZIP 与 `Data/` 复制到另一 Windows 用户/电脑时，不保证旧用户可解密，必须要求重新输入而不能退回明文储存**。
- model：`auto-list` + `manual`；展示完整模型标识，不私自替换前缀。
- timeout、maxRetries、retryBackoff、maxInputTokens、maxOutputTokens、maxRequestsPerJob、maxRequestsPerDay、estimatedCostLimit、allowedDataClasses、`enabled=false` 默认。
- 首次调用前校验目标 host、TLS、是否本地服务、实际将发送什么数据；非 TLS 外网端点默认阻断，只有明确额外风险批准才能允许。

便携数据放置与迁移规则：[Windows 三形式发行规范](../distribution/windows-three-editions.md)；不要将单文件便携 EXE 的临时解包目录作为持久化机密存储位置。

## 3. 模型发现、手动填写及协议处理
- 对声明支持 OpenAI-compatible 的提供方，尝试 `GET <normalized-baseURL>/models`；若 baseURL 本身已是 `/v1`，不自动再补一层。
- 正确处理 200、401、403、404、429、5xx、无 models、分页（若 provider 支持）、响应格式与同名模型。
- 自动获取失败不阻碍用户手工填写 `modelId`；手动模式执行最小健康探测并让用户批准可能产生的费用。
- 检测 `/chat/completions` / `/responses` 能力时必须基于 provider adapter；**不能假设所有自定义 Base URL 都兼容同一请求格式、流式返回或 JSON schema**。
- 不枚举用户本机开放端口、不默认扫描局域网模型服务；只访问用户手动设置的 URL。
- 失败后的回退：标记 `provider-unavailable`、保留本地诊断、绝不自动切换到未授权模型。

## 4. AI 使用策略：成本优化优先
默认关闭 AI；满足任一条件才提示用户升级：本地 L0-L3 没有可靠候选、复杂作用域/业务变化、多个候选歧义、已有功能断言失败但不是 Selector 原因。禁止对每个已健康脚本调用 AI。

调用前聚合去重：同一 site-state 相同 DOM fingerprint、相同 source hash、相同 findings 不重复请求；多脚本共享同一 role 时优先一次性修复共享定义。缓存 key 需包含模型 id、prompt/template 版本、脱敏策略版本、site state、脚本源码 hash、evidence hash；默认敏感内容不缓存原始 prompt。

结构化输出：
```json
{
  "findingId": "uuid",
  "assumptions": ["..."],
  "rationale": "...",
  "changeType": "replace-locator",
  "baseSha256": "...",
  "edits": [{"sourceRange": {"start": 0, "end": 0}, "replacement": "..."}],
  "riskFlags": [],
  "suggestedValidationCaseIds": [],
  "confidenceRationale": "..."
}
```
参数需经严格 schema/byte range/path allowlist 检查；返回 score 仅参考，禁止 AI 自定“验证通过”。

## 5. 发送 AI 的隐私分层
| 数据级别 | 默认外发 | 说明 |
|---|---|---|
| 非敏感诊断分类、位置、抽象结构 | 可提示后发送 | 例如 selector 匹配数量、错误类型 |
| 源码片段 | **默认不发送** | 需用户逐项目开启并可预览，可能含私有 URL/token |
| DOM 属性/节点摘要 | **默认不发送** | 脱敏后可按授权提交必要子树 |
| 完整 HTML/DOMSnapshot | **禁止默认外发** | 高隐私面；高风险模式手动逐次批准也需清洗 |
| 截图 | **默认禁止** | 登录用户头像、私聊文字等风险 |
| Cookie/Authorization/API Key/LocalStorage 内容 | **永不外发** | 即使用户启用 AI 也不允许发送凭证 |
| 浏览器历史/未选页面信息 | **永不外发** | 不属于本次诊断目的 |
| AI API Key | 仅发送到用户选定 endpoint 的认证请求 | 不参与模型 prompt |

脱敏规则包括：邮箱/电话/会话 ID/疑似 token、`password`/hidden input value、`Authorization`、`Cookie`、JWT 字符串、URL query secrets、聊天内容、选定站点用户标识；**自动识别无法保证 100%，用户需要可视化外发预览和编辑**。

## 6. 安全威胁模型
| STRIDE / 威胁 | 攻击路径 | 防御 |
|---|---|---|
| Spoofing | 9223 是攻击者/其他 Chrome 的 CDP | port owner / PID / launch association，握手身份，用户显式 attach |
| Tampering | 恶意脚本伪装 selector 数据诱导改源码 | AST 限定 edit range、source hash、审核、最小补丁 |
| Repudiation | 批量修复后无法追责 | append-only audit、revision chain、job/evidence id |
| Information Disclosure | CDP 读取 Cookie 或对 AI 泄露网页内容 | 不采 cookies/network secrets、数据最小化、默认本地 |
| Denial of Service | DOMSnapshot 超大、网站无限重渲染、脚本无限循环 | 大小/时间/深度/重试上限、取消/熔断、资源预算 |
| Elevation of Privilege | 恶意 renderer/网页获取 Node/Electron/CDP 能力 | contextIsolation、sandbox、nodeIntegration=false、strict IPC |
| Supply Chain | 被植入恶意 NPM 包/远程 compatibility rules | lockfile、依赖扫描、签名/哈希、无自动远程代码加载 |
| Prompt Injection | 页面 DOM 文本让 AI 忽略规则、发送秘密 | 把站点内容当 untrusted data、限制工具、schema、人工审批 |
| SSRF / Local Abuse | 恶意配置让 AI client 请求内网服务 | URL 显式授权、明确网络范围与 redirect policy、禁止自动扫描 |
| Data Loss | 多任务同时覆写同一 .user.js | per-file lock、hash compare-and-swap、不可变备份、原子写 |
| Harmful Browser Actions | 误点发送、删除、购买 | 默认只读/无副作用测试、危险操作人工审批与沙盒账户 |
| Public Repo Leaks | 开发者提交个人脚本/日志/密钥 | .gitignore + precommit secret scan + fake fixtures |

## 7. 权限与危险动作分级
- `READ_ONLY`：读取源码、查看 DOM 指纹、选择器匹配、无副作用日志。
- `LOW_IMPACT`：展开本程序内部测试 UI、focus/blur 等；必须明确 site-state 授权。
- `STATE_CHANGING`：在目标网页输入文字、触发 click、更改用户状态；需可恢复测试账户和批准。
- `DESTRUCTIVE`：删除、发送消息、付款、账号/隐私设置、公开发布；默认禁止，未来仅模拟服务/专用沙盒测试。
- 任何来源于 AI 的 patch 不提升动作权限；测试人员必须能查看测试步骤和副作用类别。

## 8. Electron 本地安全要求
- 不加载不受信任的远程 URL 作为 app renderer。
- 开启 `contextIsolation: true`、`sandbox: true`，关闭 `nodeIntegration`；主进程和 preload 使用命令 allowlist，IPC 两端检查类型、长度和路径作用域。
- 外部链接使用系统安全机制，限制 scheme，只允许 https/http 且提示外链域名；禁止随意启动任意二进制文件（仅受控的 Chrome 浏览器选择机制）。
- 内容安全策略 CSP 严格限制 renderer；DOM 报告作为纯文本处理，不通过不可信 HTML 注入 UI。
- 下载/更新代码时使用签名、哈希与发布来源验证；不打开未经确认的脚本下载包。

## 9. 日志/监控安全
每条日志保留必要的 enum、source range、hash 和脱敏 evidence，而非所有网页文本；日志导出二次脱敏；默认日志保留 30 天（配置可改），DOM evidence 建议 7 天，截图默认不保存。用户可以删除网站数据；不可保证删除已有导出副本。

## 10. 权限、隐私与法务提醒
对第三方网站进行自动化和帐号操作必须遵守目标服务条款及当地法律；不要将测试模式设计成绕过验证码或反爬的途径。个人账户的真实敏感内容禁止作为公开测试 fixture。许可证、第三方组件授权、扩展自动化权限在发行前二次核查。

## 11. 上线安全门禁
1. API Key 不在 SQL/plain JSON/log/报告/Git/崩溃 dump。
2. AI 未启用时所有外部 AI 请求数严格等于 0。
3. 只有明示用户授权的 host、target、测试动作可执行。
4. Renderer 无法执行任意 filesystem/Node/CDP 命令。
5. 断线或错误浏览器身份时立即阻止后续交互。
6. 导入恶意 JS 仅 AST 处理，不在本机 Node 主进程执行。
7. 任何将发送/删除/付款的页面按钮交互都不能以“修复验证”名义静默触发。
8. 所有高风险变更审查、签署、可回滚。

## 12. 需二次核查清单
- 当次选定的 Electron/Chromium/Node 版本的 Windows 10 支持状态与安全补丁节奏。
- 用户指定 BYO AI 服务的实际 Models API、结构化输出、模型授权、调用费用、地域和隐私协议。
- Tampermonkey/Violentmonkey 的扩展 API、Manifest V3、不同执行 world/GM 特性。
- Chrome CDP 版本和站点的安全策略；浏览器需要正式 profile 或 Chrome for Testing 的启动测试。
