# Windows 三形式发行、安装、便携数据与升级规范

**USS-DIST-001｜v0.1.0-draft｜2026-10-08｜发行范围：Windows 10/11 x64｜状态：用户明确规定发行三种形式；具体打包实现待设计批准**

## 0. 不可删减的发布合同
**每一个面向普通用户的 Windows 正式版本必须提供且只认以下三种主要交付形态，不得以其中一种代替另一种：**
1. **EXE 安装版（Setup.exe）**：标准图形化安装、可卸载、有快捷方式、可以选择或显示安装位置；单用户安装应优先支持非管理员权限。
2. **EXE 单文件便携版（Portable.exe）**：一个可直接双击的 EXE，无安装向导。单文件作为分发物，但内部可能在运行时临时解包，不能宣称零临时文件。
3. **ZIP 解压即用版（.zip）**：内含完整 Windows 应用目录，解压后运行其中的主 EXE；不需要安装。**ZIP 必须装的是 unpacked application，而不是仅把单文件 Portable.exe 再压缩。**

三版功能、脚本分析规则、修复引擎、CDP 能力、安全边界、数据 schema 应一致；仅封装、启动路径和持久数据目录策略有差别。三种全部从同一个 source commit/tag 构建，明确相同 app version。缺任何一种、损坏、无法启动、数据丢失或回滚失败即阻断**正式稳定版本**发布；开发预览版可明确标“不完整预览”，不可伪称满足正式合同。

## 1. 预期 GitHub Release 附件命名
假设版本号 `1.0.0`（**仅示例，不表示发布过**）：
```text
Userscript-Self-Healing-Manager-Setup-1.0.0-win-x64.exe
Userscript-Self-Healing-Manager-Portable-1.0.0-win-x64.exe
Userscript-Self-Healing-Manager-1.0.0-win-x64.zip
SHA256SUMS.txt
release-notes.md            # 可嵌入 Release 正文，也可另外附档
```
命名规则：应用主名称固定 `Userscript-Self-Healing-Manager`；`Setup`/`Portable` 后缀区分安装版与单文件版；ZIP 不含 `Portable.exe` 单文件替代品；版本必须与应用“关于”页面一致。ZIP/EXE 的签名及 SHA-256 都应检查；有签名并不等于安全，未签名版本也需公开标识。

## 2. 三种包的内容定义
### 2.1 Setup.exe 安装版
- 标准 NSIS installer；UI 支持选择安装位置（若采用交互式 NSIS 模式，则显式配置）。
- 安装范围默认 per-user，不要求管理员；可评估 per-machine 作为高级安装选项，但不强制加入首发。
- 安装包应内含运行所需 Electron/Node 运行时，不要求另装 Node、Python、浏览器自动化 MCP。
- 安装后开始菜单快捷方式；桌面快捷方式默认需用户选择；Windows 应用列表可卸载。
- 持久数据和软件安装目录分离，卸载时默认保留用户 scripts、备份、SQLite 和 settings；如支持“彻底清理”，必须单独显式确认并备份提示。
- 更新安装版必须保存数据库、Chrome 浏览器路径、API Provider 配置及不可变脚本 revisions。

### 2.2 Portable.exe 单文件便携版
- 一个独立 EXE，不运行安装过程，默认无快捷方式/卸载项、不写程序安装目录注册记录。
- electron-builder `portable` 目标允许获取 **`PORTABLE_EXECUTABLE_DIR`** 等外部 EXE 路径信息。**不能使用临时解包后的 `app.getPath('exe')` 推导“程序所在位置”**；具体实现应在主进程初始化早期确认并检查环境变量真实性。
- 首次运行在 Portable.exe 所在目录创建应用专用 `Data/` 目录，并在 Electron app ready/session creation 之前设置必要的 userData/session/cache 路径；实际 API 及 Windows 环境行为需单独集成测试。
- 如移动 EXE 与 `Data/`，应能保留 settings、script IDs、历史、AI provider 密钥引用、Chrome 配置；凭据受 Windows 账号/DPAPI 约束，跨 Windows 用户/电脑迁移时可能不可解密，必须有安全重新录入/迁移机制，绝不明文转储 key。
- 单文件 EXE 可能临时解压到系统 Temp，系统和安全软件也可能产生正常记录；不得声称完全零痕迹、零注册表或完全不写 C 盘。
- 如 EXE 目录只读，显示 `PORTABLE_DATA_DIRECTORY_NOT_WRITABLE`，允许用户显式选择可写数据目录或退出；禁止默默改放系统 AppData 并仍宣称“数据随身”。

