# Delivery roadmap

## M0 — audited foundation

- [x] Verify the real Code - OSS Agent Host, Sessions, Changes, and Codex bridge.
- [x] Verify app-server JSON-RPC/stdio, generated protocol provenance, and local
  Codex Core ownership boundaries.
- [x] Rebrand the independent product as Forge without rewriting workbench UI.
- [x] Enable the native Codex provider, native editor routing, and direct
  ChatGPT sign-in path by default.

## M1 — minimum end-to-end IDE path

- [x] Spawn the official Codex app-server binary through the existing bridge.
- [x] Reuse account login, thread creation, turns, interruption, streaming
  agent messages, public reasoning summaries/status, tools, and approvals.
- [x] Stream file patch previews into DB-backed native file-edit content.
- [x] Preserve final disk snapshots and the existing checkpoint/changeset
  Accept, Reject, and Revert pipeline.
- [ ] Complete packaged-product signing, installer assets, update feed, and a
  clean-machine smoke test.

## M2 — file-operation completeness

- [ ] Give create/delete/rename/move first-class streaming preview identities;
  the current final checkpoint is authoritative, while move previews use the
  source path until completion.
- [ ] Automatically focus the first active file in native Multi Diff without
  stealing focus repeatedly on later deltas.
- [ ] Add conflict UX for user edits that overlap a streaming agent patch.
- [ ] Add multi-root and worktree-isolation integration tests.

## M3 — IDE-native tool surfaces

- [ ] Mirror command PTY streams into a dedicated native terminal when useful,
  while retaining complete stdout/stderr in tool cards.
- [ ] Map compiler/test diagnostics into Problems when a stable parser or task
  integration exists; do not infer diagnostics from arbitrary terminal text.
- [ ] Add SCM decorations and per-file operation state during active turns.
- [ ] Add richer MCP resource and notification presentation.

## M4 — full Codex product surface

- [ ] Product QA for history/resume/fork/rollback, models and reasoning effort,
  skills, plugins, MCP authentication, memory citations, plans, subagents,
  steering, compaction, usage/rate limits, and guardian review.
- [ ] Build UI for app-server features currently intentionally ignored by the
  upstream bridge only where they improve IDE workflows (goals, selected
  thread settings/status, and remote control).
- [ ] Add protocol compatibility telemetry and a user-facing diagnostics page.

## M5 — sustainable distribution

- [ ] CI matrix for Windows, macOS, and Linux builds of both upstreams.
- [ ] Protocol-generation drift check against the pinned Codex package.
- [ ] Automated upstream merge rehearsal and focused bridge test suite.
- [ ] Release channel, crash reporting policy, privacy documentation, licenses,
  and reproducible installer builds.

Features are promoted only after exercising the real app-server event; Forge
does not fabricate reasoning, tool progress, permission state, or success.
