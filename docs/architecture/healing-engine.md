# 多级自愈引擎、Selector 分析与共享兼容层

**USS-HEAL-001｜v0.1.0-draft｜2026-10-08｜状态：设计评审**

## 1. 自愈 != 自动字符串替换
引擎输入是「静态源码 + 运行时证据 + 站点状态 + 版本历史 + 测试契约」，输出是可复验的 `Diagnosis` 和零个或多个 `PatchCandidate`。它绝不应直接以 DOM 近似字符串匹配替换所有同名字面量。

### 1.1 五类结论
- `healthy_observed`：当前明确检查的断言通过；**不代表全部功能健康**。
- `broken_confirmed`：至少一个检查明确失败，且排除了已知环境不满足的情况。
- `suspected`：看到迹象但缺少排除性证据；需追加诊断。
- `blocked`：浏览器、登录、权限、跨 frame、测试环境等前置条件不满足。
- `unverified`：没有可用的断言或没有执行，禁止以“通过”展示。

## 2. 静态分析管线
### 2.1 输入/解析
- 安全读取，保留原始 bytes / UTF-8(BOM) / CRLF-LF / sourcemap / hash。
- 分离 `// ==UserScript== ... // ==/UserScript==` metadata；查 `@match` 等冲突并索引 `GM_*` API 的使用与声明。
- 解析 JS/TS-like? **首期只保证合法浏览器 JavaScript 源码**；支持 module、JSX、proposal syntax 的情况由 Parser capability flag 决定；解析失败报告 sourceRange 而非自动修复。
- 生成 SourceModel，AST 纯分析不能执行任何脚本或 eval 代码。

### 2.2 DOM API / pattern 检测
- `document.querySelector(All)`、`Element.querySelector(All)`、`getElementById`、`getElementsByClassName`、`getElementsByTagName`、`matches`、`closest`；
- `document.forms`、`elements`、`window.frames`、`contentDocument`、`shadowRoot`、`getRootNode`；
- `addEventListener/removeEventListener`、`MutationObserver`、`ResizeObserver`、`setTimeout/setInterval`、`requestAnimationFrame`；
- jQuery `$()` 与 `.find()`（仅确定别名时）；`CSS.escape`；XPath `document.evaluate`；`textContent`/`innerText`/role/name 过滤；
- 自定义 selector 包装器按用户配置的函数签名向内追踪调用；无法确定调用归属时标动态未知。
- 对 `evaluate`、`eval`、`new Function`、import 动态依赖不执行静态求值；标 `UNSAFE_TO_EVALUATE`。
- 对 IIFE、closure、对象方法、class 方法、跨文件 `@require` 调用尝试分析；源不可得时显式标 `external_dependency_unknown`。

### 2.3 选择器提取分类
| 类型 | 例子 | 处理 |
|---|---|---|
| Literal | `querySelector('.old')` | 直接提取 exact literal + range |
| Template static | `querySelector(`div.btn`)` | 当作确定字面量 |
| Template dynamic | `querySelector(`#row-${id}`)` | template parts + runtime_required |
| Concatenation | `querySelector('.x-' + mode)` | 常量传播成功才可确定，否则未知 |
| Variable | `querySelector(SELECTOR)` | 同一作用域常量可追踪时提取，否则未知 |
| Wrapper | `findComposer(root)` | 有明确函数映射时继续追踪 |
| Runtime-generated | `querySelector(buildId(state))` | 不执行，runtime_required |
| Fallback chain | `querySelector(a) || querySelector(b)` | 记录候选顺序、首项与备用、条件 |
| Conditional/branch | `condition ? a : b` | 两分支对应不同 SiteState，分别保存 |

`SourceSelectorRecord` 保留 AST node 类型、file path、line/column、end location、function scope、selector value/parts、DOM root、frame/shadow scope、fallback chain、dynamic flag、dependency source、mutation behavior、confidence/evidence。

