# Forge AI IDE

[English](#english) · [中文](#zhongwen) · [日本語](#ribenyu) · [한국어](#hanguoyu) · [Русский](#eyu) · [Français](#fayu) · [Deutsch](#deyu) · [Español](#xibanyayu)

[License](#license)

---

<h2 id="english">English</h2>

### License

This tree is not MIT-only.

- **Forge** original work and **[Code - OSS](https://github.com/microsoft/vscode)**: [MIT](LICENSE.txt). The Microsoft copyright notice in that file is kept on purpose.
- **[Codex](https://github.com/openai/codex)** under `codex/`: [Apache-2.0](codex/LICENSE), plus [NOTICE](codex/NOTICE).
- Live edit preview animation: portions adapted from **[Cline](https://github.com/cline/cline)**, Apache-2.0 (full text in [ThirdPartyNotices.txt](ThirdPartyNotices.txt)).
- Other bundled components: [ThirdPartyNotices.txt](ThirdPartyNotices.txt).

Code - OSS MIT is not the Visual Studio Code product license and does not grant Microsoft trademarks.

Forge is a standalone desktop IDE based on [Code - OSS](https://github.com/microsoft/vscode). It embeds the official [Codex](https://github.com/openai/codex) runtime as a native agent. It is not a VS Code extension and it does not replace the editor with a chat-only shell. The editor stays the main pane; Codex lives in a separately resizable side pane.

The source tree currently targets **Windows x64**. The product name is Forge AI IDE. The application id is `forge-ai`.

### What you get

- **Full IDE**: editor, terminal, SCM, Problems, notifications, and the extension system from Code - OSS.
- **Native Codex**: sessions run through the official `codex app-server` over JSON-RPC / stdio. Forge does not reimplement the agent runtime.
- **Codex only**: the agent pane defaults to Codex and does not mix in Local or Copilot session types.
- **Streaming file edits**: catalog Codex models can stream native `apply_patch` diffs. Compatible / custom models use the host `write_file` tool, then play a write animation in the editor.
- **Approvals and changes**: patches still go through Codex approval and sandboxing. Afterward you can Accept, Reject, or Revert in Changes / Multi Diff.
- **Accounts and remaining quota**: the chat title and Codex Settings Account page support GitHub and Codex sign-in, and show remaining allowance, identity, and plan (not consumed usage).
- **Custom models**: configure OpenAI, DeepSeek, Qwen, Ollama, LM Studio, and similar providers in Codex Settings → Models. Each provider card can hold many model names, with per-model switches and persistence in `%USERPROFILE%\.forge\codex\forge-models.json`. Ollama lists models via `ollama list`; LM Studio uses manual model names.
- **Vendor accounts**: Codex Settings → Account supports GitHub, Codex, Grok, and DeepSeek sign-in. Official read-only model cards are added on login and removed on logout without overwriting manual cards. When official quota is exhausted and you supplied API credentials, routing can fall back to your API.
- **Work modes**: **Logos** runs a single agent in the side pane (Codex, DeepSeek Harness, or Grok Build). **Dialectic** assigns a Leader and parallel Workers through the host orchestrator; press **Enter** or **Send** to start a run (no separate stop button in the chat toolbar—use **Cancel** to abort). Agent quick setup (thinking depth, context size) persists across restarts and shares the Models catalog.
- **Multi-agent orchestration**: `ForgeOrchestrationService` schedules Leader/Worker tasks with git worktrees for isolation. CLI workers require API keys or saved credentials; when DeepSeek Harness or Grok Build is unavailable, Forge falls back to Codex for that task. Workers return structured summaries and changed files, not chat transcripts. See [docs/FORGE-ORCHESTRATION.md](docs/FORGE-ORCHESTRATION.md).
- **Live Edit**: Logos streams `apply_patch` diffs in a side-by-side preview, then opens one file. Dialectic splits the main editor into two groups so each worker gets its own pane; animations run independently and both files stay open when finished.
- **Chinese UI**: Codex Settings → Appearance → Language can enable the built-in Simplified Chinese language pack.

### How it relates to other products

| | Forge | VS Code | Codex Desktop |
| --- | --- | --- | --- |
| Workbench | Full Code - OSS IDE | Official distribution | Standalone client |
| Agent | Built-in official Codex `app-server` | Extensions or other agents | Official Codex |
| Config home | `%USERPROFILE%\.forge\codex` | n/a | `%USERPROFILE%\.codex` |
| Sign-in | Can reuse existing `auth.json` / `config.toml` | GitHub and others | ChatGPT / Codex |

On first launch Forge **copies** only `auth.json` and `config.toml` from an existing `%USERPROFILE%\.codex` install. Model caches, sessions, and databases are not shared, so schema collisions are avoided when Forge and Codex Desktop update on different schedules.

### Repository layout

```
src/                 # workbench, Agent Host, Codex bridge
extensions/          # built-in extensions
build/               # compile, package, Inno Setup
resources/           # icons and installer artwork
  └── forge-runtime/ # bundled console Node and Electron ABI native overlay
test/                # unit / smoke tests
scripts/             # dev launch and Forge helpers
└── forge/           # Codex staging and upstream checks
docs/                # architecture, orchestration, roadmap, packaging
codex/               # upstream Codex runtime and app-server
start-forge.bat      # source-only Windows entry point
logs/                # one detailed timestamped directory per launch
product.json         # product name, protocol, Windows setup ids
```

Seams: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Orchestration: [docs/FORGE-ORCHESTRATION.md](docs/FORGE-ORCHESTRATION.md). Milestones: [docs/ROADMAP.md](docs/ROADMAP.md). Licensing: [LICENSING.md](LICENSING.md).

### Requirements

The prepared portable source tree includes its Node dependencies, console Node runtime, Electron runtime, native bindings, and Codex binary. Starting it needs:

- Windows 10/11 x64
- the complete repository contents, including `node_modules`, `resources\forge-runtime`, and `.build\electron`

### Quick start

```bat
start-forge.bat
```

The BAT immediately hands off to a hidden source launcher, uses the bundled console Node runtime to compile the current source, restores the bundled Electron ABI bindings, and starts one development workbench. It neither installs dependencies nor builds a packaged application. Per-launch diagnostics are written under `logs\<detailed-local-time>\`.

A plain GitHub clone intentionally does not contain the ignored `node_modules/` and `.build/electron/` directories. For a no-install portable copy, transfer the complete prepared source directory (for example as an archive). The repository tracks `resources/forge-runtime/`, including the console Node executable (through Git LFS) and native ABI overlay.

To use a binary built from local `codex/` instead of the package pinned by Code - OSS:

```bat
scripts\forge\stage-codex.ps1
```

After staging, the launcher picks that binary. Forge does not reimplement the Codex protocol.

### Using Codex

1. Open the right-hand agent / chat pane. It should already be Codex.
2. Click **Open Codex Settings**.
3. **Sign in to Codex** uses official OAuth. Failures show a concrete error on the settings page.
4. **Model provider**: pick a cloud or local vendor. Ollama tries `ollama list`. Cloud providers need a base URL and API key.
5. Each provider and each saved model name has a switch. Only enabled entries appear in the agent model picker.

In installed builds, the Codex binary lives under `node_modules.asar.unpacked\@openai\codex-win32-x64\...`. Agent Host prefers that unpacked `codex.exe` and uses an existence check on Windows (not Unix execute bits).

For custom / compatible models the host registers a JSON tool named `write_file` (`path` + full `contents`). Do not name it `apply_patch`: a second tool with that name panics Codex if native `apply_patch` is already registered. Do not call `apply_patch.bat` through `shell_command` on Windows.

### Data and logs

| Path | Purpose |
| --- | --- |
| `%USERPROFILE%\.forge\codex` | Forge Codex home (config, sessions) |
| `%USERPROFILE%\.forge\codex\forge-models.json` | Custom providers and models |
| `%APPDATA%\Forge` | Workbench settings, secrets, chat sessions |
| `%USERPROFILE%\.forge-ai` | argv.json, extensions, policy |
| `<Forge repository>\logs\<detailed local timestamp>\` | Launcher, workbench, Agent Host, UI, tool, terminal, file and error logs for one run |

The `logs` root contains timestamped session directories only. Duplicate-start protection uses an in-memory Windows named mutex, so no `.lock` file is created. Every event line uses 24-hour local time with milliseconds and UTC offset.

If Codex does not start or sign-in does nothing:

`<Forge repository>\logs\<detailed timestamp>\agenthost.log`

### Architecture

```
Workbench chat / editor / terminal
        │
   Agent Host (session state, approvals, FileEdit)
        │                    ForgeOrchestrationService
        │                    Leader / Worker adapters
   CodexAgent + event mapping
        │  JSON-RPC over stdio
   codex app-server
        │
   Codex Core (tools, sandbox, MCP, skills)
```

Streaming patches use `item/fileChange/patchUpdated`. `write_file` snapshots the file before disk write, then uses the same Live Edit preview. Dialectic mode maps workers to editor panes 0 and 1. Hidden chain-of-thought is not reconstructed; the UI only renders public summaries and status from app-server.

---

<h2 id="zhongwen">中文</h2>

### 许可证

本仓库不是「整份只有 MIT」。

- **Forge** 自有代码和 **[Code - OSS](https://github.com/microsoft/vscode)**：[MIT](LICENSE.txt)。根目录文件里的 Microsoft 版权声明会保留。
- `codex/` 里的 **[Codex](https://github.com/openai/codex)** 运行时：[Apache-2.0](codex/LICENSE)，以及 [NOTICE](codex/NOTICE)。
- 实时改文件预览动画有一部分改编自 **[Cline](https://github.com/cline/cline)**，协议为 Apache-2.0（全文见 [ThirdPartyNotices.txt](ThirdPartyNotices.txt)）。
- 其余第三方组件见 [ThirdPartyNotices.txt](ThirdPartyNotices.txt)。

Code - OSS 的 MIT 不等于 Visual Studio Code 产品许可，也不包含微软商标。

Forge 是基于 [Code - OSS](https://github.com/microsoft/vscode) 的独立桌面 IDE，把官方 [Codex](https://github.com/openai/codex) 作为原生 Agent 运行时嵌进工作台。它不是 VS Code 扩展，也不另开一套聊天壳：编辑器仍是主界面，Codex 在可独立缩放的侧栏里工作。

当前源码面向 **Windows x64**。产品名称为 Forge AI IDE，应用标识为 `forge-ai`。

### 能做什么

- **完整 IDE**：编辑器、终端、SCM、Problems、通知、扩展体系沿用 Code - OSS。
- **原生 Codex**：通过官方 `codex app-server`（JSON-RPC / stdio）驱动会话，不重写一套 Agent 运行时。
- **只保留 Codex**：Agent 窗口默认且仅展示 Codex，不再混入 Local / Copilot 会话类型。
- **流式改文件**：官方模型走原生 `apply_patch` 时，可边生成边出 Diff 预览；自定义模型走宿主 `write_file` 工具，完成后在编辑器里播放写入动画。
- **审批与变更**：补丁仍走 Codex 的审批与沙箱；完成后可在 Changes / Multi Diff 里 Accept、Reject、Revert。
- **账号与额度**：聊天标题和 Codex Settings 的 Account 页支持 GitHub / Codex 登录，展示剩余额度、身份与套餐（不展示已消耗量）。
- **自定义模型**：Codex Settings → Models 里配置 OpenAI、DeepSeek、通义、Ollama、LM Studio 等。一张提供商卡片可包含多个模型名，各自有开关；持久化到 `%USERPROFILE%\.forge\codex\forge-models.json`。Ollama 通过 `ollama list` 检测；LM Studio 需手动输入模型名。
- **厂商账号**：Account 支持 GitHub、Codex、Grok、DeepSeek 登录。登录后自动添加只读官方模型卡，退出后消失，不覆盖手动卡；官方额度用尽且你填写了 API 时可改走 API。
- **工作模式**：**Logos** 侧栏选一个 Agent（Codex / DeepSeek Harness / Grok Build）；**Dialectic** 选 Leader 和 Worker 并行编排，按 **Enter** 或 **发送** 即可开始（聊天工具栏无单独停止按钮，用 **Cancel** 取消编排）。快捷配置窗可设思考深度、上下文长度，重启保持，与 Models 共用模型清单。
- **多 Agent 编排**：Host 内 `ForgeOrchestrationService` 调度 Leader/Worker，git worktree 隔离并行任务。CLI Worker 需要 API 密钥或已保存凭据；DeepSeek Harness / Grok Build 不可用时，Forge 会自动回退到 Codex 执行该任务。详见 [docs/FORGE-ORCHESTRATION.md](docs/FORGE-ORCHESTRATION.md)。
- **Live Edit**：Logos 用 Diff 边生成边滚；Dialectic 主编辑区左右两块，各 worker 一块，动画独立，播完各留一个文件。
- **中文界面**：Codex Settings 的外观里可切换 Language；确认后可启用内置简体中文语言包。

### 和现有产品的关系

| | Forge | VS Code | Codex Desktop |
| --- | --- | --- | --- |
| 工作台 | Code - OSS 完整 IDE | 官方发行版 | 独立客户端 |
| Agent | 内置官方 Codex `app-server` | 需扩展或其它 Agent | 官方 Codex |
| 配置目录 | `%USERPROFILE%\.forge\codex` | 不适用 | `%USERPROFILE%\.codex` |
| 登录 | 可复用已有 `auth.json` / `config.toml` | GitHub 等 | ChatGPT / Codex |

首次启动时，Forge 只会从已有的 `%USERPROFILE%\.codex` **复制** `auth.json` 和 `config.toml`。模型缓存、会话和数据库不会与其它 Codex 客户端共用。

### 仓库结构

见上方 English 一节的目录树。架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，编排见 [docs/FORGE-ORCHESTRATION.md](docs/FORGE-ORCHESTRATION.md)，里程碑见 [docs/ROADMAP.md](docs/ROADMAP.md)，许可见 [LICENSING.md](LICENSING.md)。

### 环境要求

- Windows 10/11 x64
- 保留完整仓库，包括 `node_modules`、`resources\forge-runtime` 和 `.build\electron`

### 快速开始

```bat
start-forge.bat
```

BAT 会立即交给隐藏的源码启动器，使用项目内置的控制台 Node 编译当前源码，恢复内置 Electron ABI 原生绑定，然后只启动一个开发工作台；不安装依赖，不构建打包版。每次启动的日志写入 `logs\<详细本地时间>\`。

GitHub 中的纯源码 clone 不包含被忽略的 `node_modules/` 和 `.build/electron/`。如果要在另一台电脑上免安装双击启动，应传输完整的已准备源码目录（例如整体压缩）。仓库会跟踪 `resources/forge-runtime/` 中的控制台 Node（通过 Git LFS）和原生 ABI 覆盖层。

本地 Codex 源码二进制：`scripts\forge\stage-codex.ps1`。

### Codex 使用说明

1. 打开右侧 Agent / 聊天窗，应默认就是 Codex。
2. 点 **Open Codex Settings**。
3. **登录 Codex** 走官方 OAuth；失败时设置页给出具体错误。
4. 模型提供商可选云端或本地；Ollama 会尝试读取 `ollama list`。
5. 每个提供商、每个已保存模型名都有开关，打开后才会出现在模型列表里。

自定义模型使用 JSON 工具 `write_file`（`path` + 完整 `contents`）。不要把该工具命名为 `apply_patch`，也不要通过 `shell_command` 调用 `apply_patch.bat`。

### 数据与日志

| 路径 | 用途 |
| --- | --- |
| `%USERPROFILE%\.forge\codex` | Forge 专用 Codex home |
| `%USERPROFILE%\.forge\codex\forge-models.json` | 自定义提供商与模型 |
| `%APPDATA%\Forge` | 工作台设置、密钥、聊天会话 |
| `%USERPROFILE%\.forge-ai` | argv.json、扩展、策略 |
| `<Forge 仓库>\logs\<详细本地时间>\` | 单次运行的启动、工作台、Agent Host、UI、工具、终端、文件和错误日志 |

日志根目录只包含带时间的会话目录。重复启动防护使用 Windows 内存命名互斥量，不会生成 `.lock` 文件。每条事件使用 24 小时制本地时间、毫秒和 UTC 偏移。

Codex 起不来时看：`<Forge 仓库>\logs\<详细时间>\agenthost.log`

---

<h2 id="ribenyu">日本語</h2>

### ライセンス

このリポジトリは MIT だけの単一ライセンスではありません。

- **Forge** 独自部分と **[Code - OSS](https://github.com/microsoft/vscode)**：[MIT](LICENSE.txt)。ファイル内の Microsoft 著作権表示は残します。
- `codex/` の **[Codex](https://github.com/openai/codex)**：[Apache-2.0](codex/LICENSE) と [NOTICE](codex/NOTICE)。
- ライブ編集プレビューの一部は **[Cline](https://github.com/cline/cline)** 由来（Apache-2.0）。全文は [ThirdPartyNotices.txt](ThirdPartyNotices.txt)。
- その他の第三者通知：[ThirdPartyNotices.txt](ThirdPartyNotices.txt)。

Code - OSS の MIT は Visual Studio Code 製品ライセンスではなく、Microsoft の商標許諾でもありません。

Forge は [Code - OSS](https://github.com/microsoft/vscode) を土台にした独立デスクトップ IDE で、公式 [Codex](https://github.com/openai/codex) をネイティブ Agent として組み込みます。VS Code 拡張ではなく、チャット専用シェルでもありません。エディタが主画面のまま、Codex は独立してリサイズできるサイドペインで動きます。

ソースは現在 **Windows x64** 向けです。製品名は Forge AI IDE、アプリ ID は `forge-ai` です。

### できること

- **フル IDE**：エディタ、ターミナル、SCM、Problems、通知、拡張は Code - OSS です。
- **ネイティブ Codex**：公式 `codex app-server`（JSON-RPC / stdio）でセッションを駆動します。Agent ランタイムは再実装しません。
- **Codex のみ**：Agent ペインの既定は Codex で、Local / Copilot は混ぜません。
- **ストリーミング編集**：公式モデルはネイティブ `apply_patch` の Diff を流せます。互換モデルはホストの `write_file` を使い、完了後にエディタで書き込みアニメーションを再生します。
- **承認と変更**：パッチは Codex の承認とサンドボックスを通り、Changes / Multi Diff で Accept / Reject / Revert できます。
- **アカウント**：GitHub / Codex ログイン、残りの枠、プラン表示（消費量は出さない）。
- **カスタムモデル**：Codex Settings → Models でプロバイダーと複数モデル名を設定。Ollama は `ollama list`、LM Studio は手入力。
- **ベンダーアカウント**：Account で GitHub / Codex / Grok / DeepSeek にログイン。公式の読み取り専用モデルカードを追加（手動カードは上書きしない）。
- **ワークモード**：**Logos** は単一 Agent、**Dialectic** は Leader + 並列 Worker。**Enter** または **Orchestrate** で開始。CLI Worker は API キーまたは保存済み資格情報が必要で、利用不可の場合は Codex にフォールバックします。詳細は [docs/FORGE-ORCHESTRATION.md](docs/FORGE-ORCHESTRATION.md)。
- **Live Edit**：Logos は Diff ストリーミング、Dialectic はエディタを左右 2 ペインに分割。
- **中国語 UI**：Appearance の Language から簡体字パックを有効化できます。

### 他製品との関係

初回起動時、既存の `%USERPROFILE%\.codex` から `auth.json` と `config.toml` だけを**コピー**します。キャッシュやセッションは共有しません。設定ホームは `%USERPROFILE%\.forge\codex` です。

### クイックスタート

```bat
start-forge.bat
```

準備済みのポータブルソースツリーで実行してください。ログは `logs\<詳細なローカル時刻>\` に保存され、ルートにログやロックファイルは作成されません。

---

<h2 id="hanguoyu">한국어</h2>

### 라이선스

이 저장소는 MIT 하나만 있는 트리가 아닙니다.

- **Forge** 자체 코드와 **[Code - OSS](https://github.com/microsoft/vscode)**: [MIT](LICENSE.txt). 파일의 Microsoft 저작권 고지는 유지합니다.
- `codex/`의 **[Codex](https://github.com/openai/codex)**: [Apache-2.0](codex/LICENSE) 및 [NOTICE](codex/NOTICE).
- 라이브 편집 미리보기의 일부는 **[Cline](https://github.com/cline/cline)**에서 각색(Apache-2.0). 전문은 [ThirdPartyNotices.txt](ThirdPartyNotices.txt).
- 기타 구성 요소: [ThirdPartyNotices.txt](ThirdPartyNotices.txt).

Code - OSS MIT는 Visual Studio Code 제품 라이선스가 아니며 Microsoft 상표를 부여하지 않습니다.

Forge는 [Code - OSS](https://github.com/microsoft/vscode) 기반의 독립 데스크톱 IDE이며, 공식 [Codex](https://github.com/openai/codex)를 네이티브 Agent로 내장합니다. VS Code 확장도 아니고, 채팅 전용 셸도 아닙니다. 편집기가 메인 창이고 Codex는 따로 크기를 조절할 수 있는 사이드 패널에서 동작합니다.

현재 소스는 **Windows x64**를 대상으로 합니다. 제품 이름은 Forge AI IDE, 앱 ID는 `forge-ai`입니다.

### 제공하는 기능

- **완전한 IDE**: 편집기, 터미널, SCM, Problems, 알림, 확장 시스템은 Code - OSS입니다.
- **네이티브 Codex**: 공식 `codex app-server`(JSON-RPC / stdio)로 세션을 돌립니다. Agent 런타임을 다시 구현하지 않습니다.
- **Codex만**: Agent 패널 기본값은 Codex이며 Local / Copilot을 섞지 않습니다.
- **스트리밍 편집**: 공식 모델은 네이티브 `apply_patch` Diff를 스트리밍할 수 있습니다. 호환 모델은 호스트 `write_file`을 쓰고, 완료 후 편집기에서 쓰기 애니메이션을 재생합니다.
- **승인**: 패치는 Codex 승인과 샌드박스를 거칩니다. 이후 Changes / Multi Diff에서 Accept / Reject / Revert가 가능합니다.
- **계정**: GitHub / Codex 로그인, 남은 허용량과 플랜(사용량은 표시하지 않음).
- **사용자 모델**: Codex Settings → Models에서 프로바이더와 여러 모델 이름을 설정합니다. Ollama는 `ollama list`, LM Studio는 수동 입력입니다.
- **벤더 계정**: Account에서 GitHub / Codex / Grok / DeepSeek 로그인. 공식 읽기 전용 모델 카드 추가(수동 카드는 덮어쓰지 않음).
- **작업 모드**: **Logos** 단일 Agent, **Dialectic** Leader + 병렬 Worker. **Enter** 또는 **Orchestrate**로 시작합니다. CLI Worker는 API 키 또는 저장된 자격 증명이 필요하며, 사용할 수 없으면 Codex로 폴백합니다. [docs/FORGE-ORCHESTRATION.md](docs/FORGE-ORCHESTRATION.md) 참고.
- **Live Edit**: Logos는 Diff 스트리밍, Dialectic은 편집기를 좌우 두 패널로 분할합니다.

첫 실행 시 기존 `%USERPROFILE%\.codex`에서 `auth.json`과 `config.toml`만 **복사**합니다. Forge 홈은 `%USERPROFILE%\.forge\codex`입니다.

### 빠른 시작

```bat
start-forge.bat
```

준비된 포터블 소스 트리에서 실행합니다. 로그는 `logs\<자세한 로컬 시간>\`에 저장되며 루트에 로그나 잠금 파일을 만들지 않습니다.

---

<h2 id="eyu">Русский</h2>

### Лицензия

Репозиторий не является деревом только с MIT.

- Собственный код **Forge** и **[Code - OSS](https://github.com/microsoft/vscode)**: [MIT](LICENSE.txt). Уведомление об авторских правах Microsoft в этом файле сохраняется.
- **[Codex](https://github.com/openai/codex)** в `codex/`: [Apache-2.0](codex/LICENSE) и [NOTICE](codex/NOTICE).
- Часть анимации предпросмотра правок адаптирована из **[Cline](https://github.com/cline/cline)** (Apache-2.0); полный текст в [ThirdPartyNotices.txt](ThirdPartyNotices.txt).
- Прочие компоненты: [ThirdPartyNotices.txt](ThirdPartyNotices.txt).

MIT у Code - OSS — это не лицензия продукта Visual Studio Code и не разрешение на товарные знаки Microsoft.

Forge — отдельная настольная IDE на базе [Code - OSS](https://github.com/microsoft/vscode) со встроенным официальным [Codex](https://github.com/openai/codex) как нативным агентом. Это не расширение VS Code и не отдельная чат-оболочка: редактор остаётся главным окном, Codex — в независимо масштабируемой боковой панели.

Исходники сейчас рассчитаны на **Windows x64**. Имя продукта — Forge AI IDE, идентификатор приложения — `forge-ai`.

### Возможности

- Полная IDE (редактор, терминал, SCM, Problems, уведомления, расширения) из Code - OSS.
- Сессии через официальный `codex app-server` (JSON-RPC / stdio), без собственной реализации runtime агента.
- В панели агента по умолчанию только Codex, без Local / Copilot.
- Потоковое редактирование: у официальных моделей — нативный `apply_patch`; у совместимых — хост-инструмент `write_file` и анимация записи.
- Патчи проходят approval и песочницу Codex; затем Accept / Reject / Revert в Changes / Multi Diff.
- Вход GitHub / Codex, отображение **оставшегося** лимита и плана.
- Свои модели в Codex Settings → Models; Ollama через `ollama list`, LM Studio — вручную.
- Вход GitHub / Codex / Grok / DeepSeek; официальные карточки моделей только для чтения.
- Режимы **Logos** (один агент) и **Dialectic** (Leader + Workers). Запуск — **Enter** или **Orchestrate**. CLI-воркеры требуют API-ключ или сохранённые учётные данные; при недоступности Forge переключается на Codex. См. [docs/FORGE-ORCHESTRATION.md](docs/FORGE-ORCHESTRATION.md).
- Live Edit: Logos — потоковый Diff; Dialectic — два независимых редактора.

При первом запуске копируются только `auth.json` и `config.toml` из `%USERPROFILE%\.codex`. Домашний каталог Forge: `%USERPROFILE%\.forge\codex`.

### Быстрый старт

```bat
start-forge.bat
```

Запускайте из подготовленного портативного дерева исходников. Журналы хранятся в `logs\<точное локальное время>\`; файлы журналов и блокировок в корне `logs` не создаются.

---

<h2 id="fayu">Français</h2>

### Licence

Ce dépôt n’est pas un arbre uniquement MIT.

- Code original **Forge** et **[Code - OSS](https://github.com/microsoft/vscode)** : [MIT](LICENSE.txt). L’avis de copyright Microsoft dans ce fichier est conservé.
- **[Codex](https://github.com/openai/codex)** sous `codex/` : [Apache-2.0](codex/LICENSE) et [NOTICE](codex/NOTICE).
- Portions de l’animation d’aperçu d’édition adaptées de **[Cline](https://github.com/cline/cline)** (Apache-2.0) ; texte intégral dans [ThirdPartyNotices.txt](ThirdPartyNotices.txt).
- Autres composants : [ThirdPartyNotices.txt](ThirdPartyNotices.txt).

Le MIT de Code - OSS n’est pas la licence produit de Visual Studio Code et n’accorde pas les marques Microsoft.

Forge est un IDE de bureau autonome basé sur [Code - OSS](https://github.com/microsoft/vscode), avec le runtime officiel [Codex](https://github.com/openai/codex) intégré comme agent natif. Ce n’est ni une extension VS Code, ni une coquille « chat only » : l’éditeur reste la vue principale, Codex occupe un panneau latéral redimensionnable.

Le dépôt cible actuellement **Windows x64**. Nom produit : Forge AI IDE. Identifiant : `forge-ai`.

### Fonctions

- IDE complet (éditeur, terminal, SCM, Problems, notifications, extensions) issu de Code - OSS.
- Sessions via `codex app-server` officiel (JSON-RPC / stdio), sans réimplémenter le runtime agent.
- Le panneau agent n’affiche que Codex (pas Local / Copilot).
- Édition en flux : `apply_patch` natif pour les modèles catalogue ; outil hôte `write_file` pour les modèles compatibles, puis animation d’écriture.
- Les rustines passent par l’approbation et le bac à sable Codex, puis Accept / Reject / Revert dans Changes / Multi Diff.
- Connexion GitHub / Codex, quota **restant** et forfait (pas la consommation).
- Modèles personnalisés dans Codex Settings → Models ; Ollama via `ollama list`, LM Studio en saisie manuelle.
- Comptes GitHub / Codex / Grok / DeepSeek ; cartes de modèles officielles en lecture seule.
- Modes **Logos** (un agent) et **Dialectic** (Leader + Workers). Démarrez avec **Entrée** ou **Orchestrate**. Les workers CLI exigent une clé API ou des identifiants enregistrés ; sinon Forge bascule sur Codex. Voir [docs/FORGE-ORCHESTRATION.md](docs/FORGE-ORCHESTRATION.md).
- Live Edit : Logos en Diff flux ; Dialectic avec deux volets d’éditeur.

Au premier lancement, seuls `auth.json` et `config.toml` sont **copiés** depuis `%USERPROFILE%\.codex`. Répertoire Forge : `%USERPROFILE%\.forge\codex`.

### Démarrage rapide

```bat
start-forge.bat
```

Exécutez-le depuis l’arborescence source portable préparée. Les journaux sont stockés dans `logs\<heure locale détaillée>\`; aucun journal ni verrou n’est créé à la racine de `logs`.

---

<h2 id="deyu">Deutsch</h2>

### Lizenz

Dieser Baum ist nicht ausschließlich MIT.

- Eigenanteil von **Forge** und **[Code - OSS](https://github.com/microsoft/vscode)**: [MIT](LICENSE.txt). Der Microsoft-Copyright-Hinweis in dieser Datei bleibt erhalten.
- **[Codex](https://github.com/openai/codex)** unter `codex/`: [Apache-2.0](codex/LICENSE) und [NOTICE](codex/NOTICE).
- Teile der Live-Edit-Vorschau stammen aus **[Cline](https://github.com/cline/cline)** (Apache-2.0); voller Text in [ThirdPartyNotices.txt](ThirdPartyNotices.txt).
- Weitere Komponenten: [ThirdPartyNotices.txt](ThirdPartyNotices.txt).

Das MIT von Code - OSS ist nicht die Visual-Studio-Code-Produktlizenz und gewährt keine Microsoft-Markenrechte.

Forge ist eine eigenständige Desktop-IDE auf Basis von [Code - OSS](https://github.com/microsoft/vscode) mit offiziellem [Codex](https://github.com/openai/codex) als nativem Agent. Es ist keine VS-Code-Erweiterung und keine reine Chat-Oberfläche. Der Editor bleibt die Hauptansicht, Codex sitzt in einer unabhängig skalierbaren Seitenleiste.

Der Quellbaum zielt derzeit auf **Windows x64**. Produktname: Forge AI IDE. Anwendungs-ID: `forge-ai`.

### Funktionen

- Volle IDE (Editor, Terminal, SCM, Problems, Benachrichtigungen, Erweiterungen) aus Code - OSS.
- Sitzungen über das offizielle `codex app-server` (JSON-RPC / stdio), ohne eigene Agent-Runtime.
- Agent-Fenster nur Codex, ohne Local / Copilot.
- Streaming-Edits: natives `apply_patch` für Katalogmodelle; Host-Tool `write_file` für kompatible Modelle, danach Schreibanimation.
- Patches durchlaufen Codex-Freigabe und Sandbox; danach Accept / Reject / Revert in Changes / Multi Diff.
- GitHub-/Codex-Anmeldung, **verbleibendes** Kontingent und Tarif (kein Verbrauch).
- Eigene Modelle in Codex Settings → Models; Ollama per `ollama list`, LM Studio manuell.
- Anmeldung GitHub / Codex / Grok / DeepSeek; offizielle schreibgeschützte Modellkarten.
- Modi **Logos** (ein Agent) und **Dialectic** (Leader + Workers). Start mit **Enter** oder **Orchestrate**. CLI-Worker brauchen API-Schlüssel oder gespeicherte Zugangsdaten; sonst fällt Forge auf Codex zurück. Siehe [docs/FORGE-ORCHESTRATION.md](docs/FORGE-ORCHESTRATION.md).
- Live Edit: Logos als Diff-Stream; Dialectic mit zwei Editor-Gruppen.

Beim ersten Start werden nur `auth.json` und `config.toml` aus `%USERPROFILE%\.codex` **kopiert**. Forge-Home: `%USERPROFILE%\.forge\codex`.

### Schnellstart

```bat
start-forge.bat
```

Aus dem vorbereiteten portablen Quellbaum starten. Protokolle liegen unter `logs\<genaue lokale Zeit>\`; im Stamm von `logs` werden keine Protokoll- oder Sperrdateien erzeugt.

---

<h2 id="xibanyayu">Español</h2>

### Licencia

Este árbol no es solo MIT.

- Código original de **Forge** y **[Code - OSS](https://github.com/microsoft/vscode)**: [MIT](LICENSE.txt). Se conserva el aviso de copyright de Microsoft de ese archivo.
- **[Codex](https://github.com/openai/codex)** en `codex/`: [Apache-2.0](codex/LICENSE) y [NOTICE](codex/NOTICE).
- Parte de la animación de vista previa de edición está adaptada de **[Cline](https://github.com/cline/cline)** (Apache-2.0); texto completo en [ThirdPartyNotices.txt](ThirdPartyNotices.txt).
- Otros componentes: [ThirdPartyNotices.txt](ThirdPartyNotices.txt).

El MIT de Code - OSS no es la licencia de producto de Visual Studio Code ni concede marcas de Microsoft.

Forge es un IDE de escritorio independiente basado en [Code - OSS](https://github.com/microsoft/vscode), con el [Codex](https://github.com/openai/codex) oficial integrado como agente nativo. No es una extensión de VS Code ni un visor solo de chat: el editor sigue siendo el panel principal y Codex vive en un panel lateral de tamaño independiente.

El código apunta ahora a **Windows x64**. Nombre del producto: Forge AI IDE. Id. de aplicación: `forge-ai`.

### Qué incluye

- IDE completo (editor, terminal, SCM, Problems, notificaciones, extensiones) de Code - OSS.
- Sesiones por el `codex app-server` oficial (JSON-RPC / stdio), sin reimplementar el runtime del agente.
- El panel de agente muestra solo Codex, no Local / Copilot.
- Edición en streaming: `apply_patch` nativo en modelos de catálogo; herramienta de host `write_file` en modelos compatibles, luego animación de escritura.
- Los parches pasan la aprobación y el sandbox de Codex; después Accept / Reject / Revert en Changes / Multi Diff.
- Inicio de sesión GitHub / Codex y cuota **restante** (no el consumo).
- Modelos propios en Codex Settings → Models; Ollama con `ollama list`, LM Studio manual.
- Inicio GitHub / Codex / Grok / DeepSeek; tarjetas oficiales de solo lectura.
- Modos **Logos** (un agente) y **Dialectic** (Leader + Workers). Inicia con **Enter** u **Orchestrate**. Los workers CLI requieren clave API o credenciales guardadas; si no están disponibles, Forge recurre a Codex. Ver [docs/FORGE-ORCHESTRATION.md](docs/FORGE-ORCHESTRATION.md).
- Live Edit: Logos con Diff en streaming; Dialectic con dos paneles de editor.

En el primer arranque solo se **copian** `auth.json` y `config.toml` desde `%USERPROFILE%\.codex`. Home de Forge: `%USERPROFILE%\.forge\codex`.

### Inicio rápido

```bat
start-forge.bat
```

Ejecuta desde el árbol de fuentes portátil ya preparado. Los registros se guardan en `logs\<hora local detallada>\`; no se crean registros ni archivos de bloqueo en la raíz de `logs`.
