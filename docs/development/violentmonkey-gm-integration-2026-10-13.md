# 官方 Violentmonkey 隔离 GM 验证记录

日期：2026-10-13（UTC）。版本：0.1.0-alpha.5。全局状态：NOT STABLE。

## 已验证范围

在 disposable Windows Chrome for Testing profile 中加载官方 Violentmonkey MV3
2.49.0 ZIP；固定 SHA-256 为
`3fa676c803a9698453ed23dfe496d4bc29a4bec52f6a95e55c43c2955921f8ee`。
只安装仓库固定的合成脚本，只访问本次服务器的 loopback `/fixture` 和
`/gm-request`，并阻断浏览器非 loopback 流量。

真实成功记录：commit `d97f856e0c69546e5d31010c77367fbc5d70ad52`，
[Development CI #38345267474](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38345267474)，
Chrome 155 job `115125094684`，Windows Server 2025，CFT `155.0.8059.39`。

- `GM_getValue` / `GM_setValue`：第一份文档计数 0→1；重载后的新 loader 计数 1→2。
- `GM_registerMenuCommand`：固定菜单 ID 注册成功；本测试没有调用菜单或验证用户菜单 UI。
- `GM_xmlhttpRequest`：恰好两次 GET 到 `/gm-request`，响应状态和固定正文一致。
- 页面每次取证校验 frame、URL 和 loader；重载前旧文档不能充当第二次结果。
- 输出只含固定成功/错误原因与阶段码；不导出经理源码、注册脚本清单或浏览器错误正文。

## 修复的实际阻断

| 阻断 | 原行为 | 修复与测试 |
|---|---|---|
| Chrome userScripts 权限 | 新 profile 没有逐扩展 Allow User Scripts 权限 | 只在本次隔离 profile 对固定 ID、版本和 UNPACKED 扩展启用；校验权限读回与 API 可用性 |
| WebUI 初始化竞态 | `/json/list` 的 URL 更新先于 `chrome://extensions/` 执行上下文，运行出现 `page-context` | 仅对 page-context/settings-api 作有次数上限的等待；身份、版本、权限失败立即拒绝 |
| VM injector 初始化 | 初装初始化发生在授权前；API 可用不表示基础脚本已注册 | 通过官方 `GetInjectorError` 再初始化，核对 id=1001 的两个官方 document_start 文件 |
| loopback 端口匹配 | 固定无端口 @match 未匹配随机端口，阶段 not-observed | 在服务器绑定后仅将固定 metadata anchor 替换为该次完整 fixture URL；范围缩小到 exact port/path |
| reload 旧结果 | Page.reload 返回时原文档的结果属性可能仍存在 | 等待新的 loader；取证前后 loader 一致，否则拒绝 |
| 产品导入边界 | 新经理 fixture 模块未列在 esbuild 禁入规则 | 将经理 fixture/helper 列入全部生产 bundle 的导入图拒绝规则；tree shaking 不能绕过 |

官方端口匹配依据：
[VM v2.49.0 tester.js](https://github.com/violentmonkey/violentmonkey/blob/v2.49.0/src/background/utils/tester.js)
的 RE_URL_PARTS、setContext、MatchTest 和 hostMatcher 保留 authority 端口。

## TDD、审查与整合

新增失败测试后逐项实现：权限能力及边界、WebUI 等待、官方 injector、
loader 更换、阶段脱敏、精确 URL scope、生产 import graph 拒绝。
独立审查发现的 injector 初始化遗漏已修复；同一审查另定位了随机端口不匹配。

与 [PR #137](https://github.com/devin930906/userscript-self-healing-manager/pull/137)
的函数表达式源码定位修复合并后的本地测试：1,220 项，1,218 通过，
0 失败，2 项环境开关跳过。TypeScript、源码构建和实际编译产物边界扫描通过。
这是代码检查；最终整合的 Windows CI 必须引用其自己的运行，不沿用前一 commit。

## 保留的验收边界

该测试证明固定合成脚本在官方 VM 中运行。它没有证明产品能够验收任意用户脚本，
也没有认证 Tampermonkey、跨浏览器重启的 GM 持久化、真实用户网页和 V3/V4 功能。
产品仍输出 V4 not-configured、managerVerified false。用户的实际 portable Chrome
和 Windows 10/11 客户端环境仍需对应环境证据。

未创建安装包、Stable tag 或 Release。三种正式分发及升级/迁移/恢复验收、
其余 P0 代码缺口和全部 RG-01~09 仍按 P0 台账推进。