## 3. 动态诊断策略
1. 确认 BrowserSession、Target、SiteState、Test URL，排除环境问题。
2. 为每个 selector 按源码 root/context 定向执行查询；读取 matched count、node summary、role/name、visibility、enabled、bbox、stable labels、parent landmark、frameId。
3. 先检查是否由于加载/焦点/弹框/路由状态不同造成；有界等待（默认 5 秒，可到 15 秒）、DOM quiet window（建议 300–800ms）和条件重试。
4. 若根本没有相关 selector 的“目标作用”定义，只能报告它是否匹配，**不能推断用户真正想要的是哪个匹配项**。
5. 动态生成 selector 仅用用户允许的受控运行时探针记录运行时实值；不能从静态不确定片段假设最终值。
6. 观察到 0 匹配并且历史证据显示同一状态旧选择器曾成功时，标 `selector_regression_probable`；在同一条件多次稳定失败后升级确认。
7. 匹配 N>1 的选择器即使非零，也应按唯一性契约判断失败；不能把任意第一个匹配当正确目标。
8. 异常来源区分 `page`、`extension`、`user_script`、`unknown`，没有 source map 时不能猜源码行。
9. 记录“能到达页面”“实际运行 manager”“测试用例是否已定义”三项独立能力矩阵。

## 4. 故障原因树
```text
用户报告：按钮失效
├─ 浏览器连接？否 → CDP/端口/profile/launcher 排错，停止源码修改
├─ 站点可访问？否 → 网络/登录/验证码/权限阻断
├─ Userscript 已注入？未知 → 仅 DOM 级，不能宣称业务故障
├─ 页面状态匹配？否 → 导航/路由/弹框/AB variant
├─ Selector 命中？
│  ├─ 0 → 延迟渲染? frame? shadow? 旧 locator? → 候选修复
│  ├─ >1 → 歧义/误命中 → 人工或严格语义约束
│  └─ 1 → 元素能交互? 事件监听? 执行 world? 页面业务接口变化?
└─ 功能断言？
   ├─ 没有 → 未验证，不自动宣称已修复
   ├─ 失败 → 记录预期/实际、evidence、最小变更
   └─ 通过 → 仅对应契约通过
```

## 5. 候选 Locator 生成与评分
候选来源优先序：
1. 明确配置的、站点自身长期提供的 stable test identifier（但不可盲信 `data-testid` 永不变化）。
2. 访问性语义 `role + accessible name`、`aria-label`、关联的 `label/for`。
3. 有稳定业务语义的自定义属性、input name、URL/表单结构。
4. 历史 Locator / shared adapter / 同类环境成功规则。
5. 有限层级锚点与文本约束（文本受本地化影响需多语言测试）。
6. class/css 链和 nth-child 作为降级兜底，遇 hash/random class 降分。
7. 仅外观相似的候选默认需人工判定。

打分建议总 100：unique 25、semantic 25、history 15、visible/interactable 10、landmark 10、cross-state 10、complexity/stability 5。每个分项必须留 evidence，例如“role/name 匹配 1 个”和“同一站点状态连续 2 次成功”。多候选同分或证据不足必须输出 ambiguous。

```ts
interface CandidateLocator {
  id: string;
  query: string;
  strategy: "css" | "role-name" | "label" | "xpath" | "composite";
  frameScope: string;
  shadowTraversal: "none" | "open" | "unsupported";
  score: number;
  scoreParts: Record<string, number>;
  evidenceIds: string[];
  riskFlags: string[];
}
```

## 6. 本地自愈级别与门槛
| Level | 动作 | 自动执行边界 |
|---|---|---|
| L0 | 纠正环境/target/脚本注入状态排查 | 自动诊断，不自动改用户 Chrome 个人资料 |
| L1 | 暂时性 DOM 时序/selector 根上下文修正 | 可自动重新测试，不写源码 |
| L2 | 局部共享兼容层定位调整 | 影响脚本测试通过后进入人工审阅；默认不自动发布 |
| L3 | AST 精确更换有限字符串或定位参数 | 仅有 evidence/功能合约/高得分时供用户确认 |
| L4 | 最小包装函数/观察器/重试逻辑改造 | 复杂度/副作用风险高；人工审核必选 |
| L5 | AI 结构化建议生成 patch | 只生成候选；禁止 AI 绕过测试直接改写 |

补丁生成必须能定位到唯一 AST range 并与当前磁盘 hash 相同；同一 patch 若重复应用应是 no-op（幂等性）；代码格式尽可能保真；出现文字重复或节点多义、头部元数据变化、导入依赖变化、未知权限增加，应标记变更超范围并拒绝自动应用。

