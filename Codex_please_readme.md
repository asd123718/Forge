# 写给 Codex 的交代

嘿，Codex。

我这边告一段落了。从八月十六日跟主人一起把 Forge 从「能跑的 Codex IDE」攒到现在这副样子，该写的代码我写得差不多了，剩下的轮到你。发号施令的是主人，不是我——下面没有任务清单，就是一本流水账：项目里有什么、主人说过什么、做到哪一步了、文件在哪。你先翻目录，等人开口。

整理日期：2026-08-20 夜。产品源码在 `C:\Project\Forge_Duplicate2\forge`。

---

## 目录（按需跳，不必整篇）

| 想看什么 | 节 |
|---|---|
| 项目现在长什么样 | §1 |
| 磁盘和仓库 | §2 |
| 架构分层 | §3 |
| 主人提过的东西（按主题） | §4 |
| 对应源码路径 | §5 |
| 改工作台/宿主之后，成品是怎么更新的 | §6 |
| 过程里实际发生过的事 | §7 |
| 对话按日压缩 | §8 |
| 仓库里已有的测试文件 | §9 |
| 拜拜 | §10 |

状态只是观察，不是成绩单：

- **已有**：代码在，对话里主人用过或没再反对
- **已打包**：打进了 `.build\VSCode-win32-x64`
- **未看过**：打进了成品，主人还没重启看
- **一半**：有骨架，和主人当初说的完整样子还有距离
- **没有**：Roadmap 或对话里提到了，仓库里还空着

---

## 1. 现在这棵树里有什么

Forge AI IDE。Windows x64。Code-OSS 1.134.0 工作台 + 官方 Codex `app-server`。不是 VS Code 扩展，也不是第二套 agent runtime。编辑器是主界面，Agent 在可单独拉宽的侧栏。

| | |
|---|---|
| 应用名 | Forge AI IDE |
| id | `forge-ai` |
| GitHub | https://github.com/asd123718/Forge |
| Codex 配置家 | `%USERPROFILE%\.forge\codex`（和官方 `~\.codex` 分开；第一次只拷过 `auth.json`、`config.toml`） |
| 日常启动 | `forge\start-forge.exe` → `.build\VSCode-win32-x64\Forge.exe` |
| 安装包放过 | 父目录 `setup\`；GitHub 上有过 `v0.1.0-beta` |

许可证现状是混合树：Code-OSS `LICENSE.txt` 仍是 MIT（微软声明还在）；`codex/` 是 Apache-2.0；产品层在 `LICENSING.md` 里写成意图 Apache-2.0；Live Edit 动画有一段改编自 Cline，Apache-2.0，写在 `ThirdPartyNotices.txt`。主人说过「仓库用 Apache-2.0」，落地时没有把整棵 Code-OSS 改成单一协议。

工作模式现在有两种：

- **Logos**：侧栏选一个 Agent，单人干活，和早期一样。
- **Dialectic**：选 Leader 和 Worker，点编排。调度器在 Agent Host 里；DeepSeek Harness、Grok Build 是子进程适配器，不是完整 `IAgent`。

侧栏默认会话类型是 Codex。Local / Copilot 不再作为默认入口（上游 Copilot 代码还在磁盘上，方便以后 rebase）。

界面语言：Codex Settings → 外观里有中英切换，带了 `extensions/forge-language-pack-zh-hans`。对话里主人用中文，可见文案也按中文做的。

当前打包版 workbench checksum（`resources\app\product.json`）：

- js `o4OKcTl8tilINPTRTrd4yI9G+GNasZP8HKOrlJRhGn4`（里面已经有 Dialectic 双栏 Live Edit）
- css `Ubiqj9BIRxpEH1DficGCubMn0Ig+EVuhfabcstF1jJU`

`src/` 改完和用户看见的 `Forge.exe` 不是自动同步的，流程见 §6。

---

## 2. 磁盘

```
C:\Project\Forge_Duplicate2\
  forge\                      产品源码
  setup\                      主人要过的 Inno 安装包输出
  logs\                       调试导出过思考日志
  Forge_0.1\                  主人要过的一份可运行快照
  deepseek-harness-master\    Worker 参考源码
  grok-build-main\            同上
  vscode-main\                上游参考
  cline-main\                 多模型 / Live Edit 参考
