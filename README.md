# Forge AI IDE

Forge is a standalone Code - OSS distribution with Codex embedded as its
native agent runtime. It is not a VS Code extension. The workbench, editors,
terminal, SCM, Problems view, notifications, and Sessions UI come from Code -
OSS; agent execution comes from the official Codex `app-server` and Codex Core.

## Repository layout

- `src`, `extensions`, `build`, `resources`, `test` — the normal Code - OSS
  source layout, with Forge's native Codex integration kept in its upstream
  Agent Host locations.
- `codex` — the upstream Codex runtime and `app-server` source.
- `scripts/forge` — Forge-specific staging and validation helpers.
- `docs` — Forge architecture, protocol mapping, and delivery roadmap.
- `.build/forge-runtime` — project-local Node 24 and npm 11 toolchain.
- `.build/electron` — the embedded Electron runtime used for normal launches.
- `start-forge.exe` — recommended native-looking Windows GUI launcher with no console window.
- `start-forge.vbs` — script fallback with the same launch behavior.
- `start-forge.cmd` — compatibility launcher that delegates to the EXE (or VBS fallback).

The repository root now follows the Code - OSS layout directly; there is no
nested `vscode` directory. Everything needed to launch the prepared project
lives below this directory.

## One-click start on Windows

Double-click `start-forge.exe` for a launch with no Command Prompt window. From
an existing terminal, `start-forge.cmd` remains available as a compatible entry
point. The launcher's auditable source lives at
`scripts/forge/ForgeLauncher.cs`; developers can rebuild it with
`scripts/forge/build-launcher.ps1`. The executable icon is generated from the
same official Codicon `agent` geometry used by Forge's pulsing startup mark.

The launcher performs no package installation, compilation, or download. It
starts the embedded Electron runtime and uses the bundled project-local
dependencies, so system Node, npm, Python, Visual Studio, and Rust are not
required for a normal launch.

Forge keeps Codex runtime data in `%USERPROFILE%\.forge\codex`. On the first
launch it copies only `auth.json` and `config.toml` from an existing
`%USERPROFILE%\.codex` installation. Model caches, sessions, and databases are
never shared with another Codex client, which prevents schema collisions when
Forge and Codex Desktop update at different times.

The Codex chat title includes GitHub and Codex account buttons. Its popup and
the `Account` page in Codex settings show remaining allowances (never consumed
amounts), identity, plan information, refresh controls, and sign-in/sign-out
actions using the existing GitHub authentication and Codex app-server state.

This working tree is prepared for local Windows x64 launches. Because upstream
Code - OSS ignores `.build` and `node_modules`, copy or archive the complete
directory when moving it to another machine. A distributable release should
rebuild the native modules from source in CI and package the resulting runtime
rather than relying on the development tree.

To exercise the local Codex source instead of the official binary pinned by
Code - OSS, developers can run `scripts\forge\stage-codex.ps1`. The staged
binary is then selected automatically. No Codex protocol or runtime is
reimplemented in Forge.

Developer builds still require the normal upstream toolchains. Advanced launch
arguments can be passed through `scripts\forge\dev.ps1`.

## Current milestone

The minimum end-to-end path is wired:

`Forge → Agent Host → codex app-server → thread/turn stream → native chat and
tool cards → streaming native file-edit snapshots → Changes/Multi Diff → Codex
approval → workspace update → editor refresh`.

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the audited upstream seams and
[ROADMAP.md](docs/ROADMAP.md) for the remaining product milestones.
