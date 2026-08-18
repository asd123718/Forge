# Forge AI IDE

Forge is a standalone desktop IDE based on [Code - OSS](https://github.com/microsoft/vscode). It embeds the official [Codex](https://github.com/openai/codex) runtime as a native agent. It is not a VS Code extension and it does not replace the editor with a chat-only shell. The editor stays the main pane; Codex lives in a separately resizable side pane.

The source tree currently targets **Windows x64**. The product name is Forge AI IDE. The application id is `forge-ai`.

A Windows x64 beta installer is on [GitHub Releases](https://github.com/asd123718/Forge/releases/tag/v0.1.0-beta) (`v0.1.0-beta`, pre-release).

## What you get

- **Full IDE**: editor, terminal, SCM, Problems, notifications, and the extension system from Code - OSS.
- **Native Codex**: sessions run through the official `codex app-server` over JSON-RPC / stdio. Forge does not reimplement the agent runtime.
- **Codex only**: the agent pane defaults to Codex and does not mix in Local or Copilot session types.
- **Streaming file edits**: catalog Codex models can stream native `apply_patch` diffs. Compatible / custom models use the host `write_file` tool, then play a write animation in the editor.
- **Approvals and changes**: patches still go through Codex approval and sandboxing. Afterward you can Accept, Reject, or Revert in Changes / Multi Diff.
- **Accounts and remaining quota**: the chat title and Codex Settings Account page support GitHub and Codex sign-in, and show remaining allowance, identity, and plan (not consumed usage).
- **Custom models**: configure OpenAI, DeepSeek, Qwen, Ollama, LM Studio, and similar providers in Codex Settings. Saved models go to `%USERPROFILE%\.forge\codex\forge-models.json`.
- **Chinese UI**: Codex Settings → Appearance → Language can enable the built-in Simplified Chinese language pack.

## How it relates to other products

| | Forge | VS Code | Codex Desktop |
| --- | --- | --- | --- |
| Workbench | Full Code - OSS IDE | Official distribution | Standalone client |
| Agent | Built-in official Codex `app-server` | Extensions or other agents | Official Codex |
| Config home | `%USERPROFILE%\.forge\codex` | n/a | `%USERPROFILE%\.codex` |
| Sign-in | Can reuse existing `auth.json` / `config.toml` | GitHub and others | ChatGPT / Codex |

On first launch Forge **copies** only `auth.json` and `config.toml` from an existing `%USERPROFILE%\.codex` install. Model caches, sessions, and databases are not shared, so schema collisions are avoided when Forge and Codex Desktop update on different schedules.

## Repository layout

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

## Requirements

Building from source needs:

- Windows 10/11 x64
- [Node.js](https://nodejs.org/) **24.18.x** (see `.nvmrc`)
- Git
- A full `vscode-win32-x64` release build plus the repo’s Inno Setup (`node_modules/innosetup`) to produce an installer

Running a packaged `Forge.exe` does not require Node, Python, Visual Studio, or Rust on the machine.

## Quick start

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

## Using Codex

1. Open the right-hand agent / chat pane. It should already be Codex.
2. Click **Open Codex Settings**.
3. **Sign in to Codex** uses official OAuth. Failures show a concrete error on the settings page.
4. **Model provider**: pick a cloud or local vendor. Ollama tries `ollama list`. Cloud providers need a base URL and API key.
5. Each provider and each saved model name has a switch. Only enabled entries appear in the agent model picker.

In installed builds, the Codex binary lives under `node_modules.asar.unpacked\@openai\codex-win32-x64\...`. Agent Host prefers that unpacked `codex.exe` and uses an existence check on Windows (not Unix execute bits).

For custom / compatible models the host registers a JSON tool named `write_file` (`path` + full `contents`). Do not name it `apply_patch`: a second tool with that name panics Codex if native `apply_patch` is already registered. Do not call `apply_patch.bat` through `shell_command` on Windows.

## Windows installer

A packaged beta build is already published:

https://github.com/asd123718/Forge/releases/tag/v0.1.0-beta

To rebuild from this tree:

```bat
set BUILD_SOURCEVERSION=c125b2a2432ff78b2d1f7b8ed8b0c67cf3af6187
set VSCODE_QUALITY=stable
npm run gulp vscode-win32-x64
npm run gulp vscode-win32-x64-inno-updater
npm run gulp vscode-win32-x64-system-setup
```

Default installer output: `.build\win32-x64\system-setup\VSCodeSetup.exe`. Release folder: `.build\VSCode-win32-x64` with `Forge.exe` and unpacked Codex natives. Unsigned installers may trigger SmartScreen.

`.gitignore` excludes `node_modules/` and `.build/`. Copying the source tree to another machine is not a release; run `npm install` and build again.

## Data and logs

| Path | Purpose |
| --- | --- |
| `%USERPROFILE%\.forge\codex` | Forge Codex home (config, sessions) |
| `%USERPROFILE%\.forge\codex\forge-models.json` | Custom providers and models |
| `%APPDATA%\.forge-ai\logs\` | Workbench and Agent Host logs |

If Codex does not start or sign-in does nothing:

`%APPDATA%\.forge-ai\logs\<date>\window1\exthost\agenthost\agenthost.log`

## Architecture

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

## License

MIT ([LICENSE.txt](LICENSE.txt)). The tree is based on Microsoft Code - OSS and includes OpenAI Codex runtime. Also see `ThirdPartyNotices.txt`.