### 2.3 ZIP 解压版
ZIP 必须包含**完整的预打包应用目录**（主 EXE、`resources`、`locales`、必要 DLL / pak / 其他运行依赖），不能只是 Portable.exe 文件的 ZIP 包装。示例：
```text
Userscript-Self-Healing-Manager-1.0.0-win-x64/
├── Userscript-Self-Healing-Manager.exe
├── resources/
├── locales/
├── [Electron/Chromium 所需 DLL、pak 及其他运行文件]
└── Data/                  # 首次启动才创建；发行包内不能包含用户数据
```
- 解压到任何**具有读写权限的普通文件夹**后直接双击主 EXE。
- 程序以 **真实安装目录下的 EXE 路径**识别 portable root；按同一 `Data/` 协定创建持久目录。
- 不能假设“ZIP 中只有一个 EXE”；删除任何运行依赖都可能启动失败，更新/备份需保留整个目录。
- 允许用户把文件夹复制到 D 盘/U 盘继续使用，但如果配置中 Chrome executable 存绝对路径，换电脑/盘符后需重新选择，不能虚构 Chrome 自动迁移。
- 若解压到无写权限目录，提供明确错误和选择其他数据目录流程，不要静默退回 AppData。
- ZIP 内禁止内置任何开发环境真实脚本、凭据、SQLite 数据、用户 DOM、测试报告和 `Data/` 内容。

## 3. 数据目录矩阵
| 条目 | Setup | Portable.exe | ZIP 解压版 |
|---|---|---|---|
| 程序安装/运行位置 | 安装目录（可选择） | 任意 EXE 所在文件夹 | 解压后的应用文件夹 |
| SQLite/脚本库/备份 | 由 OS 用户数据路径管理，独立于安装目录 | `<Portable.exe 所在目录>/Data/` | `<解压根目录>/Data/` |
| 设置和日志 | 在用户数据目录 | 同一 `Data/` 下分区存储 | 同一 `Data/` 下分区存储 |
| 密钥 | OS-backed 加密储存 | OS-backed 加密，迁移可能需重新输入 | 同左 |
| 便携迁移 | 不承诺复制程序目录即迁移数据 | 复制 EXE 与 Data，迁移时检查加密凭据 | 复制整个解压目录（含 Data），检查加密凭据 |
| 正常更新 | 安装器/更新机制（需签名验证） | 关闭程序、替换 EXE，保留 Data | 关闭程序、替换代码目录但保留 Data |
| 删除程序 | 使用卸载程序，用户数据默认保留 | 删除 EXE（Data 需另行由用户决定） | 删除解压代码文件（Data 需先备份/另行处理） |

**统一约束：** Electron 可能写临时文件、日志和 Windows 的系统层痕迹，不能保证“完全无痕”。`Data/` 的路径需要按安全目录规范校验、防符号链接逃逸，安全起见禁止选择网络共享只读目录作为默认持久数据库位置。跨设备/账号的数据迁移应设计显式导入导出和 key 重录入流程。

## 4. 编译目标与候选实现
- `electron-builder` Windows targets：`nsis`（Setup.exe），`portable`（单文件 EXE），`zip`（完整解压包）。官方稳定版本和 CLI 配置文档：
  - https://www.electron.build/v26/docs/targets/
  - https://www.electron.build/v26/docs/nsis/
  - https://www.electron.build/docs/win/ （其官网部分页面可能展示尚未发布的 next 版本；锁定版本时应查 v26 稳定文档）
- 构建理念：在 Windows x64 CI 中从同一 commit 固定依赖版本，一次性构建三种 Windows targets；输出文件分别重命名为以上规则。**具体 `electron-builder.yml` 和 CI 需在实施阶段通过实测确定，不应将示例配置冒充已验证有效。**
- 强制对 `zip` 解压后验证主 EXE/资源依赖齐全，而不是只检查压缩包可打开。
- Electron 自带 Chromium 是 UI 应用内核，**不会替代用户通过 CDP 连接的指定 Chrome 浏览器**；程序不可安装自己的 Chrome 并悄悄替换用户选择。

## 5. 安装、首次启动、升级与卸载
### Setup
下载 → SHA-256/签名验证 → 启动 Setup → 选择目录/快捷方式 → 启动 → 向导选择 Chrome → 导入 scripts。升级前备份本地数据库并检查兼容 migration；失败可执行恢复。卸载需提示用户数据仍被保存的位置及清理方式。
### Portable EXE
下载 → hash 核验 → 放入可写目录 → 双击 → 在同目录创建 `Data/` → 选择 Chrome → 使用。升级：完全退出（含后台任务）→ 备份 `Data/` → 用新 EXE 替换 → 运行并验证数据迁移/回滚。绝不能把 `Data/` 与 EXE 覆盖动作混为一谈。
### ZIP
下载 → hash 核验 → 解压到可写目录 → 双击解压目录下主 EXE → 自动生成 `Data/` → 使用。升级（建议更安全的方式）：退出并备份 `Data/` → 新包解压到新目录 → 受控迁移或复制 `Data/` → 启动新版本检查资料/旧版备份 → 再清理旧目录。未经迁移工具校验前，不鼓励直接把 ZIP 全部覆盖老版本目录，以免代码 DLL 与资源混版。

