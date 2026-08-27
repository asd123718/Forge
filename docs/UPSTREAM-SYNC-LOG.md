# Upstream sync log

One entry per Code-OSS or Codex pin move. Do not rewrite `main` history.

## 2026-08-19 — baseline snapshot

- Code-OSS pin: `package.json` `version` `1.134.0`, `distro`
  `c125b2a2432ff78b2d1f7b8ed8b0c67cf3af6187`
- Codex pin: `@openai/codex` as recorded in `package.json` and
  `build/codex/codex-version.txt`
- Git shape: initial snapshot on `main` (no microsoft/vscode ancestry)
- Forge files: see `scripts/forge/forge-delta-files.txt`
- Protocol: generated tree is pin-locked; do not hand-edit
- Replay: `pwsh scripts/forge/compare-upstream.ps1` when a local Code-OSS
  checkout at that distro hash is available