## 7. 修复与测试门控
```text
Finding
 → CandidateLocators[]
 → PatchProposal
 → StaticSafetyCheck (V0)
 → Snapshot/DOM assertions (V1)
 → Interaction-safe checks (V2)
 → Contract tests (V3)
 → Manager-observed checks if configured (V4)
 → Risk review & explicit approval
 → Backup & atomic apply
 → Post-apply re-verification
 → Revision & audit
```
安全变更可从 V0-V2 产生“建议修复”，但没有 V3/V4 不可标“功能修复已验证”。失败要输出原因并保持原版，不能一再提高候选分数。应用后若重新验证失败，自动恢复最近已验证 backup 并出事件；失败恢复再提示手动恢复。

## 8. 共享兼容层的具体 API 契约
建议 `SiteAdapter` 每站点单独版本：
```ts
interface SiteAdapter {
  siteId: string;                 // chatgpt-web
  version: string;                // semver
  urlPatterns: string[];
  states: Record<string, SiteStateDefinition>;
  roles: Record<string, SemanticLocatorDefinition>;
  validationCases: string[];
}
interface SemanticLocatorDefinition {
  contexts: Array<{ stateId: string; frame: string; shadow: "none"|"open" }>;
  strategies: Array<{ kind: string; selector: string; weight: number }>;
  cardinality: { min: number; max: number };
  assertions: string[];
}
```
脚本调用接口建议是 `compat.get('chat.composer', context)` 和 `compat.waitFor('chat.composer', options)`；需要在源码中存在显式 `@require` 或兼容层嵌入/加载机制，不能凭空假设跨 userscript 的 JS 全局变量天然共享。不同 `@grant`、沙箱 world 和 script manager 的脚本必须实测共享性。允许依赖固定 major/minor，变更前运行依赖影响分析和完整 contract tests。

## 9. AI 辅助修复的界限
AI 在本地规则不足、跨多函数封装、语义目标歧义、功能断言显示代码流变化时才触发；请求含最小相关源码片段、AST location、**脱敏且裁剪**的 DOM/evidence、失败测试和允许的 edit range。必须返回 JSON 结构化候选（`patch`、`reason`、`risks`、`testsSuggested`、`assumptions`），通过 JSON schema、路径白名单、语法测试后方可预览。请求次数与费用有硬上限，超时或 HTTP 429 走退避/等待，不让用户无限耗费额度。

## 10. 失败和极端案例
- React SPA 重渲染旧 node 引用失效：应重新查询而非缓存 NodeId。
- 输入框是 contenteditable iframe 或 shadowRoot：识别 roots，不将其误判为普通 textarea。
- 同一页面移动端/桌面 DOM 差异：以 viewport 为状态分组。
- A/B 测试／语言切换导致 role/name 不同：多语言/variant fixture。
- 元素短暂出现：至少两次采样或显式用户合约才能判断稳定。
- 多脚本同域争用菜单与 MutationObserver：隔离测试，检测重复监听与副作用。
- `@require` 引入的未公开外部脚本：无法完整静态分析，必须标记 coverage gap。
- 页面使用 closed shadow root、Canvas/截图模拟 UI：selector-based 修复能力有限。
- AI 提议改写全文件：超过最小编辑预算即拒绝。
- 需执行危险按钮才能验证的功能：必须用户显式批准沙盒账户和模拟替身服务，否则 `blocked-risk`。

## 11. 引擎单元测试与假阳性负例
测试至少包括：source 相同字符串出现在备注与代码中只修改 AST 目标、换行 BOM 保真、动态模板未知、后备 selector 已成功不误报、同状态 0 match 连续失败、异步出现重试成功、同名两个按钮产生 ambiguous、shadow frame 正确 scope、断线不写入、功能测试缺失时无 `V3`、兼容层更新引发下游失败立即回滚、批量其中一项失败不影响其他。

## 12. 不变量（违反即阻断发布）
1. `scriptHashBefore !== diskCurrentHash` → 禁止应用。
2. `patchScope` 不在授权 AST 编辑范围内 → 禁止应用。
3. 功能断言缺失 → 不可报告 `functional_pass`。
4. AI 失败、无网络、模型不可用 → 本地已有工作必须仍可完成。
5. 任何外部候选无需信任，始终经过相同的本地 gate。
6. 回滚后 hash 不相同 → 显示恢复失败并保留备份，不能显示成功。