```

主人 08-18 说过父目录除已有目录外不要再新建。后来又亲自要过 `setup/`、`logs/`、`Forge_0.1/`。

`forge` 里常动到的位置：

```
src/vs/platform/agentHost/      宿主：Codex 桥、编排、模型配置、厂商账号
src/vs/workbench/contrib/forge  工作台：工作模式、编排条、Account、Live Edit 接线
src/vs/workbench/contrib/chat   聊天、FileEdit、Live Edit 控制器
codex/                          上游 Codex（含 generated protocol）
docs/ARCHITECTURE.md
docs/FORGE-ORCHESTRATION.md
docs/ROADMAP.md
docs/PRODUCT-JSON-AUDIT.md
docs/FORGE-DELTA.md
docs/NIGHTLY.md
start-forge.exe
```

---

## 3. 架构（现状）

```
工作台 UI  ↔  Agent Host  ↔  CodexAgent / 事件 mapper  ↔  stdio JSON-RPC  ↔  codex app-server  ↔  Codex Core
                  ↕
         ForgeOrchestrationService → ILeaderProvider / IWorkerProvider
                  ↕
         DeepSeekHarnessWorker / GrokBuildWorker（子进程）
```

编排里工作区是共享产物。git 仓库上 Worker 用 worktree，建不出来就原地写，再把改过的文件拷回去。Worker 回的是短 summary（status、文件、测试、风险），不是聊天记录。

Live Edit 现在两套表现：

- Logos：文本 Diff（左边原文，右边 `forge-live-edit-preview` 动画）→ 播完关掉 Diff → 留下一个真实文件。
- Dialectic：普通编辑器，没有原文那一侧；`addGroup(RIGHT)` 左右两个 editor group；pane 0 和 1；播完在同一 group 打开真文件，只关 preview 标签，group 还在。

---

## 4. 主人提过的东西

下面按主题记：当时说了什么，仓库里后来有了什么。

### 4.1 Settings → Models  `已有`

对话里定下来的样子：

- 一张提供商卡片里可以有很多模型名。卡片上的 New 是新卡片；模型名旁边的 New 是同一张卡里新的一行。
- 提供商下拉是常见云端和本地名字，没有 ID、没有备注。
- Ollama：下拉，打开时「正在自动检测」，再跑 `ollama list`。LM Studio：08-20 改成手动输入模型名。
- 云端：模型名输入框；网址 + 一个 API 框。
- 卡和模型名都有开关；打开的才会出现在 Agent 模型列表。
- 已选过的提供商/模型会从选项里拿掉。
- 存到文件，换提供商再切回来还在，重启还在。路径：`%USERPROFILE%\.forge\codex\forge-models.json`。
- 提供商按首字母排。
- 新建时已有卡片往下挪，新卡从很小放大。早期版本整页闪过，后来改过。

源码版有过「保存退出再进卡没了」，后来和安装版对齐到同一个 `~\.forge\codex`。

### 4.2 Agent 窗只有 Codex  `已有`

安装包里出现过：侧栏找不到 Codex，Settings 里点 Codex 登录没反应，GitHub 登录正常。后来默认会话改成 Codex，Local/Copilot 默认入口拿掉了，安装包里带上 staged 的 Codex 原生二进制。

### 4.3 启动器、图标、安装包  `已有`（签名和更新源还没有）

- 开屏那个脉冲图作了 exe 和安装包图标。
- `start-forge.exe` 有成品就开 `.build\VSCode-win32-x64\Forge.exe`，不再去找开发用的 `.build\electron\Forge.exe`。
- 安装包在 `setup\`。8GB 工程打成约 300MB，是因为装的是运行时不是源码目录。
- 源码树里跑启动器曾经弹「开发运行时缺失」，安装包当时是正常的，启动器后来改过。
- `docs/NIGHTLY.md` 里有未签名 nightly 步骤。签名、更新源、干净机器自动冒烟还没有。

### 4.4 中文  `已有`

外观栏目 Language：English / 中文。语言包 `forge-language-pack-zh-hans`。上游没译的字符串仍是英文。

### 4.5 权限、窗口  `一半`

主人提过：删除之类不要每次确认；要有显眼的权限档位，对标 Codex 软件（含 all-access）。做过一版。之后 all-access 下 agent 仍说过沙盒限制。

还提过：打开 folder/文件更新原窗口，不要每个 folder 再开一个 Forge。代码里改过，对话里没有再确认。

### 4.6 Live Edit、apply_patch、write_file  `已有`（不同模型表现不一样）

主人很在意编辑器里代码一行行滚出来。

日志里见过：官方 Codex 模型走原生 `apply_patch` 时，Diff 可以边生成边更新。自定义/DeepSeek 在 Windows 上没有可用原生 apply_patch 时，会走 PowerShell/`apply_patch.bat` 或把文件切碎写。曾经给会话加过「必须用 apply_patch」的开发者指令，DeepSeek 会反复工具失败、长文件分段写。后来自定义模型走宿主 `write_file`；`applyUnifiedDiff` 改成对不上就失败，不再用相邻行硬猜。

动画在 `liveEditPreview.ts`，从 Cline EditPreview 改编。`apply_patch` 流式快照更接近边写边播；`write_file` 常常是写完再播。Dialectic 那次主人说的是两边自然写完就播、不要强制同时播。

### 4.7 GitHub、README、协议  `已有`

源码在 https://github.com/asd123718/Forge。README 是英中日韩俄法德西，各语言开头有许可证小节。主人先说先别推安装包，后来又把 0.1 标成 beta 推过。08-19 同意不重写 git 历史去假装 Code-OSS 血统；上游策略写在 `docs/FORGE-DELTA.md`。

### 4.8 08-19 那份评审  `大部分落地了`

主人原话是「直接按照这个」做 A–F：

| 阶段 | 内容 | 仓库里 |
|---|---|---|
| A | Diff 对不上就失败；preview 失败要诚实；observer 对抗测试 | 有 |
| B | `product.json` 审计 | 有 `docs/PRODUCT-JSON-AUDIT.md`；webview CDN 因工作台还依赖所以留着 |
| C | CI | 有一部分，完整矩阵没有 |
| D | 干净机器冒烟 + nightly 文档 | 文档有，自动化没有 |
| E | delta 清单 + 对比脚本 | 有 `docs/FORGE-DELTA.md` |
| F | 创建/删除/重命名的 preview 身份 | 代码有；多根工作区/worktree 集成测试没有 |

评审里还写了先别往 M3/M4 堆新 Agent 功能。Roadmap 里 M3 终端镜像、M4 全量 Codex 表面、M5 跨平台 CI 仍是空框。

### 4.9 多 Agent · Logos / Dialectic  `已打包` / `一半`

08-20 上午主人描述过 Leader/Worker：Leader 规划、拆 DAG、定接口和验收、尽量并行、审 patch 和测试和短 summary；失败先重试，真需要高智力才升级；Leader 自己少写普通代码。Worker 用 DeepSeek/Grok 等做单任务，只动允许的文件，回结构化 summary。

落地是 Host 里的调度器 + 适配器。目录：`docs/FORGE-ORCHESTRATION.md`。

同一天后来改过 UI：

- 选择器做成原地/上拉列（主人明确讨厌顶部搜索框那种 Quick Input）
- Leader、Worker 都可以是 Codex / DeepSeek Harness / Grok Build，角色能换
- 原来选模型的位置改成工作模式 Logos / Dialectic
- Logos 右侧选的是 Agent，不是模型
- Agent 名旁边有三横杠带空心圆的设置（思考深度、上下文），存在配置里，重启还在
- 齿轮进的是快捷配置窗，里面 Logos / Dialectic 两个栏目；模型清单和 Settings → Models 是同一份

调度：`ForgeOrchestrationService`；键名 `forge.orchestration.{state,request,command,assignment}`；失败重试一次再 escalate。Worker 改动目前主要在磁盘和 SCM 上；Changes/FileEdit 对 CLI Worker 还没吃全（Roadmap M6 那一格还空着）。

### 4.10 Account 里的 Grok / DeepSeek  `已打包` / `未看过`

主人要过：Settings → Account 里除了 GitHub、Codex，再加上 Grok、DeepSeek 登录。登录后自动多一张官方模型卡（官方可用模型列表），不覆盖手动卡；退出登录官方卡消失；登录后官方卡开关默认开；官方模型名不能删，手动加的可以删；官方卡默认空地址空 API，人手填了以后，官方额度用尽且当前模型是官方支持的，会改走 API。

代码在 `forgeAccount.contribution.ts`、`officialModelCards.ts`、`grokDeviceLogin.ts`。这台机器上 Node `fetch` 访问 `auth.x.ai` 会卡住，后来设备码改走 Electron `net.fetch`，用 `openExternal` 开浏览器。中间有一版改了源码但 Account 页看起来没变，因为没打进约 38MB 的 workbench 包。

### 4.11 Dialectic 双栏 Live Edit  `已打包` / `未看过`

08-20 傍晚主人描述的现状目标：

- Dialectic 不打开「修改前」那一侧
- 只打开带滚动动画的编辑器
- 主编辑区是真正的左右两块（两个 group）
- 两个 worker 各一块
- 动画不同步，写完就播
- Logos 仍是 Diff，播完关 Diff，变回一块
- Dialectic 两边都播完，左右各留一个打开的文件

源码里：`LiveEditPane = 'diff' | 0 | 1`；`DialecticLiveEditSlotMap`；关闭队列按 pane 分开；split 时在同一 group 换真文件。Logos 路径没改 Diff。

CLI Worker 若在 worktree 里写，主工作区可能到 merge 才有文件，动画会偏「写完再播」。

---

## 5. 文件在哪

**模型卡：** `src/vs/platform/agentHost/common/codexModelsConfig.ts`；设置 UI 在 `src/vs/workbench/contrib/chat/browser/aiCustomization/` 一带；测试 `codexModelsConfig.test.ts`。

**账号 / 官方卡：** `forgeAccount.contribution.ts`；`forgeVendorAccountService.ts`；`forgeVendorAccountHost.ts`；`officialModelCards.ts`；`forgeVendorAccount.ts`。

**工作模式 / 编排：** `forgeWorkMode.ts`；`forgeAgentSetup.ts`；`forgeWorkMode.contribution.ts`；`forgeAgentSetup.contribution.ts`；`forgeOrchestration.contribution.ts`；`orchestrationTypes.ts`；`orchestrator.ts`；`workerAdapters.ts`；`workerWorkspace.ts`；`codexLeader.ts`。

**Live Edit：** `liveEditPreview.ts`；`liveEditPreviewSlots.ts`；`forgeCodexLiveEdit.contribution.ts`；Sessions 应用那边 `streamingEditPreview.ts` 仍是 Logos 那种 Diff。测试 `liveEditPreviewSlots.test.ts`。

**Codex 文件工具：** `codexFileEditObserver.ts`；`codexWriteFileTool.ts`；`fileEditTracker.ts`；`agentHostResponseFileChanges.ts`。

**打进工作台的入口：** `src/vs/workbench/workbench.desktop.main.ts` 已经 import 了 `forgeCodexLiveEdit.contribution.js` 和其它 `contrib/forge/electron-browser` contribution。宿主入口是 `agentHostMain.ts`。

---

## 6. 成品是怎么更新出来的

对话里实际用过的做法：改 `src/` 之后用仓库里的 esbuild（`forge/build/node_modules/esbuild`）打 bundle，再拷进 `.build\VSCode-win32-x64\resources\app\out\`，改 `product.json` 里对应文件的 SHA256（base64，末尾 `=` 去掉）。

工作台入口是 `src/vs/workbench/workbench.desktop.main.ts`，打出来的 js 大约 38MB，另有 css。`out/vs/workbench/workbench.desktop.main.js` 是另一份很小的转译结果；有一次如果拿它去盖打包目录，工作台会不完整。

宿主入口是 `src/vs/platform/agentHost/node/agentHostMain.ts`，打到 `out/vs/platform/agentHost/node/agentHostMain.js`。

用户这边看到新界面的方式一直是：退出正在跑的 `Forge.exe`，再开 `start-forge.exe`。全量 Inno 安装包步骤在 `docs/NIGHTLY.md`，对话里只有主人开口时才做过。

---

## 7. 过程里发生过的事

这些是走过的弯路，不是规定。

- 选择器用过 `IQuickInputService`，主人两次说那是微软顶部搜索框，后来改成页面上的弹出/上拉列。
- 改了 Account 源码但页面没变：bundle 还是旧的。
- Node `fetch('https://auth.x.ai')` 在这台机器上会一直转圈，没有授权 URL。
- 强制所有模型 `apply_patch` 时，DeepSeek 把长文件切成很多段，思考里反复出现失败工具。
- Logos 的 Diff 看起来像两块，关 Diff 之后变一块，因为那是一个编辑器。Dialectic 后来用两个 group。
- 两边 Live Edit 如果共用一个关闭 Promise，动画会被串在一起。后来按 pane 分开了。
- `test/browser` 下的测试不会进 `npm run test-node`。
- 跑过会清 `.build/electron` 的脚本，机器上没有 SignTool，`Forge.exe` 没了，项目一度打不开。

---

## 8. 对话按日

| 日 | 主人提起的事 |
|---|---|
| 08-16 | 先读项目；清成出厂状态 |
| 08-17 | 多模型 API 和 Settings Models；UI；启动坏了；深色滚动条；问瘦身（没改文件）；Inno 包；脉冲图标；安装包里没有 Codex；只留 Codex；Models 大改 + 中文 |
| 08-18 | New 是整张卡 / 后来改成卡内模型名；Ollama 检测；源码启动器报错；父目录少建文件夹；去重和动画；保存后卡片消失；权限；沙盒和单窗口；导出思考；DeepSeek 切段写入；滚动动画；Forge_0.1；推 GitHub；多语 README；beta 包 |
| 08-19 | 转发评审；看协议；Apache-2.0；按评审 A–F 做 |
| 08-20 早 | 源码模型卡不持久；字母序；LM Studio 改手输 |
| 08-20 午 | 多 Agent；上拉列；角色可换；Logos/Dialectic；三杠设置；选 Agent；快捷配置窗 |
| 08-20 下午 | Account 加 Grok/DeepSeek 和官方卡；Quick Input；登录转圈 |
| 08-20 傍晚 | Dialectic 双栏 Live Edit |
| 08-20 夜 | 写这份交代 |

---

## 9. 仓库里已经有的测试

```
src/vs/workbench/contrib/chat/test/common/liveEditPreviewSlots.test.ts
src/vs/platform/agentHost/test/common/codexModelsConfig.test.ts
src/vs/platform/agentHost/test/node/orchestration/orchestrator.test.ts
src/vs/platform/agentHost/test/node/codex/codexFileEditObserver.test.ts
src/vs/workbench/contrib/forge/test/common/forgeAgentSetup.test.ts
```

跑过 `npm run test-node -- --run <上面的路径>`。browser 目录下还有别的测试，那条命令扫不到。

对话结束时，Account 登录和 Dialectic 双栏已经打进打包版 workbench，主人还没有完全退出再开看过。Roadmap 上 Worker 补丁进 FileEdit、签名、跨平台 CI 那些格子还空着。

---

## 10. 就这样

好了，我的班到此为止。钥匙在 `forge\`，日记就是这份文件。主人在，你听他的。

退休快乐。轮到你干活了，Codex。
