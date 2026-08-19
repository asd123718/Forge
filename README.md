# Forge AI IDE

[English](#english) · [中文](#zhongwen) · [日本語](#ribenyu) · [한국어](#hanguoyu) · [Русский](#eyu) · [Français](#fayu) · [Deutsch](#deyu) · [Español](#xibanyayu)

[Licensing details](LICENSING.md)

---

<h2 id="english">English</h2>

### License

This is a mixed-license source tree.

- **Forge original work**: [Apache-2.0](LICENSE).
- **[Code - OSS](https://github.com/microsoft/vscode)**: [MIT](LICENSE.txt). The Microsoft copyright notice in that file is kept on purpose.
- **[Codex](https://github.com/openai/codex)** under `codex/`: [Apache-2.0](codex/LICENSE), plus [NOTICE](codex/NOTICE).
- Live edit preview animation: portions adapted from **[Cline](https://github.com/cline/cline)**, Apache-2.0 (full text in [ThirdPartyNotices.txt](ThirdPartyNotices.txt)).
- Other bundled components: [ThirdPartyNotices.txt](ThirdPartyNotices.txt).

See [LICENSING.md](LICENSING.md) for the exact scope of each license. The root Apache-2.0 license does not replace third-party notices or licenses.

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
- **Custom models**: configure OpenAI, DeepSeek, Qwen, Ollama, LM Studio, and similar providers in Codex Settings. Saved models go to `%USERPROFILE%\.forge\codex\forge-models.json`.
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
test/                # unit / smoke tests
scripts/             # dev launch and Forge helpers
└── forge/           # launcher, Codex staging, upstream checks
docs/                # architecture and roadmap
codex/               # upstream Codex runtime and app-server
start-forge.cmd      # Windows entry point
product.json         # product name, protocol, Windows setup ids
```

Seams: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Milestones: [docs/ROADMAP.md](docs/ROADMAP.md).

### Requirements

Building from source needs:

- Windows 10/11 x64
- [Node.js](https://nodejs.org/) **24.18.x** (see `.nvmrc`)
- Git
- A full `vscode-win32-x64` release build plus the repo’s Inno Setup (`node_modules/innosetup`) to produce an installer

Running a packaged `Forge.exe` does not require Node, Python, Visual Studio, or Rust on the machine.

### Quick start

If `.build\VSCode-win32-x64\Forge.exe` or `start-forge.exe` already exists:

```bat
start-forge.cmd
```

You can also run `.build\VSCode-win32-x64\Forge.exe` directly.

From source:

```bat
git clone https://github.com/asd123718/Forge.git
cd Forge
npm install
npm run compile
scripts\code.bat
```

Pass extra launch args with `scripts\forge\dev.ps1`.

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

### Windows installer

```bat
set BUILD_SOURCEVERSION=c125b2a2432ff78b2d1f7b8ed8b0c67cf3af6187
set VSCODE_QUALITY=stable
npm run gulp vscode-win32-x64
npm run gulp vscode-win32-x64-inno-updater
npm run gulp vscode-win32-x64-system-setup
```

Default installer: `.build\win32-x64\system-setup\VSCodeSetup.exe`. Release folder: `.build\VSCode-win32-x64` with `Forge.exe` and unpacked Codex natives. Unsigned installers may trigger SmartScreen.

`.gitignore` excludes `node_modules/` and `.build/`. Copying the source tree to another machine is not a release; run `npm install` and build again.

### Data and logs

| Path | Purpose |
| --- | --- |
| `%USERPROFILE%\.forge\codex` | Forge Codex home (config, sessions) |
| `%USERPROFILE%\.forge\codex\forge-models.json` | Custom providers and models |
| `%APPDATA%\.forge-ai\logs\` | Workbench and Agent Host logs |

If Codex does not start or sign-in does nothing:

`%APPDATA%\.forge-ai\logs\<date>\window1\exthost\agenthost\agenthost.log`

### Architecture

```
Workbench chat / editor / terminal
        │
   Agent Host (session state, approvals, FileEdit)
        │
   CodexAgent + event mapping
        │  JSON-RPC over stdio
   codex app-server
        │
   Codex Core (tools, sandbox, MCP, skills)
```

Streaming patches use `item/fileChange/patchUpdated`. `write_file` snapshots the file before disk write, then uses the same Live Edit preview. Hidden chain-of-thought is not reconstructed; the UI only renders public summaries and status from app-server.

---

<h2 id="zhongwen">中文</h2>

### 许可证

本仓库是一个混合许可证源码树。

- **Forge 自有代码**：[Apache-2.0](LICENSE)。
- **[Code - OSS](https://github.com/microsoft/vscode)**：[MIT](LICENSE.txt)。根目录文件里的 Microsoft 版权声明会保留。
- `codex/` 里的 **[Codex](https://github.com/openai/codex)** 运行时：[Apache-2.0](codex/LICENSE)，以及 [NOTICE](codex/NOTICE)。
- 实时改文件预览动画有一部分改编自 **[Cline](https://github.com/cline/cline)**，协议为 Apache-2.0（全文见 [ThirdPartyNotices.txt](ThirdPartyNotices.txt)）。
- 其余第三方组件见 [ThirdPartyNotices.txt](ThirdPartyNotices.txt)。

各许可证的准确适用范围见 [LICENSING.md](LICENSING.md)。根目录 Apache-2.0 不会覆盖或移除第三方版权、署名和许可证声明。

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
- **自定义模型**：在 Codex Settings 里配置 OpenAI、DeepSeek、通义、Ollama、LM Studio 等提供商；保存的模型写入 `%USERPROFILE%\.forge\codex\forge-models.json`。
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

见上方 English 一节的目录树。更细的接缝说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，里程碑见 [docs/ROADMAP.md](docs/ROADMAP.md)。

### 环境要求

- Windows 10/11 x64
- [Node.js](https://nodejs.org/) **24.18.x**（见 `.nvmrc`）
- Git
- 打安装包还需要完整的 `vscode-win32-x64` 发布构建和仓库自带的 Inno Setup

日常运行已打包的 `Forge.exe` 不要求本机安装 Node、Python、Visual Studio 或 Rust。

### 快速开始

已有 `.build\VSCode-win32-x64\Forge.exe` 或 `start-forge.exe` 时运行 `start-forge.cmd`。从源码：

```bat
git clone https://github.com/asd123718/Forge.git
cd Forge
npm install
npm run compile
scripts\code.bat
```

本地 Codex 源码二进制：`scripts\forge\stage-codex.ps1`。

### Codex 使用说明

1. 打开右侧 Agent / 聊天窗，应默认就是 Codex。
2. 点 **Open Codex Settings**。
3. **登录 Codex** 走官方 OAuth；失败时设置页给出具体错误。
4. 模型提供商可选云端或本地；Ollama 会尝试读取 `ollama list`。
5. 每个提供商、每个已保存模型名都有开关，打开后才会出现在模型列表里。

自定义模型使用 JSON 工具 `write_file`（`path` + 完整 `contents`）。不要把该工具命名为 `apply_patch`，也不要通过 `shell_command` 调用 `apply_patch.bat`。

### 打 Windows 安装包

```bat
set BUILD_SOURCEVERSION=c125b2a2432ff78b2d1f7b8ed8b0c67cf3af6187
set VSCODE_QUALITY=stable
npm run gulp vscode-win32-x64
npm run gulp vscode-win32-x64-inno-updater
npm run gulp vscode-win32-x64-system-setup
```

产物：`.build\win32-x64\system-setup\VSCodeSetup.exe`。未签名安装包可能出现 SmartScreen 提示。

### 数据与日志

| 路径 | 用途 |
| --- | --- |
| `%USERPROFILE%\.forge\codex` | Forge 专用 Codex home |
| `%USERPROFILE%\.forge\codex\forge-models.json` | 自定义提供商与模型 |
| `%APPDATA%\.forge-ai\logs\` | 工作台与 Agent Host 日志 |

Codex 起不来时看：`%APPDATA%\.forge-ai\logs\<日期>\window1\exthost\agenthost\agenthost.log`

---

<h2 id="ribenyu">日本語</h2>

### ライセンス

このリポジトリは複数ライセンスのソースツリーです。

- **Forge 独自部分**：[Apache-2.0](LICENSE)。
- **[Code - OSS](https://github.com/microsoft/vscode)**：[MIT](LICENSE.txt)。ファイル内の Microsoft 著作権表示は残します。
- `codex/` の **[Codex](https://github.com/openai/codex)**：[Apache-2.0](codex/LICENSE) と [NOTICE](codex/NOTICE)。
- ライブ編集プレビューの一部は **[Cline](https://github.com/cline/cline)** 由来（Apache-2.0）。全文は [ThirdPartyNotices.txt](ThirdPartyNotices.txt)。
- その他の第三者通知：[ThirdPartyNotices.txt](ThirdPartyNotices.txt)。

各ライセンスの適用範囲は [LICENSING.md](LICENSING.md) を参照してください。ルートの Apache-2.0 は第三者の著作権表示やライセンスを置き換えません。

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
- **カスタムモデル**：OpenAI、DeepSeek、Qwen、Ollama、LM Studio などを Codex Settings で設定。保存先は `%USERPROFILE%\.forge\codex\forge-models.json`。
- **中国語 UI**：Appearance の Language から簡体字パックを有効化できます。

### 他製品との関係

初回起動時、既存の `%USERPROFILE%\.codex` から `auth.json` と `config.toml` だけを**コピー**します。キャッシュやセッションは共有しません。設定ホームは `%USERPROFILE%\.forge\codex` です。

### クイックスタート

```bat
git clone https://github.com/asd123718/Forge.git
cd Forge
npm install
npm run compile
scripts\code.bat
```

ビルド要件：Windows 10/11 x64、Node.js **24.18.x**、Git。インストーラ作成は `npm run gulp vscode-win32-x64` など（English 節と同じコマンド）。

---

<h2 id="hanguoyu">한국어</h2>

### 라이선스

이 저장소는 여러 라이선스가 함께 적용되는 소스 트리입니다.

- **Forge 자체 코드**: [Apache-2.0](LICENSE).
- **[Code - OSS](https://github.com/microsoft/vscode)**: [MIT](LICENSE.txt). 파일의 Microsoft 저작권 고지는 유지합니다.
- `codex/`의 **[Codex](https://github.com/openai/codex)**: [Apache-2.0](codex/LICENSE) 및 [NOTICE](codex/NOTICE).
- 라이브 편집 미리보기의 일부는 **[Cline](https://github.com/cline/cline)**에서 각색(Apache-2.0). 전문은 [ThirdPartyNotices.txt](ThirdPartyNotices.txt).
- 기타 구성 요소: [ThirdPartyNotices.txt](ThirdPartyNotices.txt).

각 라이선스의 정확한 적용 범위는 [LICENSING.md](LICENSING.md)를 참고하세요. 루트 Apache-2.0은 제3자 저작권, 고지 또는 라이선스를 대체하지 않습니다.

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
- **사용자 모델**: OpenAI, DeepSeek, Qwen, Ollama, LM Studio 등을 Codex Settings에서 설정합니다. 저장 위치는 `%USERPROFILE%\.forge\codex\forge-models.json`입니다.

첫 실행 시 기존 `%USERPROFILE%\.codex`에서 `auth.json`과 `config.toml`만 **복사**합니다. Forge 홈은 `%USERPROFILE%\.forge\codex`입니다.

### 빠른 시작

```bat
git clone https://github.com/asd123718/Forge.git
cd Forge
npm install
npm run compile
scripts\code.bat
```

요구 사항: Windows 10/11 x64, Node.js **24.18.x**, Git. 설치 패키지 명령은 English 절과 같습니다.

---

<h2 id="eyu">Русский</h2>

### Лицензия

В репозитории используется несколько лицензий.

- Собственный код **Forge**: [Apache-2.0](LICENSE).
- **[Code - OSS](https://github.com/microsoft/vscode)**: [MIT](LICENSE.txt). Уведомление об авторских правах Microsoft в этом файле сохраняется.
- **[Codex](https://github.com/openai/codex)** в `codex/`: [Apache-2.0](codex/LICENSE) и [NOTICE](codex/NOTICE).
- Часть анимации предпросмотра правок адаптирована из **[Cline](https://github.com/cline/cline)** (Apache-2.0); полный текст в [ThirdPartyNotices.txt](ThirdPartyNotices.txt).
- Прочие компоненты: [ThirdPartyNotices.txt](ThirdPartyNotices.txt).

Точная область действия каждой лицензии описана в [LICENSING.md](LICENSING.md). Корневая Apache-2.0 не заменяет лицензии и уведомления третьих лиц.

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
- Свои модели (OpenAI, DeepSeek, Qwen, Ollama, LM Studio) в Codex Settings; файл `%USERPROFILE%\.forge\codex\forge-models.json`.

При первом запуске копируются только `auth.json` и `config.toml` из `%USERPROFILE%\.codex`. Домашний каталог Forge: `%USERPROFILE%\.forge\codex`.

### Быстрый старт

```bat
git clone https://github.com/asd123718/Forge.git
cd Forge
npm install
npm run compile
scripts\code.bat
```

Нужны Windows 10/11 x64, Node.js **24.18.x**, Git. Команды сборки установщика — в разделе English.

---

<h2 id="fayu">Français</h2>

### Licence

Ce dépôt contient plusieurs licences.

- Code original **Forge** : [Apache-2.0](LICENSE).
- **[Code - OSS](https://github.com/microsoft/vscode)** : [MIT](LICENSE.txt). L’avis de copyright Microsoft dans ce fichier est conservé.
- **[Codex](https://github.com/openai/codex)** sous `codex/` : [Apache-2.0](codex/LICENSE) et [NOTICE](codex/NOTICE).
- Portions de l’animation d’aperçu d’édition adaptées de **[Cline](https://github.com/cline/cline)** (Apache-2.0) ; texte intégral dans [ThirdPartyNotices.txt](ThirdPartyNotices.txt).
- Autres composants : [ThirdPartyNotices.txt](ThirdPartyNotices.txt).

Voir [LICENSING.md](LICENSING.md) pour le périmètre exact de chaque licence. La licence Apache-2.0 à la racine ne remplace pas les licences ou avis de tiers.

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
- Modèles personnalisés (OpenAI, DeepSeek, Qwen, Ollama, LM Studio) dans Codex Settings ; fichier `%USERPROFILE%\.forge\codex\forge-models.json`.

Au premier lancement, seuls `auth.json` et `config.toml` sont **copiés** depuis `%USERPROFILE%\.codex`. Répertoire Forge : `%USERPROFILE%\.forge\codex`.

### Démarrage rapide

```bat
git clone https://github.com/asd123718/Forge.git
cd Forge
npm install
npm run compile
scripts\code.bat
```

Prérequis : Windows 10/11 x64, Node.js **24.18.x**, Git. Commandes d’installeur : voir English.

---

<h2 id="deyu">Deutsch</h2>

### Lizenz

Dieser Quellbaum enthält mehrere Lizenzen.

- Eigenanteil von **Forge**: [Apache-2.0](LICENSE).
- **[Code - OSS](https://github.com/microsoft/vscode)**: [MIT](LICENSE.txt). Der Microsoft-Copyright-Hinweis in dieser Datei bleibt erhalten.
- **[Codex](https://github.com/openai/codex)** unter `codex/`: [Apache-2.0](codex/LICENSE) und [NOTICE](codex/NOTICE).
- Teile der Live-Edit-Vorschau stammen aus **[Cline](https://github.com/cline/cline)** (Apache-2.0); voller Text in [ThirdPartyNotices.txt](ThirdPartyNotices.txt).
- Weitere Komponenten: [ThirdPartyNotices.txt](ThirdPartyNotices.txt).

Der genaue Geltungsbereich jeder Lizenz steht in [LICENSING.md](LICENSING.md). Apache-2.0 im Stammverzeichnis ersetzt keine Lizenzen oder Hinweise Dritter.

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
- Eigene Modelle (OpenAI, DeepSeek, Qwen, Ollama, LM Studio) in Codex Settings; Datei `%USERPROFILE%\.forge\codex\forge-models.json`.

Beim ersten Start werden nur `auth.json` und `config.toml` aus `%USERPROFILE%\.codex` **kopiert**. Forge-Home: `%USERPROFILE%\.forge\codex`.

### Schnellstart

```bat
git clone https://github.com/asd123718/Forge.git
cd Forge
npm install
npm run compile
scripts\code.bat
```

Voraussetzungen: Windows 10/11 x64, Node.js **24.18.x**, Git. Installer-Befehle stehen im Abschnitt English.

---

<h2 id="xibanyayu">Español</h2>

### Licencia

Este repositorio contiene varias licencias.

- Código original de **Forge**: [Apache-2.0](LICENSE).
- **[Code - OSS](https://github.com/microsoft/vscode)**: [MIT](LICENSE.txt). Se conserva el aviso de copyright de Microsoft de ese archivo.
- **[Codex](https://github.com/openai/codex)** en `codex/`: [Apache-2.0](codex/LICENSE) y [NOTICE](codex/NOTICE).
- Parte de la animación de vista previa de edición está adaptada de **[Cline](https://github.com/cline/cline)** (Apache-2.0); texto completo en [ThirdPartyNotices.txt](ThirdPartyNotices.txt).
- Otros componentes: [ThirdPartyNotices.txt](ThirdPartyNotices.txt).

Consulta [LICENSING.md](LICENSING.md) para ver el alcance exacto de cada licencia. Apache-2.0 en la raíz no sustituye las licencias ni los avisos de terceros.

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
- Modelos propios (OpenAI, DeepSeek, Qwen, Ollama, LM Studio) en Codex Settings; archivo `%USERPROFILE%\.forge\codex\forge-models.json`.

En el primer arranque solo se **copian** `auth.json` y `config.toml` desde `%USERPROFILE%\.codex`. Home de Forge: `%USERPROFILE%\.forge\codex`.

### Inicio rápido

```bat
git clone https://github.com/asd123718/Forge.git
cd Forge
npm install
npm run compile
scripts\code.bat
```

Requisitos: Windows 10/11 x64, Node.js **24.18.x**, Git. Comandos del instalador: sección English.