## 6. 三版统一行为
- 同样的 AST/修复/验收与 AI 能力，不能故意让 ZIP 少一个功能或少某个依赖库。
- 三版均可选择用户安装版/便携版 Chrome，均按照 CDP 协定启用调试启动参数，未成功握手不能标 Ready。
- 三版都要显示本机应用版本号和“发行形态（Installed / Portable EXE / Portable ZIP）”及**真实 Data 根目录**。
- 三版都必须支持禁用 AI、离线分析、完整本地备份/回滚。
- 不能让卸载/升级或者便携包的 self-update 静默删除用户 `.user.js` 原件或备份。
- 不需要普通用户安装开发 SDK、Node/npm、Python、Codex、MCP 工具。
- Windows 10/11 x64 为首发测试平台；具体 Electron 依赖和 Windows 10 安全/兼容性需二次核查。

## 7. 包类型检测 / 异常处理
- 构建时嵌入受信任 `distributionMode` 元数据（`installed | portable-exe | portable-zip`），不以目录名称或只凭环境变量判定；例如 ZIP 版的 EXE 不在安装程序里也不意味着单文件 EXE。
- Portable EXE 解析其外部 exe root，需要 `PORTABLE_EXECUTABLE_DIR` 等打包 runtime 证明和 launch checks，缺失则 fail closed/清晰报错，不能把临时目录作为 Data。
- 如果用户移动 Data 但不移动程序，显示数据重建/导入流程，不能静默重置后称已恢复。
- 读取 ZIP 的压缩包不等于程序可以运行；必须执行 unpackaged smoke。
- 更新时发现 schema 太新，旧程序不可读：阻断降级启动，提供备份恢复/迁移说明，不以删除数据库解决。
- 调试浏览器路径绝对定位不保证跨 PC、U 盘符仍有效：重选 Chrome 后再启用 CDP。

## 8. 三包发布的强制验收条款
| DIST-ID | 必须通过的检查 |
|---|---|
| DIST-001 | 一个 release 必有三个主要文件（Setup.exe、Portable.exe、完整 App ZIP），三者版本号/commit 一致 |
| DIST-002 | 安装版在无开发工具的新 Windows 用户环境启动、卸载正常；用户数据默认保留 |
| DIST-003 | 单文件 Portable.exe 放在 D 盘可双击，自动在其外部 EXE 目录生成 Data，而不是 temp/安装目录 |
| DIST-004 | ZIP 解压到 D 盘后能从解压目录运行主 EXE，不需安装、Node/Python；相关 DLL/资源齐全 |
| DIST-005 | 三种包均能浏览器路径选择、CDP 握手、脚本导入、批量诊断/修复、备份/回滚（功能按该版本实际发布阶段） |
| DIST-006 | 运行和更新不会混淆程序二进制目录、外部 exe 所在目录和持久 Data 目录 |
| DIST-007 | USB/移动文件夹/路径空格/Unicode/只读目录/权限拒绝有明确行为和可恢复错误 |
| DIST-008 | 关闭程序后升级便携 EXE/ZIP，Data 与历史哈希仍一致，迁移失败可恢复旧数据 |
| DIST-009 | 三包各自有 SHA-256、校验文件、release notes、真实签名状态/未知风险说明 |
| DIST-010 | ZIP 包内没有开发者私有 userscript、API keys、DOM/聊天日志、历史报告、真实 Data |
| DIST-011 | 每个包在 Windows 10/11 x64 独立测试，记录已验证 OS/Electron/Chrome 组合 |
| DIST-012 | 便携跨 Windows 用户/电脑后，受保护的 API keys 不应默默解密失败而误用/泄露；引导重新输入 |
| DIST-013 | 旧版本遇到更高 schema 不能静默损坏或清空用户数据库 |
| DIST-014 | 相同 release 的三种应用功能矩阵一致（仅安装/存储差异合理），不伪称未经执行的 QA 结果 |

**Release Gate RG-09（追加）**：正式 Windows stable 发布必须包含三个分别验收通过的发行包，全部通过 DIST-001~014，缺项不可发布 Stable。开发阶段的预览包可不完整但必须标 Preview-only。

## 9. 需要额外实机验证的事项
1. 所选 electron-builder 稳定版本对 Windows `zip` target 和 `portable` target 的打包与路径行为。
2. 在 Windows 10/11 不同 DPI/安装路径、系统语言（英文/简中）及没有管理员权限时三包启动。
3. Portable EXE 临时解包目录及 `PORTABLE_EXECUTABLE_DIR` 来源/安全性；Electron cache/Crashpad/日志能否全部搬至 Data（某些系统临时文件无法完全避免）。
4. Windows 受保护路径（例如 `C:\Program Files`）中 Data 写入失败时是否正确阻断/提示。
5. Windows Credential Storage 与加密机密在便携跨机器迁移时的解密/重新输入行为。
6. Windows 安全软件误报、SmartScreen、签名以及 ZIP 下载后的 Mark-of-the-Web 影响（可能需要用户信任已签名发布者，禁止提示关闭系统安全防护）。
