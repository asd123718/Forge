# Forge delta inventory

This repository started as a **single snapshot commit**, not a replay of
microsoft/vscode history. Do not rebase `main` onto Code-OSS ancestry.

Forge-owned paths are listed in `scripts/forge/forge-delta-files.txt` (one path
per line, `#` comments allowed). That list is what `list-delta.ps1` and
`compare-upstream.ps1` replay.

Categories:

- Codex bridge and Live Edit: `src/vs/platform/agentHost/node/codex/codexFileEditObserver.ts`, mapper/agent call sites, `FileEditTracker` identity options
- Workbench surfaces: `src/vs/workbench/contrib/forge/**`, `liveEditPreview.ts`, Sessions `streamingEditPreview.ts`
- Multi-agent orchestration: `src/vs/platform/agentHost/{common,node,test}/**/orchestration/**`, `docs/FORGE-ORCHESTRATION.md`
- Product identity: `product.json`
- Scripts: `scripts/forge/**`
- Docs: `docs/**`, root `README.md`, `LICENSING.md`
- Source launcher / icons: `start-forge.bat` and `resources/win32/**`

Generated protocol under `src/vs/platform/agentHost/node/codex/protocol/generated`
is **not** a Forge edit surface. Never hand-edit it; regenerate with
`npm run codex:gen-protocol`.

After a Code-OSS sync, record the tag, touched Forge files, and whether protocol
was regenerated in `docs/UPSTREAM-SYNC-LOG.md`.
